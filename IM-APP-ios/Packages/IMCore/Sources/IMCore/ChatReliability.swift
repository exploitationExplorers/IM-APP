import Foundation

public enum HistoryViewportPolicy {
    /// 首屏只定位一次；迟到的历史补洞不能打断已经开始阅读的用户。
    public static func shouldFollowBottom(explicit: Bool, initial: Bool, userInteracted: Bool, appended: Bool, nearBottom: Bool, interacting: Bool) -> Bool {
        explicit || (initial && !userInteracted) || (appended && nearBottom && !interacting)
    }

    public static func restoredOffset(anchorMinY: Double, distanceFromTop: Double, gestureDelta: Double, minimum: Double, maximum: Double) -> Double {
        min(max(minimum, maximum), max(minimum, anchorMinY - distanceFromTop + gestureDelta))
    }

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

public struct EmptyConversationReloadBudget {
    public private(set) var attempts = 0
    private var startedAt: TimeInterval?
    public init() {}
    public mutating func begin(now: TimeInterval) { startedAt = now; attempts = 0 }
    public mutating func cancel() { startedAt = nil }
    public func withinWindow(now: TimeInterval) -> Bool {
        guard let start = startedAt else { return false }
        return now >= start && now - start < 45
    }
    public mutating func reserve(now: TimeInterval, connected: Bool, loggedIn: Bool, syncing: Bool, empty: Bool) -> TimeInterval? {
        guard connected, loggedIn, syncing, empty, attempts < 12, withinWindow(now: now) else { return nil }
        attempts += 1
        return attempts == 1 ? 0.35 : min(4, Double(attempts - 1))
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
        let api = try IMEndpointPolicy.resolve(token.apiAddr, webSocket: false, businessBaseURL: configuration.baseURL)
        let ws = try IMEndpointPolicy.resolve(token.wsAddr, webSocket: true, businessBaseURL: configuration.baseURL)
        // 这里只验证本机开库身份；发送权限、token 有效性仍由 SDK 和服务端判断。
        return IMToken(userId: token.userId, token: token.token, platform: token.platform, expireSec: token.expireSec, apiAddr: api, wsAddr: ws)
    }

