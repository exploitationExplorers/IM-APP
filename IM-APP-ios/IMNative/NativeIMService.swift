import UIKit
import Network
import CryptoKit
import OpenIMSDK
import IMCore
import UserNotifications
import AudioToolbox
import AVFoundation
import ImageIO
import UniformTypeIdentifiers

struct NativeConversation: Equatable {
    let id: String
    let type: Int
    let target: String
    let title: String
    let preview: String
    let unread: Int
    let timestamp: Int64
    let pinned: Bool
    let avatar: String
    let muted: Bool
    let latestSeq: Int
    let latestSender: String
    let extra: String
    init?(_ data: [String: Any]) {
        guard let id = data["id"] as? String, !id.isEmpty else { return nil }
        self.id = id; extra = data["ex"] as? String ?? ""; type = (data["type"] as? NSNumber)?.intValue ?? 0
        target = data["target"] as? String ?? ""; title = data["title"] as? String ?? ""
        preview = data["preview"] as? String ?? "暂无消息"; unread = (data["unread"] as? NSNumber)?.intValue ?? 0
        timestamp = (data["timestamp"] as? NSNumber)?.int64Value ?? 0; pinned = data["pinned"] as? Bool ?? false
        avatar = data["avatar"] as? String ?? ""; muted = data["muted"] as? Bool ?? false
        latestSeq = (data["latestSeq"] as? NSNumber)?.intValue ?? 0; latestSender = data["latestSender"] as? String ?? ""
    }
    var canOpen: Bool { [1, 3].contains(type) && !target.isEmpty }
}

struct NativeHistoryPage {
    let messages: [ChatTextItem]
    let isEnd: Bool
    let lastMinSeq: Int
}
struct NativeSearchHit { let conversationID: String; let title: String; let message: ChatTextItem }
struct NativeSearchPage { let items: [NativeSearchHit]; let hasMore: Bool }

private enum NativeChatError: LocalizedError {
    case inactive, unavailable, timedOut, invalidMessage, noCursor, persistence
    var errorDescription: String? {
        switch self {
        case .inactive: return "当前聊天会话已退出，请重新登录。"
        case .unavailable: return "聊天尚未就绪，请检查连接或重新登录。"
        case .timedOut: return "聊天请求超时，保留现有记录，请手动重试或核对发送结果。"
        case .invalidMessage: return "暂时不能处理此条消息。"
        case .noCursor: return "历史游标没有推进，请稍后重试；未标记为历史结束。"
        case .persistence: return "待发记录保存失败，本次没有发送消息，请检查存储空间。"
        }
    }
}

@MainActor
private final class NativeReply {
    private var continuation: CheckedContinuation<[String: Any], Error>?
    var timeout: Task<Void, Never>?
    init(_ continuation: CheckedContinuation<[String: Any], Error>) { self.continuation = continuation }
    func finish(_ result: Result<[String: Any], Error>) {
        guard let continuation = continuation else { return }
        self.continuation = nil
        timeout?.cancel(); timeout = nil
        continuation.resume(with: result)
    }
}

/// 整个 App 只允许一个真实 SDK owner。业务/SDK/库/同步分别推进，失败从不删除账号目录。
@MainActor
final class NativeIMService {
    private static var current: NativeIMService?
    private static var switching = false
    let account: BusinessAccountSession
    private let configuration: APIConfiguration
    private let api: APIClient
    lazy var business = NativeBusinessContext(account: account, configuration: configuration, ownerIsActive: { [weak self] in self?.isActive == true && self?.needsAuthentication == false })
    private let bridge = NativeOpenIMBridge()
    private let coordinator = SessionCoordinator()
    private var ticket: SessionTicket?
    private var attempt: SyncAttempt?
    private var syncEventSequence: UInt64 = 0
    private var syncBeginOperation: UUID?
    private var pendingSync: SyncState?
    private var syncing = false
    private var syncTimeout: Task<Void, Never>?
    private var pending: [UUID: NativeReply] = [:]
    private var observers: [UUID: () -> Void] = [:]
    private var initialized = false
    private(set) var loggedIn = false
    private(set) var needsAuthentication = false
    private var stopped = false
    private var stopTask: Task<Void, Never>?
    private var inFlightIDs = Set<String>()
    private var sendAttempts: [String: UUID] = [:]
    private var reconciliationTasks: [String: Task<Void, Never>] = [:]
    private var forwardTasks: [String: Task<Void, Never>] = [:]
    private var forwardNotices: [String: String] = [:]
    private var imagePaths: [String: String] = [:]
    private var generation = UUID()
    private var localReadable = false
    private var connection = "连接中"
    private var syncLabel = "等待同步事件"
    private var storeLabel = "等待开库"
    private(set) var lastError: String?
    private(set) var lastSendErrorCode: Int?
    private(set) var imUserID = ""
    private(set) var conversations: [NativeConversation] = []
    private(set) var conversationsEnd = false
    private(set) var loadingConversations = false
    private var conversationOffset = 0
    private var conversationRequest: UUID?
    private var conversationChangesDuringRequest: [NativeConversation] = []
    private var outbox: PersistentOutbox?
    private(set) var outboxEntries: [OutboxEntry] = []
    private(set) var messages: [String: [ChatTextItem]] = [:]
    private let monitor = NWPathMonitor()
    private var notifications: [NSObjectProtocol] = []
    private var queuedEvents: [(String, [String: Any])] = []
    private var drainingEvents = false
    private var revokedIDs = Set<String>()
    private var deletedIDs = Set<String>()
    private var storageDirectory: URL?
    private var visibilityLedger: GroupVisibilityLedger?
    private var visibility = GroupVisibility()
    private var groupTargets: [String: NativeGroupPeer] = [:]
    private var readIDs = Set<String>()
    private var notifiedIDs = Set<String>()
    private var retentionTask: Task<Void, Never>?
    private var groupVisibilityReady = Set<String>()
    private var pinSyncTime: [String: Int64] = [:]

    init(account: BusinessAccountSession, configuration: APIConfiguration) {
        self.account = account; self.configuration = configuration; self.api = APIClient(configuration: configuration)
    }

    var isActive: Bool { !stopped && Self.current === self }
    var canSend: Bool { isActive && loggedIn && localReadable && !needsAuthentication && UIApplication.shared.isProtectedDataAvailable }
    func canSend(to conversation: NativeConversation) -> Bool { canSend && (conversation.type != 3 || groupTargets[conversation.id]?.canChat == true) }
    func sendRestriction(_ conversation: NativeConversation) -> String? { conversation.type == 3 && groupTargets[conversation.id]?.canChat == false ? groupTargets[conversation.id]?.denyReason ?? "当前禁止在此群发言。" : nil }
    func loadAllConversations() async throws -> [NativeConversation] {
        await loadConversations(reset: true)
        guard isActive, localReadable, !loadingConversations else { throw NativeChatError.unavailable }
        var previousOffset = -1
        while !conversationsEnd { guard previousOffset != conversationOffset else { throw NativeChatError.noCursor }; previousOffset = conversationOffset; await loadConversations(); guard isActive, !loadingConversations, lastError == nil else { throw NativeChatError.unavailable } }
        return conversations
    }
    var statusText: String { lastError ?? "\(connection) · \(storeLabel) · \(syncLabel)" }

    func observe(_ update: @escaping () -> Void) -> UUID {
        let id = UUID(); observers[id] = update; return id
    }
    func removeObserver(_ id: UUID) { observers[id] = nil }
    private func publish() { for update in Array(observers.values) { update() } }
    private func require(_ expected: UUID) throws {
        try Task.checkCancellation()
        guard isActive && generation == expected else { throw NativeChatError.inactive }
    }

