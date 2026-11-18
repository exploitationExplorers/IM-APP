import Foundation

public enum GroupMemberRole: String, Sendable {
    case owner, admin, member, unknown

    public init(serverValue: String?) {
        switch serverValue {
        case "owner", "100": self = .owner
        case "admin", "60": self = .admin
        case "member", "20": self = .member
        default: self = .unknown
        }
    }

    public var canManage: Bool { self == .owner || self == .admin }

    public func canModerate(target: GroupMemberRole, isSelf: Bool) -> Bool {
        guard !isSelf, target != .owner, target != .unknown else { return false }
        return self == .owner || (self == .admin && target == .member)
    }
}

/// 首页角标合并真实未读与待审核申请；只有免打扰消息时显示圆点。
public struct HomeChatBadge: Equatable, Sendable {
    public let count: Int
    public let mutedOnly: Bool

    public init(unmutedUnread: Int, mutedUnread: Int, pendingJoinRequests: Int) {
        let pending = min(100, max(0, pendingJoinRequests))
        let unread = min(100, max(0, unmutedUnread))
        mutedOnly = pending == 0 && unread == 0 && mutedUnread > 0
        count = mutedOnly ? 1 : min(100, unread + pending)
    }
}

public struct PendingGroupJoinCount: Decodable, Equatable, Sendable {
    public let groupID: String
    public let count: Int

    private enum CodingKeys: String, CodingKey { case groupId, count }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        groupID = try container.decode(String.self, forKey: .groupId)
        let count = try container.decode(Int.self, forKey: .count)
        guard count >= 0 else {
            throw DecodingError.dataCorruptedError(forKey: .count, in: container, debugDescription: "Negative pending request count")
        }
        self.count = count
    }

    /// 按群去重并在展示上限截断，避免异常计数溢出。
    public static func badgeTotal(_ rows: [Self]) -> Int {
        var counts: [String: Int] = [:]
        for row in rows { counts[row.groupID] = row.count }
        return counts.values.reduce(0) { min(100, $0 + min(100, $1)) }
    }
}
