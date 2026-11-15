import Foundation

public enum HistoryViewportPolicy {
    /// 提前读取一段视口内的历史，惯性滚动与手指拖动使用同一门限。
    public static func shouldPrefetch(distanceFromTop: Double, viewportHeight: Double, movingTowardHistory: Bool, interacting: Bool, canLoad: Bool) -> Bool {
        let threshold = max(160, min(640, viewportHeight * 0.75))
        return canLoad && interacting && movingTowardHistory && distanceFromTop < threshold
    }
}

public enum ConversationUnreadBadge {
    public static func text(_ count: Int) -> String? {
        guard count > 0 else { return nil }
        return count > 99 ? "99+" : String(count)
    }
}

public enum ContactCountPolicy {
    /// 部分服务端只有首页提供总数，后续页的 0 不能覆盖已确认总数。
    public static func total(reported: Int?, previous: Int?, loaded: Int, reset: Bool) -> Int {
        max(0, loaded, max(reported ?? 0, reset ? 0 : previous ?? 0))
    }
}

public struct ConversationOrderEntry: Equatable, Sendable {
    public let id: String
    public let pinned: Bool
    public let timestamp: Int64
    public init(id: String, pinned: Bool, timestamp: Int64) { self.id = id; self.pinned = pinned; self.timestamp = timestamp }
}

public enum ConversationOrderPolicy {
    /// 同时间保留原有顺序；新会话按 SDK 返回顺序追加，避免重读后整批换序。
    public static func orderedIDs(_ entries: [ConversationOrderEntry], previous: [String]) -> [String] {
        var ranks: [String: Int] = [:]
        for id in previous + entries.map(\.id) where ranks[id] == nil { ranks[id] = ranks.count }
        return entries.sorted {
            if $0.pinned != $1.pinned { return $0.pinned }
            if $0.timestamp != $1.timestamp { return $0.timestamp > $1.timestamp }
            return (ranks[$0.id] ?? Int.max) < (ranks[$1.id] ?? Int.max)
        }.map(\.id)
    }
}

public enum ConversationRefreshPolicy {
    /// 先合成最终快照再排序，避免旧页的临时置顶状态改变同时间会话的稳定顺序。
    public static func resolve<Row>(page: [Row], changes: [Row], identity: (Row) -> String) -> [Row] {
        let changedIDs = Set(changes.map(identity))
        return page.filter { !changedIDs.contains(identity($0)) } + changes
    }
    public static func changesSince<Row: Equatable>(start: [Row], current: [Row], identity: (Row) -> String) -> [Row] {
        let baseline = Dictionary(start.map { (identity($0), $0) }, uniquingKeysWith: { _, latest in latest })
        return current.filter { baseline[identity($0)] != $0 }
    }
}

public struct ConversationStartupGate<Row> {
    public private(set) var ready = false
    public private(set) var buffered: [Row] = []
    public init() {}
    /// 首次完整本地快照前，事件只是增量，不足以作为会话首屏。
    public mutating func receive(_ rows: [Row]) -> Bool {
        guard !ready else { return true }
        buffered += rows; return false
    }
    public mutating func complete(snapshot: [Row], changes: [Row], identity: (Row) -> String) -> [Row] {
        var order: [String] = [], latest: [String: Row] = [:]
        for row in snapshot + buffered + changes {
            let id = identity(row)
            if latest[id] == nil { order.append(id) }
            latest[id] = row
        }
        ready = true; buffered = []
        return order.compactMap { latest[$0] }
    }
}

/// 由平台安全仓保存的 SDK 开库票据；业务账号、环境、平台必须同时匹配。
public struct IMBootstrapCredential: Codable, Equatable, Sendable {
    public let businessUserID: String
    public let apiBaseURL: String
    public let token: IMToken
    public let savedAt: Date
    public init(businessUserID: String, apiBaseURL: String, token: IMToken, savedAt: Date = Date()) {
        self.businessUserID = businessUserID; self.apiBaseURL = apiBaseURL; self.token = token; self.savedAt = savedAt
    }
    public func validated(businessUserID expectedUser: String, configuration: APIConfiguration) throws -> IMToken {
        guard businessUserID == expectedUser, apiBaseURL == configuration.baseURL.absoluteString,
              GroupVisibility.businessUserID(token.userId) == expectedUser.lowercased(), token.platform == 1,
              !token.token.isEmpty, token.expireSec > 0, savedAt.timeIntervalSince1970.isFinite else { throw APIError.invalidCredentials }
        _ = try IMEndpointPolicy.resolve(token.apiAddr, webSocket: false, businessBaseURL: configuration.baseURL)
        _ = try IMEndpointPolicy.resolve(token.wsAddr, webSocket: true, businessBaseURL: configuration.baseURL)
        // 这里只验证本机开库身份；发送权限、token 有效性仍由 SDK 和服务端判断。
        return token
    }
}