    /// 本机开库身份与在线票据有效期分开判断；重启不能重新延长原票据。
    public func validForLogin(businessUserID: String, configuration: APIConfiguration, now: Date = Date()) throws -> IMToken {
        let token = try validated(businessUserID: businessUserID, configuration: configuration)
        let age = now.timeIntervalSince(savedAt)
        guard age.isFinite, age >= -60, TimeInterval(token.expireSec) - max(0, age) > 60 else { throw APIError.invalidCredentials }
        // JWT 的 exp 仅用于提前拒绝过期票据，不能替代服务端验签。
        let parts = token.token.split(separator: ".", omittingEmptySubsequences: false)
        if parts.count == 3 {
            var payload = String(parts[1]).replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
            payload += String(repeating: "=", count: (4 - payload.count % 4) % 4)
            if let data = Data(base64Encoded: payload),
               let claims = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               let expiry = claims["exp"] as? NSNumber {
                guard expiry.doubleValue.isFinite, expiry.doubleValue > now.timeIntervalSince1970 + 60 else { throw APIError.invalidCredentials }
            }
        }
        return token
    }
}

/// SDK 失效通知可能重复到达；每次业务登录最多恢复一次，真实互踢必须由用户重新登录。
public struct IMCredentialRecoveryBudget: Sendable {
    public enum Failure: String, Sendable { case expired, invalid, kicked }
    public private(set) var attempts = 0
    public private(set) var kicked = false
    public init() {}
    public mutating func reserve(_ failure: Failure) -> Bool {
        if failure == .kicked { kicked = true }
        guard !kicked, attempts == 0 else { return false }
        attempts += 1
        return true
    }
}

public enum IMCredentialRecoveryError: LocalizedError, Equatable {
    case sdkBusy, unchangedCredential, connectionNotReady
    public var errorDescription: String? {
        switch self {
        case .sdkBusy: return "聊天 SDK 上一次会话尚未退出，聊天记录已保留。"
        case .unchangedCredential: return "服务仍返回同一张失效的 iOS 聊天票据，需要重新签发。"
        case .connectionNotReady: return "聊天本地登录完成，在线连接尚未确认，请稍后重试。"
        }
    }
    public static func requireReplacement(_ token: String, rejected: String?) throws {
        if token == rejected { throw Self.unchangedCredential }
    }
}

/// Token 失效回调先通知 App，再由 SDK 异步退出；必须等到状态 1 后才能重登。
public enum OpenIMSessionBarrier {
    @MainActor
    public static func waitForLogout(timeout: TimeInterval = 25,
        status: () throws -> Int,
        now: () -> TimeInterval = { ProcessInfo.processInfo.systemUptime },
        pause: () async throws -> Void = { try await Task.sleep(nanoseconds: 50_000_000) }) async throws {
        let started = now()
        while true {
            try Task.checkCancellation()
            let current = try status()
            if current == 1 { return }
            guard current == 2 || current == 3, now() - started < timeout else { throw IMCredentialRecoveryError.sdkBusy }
            try await pause()
        }
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
        guard business?.scheme?.lowercased() == "https", business?.url?.host?.lowercased() == "www.xn--jprz53bj9s.com",
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

    /// 只允许发送前改写已保护的引用内容，不能把 sending/uncertain 回退成可发送状态。
    public func replaceUnsubmittedPayload(_ id: String, serialized: String) throws -> OutboxEntry {
        guard let index = entries.firstIndex(where: { $0.clientMsgID == id }) else { throw OutboxError.missingEntry }
        let old = entries[index]
        guard [.prepared, .failed].contains(old.state),
              let before = MessagePayload.object(old.serializedMessage),
              let after = MessagePayload.object(serialized),
              MessagePayload.text(before, "clientMsgID") == id,
              MessagePayload.text(after, "clientMsgID") == id,
              MessagePayload.number(before, "contentType") == MessagePayload.number(after, "contentType"),
              let quote = MessageQuoteReference(serialized: old.serializedMessage),
              let updated = MessageQuoteReference(serialized: serialized),
              quote.id == updated.id, quote.replyText == updated.replyText else { throw OutboxError.invalidEntry }
        var replacement = OutboxEntry(clientMsgID: old.clientMsgID, conversationID: old.conversationID,
            targetID: old.targetID, sessionType: old.sessionType, text: old.text,
            serializedMessage: serialized, createdAt: old.createdAt)
        replacement.state = old.state
        var next = entries
        next[index] = replacement
        try commit(next)
        return replacement
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
    public let byteCount: Int64?
    public init(kind: Int, url: String = "", thumbnail: String = "", localPath: String = "", filename: String = "", duration: Int = 0, byteCount: Int64? = nil) {
        self.kind = kind; self.url = url; self.thumbnail = thumbnail; self.localPath = localPath; self.filename = filename; self.duration = duration
        self.byteCount = byteCount
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
        func precedes(_ lhs: ChatTextItem, _ rhs: ChatTextItem) -> Bool {
            lhs.timestamp == rhs.timestamp ? lhs.id < rhs.id : lhs.timestamp < rhs.timestamp
        }
        var byID: [String: ChatTextItem] = [:]
        var ordered = true
        for (index, item) in old.enumerated() {
            if byID[item.id] != nil || (index > 0 && precedes(item, old[index - 1])) { ordered = false }
            byID[item.id] = item
        }
        let baseline = ordered ? old : byID.values.sorted(by: precedes)
        var changed: [String: ChatTextItem] = [:]
        for item in incoming where !item.id.isEmpty {
            // 迟到的历史 sending 不能把实时 success 降级。
            if let prior = byID[item.id] {
                if prior.status == 4 && item.status != 4 { continue }
                if prior.status == 2 && item.status != 2 && item.status != 4 { continue }
            }
            if byID[item.id] != item { changed[item.id] = item }
            byID[item.id] = item
        }
        guard !changed.isEmpty else { return baseline }
        // 已排序的历史只做线性合并，单条消息不再触发整段历史排序。
        let retained = baseline.filter { changed[$0.id] == nil }
        let additions = changed.values.sorted(by: precedes)
        var result: [ChatTextItem] = []; result.reserveCapacity(retained.count + additions.count)
        var left = 0, right = 0
        while left < retained.count && right < additions.count {
            if precedes(retained[left], additions[right]) { result.append(retained[left]); left += 1 }
            else { result.append(additions[right]); right += 1 }
        }
        result.append(contentsOf: retained[left...]); result.append(contentsOf: additions[right...])
        return result
    }
}
