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

/// 底部聊天角标只统计消息未读；待审核申请使用群会话的独立提醒。
public struct HomeChatBadge: Equatable, Sendable {
    public let count: Int
    public let mutedOnly: Bool

    public init(unmutedUnread: Int, mutedUnread: Int) {
        let unread = min(100, max(0, unmutedUnread))
        mutedOnly = unread == 0 && mutedUnread > 0
        count = mutedOnly ? 1 : unread
    }
}

public struct PendingGroupJoinCount: Decodable, Equatable, Sendable {
    public let groupID: String
    public let conversationID: String?
    public let count: Int

    private enum CodingKeys: String, CodingKey { case groupId, groupConversationId, count }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        groupID = try container.decode(String.self, forKey: .groupId)
        let conversation = try container.decodeIfPresent(String.self, forKey: .groupConversationId)
        conversationID = conversation.flatMap { GroupJoinRequestNotice.isGroupConversationID($0) ? $0 : nil }
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

/// Business notifications are refresh hints, never chat messages or approval commands.
public struct GroupJoinRequestNotice: Equatable, Sendable {
    public let conversationID: String

    public init?(payload: [String: Any]) {
        guard MessagePayload.text(payload, "key") == "group_join_request",
              let data = MessagePayload.object(MessagePayload.value(payload, "data")) else { return nil }
        let id = MessagePayload.text(data, "groupConversationId")
        let alternative = MessagePayload.text(data, "groupConversationID")
        let conversation = id.isEmpty ? alternative : id
        guard Self.isGroupConversationID(conversation) else { return nil }
        conversationID = conversation
    }

    static func isGroupConversationID(_ value: String) -> Bool {
        value.range(of: "^sg_[0-9a-f]{32}$", options: .regularExpression) != nil
    }
}

public struct PendingJoinRequestSnapshot: Equatable, Sendable {
    public let count: Int
    public let conversationIDs: Set<String>

    public init(count: Int) {
        self.count = max(0, count)
        conversationIDs = []
    }

    public init(rows: [PendingGroupJoinCount]) {
        // Match badgeTotal's last-row-wins group deduplication before deriving highlights.
        let groups = Dictionary(rows.map { ($0.groupID, $0) }, uniquingKeysWith: { _, latest in latest })
        count = PendingGroupJoinCount.badgeTotal(Array(groups.values))
        conversationIDs = Set(groups.values.filter { $0.count > 0 }.compactMap(\.conversationID))
    }
}