/// 只将现有默认环境中两个精确旧地址升级到已经存在的 TLS 代理。
public enum IMEndpointPolicy {
    public static let defaultOrigin = "https://www.xn--jprz53bj9s.com"

    public static func resolve(_ address: String, webSocket: Bool, businessBaseURL: URL) throws -> String {
        guard let source = URLComponents(string: address), let host = source.host, !host.isEmpty,
              source.user == nil, source.password == nil, source.query == nil, source.fragment == nil else {
            throw APIError.invalidCredentials
        }
        let secureScheme = webSocket ? "wss" : "https"
        if source.scheme?.lowercased() == secureScheme { return address }
        let business = URLComponents(url: businessBaseURL, resolvingAgainstBaseURL: false)
        let legacyScheme = webSocket ? "ws" : "http"
        let legacyPath = webSocket ? "/openim-ws" : "/openim-api"
        guard business?.scheme?.lowercased() == "https", business?.host?.lowercased() == "www.xn--jprz53bj9s.com",
              business?.port == nil || business?.port == 443,
              source.scheme?.lowercased() == legacyScheme, host == "8.154.44.197",
              source.port == nil || source.port == 80,
              source.path == legacyPath || source.path == legacyPath + "/" else { throw APIError.invalidCredentials }
        return (webSocket ? "wss://www.xn--jprz53bj9s.com/openim-ws" : defaultOrigin + "/openim-api")
    }
}

public enum OutboxState: String, Codable, Sendable {
    case prepared, sending, accepted, failed, uncertain
}

/// 固定 Core 的提交前拒绝码；未知、超时和重复 ID 均保持待核对。
public enum SendFailurePolicy {
    public static func rejectedBeforeSubmission(_ code: Int) -> Bool {
        [10002, 10004, 10100, 10101, 10200, 10205, 10302, 10400, 10401].contains(code)
    }
}

public struct OutboxEntry: Codable, Equatable, Sendable {
    public let clientMsgID: String
    public let conversationID: String
    public let targetID: String
    public let sessionType: Int
    public let text: String
    public let serializedMessage: String
    public let createdAt: Int64
    public var state: OutboxState

    public init(clientMsgID: String, conversationID: String, targetID: String, sessionType: Int,
                text: String, serializedMessage: String, createdAt: Int64) {
        self.clientMsgID = clientMsgID
        self.conversationID = conversationID
        self.targetID = targetID
        self.sessionType = sessionType
        self.text = text
        self.serializedMessage = serializedMessage
        self.createdAt = createdAt
        self.state = .prepared
    }
}

public enum OutboxError: Error { case invalidEntry, duplicateID, missingEntry, invalidTransition, wrongOwner }

