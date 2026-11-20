import Foundation

public struct GroupRetentionState: Codable, Equatable, Sendable {
    public let conversationId: String
    public let minVisibleSeq: Int
    public let revision: Int
    public init(conversationId: String, minVisibleSeq: Int, revision: Int) { self.conversationId = conversationId; self.minVisibleSeq = minVisibleSeq; self.revision = revision }
}
public struct GroupMessagePurge: Codable, Equatable, Sendable {
    public let userId: String; public let purgedAt: String
    public init(userId: String, purgedAt: String) { self.userId = userId; self.purgedAt = purgedAt }
}
public struct GroupVisibility: Codable, Equatable, Sendable {
    public var floors: [String: GroupRetentionState] = [:]
    public var purges: [String: [String: Int64]] = [:]
    public var hiddenMessageIDs = Set<String>()
    // Optional for archives written before successful empty retention queries were recorded.
    fileprivate var checkedRetentionIDs: Set<String>?
    public init() {}
    public static func supportsRetention(_ conversationID: String) -> Bool {
        conversationID.range(of: "^sg_[0-9a-f]{32}$", options: .regularExpression) != nil
    }
    public func hasCheckedRetention(_ conversationID: String) -> Bool {
        floors[conversationID] != nil || checkedRetentionIDs?.contains(conversationID) == true
    }
    /// 保留水位与成员清理快照都曾确认，才允许离线展示群历史。
    public func hasConfirmedBoundary(_ conversationID: String) -> Bool {
        hasCheckedRetention(conversationID) && purges[conversationID] != nil
    }
    public var confirmedBoundaryIDs: Set<String> {
        Set(floors.keys).union(checkedRetentionIDs ?? []).filter { hasConfirmedBoundary($0) }
    }
    /// Badge metadata can use the checked retention floor without exposing message content.
    public func groupUnreadCount(_ count: Int, latest: ChatTextItem, conversationID: String) -> Int {
        guard count > 0, hasCheckedRetention(conversationID), permits(latest, conversationID: conversationID) else { return 0 }
        guard let floor = floors[conversationID], floor.minVisibleSeq > 0, latest.seq > 0 else { return count }
        return min(count, latest.seq - floor.minVisibleSeq + 1)
    }
    public func permits(_ item: ChatTextItem, conversationID: String) -> Bool {
        if hiddenMessageIDs.contains(item.id) { return false }
        if item.seq > 0, let floor = floors[conversationID], item.seq < floor.minVisibleSeq { return false }
        if let purge = purges[conversationID]?[Self.businessUserID(item.senderID)], item.timestamp <= purge { return false }
        return true
    }
    public static func businessUserID(_ id: String) -> String {
        let id = id.lowercased()
        if UUID(uuidString: id) != nil { return id }
        guard id.count == 32, id.range(of: "^[0-9a-f]{32}$", options: .regularExpression) != nil else { return "" }
        let array = Array(id); return [String(array[0..<8]), String(array[8..<12]), String(array[12..<16]), String(array[16..<20]), String(array[20..<32])].joined(separator: "-")
    }
}
public enum GroupRetentionSnapshotError: Error {
    case invalidResponse
}
/// 账号/环境隔离的可见性水位只增不减，旧回调不能恢复已过期/已清理的消息。
public actor GroupVisibilityLedger {
    private struct Archive: Codable { let owner: String; let visibility: GroupVisibility }
    private let file: URL; private let owner: String; private var state: GroupVisibility
    public init(file: URL, owner: String) throws {
        self.file = file; self.owner = owner
        if FileManager.default.fileExists(atPath: file.path) {
            let data = try JSONDecoder().decode(Archive.self, from: Data(contentsOf: file))
            guard data.owner == owner else { throw OutboxError.wrongOwner }; state = data.visibility
        } else { state = GroupVisibility() }
    }
    public func snapshot() -> GroupVisibility { state }
    public func hide(_ ids: Set<String>) throws -> GroupVisibility { var next = state; next.hiddenMessageIDs.formUnion(ids); try commit(next); return state }
    public func apply(_ incoming: [GroupRetentionState]) throws -> GroupVisibility {
        let next = merging(incoming, into: state)
        try commit(next)
        return state
    }
    /// A successful empty response means no published cleanup watermark, not an unavailable chat.
    /// Membership and the member-purge snapshot must still be confirmed independently.
    public func applyRetentionSnapshot(_ incoming: [GroupRetentionState], requested: Set<String>) throws -> GroupVisibility {
        guard !requested.isEmpty, requested.count <= 50,
              requested.allSatisfy(GroupVisibility.supportsRetention),
              incoming.count <= requested.count else { throw GroupRetentionSnapshotError.invalidResponse }
        var seen = Set<String>()
        guard incoming.allSatisfy({ requested.contains($0.conversationId)
            && seen.insert($0.conversationId).inserted && $0.minVisibleSeq >= 0 && $0.revision >= 0
        }) else { throw GroupRetentionSnapshotError.invalidResponse }
        var next = merging(incoming, into: state)
        next.checkedRetentionIDs = (next.checkedRetentionIDs ?? []).union(requested)
        try commit(next)
        return state
    }
    private func merging(_ incoming: [GroupRetentionState], into state: GroupVisibility) -> GroupVisibility {
        var next = state
        for row in incoming where row.minVisibleSeq >= 0 && row.revision >= 0 {
            let old = next.floors[row.conversationId]
            if let old = old, row.revision < old.revision { continue }
            next.floors[row.conversationId] = GroupRetentionState(conversationId: row.conversationId, minVisibleSeq: max(old?.minVisibleSeq ?? 0, row.minVisibleSeq), revision: max(old?.revision ?? 0, row.revision))
        }
        return next
    }
    public func applyPurges(_ incoming: [GroupMessagePurge], conversationID: String) throws -> GroupVisibility {
        var next = state; var purges = next.purges[conversationID] ?? [:]
        let formatter = ISO8601DateFormatter(); formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let fallback = ISO8601DateFormatter()
        for purge in incoming {
            guard let date = formatter.date(from: purge.purgedAt) ?? fallback.date(from: purge.purgedAt) else { continue }
            let user = GroupVisibility.businessUserID(purge.userId); guard !user.isEmpty else { continue }
            purges[user] = max(purges[user] ?? 0, Int64(date.timeIntervalSince1970 * 1000))
        }
        next.purges[conversationID] = purges; try commit(next); return state
    }
    private func commit(_ next: GroupVisibility) throws {
        let data = try JSONEncoder().encode(Archive(owner: owner, visibility: next))
        #if os(iOS)
        try data.write(to: file, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        #else
        try data.write(to: file, options: .atomic)
        #endif
        state = next
    }
}