    func start() async {
        guard !Self.switching else { lastError = "另一次聊天登录仍在结束，请返回后重试。"; publish(); return }
        Self.switching = true
        defer { Self.switching = false }
        if let previous = Self.current, previous !== self { await previous.stop() }
        guard !Task.isCancelled, !stopped else { return }
        Self.current = self
        let current = generation
        do {
            let created = try await coordinator.beginAuthentication(ownerKey: configuration.baseURL.absoluteString + "|" + account.profile.id)
            try require(current)
            ticket = created
            // 每个本次业务会话只签发一次；资源未就绪、断线和前后台切换都不循环申请。
            let token = try await api.imToken(accessToken: account.authentication.accessToken)
            try require(current)
            imUserID = token.userId
            _ = await coordinator.authenticationSucceeded(created, businessUserID: account.profile.id, imUserID: token.userId)
            _ = await coordinator.updateLocalStore(.opening, for: created)
            let namespace = configuration.baseURL.absoluteString + "|" + token.userId
            let storage = try await Task.detached(priority: .userInitiated) { () -> (String, PersistentOutbox) in
                let manager = FileManager.default
                let support = try manager.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
                let digest = SHA256.hash(data: Data(namespace.utf8)).map { String(format: "%02x", $0) }.joined()
                var root = support.appendingPathComponent("NativeIM/" + digest, isDirectory: true)
                let sdk = root.appendingPathComponent("sdk", isDirectory: true)
                let own = root.appendingPathComponent("outbox", isDirectory: true)
                for directory in [root, sdk, own] {
                    try manager.createDirectory(at: directory, withIntermediateDirectories: true,
                        attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
                }
                var values = URLResourceValues(); values.isExcludedFromBackup = true
                try root.setResourceValues(values)
                let outbox = try PersistentOutbox(fileURL: own.appendingPathComponent("pending.json"), ownerKey: namespace)
                return (sdk.path, outbox)
            }.value
            try require(current)
            outbox = storage.1
            storageDirectory = URL(fileURLWithPath: storage.0).deletingLastPathComponent()
            if let root = storageDirectory, let data = try? Data(contentsOf: root.appendingPathComponent("outbox/image-paths.json")), let paths = try? JSONDecoder().decode([String: String].self, from: data) { imagePaths = paths }
            if let storageDirectory = storageDirectory {
                visibilityLedger = try GroupVisibilityLedger(file: storageDirectory.appendingPathComponent("outbox/visibility.json"), owner: namespace)
                visibility = await visibilityLedger!.snapshot()
                groupVisibilityReady = Set(visibility.floors.keys)
            }
            outboxEntries = await storage.1.snapshot()
            try require(current)
            initialized = bridge.initialize(api: token.apiAddr, ws: token.wsAddr, directory: storage.0) { [weak self] name, payload in
                Task { @MainActor in
                    guard let self = self, self.isActive, self.generation == current else { return }
                    self.enqueueEvent(name, payload: payload)
                }
            }
            guard initialized else { throw NativeChatError.unavailable }
            installLifecycle()
            _ = try await call { bridge.login(userID: token.userId, token: token.token, completion: $0) }
            try require(current)
            loggedIn = true
            retentionTask = Task { [weak self] in
                while !Task.isCancelled {
                    do { try await Task.sleep(nanoseconds: 30_000_000_000) } catch { return }
                    guard let self = self, self.isActive else { return }
                    do { try await self.refreshRetentionBatch(); for conversation in self.conversations where self.groupTargets[conversation.id] != nil { try await self.refreshGroupVisibility(conversation) } }
                    catch { if self.isActive { self.lastError = "群消息可见性暂未更新，保留已确认水位。"; self.publish() } }
                }
            }
            storeLabel = "正在验证本地可读"
            publish()
            await loadConversations(reset: true)
        } catch {
            guard isActive, generation == current else { return }
            lastError = error.localizedDescription
            if let ticket = ticket { _ = await coordinator.authenticationFailed(ticket, reason: "SDK 登录未就绪") }
            publish()
        }
    }

    /// 所有异步 SDK 请求有界等待；超时只停止等待，不假定网络操作没有执行。
    private func call(timeout: UInt64 = 25_000_000_000, _ start: (@escaping NativeIMResult) -> Void) async throws -> [String: Any] {
        let current = generation
        try require(current)
        let id = UUID()
        let value: [String: Any] = try await withCheckedThrowingContinuation { continuation in
            let reply = NativeReply(continuation)
            pending[id] = reply
            reply.timeout = Task { [weak self, weak reply] in
                do { try await Task.sleep(nanoseconds: timeout) } catch { return }
                reply?.finish(.failure(NativeChatError.timedOut)); self?.pending[id] = nil
            }
            start { [weak self, weak reply] result, error in
                Task { @MainActor in
                    if let error = error { reply?.finish(.failure(error)) }
                    else if let result = result { reply?.finish(.success(result)) }
                    else { reply?.finish(.failure(NativeChatError.invalidMessage)) }
                    self?.pending[id] = nil
                }
            }
        }
        try require(current)
        return value
    }

    func stop() async {
        if let stopTask = stopTask { await stopTask.value; return }
        let task = Task { @MainActor in await self.performStop() }
        stopTask = task
        await task.value
    }

    private func performStop() async {
        guard !stopped else { return }
        stopped = true; generation = UUID(); loggedIn = false
        syncTimeout?.cancel(); syncTimeout = nil; monitor.cancel()
        retentionTask?.cancel(); retentionTask = nil
        for token in notifications { NotificationCenter.default.removeObserver(token) }
        notifications.removeAll()
        for reply in pending.values { reply.finish(.failure(NativeChatError.inactive)) }
        pending.removeAll()
        queuedEvents.removeAll()
        reconciliationTasks.values.forEach { $0.cancel() }; reconciliationTasks.removeAll()
        forwardTasks.values.forEach { $0.cancel() }; forwardTasks.removeAll()
        forwardNotices.removeAll()
        // unInitSDK 同步释放旧核心，再允许新owner初始化；不等待迟到的旧logout回调去unInit新核心。
        if initialized, Self.current === self {
            bridge.shutdown()
            initialized = false
        }
        // 等待此前已入队的旧outbox写操作结束，新owner才能读取同一账号文件。
        if let outbox = outbox { _ = await outbox.snapshot() }
        if Self.current === self { Self.current = nil }
        await coordinator.logout()
        await NativeImageCache.shared.invalidateSession()
        messages.removeAll(); conversations.removeAll(); outboxEntries.removeAll(); outbox = nil
        lastError = "已退出聊天会话"
        publish(); observers.removeAll()
    }

    func logout() async {
        if let stopTask = stopTask { await stopTask.value; return }
        // stop与logout共用一个task；新owner.start必须等完整旧logout/unInit结束。
        let task = Task { @MainActor in
            let shouldLogout = self.isActive && self.initialized && self.loggedIn
            self.needsAuthentication = true; self.loggedIn = false
            let refresh = self.business.refreshToken
            var warnings: [String] = []
            do { try await NativeSessionVault.shared.clear(expectedUserID: self.account.profile.id, expectedRefreshToken: refresh) }
            catch { warnings.append("本机登录凭据清理失败：" + error.localizedDescription) }
            do { let _: EmptyReply = try await self.api.businessRequest("auth/logout", method: "POST", body: ["refreshToken": .string(refresh)], accessToken: self.business.accessToken) }
            catch { warnings.append("服务端会话撤销未确认：" + error.localizedDescription) }
            self.business.logoutWarning = warnings.isEmpty ? nil : warnings.joined(separator: "；")
            if shouldLogout { _ = try? await self.call { self.bridge.logout(completion: $0) } }
            await self.performStop()
        }
        stopTask = task
        await task.value
    }

    func finishAccountDeletion() async throws {
        needsAuthentication = true
        var credentialError: Error?
        do { try await NativeSessionVault.shared.clear(expectedUserID: account.profile.id, expectedRefreshToken: business.refreshToken) }
        catch { credentialError = error }
        await stop()
        if let error = credentialError { throw error }
    }

    func loadConversations(reset: Bool = false) async {
        guard isActive, loggedIn, !loadingConversations, reset || !conversationsEnd else { return }
        let current = generation, requestID = UUID()
        conversationRequest = requestID; conversationChangesDuringRequest = []; loadingConversations = true; publish()
        defer { if conversationRequest == requestID { loadingConversations = false; publish() } }
        do {
            let offset = reset ? 0 : conversationOffset
            let result = try await call { bridge.conversations(offset: offset, count: 40, completion: $0) }
            try require(current)
            let rows = (result["items"] as? [[String: Any]] ?? []).compactMap(NativeConversation.init)
            if reset { conversations = [] }
            mergeConversations(rows)
            mergeConversations(conversationChangesDuringRequest)
            conversationOffset = offset + rows.count
            conversationsEnd = rows.count < 40
            localReadable = true; storeLabel = "本地可读"; lastError = nil
            if let ticket = ticket { _ = await coordinator.updateLocalStore(.readable, for: ticket) }
            await advanceSyncIfReadable()
            do { try await refreshRetentionBatch() } catch { if isActive { lastError = "群消息可见性暂未更新，请稍后重试。" } }
        } catch {
            guard isActive, generation == current else { return }
            lastError = error.localizedDescription
            // resource not ready 不是同步完成，也不触发取token/删库/循环登录。
        }
    }

    private func mergeConversations(_ rows: [NativeConversation]) {
        var byID = Dictionary(conversations.map { ($0.id, $0) }, uniquingKeysWith: { _, b in b })
        for row in rows { byID[row.id] = row }
        conversations = byID.values.sorted {
            if $0.pinned != $1.pinned { return $0.pinned }
            return $0.timestamp == $1.timestamp ? $0.id < $1.id : $0.timestamp > $1.timestamp
        }
    }

    func openConversation(target: String, type: Int) async throws -> NativeConversation {
        let current = generation
        guard loggedIn, [1, 3].contains(type) else { throw NativeChatError.unavailable }
        let result = try await call { bridge.conversation(target: target, type: type, completion: $0) }
        try require(current)
        guard let conversation = NativeConversation(result), conversation.canOpen else { throw NativeChatError.invalidMessage }
        mergeConversations([conversation]); publish(); return conversation
    }

    func history(_ conversation: NativeConversation, cursor: String) async throws -> NativeHistoryPage {
        let current = generation
        guard conversation.canOpen, loggedIn else { throw NativeChatError.unavailable }
        if conversation.type == 3 { try await refreshGroupVisibility(conversation) }
        let result = try await call { bridge.history(conversation: conversation.id, cursor: cursor, count: 40, completion: $0) }
        let items = (result["items"] as? [[String: Any]] ?? []).compactMap(Self.item)
        let isEnd = result["isEnd"] as? Bool ?? false
        // 空页或重复游标却没有isEnd时按可重试错误处理，绝不能吞掉历史。
        if !isEnd && (items.isEmpty || (!cursor.isEmpty && items.allSatisfy { $0.id == cursor })) { throw NativeChatError.noCursor }
        for item in items.sorted(by: { $0.timestamp < $1.timestamp }) where NativeMessagePin.control(item) != nil { try await applyPinControl(item, conversation: conversation) }
        try require(current)
        mergeMessages(items, conversationID: conversation.id)
        localReadable = true; storeLabel = "本地可读"
        if let ticket = ticket { _ = await coordinator.updateLocalStore(.readable, for: ticket) }
        try require(current)
        await reconcile(conversationID: conversation.id)
        try require(current)
        publish()
        return NativeHistoryPage(messages: items, isEnd: isEnd, lastMinSeq: (result["lastMinSeq"] as? NSNumber)?.intValue ?? 0)
    }

    private static func item(_ data: [String: Any]) -> ChatTextItem? {
        guard let id = data["id"] as? String, !id.isEmpty else { return nil }
        let type = (data["contentType"] as? NSNumber)?.intValue ?? 101
        let sequence = (data["seq"] as? NSNumber)?.intValue ?? 0, rawStatus = (data["status"] as? NSNumber)?.intValue ?? 0
        // 正服务序号证明已受理；迟到的本地失败不能覆盖它，撤回仍按撤回显示。
        let status = sequence > 0 && rawStatus != 4 ? 2 : rawStatus
        let media = [102, 103, 104, 105].contains(type) ? ChatMedia(kind: type, url: data["mediaURL"] as? String ?? "", thumbnail: data["thumbnail"] as? String ?? "", localPath: data["localPath"] as? String ?? "", filename: data["filename"] as? String ?? "", duration: (data["duration"] as? NSNumber)?.intValue ?? 0) : nil
        return ChatTextItem(id: id, senderID: data["senderID"] as? String ?? "", text: data["text"] as? String ?? "[消息]",
            timestamp: (data["timestamp"] as? NSNumber)?.int64Value ?? 0, status: status,
            seq: sequence, avatar: data["avatar"] as? String ?? "", senderName: data["senderName"] as? String ?? "", contentType: type,
            isRead: data["isRead"] as? Bool ?? false, serialized: data["serialized"] as? String ?? "", media: media)
    }

    func send(_ text: String, to conversation: NativeConversation, onPersisted: (() -> Void)? = nil) async throws {
        guard let data = bridge.createText(text) else { throw NativeChatError.invalidMessage }
        try await sendPrepared(data, to: conversation, onPersisted: onPersisted)
    }

    private func sendPrepared(_ data: [String: Any], to conversation: NativeConversation, onPersisted: (() -> Void)? = nil) async throws {
        guard canSend, conversation.canOpen, let outbox = outbox else { throw NativeChatError.unavailable }
        let current = generation
        guard let message = Self.item(data),
              let serialized = data["serialized"] as? String, !serialized.isEmpty else { throw NativeChatError.invalidMessage }
        let entry = OutboxEntry(clientMsgID: message.id, conversationID: conversation.id, targetID: conversation.target,
            sessionType: conversation.type, text: message.text, serializedMessage: serialized, createdAt: message.timestamp)
        do { try await outbox.prepare(entry) } catch { throw NativeChatError.persistence }
        if let media = message.media, let file = ownedMediaURL(media.localPath), let root = storageDirectory {
            imagePaths[entry.clientMsgID] = file.lastPathComponent
            if imagePaths.count > 500 { let keep = Set(outboxEntries.map(\.clientMsgID) + [entry.clientMsgID]); for key in imagePaths.keys.sorted() where imagePaths.count > 500 && !keep.contains(key) { imagePaths.removeValue(forKey: key) } }
            try? JSONEncoder().encode(imagePaths).write(to: root.appendingPathComponent("outbox/image-paths.json"), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        }
        try require(current)
        await refreshOutbox()
        try require(current)
        onPersisted?()
        try await dispatch(entry, outbox: outbox)
    }

    func createMediaFile(data: Data, extension fileExtension: String) throws -> URL {
        guard isActive, let root = storageDirectory else { throw NativeChatError.unavailable }
        let folder = root.appendingPathComponent("media", isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true, attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
        let ext = fileExtension.lowercased().filter { $0.isASCII && $0.isLetter || $0.isNumber }
        let url = folder.appendingPathComponent(UUID().uuidString).appendingPathExtension(ext.isEmpty ? "bin" : String(ext.prefix(12)))
        try data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication]); return url
    }
    func massRecordsData() throws -> Data? {
        guard isActive, let root = storageDirectory else { throw NativeChatError.unavailable }
        let file = root.appendingPathComponent("outbox/mass-records.json")
        guard FileManager.default.fileExists(atPath: file.path) else { return nil }; return try Data(contentsOf: file)
    }
    func saveMassRecordsData(_ data: Data) throws {
        guard isActive, let root = storageDirectory else { throw NativeChatError.unavailable }
        try data.write(to: root.appendingPathComponent("outbox/mass-records.json"), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }
    func forwardSubmissionsData() throws -> Data? {
        guard isActive, let root = storageDirectory else { throw NativeChatError.unavailable }
        let file = root.appendingPathComponent("outbox/forward-submissions.json"); guard FileManager.default.fileExists(atPath: file.path) else { return nil }; return try Data(contentsOf: file)
    }
    func saveForwardSubmissionsData(_ data: Data) throws {
        guard isActive, let root = storageDirectory else { throw NativeChatError.unavailable }
        try data.write(to: root.appendingPathComponent("outbox/forward-submissions.json"), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }
    func saveForwardSubmission(_ submission: NativeForwardSubmission) throws {
        var rows = try forwardSubmissionsData().map { try JSONDecoder().decode([NativeForwardSubmission].self, from: $0) } ?? []
        if let index = rows.firstIndex(where: { $0.key == submission.key }) {
            guard rows[index].body == submission.body else { throw NativeChatError.invalidMessage }
            return
        }
        guard rows.filter({ $0.accepted == nil }).count < 200 else { throw APIError.business(code: -1, message: "未确认的转发较多，请稍后重试。") }
        rows = rows.filter { $0.accepted == nil } + rows.filter { $0.accepted != nil }.suffix(100)
        rows.append(submission); try saveForwardSubmissionsData(JSONEncoder().encode(rows))
    }
    /// 页面退出后由账号 owner 持有任务；结果不确定时保留同一幂等批次供显式核对。
    func dispatchForwardInBackground(_ submission: NativeForwardSubmission) {
        guard isActive, forwardTasks[submission.key] == nil else { return }
        let expected = generation
        forwardTasks[submission.key] = Task { [weak self] in
            guard let self = self else { return }; defer { self.forwardTasks[submission.key] = nil }
            do {
                let cacheEpoch = await NativeImageCache.shared.mutationEpoch()
                try self.require(expected)
                let result: NativeForwardAccepted = try await self.business.request("forward-batches", method: "POST", body: submission.body)
                try self.require(expected)
                guard ForwardBatchReceiptPolicy.isAccepted(status: result.status, batchID: result.batchId, taskIDs: result.taskIds), result.taskIds.count == Set(submission.messageIDs).count else { throw APIError.invalidResponse }
                // 重新读当前文件，不能用页面旧快照覆盖同时提交的其他批次。
                var rows = try self.forwardSubmissionsData().map { try JSONDecoder().decode([NativeForwardSubmission].self, from: $0) } ?? []
                guard let index = rows.firstIndex(where: { $0.key == submission.key }) else { throw NativeChatError.persistence }
                rows[index].accepted = result
                try self.saveForwardSubmissionsData(JSONEncoder().encode(rows))
                self.publish()
                // 缓存重绑失败不推翻已经持久保存的服务端受理结果。
                let initialProgress = (try? await self.rebindForwardImages(submission, accepted: result, expected: expected, cacheEpoch: cacheEpoch)) ?? [:]
                try self.require(expected)
                let outcome = try await self.confirmForwardDelivery(submission, accepted: result, initialProgress: initialProgress, expected: expected)
                try self.require(expected)
                self.forwardNotices[submission.sourceConversationID] = outcome == .success ? "转发成功" : outcome == .failure ? "有消息转发失败，请重试。" : "转发结果尚未确认，请稍后查看聊天记录。"
                self.publish()
            } catch {
                guard self.isActive, self.generation == expected else { return }
                self.forwardNotices[submission.sourceConversationID] = "暂未确认转发结果，请稍后查看聊天记录。"; self.publish()
            }
        }
    }
    func forwardIsRunning(_ key: String) -> Bool { forwardTasks[key] != nil }
    func takeForwardNotice(in conversationID: String) -> String? { forwardNotices.removeValue(forKey: conversationID) }
    private func confirmForwardDelivery(_ submission: NativeForwardSubmission, accepted: NativeForwardAccepted, initialProgress: [String: NativeForwardProgress], expected: UUID) async throws -> ForwardBatchReceiptPolicy.DeliveryState {
        var remaining = Set(accepted.taskIds)
        var deliveredSources = Set<String>()
        let deadline = Date().addingTimeInterval(30)
        for attempt in 0..<30 {
            for id in remaining.sorted() {
                try require(expected)
                guard Date() < deadline else { return .unconfirmed }
                let progress: NativeForwardProgress
                if attempt == 0, let cached = initialProgress[id] { progress = cached }
                else { progress = try await business.request("forward-task-progress", query: [URLQueryItem(name: "taskId", value: id)]) }
                try require(expected)
                guard progress.id == id, submission.messageIDs.contains(progress.sourceClientMsgId) else { throw APIError.invalidResponse }
                switch progress.deliveryState {
                case .success: remaining.remove(id); deliveredSources.insert(progress.sourceClientMsgId)
                case .failure: return .failure
                case .unconfirmed: return .unconfirmed
                case .pending: break
                }
            }
            if remaining.isEmpty { return deliveredSources == Set(submission.messageIDs) ? .success : .unconfirmed }
            if attempt < 29 { try await Task.sleep(nanoseconds: 1_000_000_000) }
        }
        return .unconfirmed
    }
    private func rebindForwardImages(_ submission: NativeForwardSubmission, accepted: NativeForwardAccepted, expected: UUID, cacheEpoch: UUID) async throws -> [String: NativeForwardProgress] {
        guard case .array(let sources)? = submission.body["messages"] else { return [:] }
        var originals: [String: ForwardMessageSnapshot] = [:]
        var initialProgress: [String: NativeForwardProgress] = [:]
        for value in sources {
            guard case .object(let row) = value, case .string(let id)? = row["sourceClientMsgId"], let snapshot = row["sourceSnapshot"], submission.messageIDs.contains(id) else { continue }
            originals[id] = try JSONDecoder().decode(ForwardMessageSnapshot.self, from: JSONEncoder().encode(snapshot))
        }
        let policy = business.media
        for id in accepted.taskIds {
            let progress: NativeForwardProgress = try await business.request("forward-task-progress", query: [URLQueryItem(name: "taskId", value: id)])
            try require(expected)
            guard progress.id == id, submission.messageIDs.contains(progress.sourceClientMsgId) else { throw APIError.invalidResponse }
            initialProgress[id] = progress
            guard let original = originals[progress.sourceClientMsgId] else { continue }
            for (source, archived) in original.imageCopies(to: progress.sourceSnapshot) {
                guard policy.absolute(source)?.scheme == "https", policy.absolute(archived)?.scheme == "https" else { continue }
                for variant in [MediaURLPolicy.Variant.list, .preview] {
                    try require(expected)
                    await NativeImageCache.shared.aliasCached(from: policy.cacheIdentity(policy.image(source, variant: variant)), to: policy.cacheIdentity(policy.image(archived, variant: variant)), expectedEpoch: cacheEpoch)
                    try require(expected)
                }
            }
        }
        return initialProgress
    }
    func unpackMessage(_ serialized: String) -> ChatTextItem? { bridge.unpack(serialized).flatMap(Self.item) }
    func sendAt(_ text: String, users: [NativeGroupMember], all: Bool, quoted: ChatTextItem?, to conversation: NativeConversation, onPersisted: (() -> Void)? = nil) async throws {
        guard conversation.type == 3 else { throw NativeChatError.invalidMessage }; let current = generation
        var mentions: [[String: String]] = []
        for user in users { let peer: NativePeer = try await business.request("im/peers/\(user.id)"); try require(current); mentions.append(["id": peer.imUserId, "name": user.name]) }
        guard let message = bridge.createAt(text, users: mentions, all: all, quoted: quoted?.serialized ?? "") else { throw NativeChatError.invalidMessage }
        try await sendPrepared(message, to: conversation, onPersisted: onPersisted)
    }
    func pinnedMessage(in conversation: NativeConversation) -> NativeMessagePin? {
        let extra = conversations.first(where: { $0.id == conversation.id })?.extra ?? conversation.extra
        guard let data = extra.data(using: .utf8), let root = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any], let raw = root["pinnedMessage"] as? [String: Any], let pin = NativeMessagePin(raw) else { return nil }
        if let message = messages[conversation.id]?.first(where: { $0.id == pin.id }), !visibility.permits(message, conversationID: conversation.id) || revokedIDs.contains(pin.id) || deletedIDs.contains(pin.id) { return nil }
        return pin
    }
    func pinMessage(_ item: ChatTextItem, in conversation: NativeConversation, shared: Bool, remove: Bool = false) async throws {
        let current = generation
        guard item.status == 2, item.contentType < 1000 else { throw NativeChatError.invalidMessage }
        if shared, conversation.type == 3 {
            let id = try await businessPeerID(conversation); let group: NativeGroup = try await business.request("groups/detail", query: [URLQueryItem(name: "groupId", value: id)]); try require(current)
            guard group.canManage else { throw APIError.business(code: -1, message: "仅群主或管理员可为全员置顶。") }
        }
        let type = [102: "image", 103: "voice", 104: "video", 105: "file", 108: "card"][item.contentType] ?? "text"
        var body: [String: Any] = ["clientMsgID": item.id, "preview": item.text, "senderNickname": item.senderName, "messageType": type, "scope": shared ? "shared" : "self", "pinnedAt": Int64(Date().timeIntervalSince1970 * 1000)]
        body["action"] = remove ? "unpin" : "pin"
        let payload = String(decoding: try JSONSerialization.data(withJSONObject: body), as: UTF8.self)
        _ = try await call { bridge.patchPin(conversation.id, payload: payload, completion: $0) }; try require(current)
        await loadConversations(reset: true); try require(current)
        if shared { body["businessKey"] = "message_pin"; body["action"] = remove ? "unpin" : "pin"; guard let message = bridge.createCustom(String(decoding: try JSONSerialization.data(withJSONObject: body), as: UTF8.self)) else { throw NativeChatError.invalidMessage }; try await sendPrepared(message, to: conversation) }
    }
    func importMediaFile(_ source: URL) throws -> URL {
        guard isActive, let root = storageDirectory else { throw NativeChatError.unavailable }
        let folder = root.appendingPathComponent("media", isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true, attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
        let destination = folder.appendingPathComponent(UUID().uuidString).appendingPathExtension(source.pathExtension)
        try FileManager.default.copyItem(at: source, to: destination); try FileManager.default.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication], ofItemAtPath: destination.path)
        return destination
    }
    func ownedMediaURL(_ path: String) -> URL? {
        let url = path.hasPrefix("file:") ? URL(string: path) : URL(fileURLWithPath: path)
        guard let url = url?.standardizedFileURL.resolvingSymlinksInPath(), let root = storageDirectory?.appendingPathComponent("media").standardizedFileURL.resolvingSymlinksInPath(),
              url.isFileURL, url.path.hasPrefix(root.path + "/"), FileManager.default.fileExists(atPath: url.path) else { return nil }; return url
    }
    /// 大媒体复制不占用 UI 线程；异步返回时仍必须属于同一登录 owner。
    func importMediaFileInBackground(_ source: URL) async throws -> URL {
        guard isActive, let root = storageDirectory else { throw NativeChatError.unavailable }
        let expected = generation, folder = root.appendingPathComponent("media", isDirectory: true)
        let destination = folder.appendingPathComponent(UUID().uuidString).appendingPathExtension(source.pathExtension)
        do {
            try await Task.detached(priority: .userInitiated) {
                try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true, attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
                try FileManager.default.copyItem(at: source, to: destination)
                try FileManager.default.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication], ofItemAtPath: destination.path)
            }.value
            try Task.checkCancellation(); try require(expected)
            guard ownedMediaURL(destination.path) != nil else { throw NativeChatError.invalidMessage }
            return destination
        } catch { try? FileManager.default.removeItem(at: destination); throw error }
    }
    func ownedImageURL(for message: ChatTextItem) -> URL? {
        guard message.contentType == 102 else { return nil }
        return ownedMediaURL(for: message)
    }
    func ownedMediaURL(for message: ChatTextItem) -> URL? {
        guard message.senderID == imUserID, [102, 103, 104, 105].contains(message.contentType) else { return nil }
        if let media = message.media, let file = ownedMediaURL(media.localPath) { return file }
        guard let name = imagePaths[message.id], name == (name as NSString).lastPathComponent,
              let root = storageDirectory else { return nil }
        return ownedMediaURL(root.appendingPathComponent("media").appendingPathComponent(name).path)
    }
    func sendMedia(kind: Int, file: URL, filename: String, duration: Int = 0, snapshot: URL? = nil, to conversation: NativeConversation, onPersisted: (() -> Void)? = nil) async throws {
        guard let owned = ownedMediaURL(file.path), snapshot == nil || ownedMediaURL(snapshot!.path) != nil,
              let message = bridge.createMedia(kind: kind, path: owned.path, filename: filename, duration: duration, snapshot: snapshot?.path ?? "") else { throw NativeChatError.invalidMessage }
        try await sendPrepared(message, to: conversation, onPersisted: onPersisted)
    }
    func sendQuote(_ text: String, original: ChatTextItem, to conversation: NativeConversation, onPersisted: (() -> Void)? = nil) async throws {
        guard original.status != 4, let message = bridge.createQuote(text, serialized: original.serialized) else { throw NativeChatError.invalidMessage }
        try await sendPrepared(message, to: conversation, onPersisted: onPersisted)
    }
    func forward(_ item: ChatTextItem, to conversation: NativeConversation) async throws {
        guard item.status != 4, let message = bridge.createForward(item.serialized) else { throw NativeChatError.invalidMessage }
        try await sendPrepared(message, to: conversation)
    }
    func sendCard(_ contact: NativeContact, to conversation: NativeConversation) async throws {
        let current = generation
        let peer: NativePeer = try await business.request("im/peers/\(contact.id)"); try require(current)
        guard let message = bridge.createCard(peer.imUserId, nickname: contact.nickname, avatar: contact.avatar, businessUser: contact.id) else { throw NativeChatError.invalidMessage }
        try await sendPrepared(message, to: conversation)
    }
    func sendFavorite(type: String, content: String, to conversation: NativeConversation) async throws {
        if ["text", "emoji"].contains(type) { try await send(content, to: conversation); return }
        let current = generation, parsed = FavoriteContent(type: type, content: content)
        guard let kind = ["image": 102, "voice": 103, "video": 104, "file": 105][type], let url = business.media.absolute(kind == 104 ? business.media.playback(parsed.url) : business.media.original(parsed.url)), url.scheme == "https" else { throw NativeChatError.invalidMessage }
        let temp = try await NativeBoundedDownload(limit: 100 * 1024 * 1024).download(url); defer { try? FileManager.default.removeItem(at: temp) }; try require(current)
        let ext: String
        if kind == 102, let source = CGImageSourceCreateWithURL(temp as CFURL, nil), let raw = CGImageSourceGetType(source) as String? { ext = UTType(raw)?.preferredFilenameExtension ?? "jpg" }
        else { ext = (parsed.filename as NSString).pathExtension.isEmpty ? (kind == 103 ? "m4a" : kind == 104 ? "mp4" : "bin") : (parsed.filename as NSString).pathExtension }
        // 下载的无后缀临时文件只作为传输载体，SDK持有账号私有目录中的稳定副本。
        let file = try importMediaFile(temp); let named = file.deletingPathExtension().appendingPathExtension(ext); try FileManager.default.moveItem(at: file, to: named)
        var duration = parsed.duration; var snapshot: URL?
        if kind == 104 {
            let asset = AVURLAsset(url: named); if duration <= 0 { let time = try await asset.load(.duration); duration = max(1, Int(CMTimeGetSeconds(time))); try require(current) }
            let bitmap = try await Task.detached { let generator = AVAssetImageGenerator(asset: AVURLAsset(url: named)); generator.appliesPreferredTrackTransform = true; generator.maximumSize = CGSize(width: 720, height: 720); return try generator.copyCGImage(at: .zero, actualTime: nil) }.value
            try require(current); guard let data = UIImage(cgImage: bitmap).jpegData(compressionQuality: 0.8) else { throw APIError.invalidResponse }; snapshot = try createMediaFile(data: data, extension: "jpg")
        }
        try await sendMedia(kind: kind, file: named, filename: parsed.filename.isEmpty ? "收藏." + ext : parsed.filename, duration: max(1, duration), snapshot: snapshot, to: conversation)
    }
    func businessPeerID(_ conversation: NativeConversation) async throws -> String {
        if conversation.type == 3 { let target: NativeGroupPeer = try await business.request("im/groups/by-im/\(conversation.target)"); return target.businessGroupId }
        let id = GroupVisibility.businessUserID(conversation.target); guard !id.isEmpty else { throw NativeChatError.invalidMessage }; return id
    }
    func refreshGroupVisibility(_ conversation: NativeConversation) async throws {
        let current = generation
        guard let ledger = visibilityLedger else { throw NativeChatError.unavailable }
        struct RetentionResult: Decodable { let items: [GroupRetentionState] }
        let states: RetentionResult = try await business.request("im/group-retention/states", query: [URLQueryItem(name: "conversationIds", value: conversation.id)])
        try require(current)
        visibility = try await ledger.apply(states.items); try require(current)
        let target: NativeGroupPeer = try await business.request("im/groups/by-im/\(conversation.target)"); try require(current)
        groupTargets[conversation.id] = target
        struct Purges: Decodable { let items: [GroupMessagePurge] }
        let purges: Purges = try await business.request("groups/\(target.businessGroupId)/message-purges"); try require(current)
        visibility = try await ledger.applyPurges(purges.items, conversationID: conversation.id); try require(current)
        groupVisibilityReady.insert(conversation.id)
        messages[conversation.id] = (messages[conversation.id] ?? []).filter { visibility.permits($0, conversationID: conversation.id) }
        publish()
    }
    func markRead(_ conversation: NativeConversation) async throws {
        _ = try await call { bridge.markRead(conversation.id, completion: $0) }
        if conversation.type == 3 { try await business.change("im/group-read-cursors/report", body: ["conversationId": .string(conversation.id)]) }
    }
    func recall(_ item: ChatTextItem, in conversation: NativeConversation, reason: String? = nil) async throws {
        let current = generation
        let peer = try await businessPeerID(conversation); try require(current)
        var body: [String: JSONValue] = ["peerType": .string(conversation.type == 3 ? "group" : "c2c"), "peerId": .string(peer), "clientMsgId": .string(item.id), "seq": .number(Double(item.seq))]
        if let reason = reason, !reason.isEmpty { body["reason"] = .string(reason) }
        try await business.change("im/messages/recall", body: body)
        try require(current); revokedIDs.insert(item.id); mergeMessages([], conversationID: conversation.id); publish()
    }
    func delete(_ item: ChatTextItem, in conversation: NativeConversation) async throws {
        let current = generation
        _ = try await call { bridge.deleteMessage(item.id, conversation: conversation.id, completion: $0) }
        if let ledger = visibilityLedger { visibility = try await ledger.hide([item.id]); try require(current) }
        deletedIDs.insert(item.id); mergeMessages([], conversationID: conversation.id); publish()
    }
    func clearHistory(_ conversation: NativeConversation) async throws {
        let current = generation; let peer = try await businessPeerID(conversation); try require(current)
        try await business.change("im/conversation-messages/clear", body: ["peerType": .string(conversation.type == 3 ? "group" : "c2c"), "peerId": .string(peer)]); try require(current)
        let ids = Set((messages[conversation.id] ?? []).map(\.id) + outboxEntries.filter { $0.conversationID == conversation.id }.map(\.clientMsgID))
        if let ledger = visibilityLedger { visibility = try await ledger.hide(ids); try require(current) }
        deletedIDs.formUnion(ids); messages[conversation.id] = []; publish()
        _ = try await call { bridge.clear(conversation.id, completion: $0) }; await loadConversations(reset: true)
    }
    func pin(_ conversation: NativeConversation) async throws { try await setPinned(!conversation.pinned, conversation: conversation) }
    func mute(_ conversation: NativeConversation) async throws { try await setMuted(!conversation.muted, conversation: conversation) }
    func setPinned(_ value: Bool, conversation: NativeConversation) async throws { let current = generation; _ = try await call { bridge.pin(conversation.id, pinned: value, completion: $0) }; try require(current); await loadConversations(reset: true) }
    func setMuted(_ value: Bool, conversation: NativeConversation) async throws { let current = generation; _ = try await call { bridge.mute(conversation.id, muted: value, completion: $0) }; try require(current); await loadConversations(reset: true) }
    func hide(_ conversation: NativeConversation) async throws { let current = generation; _ = try await call { bridge.hide(conversation.id, completion: $0) }; try require(current); conversations.removeAll { $0.id == conversation.id }; publish() }
    func search(_ keyword: String, conversation: NativeConversation?, types: [Int] = [], page: Int = 1) async throws -> [NativeSearchHit] {
        try await searchPage(keyword, conversation: conversation, types: types, page: page).items
    }
    func searchPage(_ keyword: String, conversation: NativeConversation?, types: [Int] = [], page: Int = 1) async throws -> NativeSearchPage {
        let current = generation
        guard loggedIn, localReadable else { throw NativeChatError.unavailable }
        if let conversation = conversation, conversation.type == 3 { try await refreshGroupVisibility(conversation) }
        else { try await refreshRetentionBatch() }
        try require(current)
        let result = try await call { bridge.search(keyword, conversation: conversation?.id ?? "", types: types.map { NSNumber(value: $0) }, page: page, completion: $0) }
        let raw = result["items"] as? [[String: Any]] ?? []
        let items: [NativeSearchHit] = raw.compactMap { data in
            guard let item = Self.item(data), let id = data["conversationID"] as? String, visibility.permits(item, conversationID: id), NativeMessagePin.control(item) == nil, !deletedIDs.contains(item.id), !revokedIDs.contains(item.id) else { return nil }
            return NativeSearchHit(conversationID: id, title: data["conversationTitle"] as? String ?? "", message: item)
        }
        return NativeSearchPage(items: items, hasMore: conversation != nil && raw.count == 40)
    }
    func conversationForSearch(_ hit: NativeSearchHit) async throws -> NativeConversation {
        if let conversation = conversations.first(where: { $0.id == hit.conversationID }) { return conversation }
        guard let data = hit.message.serialized.data(using: .utf8), let message = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { throw NativeChatError.invalidMessage }
        let type = (message["sessionType"] as? NSNumber)?.intValue ?? 0
        let target = type == 3 ? message["groupID"] as? String : (hit.message.senderID == imUserID ? message["recvID"] as? String : hit.message.senderID)
        guard let target = target, !target.isEmpty else { throw NativeChatError.invalidMessage }
        let conversation = try await openConversation(target: target, type: type)
        guard conversation.id == hit.conversationID else { throw NativeChatError.invalidMessage }; return conversation
    }
    func focusMessage(_ id: String, in conversation: NativeConversation) async throws {
        let current = generation
        if conversation.type == 3 { try await refreshGroupVisibility(conversation) }; try require(current)
        let result = try await call { bridge.find(conversation: conversation.id, clientMsgIDs: [id], completion: $0) }; try require(current)
        guard let item = (result["items"] as? [[String: Any]] ?? []).compactMap(Self.item).first(where: { $0.id == id }), item.status != 4, !deletedIDs.contains(id), !revokedIDs.contains(id), visibility.permits(item, conversationID: conversation.id) else { throw APIError.business(code: -1, message: "该消息已不可见，无法定位。") }
        mergeMessages([item], conversationID: conversation.id); publish()
    }
    func sourceForFavorite(_ favorite: NativeFavorites) async throws -> (NativeConversation, ChatTextItem) {
        let current = generation
        let all = try await loadAllConversations(); try require(current)
        guard let conversation = all.first(where: { $0.id == favorite.conversationId }) else { throw APIError.business(code: -1, message: "请回到原聊天后转发。") }
        try await focusMessage(favorite.messageId, in: conversation); try require(current)
        guard let message = visibleMessages(conversation.id).first(where: { $0.id == favorite.messageId }) else { throw NativeChatError.invalidMessage }; return (conversation, message)
    }

    private func dispatch(_ entry: OutboxEntry, outbox: PersistentOutbox) async throws {
        guard !inFlightIDs.contains(entry.clientMsgID) else { throw NativeChatError.unavailable }
        inFlightIDs.insert(entry.clientMsgID)
        sendAttempts[entry.clientMsgID] = UUID()
        defer { inFlightIDs.remove(entry.clientMsgID) }
        guard canSend else {
            // 这一条尚未调用SDK网络发送，可明确失败，允许用户之后手动重试同一ID。
            try await outbox.transition(entry.clientMsgID, to: .failed)
            await refreshOutbox(); throw NativeChatError.unavailable
        }
        let current = generation
        // 本地气泡已持久化并发布，权限请求只延迟发送，不延迟本地预览。
        let cacheEpoch = await NativeImageCache.shared.mutationEpoch()
        try require(current)
        if entry.sessionType == 3 {
            do {
                let target: NativeGroupPeer = try await business.request("im/groups/by-im/\(entry.targetID)")
                try require(current)
                guard target.canChat else { throw APIError.business(code: -1, message: target.denyReason ?? "当前不能在群内发言。") }
            } catch {
                try require(current)
                try await outbox.transition(entry.clientMsgID, to: .failed)
                await refreshOutbox(); throw error
            }
        }
        try await outbox.transition(entry.clientMsgID, to: .sending)
        try require(current)
        await refreshOutbox()
        do {
            let kind = (bridge.unpack(entry.serializedMessage)?["contentType"] as? NSNumber)?.intValue ?? 101
            let result = try await call(timeout: [102, 103, 104, 105].contains(kind) ? 120_000_000_000 : 25_000_000_000) { bridge.send(serialized: entry.serializedMessage, target: entry.targetID, type: entry.sessionType, completion: $0) }
            try require(current)
            guard let message = Self.item(result), message.id == entry.clientMsgID, message.status == 2 else { throw NativeChatError.invalidMessage }
            if let original = bridge.unpack(entry.serializedMessage).flatMap(Self.item)?.media, let media = message.media,
               let local = original.kind == 102 ? ownedMediaURL(original.localPath) : (original.kind == 104 ? ownedMediaURL(VideoMessageMetadata(serialized: entry.serializedMessage).localThumbnail) : nil) {
                let policy = business.media
                let identities = (original.kind == 104 ? [media.thumbnail] : [media.url, media.thumbnail]).filter { !$0.isEmpty }.flatMap { raw in
                    [policy.cacheIdentity(raw), policy.cacheIdentity(policy.image(raw, variant: .list)), policy.cacheIdentity(policy.image(raw, variant: .preview))]
                }
                try require(current)
                await NativeImageCache.shared.seedOwned(local, identities: identities, expectedEpoch: cacheEpoch)
                try require(current)
            }
            try await outbox.transition(entry.clientMsgID, to: .accepted)
            mergeMessages([message], conversationID: entry.conversationID)
            await reconcile(conversationID: entry.conversationID)
        } catch {
            guard isActive, generation == current else { throw error }
            // 发送回调失败或超时不能证明服务器未收；只允许核对，不自动重发。
            try? await outbox.transition(entry.clientMsgID, to: .uncertain)
            if isActive, generation == current {
                let native = error as NSError
                lastSendErrorCode = native.domain == "NativeOpenIM" ? native.code : nil
                let code = lastSendErrorCode.map { "（SDK \($0)）" } ?? ""
                lastError = "发送结果待核对" + code + "，正在查询本地记录。"
            }
            await refreshOutbox()
            await reconcile(conversationID: entry.conversationID)
            try require(current)
            if messages[entry.conversationID]?.contains(where: { $0.id == entry.clientMsgID && $0.status == 2 }) == true { return }
            scheduleReconciliation(entry.conversationID)
            throw error
        }
        await refreshOutbox()
    }

    func retry(_ entry: OutboxEntry) async throws {
        guard entry.state == .failed, let outbox = outbox,
              outboxEntries.contains(where: { $0.clientMsgID == entry.clientMsgID && $0.state == .failed }), !inFlightIDs.contains(entry.clientMsgID) else { throw NativeChatError.unavailable }
        let expected = generation
        // 手动重试也先按原 ID 查询，防止明确失败之后收到迟到 ACK。
        let found = try await call { bridge.find(conversation: entry.conversationID, clientMsgIDs: [entry.clientMsgID], completion: $0) }
        try require(expected)
        let items = (found["items"] as? [[String: Any]] ?? []).compactMap(Self.item).filter { $0.id == entry.clientMsgID }
        if let item = items.first {
            mergeMessages([item], conversationID: entry.conversationID)
            if item.status == 2 || item.status == 4 {
                try await outbox.transition(entry.clientMsgID, to: .accepted)
                try await outbox.pruneConfirmedAccepted(Set([entry.clientMsgID])); await refreshOutbox(); return
            }
            guard item.status == 3 && item.seq <= 0 else {
                try await outbox.transition(entry.clientMsgID, to: .uncertain); await refreshOutbox(); scheduleReconciliation(entry.conversationID); throw NativeChatError.unavailable
            }
        }
        let pending = await outbox.snapshot(conversationID: entry.conversationID)
        try require(expected)
        guard let current = pending.first(where: { $0.clientMsgID == entry.clientMsgID }), current.state == .failed else { throw NativeChatError.unavailable }
        try await dispatch(current, outbox: outbox)
    }

    func reconcile(conversationID: String) async {
        guard isActive, loggedIn, let outbox = outbox else { return }
        let current = generation
        let entries = await outbox.snapshot(conversationID: conversationID)
        let queryAttempts = sendAttempts
        let ids = entries.map(\.clientMsgID)
        guard !ids.isEmpty else { return }
        do {
            var confirmed = Set<String>()
            for start in stride(from: 0, to: ids.count, by: 40) {
                let batch = Array(ids[start..<min(start + 40, ids.count)])
                let result = try await call { bridge.find(conversation: conversationID, clientMsgIDs: batch, completion: $0) }
                try require(current)
                let items = (result["items"] as? [[String: Any]] ?? []).compactMap(Self.item)
                mergeMessages(items, conversationID: conversationID)
                for item in items where item.status == 2 && batch.contains(item.id) {
                    try await outbox.transition(item.id, to: .accepted)
                    try require(current)
                    confirmed.insert(item.id)
                }
                // SDK 明确返回失败时允许用户重试同一 clientMsgID；空结果或发送中仍保持待核对。
                for item in items where item.status == 3 && item.seq <= 0 && batch.contains(item.id) && !inFlightIDs.contains(item.id) && queryAttempts[item.id] == sendAttempts[item.id] {
                    try await outbox.confirmUncertainFailure(item.id)
                    try require(current)
                }
            }
            try require(current)
            try await outbox.pruneConfirmedAccepted(confirmed)
            if !confirmed.isEmpty { lastError = nil }
        } catch {
            if isActive, generation == current { lastError = "发送结果尚未核对，已保留待发记录。" }
        }
        await refreshOutbox()
        if isActive, generation == current, !outboxEntries.contains(where: { $0.conversationID == conversationID && $0.state == .uncertain }), outboxEntries.contains(where: { $0.conversationID == conversationID && $0.state == .failed }) {
            lastError = "消息未发送，可长按消息重试。"; publish()
        }
    }

    private func scheduleReconciliation(_ conversationID: String) {
        guard reconciliationTasks[conversationID] == nil else { return }
        let expected = generation
        reconciliationTasks[conversationID] = Task { [weak self] in
            guard let self = self else { return }
            defer { self.reconciliationTasks[conversationID] = nil }
            // 有界核对，绝不重新调用发送，也不把未查到当成明确失败。
            for delay in [UInt64(1_000_000_000), 3_000_000_000, 10_000_000_000] {
                do { try await Task.sleep(nanoseconds: delay) } catch { return }
                guard self.isActive, self.generation == expected, self.outboxEntries.contains(where: { $0.conversationID == conversationID && $0.state == .uncertain }) else { return }
                await self.reconcile(conversationID: conversationID)
            }
        }
    }

    private func refreshOutbox() async {
        let current = generation
        guard let outbox = outbox else { return }
        let entries = await outbox.snapshot()
        guard isActive, generation == current else { return }
        outboxEntries = entries; publish()
    }

    func visibleMessages(_ id: String) -> [ChatTextItem] {
        if conversations.first(where: { $0.id == id })?.type == 3, !groupVisibilityReady.contains(id) { return [] }
        let pending = outboxEntries.filter { $0.conversationID == id && $0.state != .accepted }.map { entry -> ChatTextItem in
            if let data = bridge.unpack(entry.serializedMessage), let item = Self.item(data) {
                return ChatTextItem(id: item.id, senderID: item.senderID.isEmpty ? imUserID : item.senderID, text: item.text, timestamp: item.timestamp, status: item.status, seq: item.seq, avatar: item.avatar, senderName: item.senderName, contentType: item.contentType, isRead: item.isRead, serialized: item.serialized, media: item.media)
            }
            return ChatTextItem(id: entry.clientMsgID, senderID: imUserID, text: entry.text, timestamp: entry.createdAt, status: 1)
        }
        return sanitize(ChatTextItem.merge(pending, messages[id] ?? [])).filter { visibility.permits($0, conversationID: id) && NativeMessagePin.control($0) == nil }
    }

    private func sanitize(_ items: [ChatTextItem]) -> [ChatTextItem] {
        items.filter { !deletedIDs.contains($0.id) }.map {
            revokedIDs.contains($0.id) ? ChatTextItem(id: $0.id, senderID: $0.senderID, text: "[消息已撤回]", timestamp: $0.timestamp, status: 4, seq: $0.seq) : (readIDs.contains($0.id) ? $0.read() : $0)
        }
    }

    private func mergeMessages(_ items: [ChatTextItem], conversationID: String) {
        for item in items where item.status == 4 { revokedIDs.insert(item.id) }
        messages[conversationID] = sanitize(ChatTextItem.merge(messages[conversationID] ?? [], items)).filter { visibility.permits($0, conversationID: conversationID) }
    }

    private func applyPinControl(_ item: ChatTextItem, conversation: NativeConversation) async throws {
        guard let pin = NativeMessagePin.control(item), visibility.permits(item, conversationID: conversation.id), item.status != 4 else { return }
        let extra = conversations.first(where: { $0.id == conversation.id })?.extra ?? conversation.extra
        let root = extra.data(using: .utf8).flatMap { try? JSONSerialization.jsonObject(with: $0) } as? [String: Any] ?? [:]
        let stored = (root["nativeMessagePinRevision"] as? NSNumber)?.int64Value ?? 0
        guard item.timestamp > max(pinSyncTime[conversation.id] ?? 0, stored) else { return }
        let body: [String: Any] = ["action": pin.action, "clientMsgID": pin.id, "preview": pin.preview, "senderNickname": pin.sender, "messageType": pin.type, "scope": "shared", "pinnedAt": item.timestamp]
        let current = generation, payload = String(decoding: try JSONSerialization.data(withJSONObject: body), as: UTF8.self)
        _ = try await call { bridge.patchPin(conversation.id, payload: payload, completion: $0) }
        try require(current); pinSyncTime[conversation.id] = item.timestamp
    }
    private func refreshRetentionBatch() async throws {
        let current = generation; guard let ledger = visibilityLedger else { throw NativeChatError.unavailable }
        let ids = conversations.filter { $0.type == 3 }.map(\.id)
        struct Result: Decodable { let items: [GroupRetentionState] }
        for start in stride(from: 0, to: ids.count, by: 50) {
            let batch = Array(ids[start..<min(start + 50, ids.count)])
            let result: Result = try await business.request("im/group-retention/states", query: [URLQueryItem(name: "conversationIds", value: batch.joined(separator: ","))]); try require(current)
            visibility = try await ledger.apply(result.items); try require(current); groupVisibilityReady.formUnion(batch)
        }
        for id in messages.keys { messages[id] = (messages[id] ?? []).filter { visibility.permits($0, conversationID: id) } }; publish()
    }
    func conversationPreview(_ conversation: NativeConversation) -> String {
        if conversation.type == 3, !groupVisibilityReady.contains(conversation.id) { return "" }
        let latest = ChatTextItem(id: "preview", senderID: conversation.latestSender, text: "", timestamp: conversation.timestamp, status: 2, seq: conversation.latestSeq)
        return visibility.permits(latest, conversationID: conversation.id) ? conversation.preview : ""
    }
    func conversationUnread(_ conversation: NativeConversation) -> Int {
        if conversationPreview(conversation).isEmpty { return 0 }
        if let floor = visibility.floors[conversation.id], conversation.latestSeq > 0 { return max(0, min(conversation.unread, conversation.latestSeq - floor.minVisibleSeq + 1)) }
        return conversation.unread
    }

    private func enqueueEvent(_ name: String, payload: [String: Any]) {
        queuedEvents.append((name, payload))
        guard !drainingEvents else { return }
        drainingEvents = true
        Task { [weak self] in
            guard let self = self else { return }
            defer { self.drainingEvents = false }
            while self.isActive && !self.queuedEvents.isEmpty {
                let next = self.queuedEvents.removeFirst()
                await self.event(next.0, payload: next.1)
            }
        }
    }

    func sendingLabel(_ item: ChatTextItem) -> String {
        guard item.senderID == imUserID else { return "" }
        if let entry = outboxEntries.first(where: { $0.clientMsgID == item.id }) {
            switch entry.state {
            case .uncertain: return "结果待核对"
            case .failed: return "未发送 · 可重试"
            case .prepared: return "已保存待发"
            case .sending: return "发送中"
            case .accepted: return "已提交"
            }
        }
        return item.isRead ? "已读" : (item.status == 2 ? "已提交" : (item.status == 3 ? "发送失败" : "发送中"))
    }
    func mediaIsSending(_ item: ChatTextItem) -> Bool {
        guard item.senderID == imUserID, [102, 104].contains(item.contentType) else { return false }
        return outboxEntries.contains { $0.clientMsgID == item.id && [.prepared, .sending].contains($0.state) }
    }

    private func event(_ name: String, payload: [String: Any]) async {
        let eventGeneration = generation
        guard isActive else { return }
        switch name {
        case "connecting": connection = "连接中"
        case "connected":
            connection = "已连接"
            for id in Set(outboxEntries.filter { $0.state == .uncertain }.map(\.conversationID)) { await reconcile(conversationID: id); guard isActive, generation == eventGeneration else { return } }
        case "connectFailed": connection = "连接中断，等待 SDK 重连"
        case "kicked", "tokenExpired", "tokenInvalid":
            needsAuthentication = true
            connection = name == "kicked" ? "账号已在其他设备登录" : "聊天凭据失效"
            lastError = connection + "，请退出后重新登录。"
            // 由用户重新登录触发新 token；当前绝不重登循环。
        case "syncStart":
            if let old = attempt { _ = await coordinator.finishSync(.cancelled, attempt: old) }
            syncEventSequence &+= 1
            syncing = true; pendingSync = nil; attempt = nil; syncLabel = "同步中"
            await advanceSyncIfReadable()
            let sequence = syncEventSequence, current = generation
            syncTimeout?.cancel()
            syncTimeout = Task { [weak self] in
                do { try await Task.sleep(nanoseconds: 60_000_000_000) } catch { return }
                guard let self = self, self.isActive, self.generation == current, self.syncEventSequence == sequence else { return }
                await self.finishSync(.timedOut)
            }
        case "syncFinish":
            await finishSync(.completed)
            if loggedIn && !loadingConversations { await loadConversations(reset: true) }
        case "syncFailed": await finishSync(.failed("SDK 同步失败"))
        case "syncProgress": syncLabel = "同步中 \((payload["progress"] as? NSNumber)?.intValue ?? 0)%"
        case "conversations":
            let changed = (payload["items"] as? [[String: Any]] ?? []).compactMap(NativeConversation.init)
            if loadingConversations { conversationChangesDuringRequest.append(contentsOf: changed) }
            mergeConversations(changed)
        case "message":
            if let item = Self.item(payload) {
                let type = (payload["sessionType"] as? NSNumber)?.intValue ?? 0
                let target = type == 3 ? payload["groupID"] as? String : (item.senderID == imUserID ? payload["recvID"] as? String : item.senderID)
                var matching = conversations.filter { $0.type == type && $0.target == target }
                if NativeMessagePin.control(item) != nil, matching.isEmpty, let target = target, [1, 3].contains(type) { do { let opened = try await openConversation(target: target, type: type); matching = [opened] } catch { if isActive, generation == eventGeneration { lastError = "置顶会话读取失败，请刷新重试。" } } }
                guard isActive, generation == eventGeneration else { return }
                for conversation in matching {
                    if NativeMessagePin.control(item) != nil { do { try await applyPinControl(item, conversation: conversation) } catch { if isActive, generation == eventGeneration { lastError = "置顶状态同步失败，请刷新会话重试。" } } }
                    guard isActive, generation == eventGeneration else { return }
                    mergeMessages([item], conversationID: conversation.id)
                }
                if NativeMessagePin.control(item) == nil, item.senderID != imUserID, item.status != 4, item.timestamp > Int64(Date().timeIntervalSince1970 * 1000) - 10_000, notifiedIDs.insert(item.id).inserted {
                    let prefix = "native.\(configuration.baseURL.host ?? "").\(account.profile.id)."
                    let preferences = UserDefaults.standard
                    let enabled = preferences.object(forKey: prefix + "message") == nil || preferences.bool(forKey: prefix + "message")
                    if UIApplication.shared.applicationState == .active, enabled, !preferences.bool(forKey: prefix + "noDisturb") {
                        let content = UNMutableNotificationContent(); content.title = item.senderName.isEmpty ? "新消息" : item.senderName; content.body = item.text
                        if preferences.object(forKey: prefix + "sound") == nil || preferences.bool(forKey: prefix + "sound") { content.sound = .default }
                        let request = UNNotificationRequest(identifier: "message-" + item.id, content: content, trigger: nil)
                        try? await UNUserNotificationCenter.current().add(request)
                    }
                }
            }
        case "read":
            readIDs.formUnion(payload["ids"] as? [String] ?? [])
        case "revoked", "deleted":
            if let id = payload["id"] as? String {
                if name == "deleted" { deletedIDs.insert(id) } else { revokedIDs.insert(id) }
                for key in Array(messages.keys) {
                    messages[key] = sanitize(messages[key] ?? [])
                }
            }
        default: break
        }
        publish()
    }

    private func advanceSyncIfReadable() async {
        guard isActive, localReadable, syncing, attempt == nil, syncBeginOperation == nil, let ticket = ticket else { return }
        let sequence = syncEventSequence
        let operation = UUID()
        syncBeginOperation = operation
        let next = await coordinator.beginSync(for: ticket)
        guard isActive, syncing, sequence == syncEventSequence else {
            if let next = next { _ = await coordinator.finishSync(.cancelled, attempt: next) }
            if syncBeginOperation == operation { syncBeginOperation = nil }
            if isActive, syncing, attempt == nil { await advanceSyncIfReadable() }
            return
        }
        if syncBeginOperation == operation { syncBeginOperation = nil }
        guard let next = next else { return }
        attempt = next
        if let pendingSync = pendingSync { await finishSync(pendingSync) }
    }

    private func finishSync(_ state: SyncState) async {
        syncTimeout?.cancel(); syncTimeout = nil
        guard syncing else { return }
        guard let attempt = attempt else {
            pendingSync = state
            syncLabel = state == .completed ? "同步事件结束，等待本地可读" : "同步未完成，保留本地库"
            publish(); return
        }
        let sequence = syncEventSequence
        let accepted = await coordinator.finishSync(state, attempt: attempt)
        guard accepted, isActive, syncEventSequence == sequence else { return }
        self.attempt = nil; pendingSync = nil; syncing = false
        switch state {
        case .completed: syncLabel = "同步完成"
        case .timedOut: syncLabel = "同步超时，保留本地记录"
        default: syncLabel = "同步失败，保留本地记录"
        }
        publish()
    }

    private func installLifecycle() {
        let center = NotificationCenter.default
        for (name, background) in [(UIApplication.didEnterBackgroundNotification, true), (UIApplication.willEnterForegroundNotification, false)] {
            notifications.append(center.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
                Task { @MainActor in await self?.changeBackground(background) }
            })
        }
        notifications.append(center.addObserver(forName: UIApplication.protectedDataWillBecomeUnavailableNotification, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in
                guard let self = self, self.isActive else { return }
                self.storeLabel = "系统数据保护中，保留本地库"
                self.publish()
            }
        })
        notifications.append(center.addObserver(forName: UIApplication.protectedDataDidBecomeAvailableNotification, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in await self?.loadConversations(reset: true) }
        })
        monitor.pathUpdateHandler = { [weak self] _ in
            Task { @MainActor in
                guard let self = self, self.isActive, self.loggedIn, !self.needsAuthentication else { return }
                do { _ = try await self.call { self.bridge.networkChanged(completion: $0) } }
                catch { self.lastError = "网络切换尚未恢复，等待 SDK 重连。"; self.publish() }
            }
        }
        monitor.start(queue: DispatchQueue(label: "im.native.network"))
    }

    func reconnect() async throws { guard isActive, loggedIn, !needsAuthentication else { throw NativeChatError.unavailable }; _ = try await call { bridge.networkChanged(completion: $0) }; await loadConversations(reset: true) }
    private func changeBackground(_ background: Bool) async {
        guard isActive, initialized, loggedIn else { return }
        do {
            _ = try await call { bridge.background(background, completion: $0) }
            if !background { await loadConversations(reset: true) }
        } catch {
            lastError = "前后台状态更新失败，保留本地库，请检查连接。"; publish()
        }
    }
}