/// 自有待发文件不保存历史库；SDK 库始终由 SDK 独占。写盘失败不能发消息。
public actor PersistentOutbox {
    private struct Archive: Codable {
        let ownerKey: String
        var entries: [OutboxEntry]
    }
    private let fileURL: URL
    private let ownerKey: String
    private var entries: [OutboxEntry]

    public init(fileURL: URL, ownerKey: String) throws {
        self.fileURL = fileURL
        self.ownerKey = ownerKey
        if FileManager.default.fileExists(atPath: fileURL.path) {
            let archive = try JSONDecoder().decode(Archive.self, from: Data(contentsOf: fileURL))
            guard archive.ownerKey == ownerKey else { throw OutboxError.wrongOwner }
            // 进程中断后，prepared 也不能自动重发：无法证明崩溃发生在网络调用前。
            self.entries = archive.entries.map { entry in
                var entry = entry
                if entry.state == .prepared || entry.state == .sending { entry.state = .uncertain }
                return entry
            }
            try Self.write(JSONEncoder().encode(Archive(ownerKey: ownerKey, entries: self.entries)), to: fileURL)
        } else { self.entries = [] }
    }

    public func snapshot(conversationID: String? = nil) -> [OutboxEntry] {
        entries.filter { conversationID == nil || $0.conversationID == conversationID }
    }

    public func prepare(_ entry: OutboxEntry) throws {
        guard !entry.clientMsgID.isEmpty, !entry.conversationID.isEmpty, !entry.targetID.isEmpty,
              [1, 3].contains(entry.sessionType), !entry.text.isEmpty, !entry.serializedMessage.isEmpty,
              entry.state == .prepared else { throw OutboxError.invalidEntry }
        guard !entries.contains(where: { $0.clientMsgID == entry.clientMsgID }) else { throw OutboxError.duplicateID }
        try commit(entries + [entry])
    }

    public func transition(_ id: String, to state: OutboxState) throws {
        guard let index = entries.firstIndex(where: { $0.clientMsgID == id }) else { throw OutboxError.missingEntry }
        let old = entries[index].state
        // uncertain 不允许直接重发。只可通过 SDK 本地/服务结果核对为 accepted 或明确 failed。
        let allowed = (old == .prepared && [.sending, .failed].contains(state))
            || (old == .sending && [.accepted, .failed, .uncertain].contains(state))
            || (old == .uncertain && [.accepted, .failed].contains(state))
            || (old == .failed && [.sending, .uncertain].contains(state))
            || (state == .accepted)
            || old == state
        guard allowed else { throw OutboxError.invalidTransition }
        var next = entries
        next[index].state = state
        try commit(next)
    }

    /// 条件更新在 outbox actor 内一次完成，迟到查询不能把新发送中的记录改成失败。
    @discardableResult
    public func confirmUncertainFailure(_ id: String) throws -> Bool {
        guard entries.first(where: { $0.clientMsgID == id })?.state == .uncertain else { return false }
        try transition(id, to: .failed); return true
    }

    /// 仅裁剪已被 SDK 按 ID 查询证实成功的 accepted 记录，不裁剪失败或不确定项。
    public func pruneConfirmedAccepted(_ ids: Set<String>) throws {
        let next = entries.filter { !($0.state == .accepted && ids.contains($0.clientMsgID)) }
        if next.count != entries.count { try commit(next) }
    }

    private func commit(_ next: [OutboxEntry]) throws {
        let data = try JSONEncoder().encode(Archive(ownerKey: ownerKey, entries: next))
        try Self.write(data, to: fileURL)
        entries = next
    }

    private static func write(_ data: Data, to fileURL: URL) throws {
        #if os(iOS)
        try data.write(to: fileURL, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        #else
        try data.write(to: fileURL, options: .atomic)
        #endif
    }
}

/// 页面合并使用 SDK clientMsgID，SDK 成功只表示提交成功，不表示收件人已送达。
public struct ChatMedia: Codable, Equatable, Sendable {
    public let kind: Int
    public let url: String
    public let thumbnail: String
    public let localPath: String
    public let filename: String
    public let duration: Int
    public init(kind: Int, url: String = "", thumbnail: String = "", localPath: String = "", filename: String = "", duration: Int = 0) {
        self.kind = kind; self.url = url; self.thumbnail = thumbnail; self.localPath = localPath; self.filename = filename; self.duration = duration
    }
}

public struct ChatTextItem: Equatable, Sendable {
    public let id: String
    public let senderID: String
    public let text: String
    public let timestamp: Int64
    public let status: Int
    public let seq: Int
    public let avatar: String
    public let senderName: String
    public let contentType: Int
    public let isRead: Bool
    public let serialized: String
    public let media: ChatMedia?
    public init(id: String, senderID: String, text: String, timestamp: Int64, status: Int,
                seq: Int = 0, avatar: String = "", senderName: String = "", contentType: Int = 101,
                isRead: Bool = false, serialized: String = "", media: ChatMedia? = nil) {
        self.id = id; self.senderID = senderID; self.text = text; self.timestamp = timestamp; self.status = status
        self.seq = seq; self.avatar = avatar; self.senderName = senderName; self.contentType = contentType
        self.isRead = isRead; self.serialized = serialized; self.media = media
    }
    public func read() -> ChatTextItem { ChatTextItem(id: id, senderID: senderID, text: text, timestamp: timestamp, status: status, seq: seq, avatar: avatar, senderName: senderName, contentType: contentType, isRead: true, serialized: serialized, media: media) }
    public static func merge(_ old: [ChatTextItem], _ incoming: [ChatTextItem]) -> [ChatTextItem] {
        var byID = Dictionary(old.map { ($0.id, $0) }, uniquingKeysWith: { _, latest in latest })
        for item in incoming where !item.id.isEmpty {
            // 迟到的历史 sending 不能把实时 success 降级。
            if let prior = byID[item.id] {
                if prior.status == 4 && item.status != 4 { continue }
                if prior.status == 2 && item.status != 2 && item.status != 4 { continue }
            }
            byID[item.id] = item
        }
        return byID.values.sorted { $0.timestamp == $1.timestamp ? $0.id < $1.id : $0.timestamp < $1.timestamp }
    }
}
