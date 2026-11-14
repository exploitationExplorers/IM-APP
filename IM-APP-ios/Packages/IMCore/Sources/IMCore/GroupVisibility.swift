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
    public init() {}
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
        var next = state
        for row in incoming where row.minVisibleSeq >= 0 && row.revision >= 0 {
            let old = next.floors[row.conversationId]
            if let old = old, row.revision < old.revision { continue }
            next.floors[row.conversationId] = GroupRetentionState(conversationId: row.conversationId, minVisibleSeq: max(old?.minVisibleSeq ?? 0, row.minVisibleSeq), revision: max(old?.revision ?? 0, row.revision))
        }
        try commit(next); return state
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
