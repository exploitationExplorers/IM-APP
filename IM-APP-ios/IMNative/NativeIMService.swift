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
    let latestMessageID: String
    let latestSeq: Int
    let latestSender: String
    let groupDismissed: Bool
    let extra: String
    init?(_ data: [String: Any]) {
        guard let id = data["id"] as? String, !id.isEmpty else { return nil }
        self.id = id; extra = data["ex"] as? String ?? ""; type = (data["type"] as? NSNumber)?.intValue ?? 0
        target = data["target"] as? String ?? ""; title = data["title"] as? String ?? ""
        preview = data["preview"] as? String ?? "暂无消息"; unread = (data["unread"] as? NSNumber)?.intValue ?? 0
        timestamp = (data["timestamp"] as? NSNumber)?.int64Value ?? 0; pinned = data["pinned"] as? Bool ?? false
        avatar = data["avatar"] as? String ?? ""; muted = data["muted"] as? Bool ?? false
        latestMessageID = data["latestMessageID"] as? String ?? ""
        latestSeq = (data["latestSeq"] as? NSNumber)?.intValue ?? 0; latestSender = data["latestSender"] as? String ?? ""
        groupDismissed = data["groupDismissed"] as? Bool ?? false
    }
    var canOpen: Bool { [1, 3].contains(type) && !target.isEmpty }
}

struct NativeForwardDestination: Hashable, Sendable {
    let imID: String
    let type: Int
}

struct NativeHistoryPage {
    let messages: [ChatTextItem]
    let isEnd: Bool
    let lastMinSeq: Int
    let isLocalPreview: Bool
    let localExhausted: Bool
    init(messages: [ChatTextItem], isEnd: Bool, lastMinSeq: Int, isLocalPreview: Bool = false, localExhausted: Bool = false) {
        self.messages = messages; self.isEnd = isEnd; self.lastMinSeq = lastMinSeq
        self.isLocalPreview = isLocalPreview; self.localExhausted = localExhausted
    }
}
struct NativeSearchHit { let conversationID: String; let title: String; let message: ChatTextItem }
struct NativeSearchPage { let items: [NativeSearchHit]; let hasMore: Bool }

private enum NativeChatError: LocalizedError {
    case inactive, unavailable, timedOut, invalidMessage, noCursor, persistence, groupDismissed
    var errorDescription: String? {
        switch self {
        case .inactive: return "当前聊天会话已退出，请重新登录。"
        case .unavailable: return "聊天尚未就绪，请检查连接或重新登录。"
        case .timedOut: return "聊天请求超时，保留现有记录，请手动重试或核对发送结果。"
        case .invalidMessage: return "暂时不能处理此条消息。"
        case .noCursor: return "历史游标没有推进，请稍后重试；未标记为历史结束。"
        case .persistence: return "待发记录保存失败，本次没有发送消息，请检查存储空间。"
        case .groupDismissed: return "群聊已解散"
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
    // SDK 认证失败不代表业务 owner 已退出；通讯录、资料及业务刷新仍可使用。
    lazy var business = NativeBusinessContext(account: account, configuration: configuration, ownerIsActive: { [weak self] in self?.isActive == true })
    private let bridge = NativeOpenIMBridge()
    private let coordinator = SessionCoordinator()
    private var ticket: SessionTicket?
    private var attempt: SyncAttempt?
    private var syncEventSequence: UInt64 = 0
    private var syncBeginOperation: UUID?
    private var pendingSync: SyncState?
    private var syncing = false
    private var syncTimeout: Task<Void, Never>?
    private var sdkConnected = false
    private var emptyConversationBudget = EmptyConversationReloadBudget()
    private var emptyConversationTask: Task<Void, Never>?
    private var emptyConversationTaskID: UUID?
    private var pending: [UUID: NativeReply] = [:]
    private var observers: [UUID: () -> Void] = [:]
    private var publishTask: Task<Void, Never>?
    private var initialized = false
    private var bootstrapToken: IMToken?
    private var retryingConnection = false
    private var credentialRecoveryBudget = IMCredentialRecoveryBudget()
    private var credentialRecoveryTask: Task<Void, Never>?
    private var recoveryLoginInProgress = false
    private var recoveryLoginRejected = false
    private var automaticLogoutExpected = false
    private var credentialRecoveryStage = "idle"
    private var rejectedCredentialReused = false
    private var sdkStopWarning: String?
    private var conversationReadRetryBudget = ConversationReadRetryBudget()
    private var conversationReadRetryTask: Task<Void, Never>?
    private(set) var lastSDKReadFailure: OpenIMReadFailure?
    private var conversationSnapshotFallbacks = 0
    private(set) var loggedIn = false
    private(set) var needsAuthentication = false
    private var stopped = false
    private var stopTask: Task<Void, Never>?
    private var inFlightIDs = Set<String>()
    private var sendAttempts: [String: UUID] = [:]
    private var reconciliationTasks: [String: Task<Void, Never>] = [:]
    private var forwardDelivery: NativeForwardDeliveryCoordinator?
    private var directForwardTasks: [UUID: Task<Void, Never>] = [:]
    private var directForwardNotices: [String: String] = [:]
    private var latestLocalForwards: [String: OutboxEntry] = [:]
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
    private(set) var groupJoinRequestsRevision = UUID()
    private(set) var conversationsEnd = false
    private(set) var loadingConversations = false
    private var conversationOffset = 0
    private var conversationRequest: UUID?
    private var conversationChangesDuringRequest: [NativeConversation] = []
    private var conversationHiddenDuringRequest = Set<String>()
    private var conversationRefreshSeen: Set<String>?
    private var pendingConversationReset = false
    private var conversationStartup = ConversationStartupGate<NativeConversation>()
    private var conversationSnapshotCount = 0
    private var conversationSnapshotMilliseconds = 0
    private var bufferedStartupEventCount = 0
    var conversationStartupDiagnosticLines: [String] {
        ["conversationSnapshotReady=\(conversationStartup.ready)", "conversationStartupBufferedRows=\(bufferedStartupEventCount)", "conversationFullSnapshotRows=\(conversationSnapshotCount)", "conversationSnapshotMs=\(conversationSnapshotMilliseconds)", "conversationAutoReloadAttempts=\(emptyConversationBudget.attempts)", "sdkLoginStatus=\(initialized ? bridge.loginStatus() : 0)", "sdkLoginPending=\(bridge.loginPending())", "sdkConnected=\(sdkConnected)", "imPlatform=1", "imCredentialRecoveryAttempts=\(credentialRecoveryBudget.attempts)", "imCredentialRecoveryRunning=\(credentialRecoveryTask != nil)", "imCredentialRecoveryStage=\(credentialRecoveryStage)", "imRejectedCredentialReused=\(rejectedCredentialReused)", "imSessionKicked=\(credentialRecoveryBudget.kicked)", "conversationReadRetryAttempts=\(conversationReadRetryBudget.attempts)", "conversationSnapshotFallbacks=\(conversationSnapshotFallbacks)", "lastSDKReadOperation=\(lastSDKReadFailure?.operation ?? "none")", "lastSDKReadCode=\(lastSDKReadFailure.map { String($0.code) } ?? "none")", "lastSDKReadReason=\(lastSDKReadFailure?.reason.rawValue ?? "none")"]
    }
    private var outbox: PersistentOutbox?
    private(set) var outboxEntries: [OutboxEntry] = []
    private(set) var messages: [String: [ChatTextItem]] = [:]
    private let monitor = NWPathMonitor()
    private var notifications: [NSObjectProtocol] = []
    private var queuedEvents: [(String, [String: Any])] = []
    private var drainingEvents = false
    private var revokedIDs = Set<String>()
    private var pendingRecalls = Set<String>()
    private var lastKnownPreview: [String: NativeConversation] = [:]
    private var revokers: [String: (id: String, name: String)] = [:]
    private var inviteStatuses: [String: String] = [:]
    private var deletedIDs = Set<String>()
    private var storageDirectory: URL?
    private var visibilityLedger: GroupVisibilityLedger?
    private var visibility = GroupVisibility()
    private var groupTargets: [String: NativeGroupPeer] = [:]
    private var readIDs = Set<String>()
    private var notifiedIDs = Set<String>()
    private var retentionTask: Task<Void, Never>?
    private var groupVisibilityReady = Set<String>()
    private var visibilityRefreshTasks: [String: Task<Void, Never>] = [:]
    private let recentHistory = NativeRecentHistory()
    private var activeHistoryRoom: String?
    private var checkedRecentGroup: String?
    private var activeHistoryFailureCursor: String?
    var historyIsSyncing: Bool { syncing }
    private var historyRefreshTasks: [String: Task<Void, Never>] = [:]
    private var localHistoryCursors: [String: [String: (position: Int, page: Int, exhausted: Bool)]] = [:]
    private var completedHistoryPages: [String: [String: NativeHistoryPage]] = [:]
    private var historyRequests: [String: (conversation: NativeConversation, cursor: String)] = [:]
    private var historyVersions: [String: UUID] = [:]
    private(set) var historyReloadRevisions: [String: UInt64] = [:]
    private let historyPageSize = 20
    private var retentionRefreshTask: Task<Void, Never>?
    private var pinSyncTime: [String: Int64] = [:]
    private var pinPatchTail: (id: UUID, task: Task<Void, Error>)?

    init(account: BusinessAccountSession, configuration: APIConfiguration) {
        self.account = account; self.configuration = configuration; self.api = APIClient(configuration: configuration)
    }

    var isActive: Bool { !stopped && Self.current === self }
    var canSend: Bool { isActive && loggedIn && sdkConnected && localReadable && !needsAuthentication && UIApplication.shared.isProtectedDataAvailable }
    private func isGroupDismissed(_ conversation: NativeConversation) -> Bool {
        conversation.type == 3 && (conversation.groupDismissed || groupTargets[conversation.id]?.denyReason == "group_inactive")
    }

    func isRoomDismissed(_ conversation: NativeConversation) -> Bool {
        isGroupDismissed(conversation) || (conversation.type == 3 && conversations.contains { $0.id == conversation.id && $0.groupDismissed })
    }

    func canSend(to conversation: NativeConversation) -> Bool {
        canSend && (conversation.type != 3 || (!isRoomDismissed(conversation) && groupTargets[conversation.id]?.canChat == true))
    }

    func sendRestriction(_ conversation: NativeConversation) -> String? {
        if isRoomDismissed(conversation) { return "群聊已解散" }
        guard conversation.type == 3, let target = groupTargets[conversation.id], !target.canChat else { return nil }
        switch target.denyReason {
        case "group_muted": return "全群禁言中"
        case "member_muted": return "您已被禁言"
        case "not_member": return "您已不在该群聊"
        default: return "当前禁止在此群发言。"
        }
    }
    func loadAllConversations() async throws -> [NativeConversation] {
        await loadConversations(reset: true)
        guard isActive, localReadable, !loadingConversations else { throw NativeChatError.unavailable }
        var previousOffset = -1
        while !conversationsEnd { guard previousOffset != conversationOffset else { throw NativeChatError.noCursor }; previousOffset = conversationOffset; await loadConversations(); guard isActive, !loadingConversations, lastError == nil else { throw NativeChatError.unavailable } }
        return conversations
    }
    var statusText: String { lastError ?? "\(connection) · \(storeLabel) · \(syncLabel)" }

    func mediaPreference(_ preference: NativeMediaPreference) -> Bool {
        UserDefaults.standard.object(forKey: preference.key(for: business.media)) as? Bool ?? true
    }

    func setMediaPreference(_ preference: NativeMediaPreference, enabled: Bool) {
        UserDefaults.standard.set(enabled, forKey: preference.key(for: business.media))
    }

    func canPrefetchMedia(wifiOnly: Bool) -> Bool {
        let path = monitor.currentPath
        return isActive && loggedIn && !needsAuthentication && UIApplication.shared.applicationState == .active &&
            path.status == .satisfied && (!wifiOnly || path.usesInterfaceType(.wifi))
    }

    func observe(_ update: @escaping () -> Void) -> UUID {
        let id = UUID(); observers[id] = update; return id
    }
    func removeObserver(_ id: UUID) { observers[id] = nil }
    private func publish() {
        guard publishTask == nil else { return }
        publishTask = Task { [weak self] in
            do { try await Task.sleep(nanoseconds: 16_000_000) } catch { return }
            guard let self = self else { return }
            self.publishTask = nil
            for update in Array(self.observers.values) { update() }
        }
    }
    private func require(_ expected: UUID) throws {
        try Task.checkCancellation()
        guard isActive && generation == expected else { throw NativeChatError.inactive }
    }

    func start() async {
        guard !Self.switching else { lastError = "另一次聊天登录仍在结束，请返回后重试。"; publish(); return }
        Self.switching = true
        defer { Self.switching = false }
        if let previous = Self.current, previous !== self {
            await previous.stop()
            guard !previous.initialized else { lastError = previous.sdkStopWarning ?? "上一聊天会话尚未退出，请完全关闭 App 后重开；聊天记录已保留。"; publish(); return }
        }
        guard !Task.isCancelled, !stopped else { return }
        Self.current = self
        let current = generation
        do {
            let created = try await coordinator.beginAuthentication(ownerKey: configuration.baseURL.absoluteString + "|" + account.profile.id)
            try require(current)
            ticket = created
            // 普通重试复用票据；过期或 SDK 明确拒绝时才有界恢复一次。
            let saved = try await NativeSessionVault.shared.load()
            let credential = saved?.authentication.refreshToken == business.refreshToken ? saved?.imCredential : nil
            let cached = credential.flatMap { try? $0.validForLogin(businessUserID: account.profile.id, configuration: configuration) }
            let token: IMToken
            if let cached = cached { token = cached }
            else {
                do {
                    let issued = try await business.imToken()
                    try require(current)
                    try await saveIMCredential(issued)
                    token = issued
                } catch {
                    guard let failure = error as? APIError, failure == .transport || failure == .timedOut,
                          let credential = credential else { throw error }
                    // 与 Android 一样，临时断网仍可尝试同身份本机开库，不能据此恢复发送权限。
                    token = try credential.validated(businessUserID: account.profile.id, configuration: configuration)
                }
            }
            try require(current)
            bootstrapToken = token
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
                groupVisibilityReady = visibility.confirmedBoundaryIDs
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
            await resumeAfterSDKLogin()
        } catch {
            guard isActive, generation == current else { return }
            lastSDKReadFailure = OpenIMReadFailure(error: error)
            lastError = lastSDKReadFailure?.message ?? error.localizedDescription
            if lastSDKReadFailure?.reason == .kicked { handleCredentialFailure(.kicked) }
            else if lastSDKReadFailure?.reason == .authentication { handleCredentialFailure(.invalid) }
            if let ticket = ticket { _ = await coordinator.authenticationFailed(ticket, reason: "SDK 登录未就绪") }
            publish()
        }
    }

    private func resumeAfterSDKLogin() async {
        guard !needsAuthentication else { return }
        loggedIn = true
        if retentionTask == nil {
            retentionTask = Task { [weak self] in
                while !Task.isCancelled {
                    do { try await Task.sleep(nanoseconds: 30_000_000_000) } catch { return }
                    guard let self = self, self.isActive else { return }
                    do {
                        try await self.refreshRetentionBatch()
                        for conversation in self.conversations where self.groupTargets[conversation.id] != nil && !self.isGroupDismissed(conversation) {
                            do { try await self.refreshGroupVisibility(conversation) }
                            catch NativeChatError.groupDismissed { continue }
                        }
                    } catch {
                        if self.isActive && !Task.isCancelled {
                            self.lastError = "群消息可见性暂未更新，保留已确认水位。"
                            self.publish()
                        }
                    }
                }
            }
        }
        storeLabel = "正在验证本地可读"; lastError = nil; publish()
        await loadConversations(reset: true)
    }

    /// 普通读取重试复用票据，认证失效只走独立的有界恢复。
    func retryConversations() async {
        guard isActive, !retryingConnection, !Self.switching else { return }
        guard !needsAuthentication else {
            lastError = credentialRecoveryTask != nil ? "正在恢复聊天认证，请稍候。" : (credentialRecoveryBudget.kicked ? "账号已在其他设备登录，请重新登录。" : credentialFailureMessage())
            publish(); return
        }
        guard initialized, let token = bootstrapToken else { lastError = "聊天 SDK 初始化未完成，请返回登录页重试。"; publish(); return }
        retryingConnection = true
        defer { retryingConnection = false; publish() }
        conversationReadRetryTask?.cancel(); conversationReadRetryTask = nil; conversationReadRetryBudget.reset()
        let current = generation
        switch bridge.loginStatus() {
        case 3:
            if loggedIn { await loadConversations(reset: true) }
            else { await resumeAfterSDKLogin() }
        case 2:
            lastError = "聊天 SDK 正在登录，请稍后再试。"
        default:
            guard !bridge.loginPending() else { lastError = "聊天 SDK 正在完成上一次登录，请稍后再试。"; return }
            loggedIn = false
            do {
                _ = try await call { bridge.login(userID: token.userId, token: token.token, completion: $0) }
                try require(current)
                await resumeAfterSDKLogin()
            } catch {
                guard isActive, generation == current else { return }
                lastSDKReadFailure = OpenIMReadFailure(error: error)
                lastError = lastSDKReadFailure?.message ?? error.localizedDescription
                if lastSDKReadFailure?.reason == .kicked { handleCredentialFailure(.kicked) }
                else if lastSDKReadFailure?.reason == .authentication { handleCredentialFailure(.invalid) }
            }
        }
    }

    private func saveIMCredential(_ token: IMToken) async throws {
        let credential = IMBootstrapCredential(businessUserID: account.profile.id, apiBaseURL: configuration.baseURL.absoluteString, token: token)
        let expectedRefresh = business.refreshToken
        do { try await NativeSessionVault.shared.saveIMCredential(credential, expectedRefreshToken: expectedRefresh) }
        catch is CancellationError {
            // 只重试同 owner 的并发业务轮换，不重复申请 IM Token。
            guard isActive, business.refreshToken != expectedRefresh else { throw CancellationError() }
            try await NativeSessionVault.shared.saveIMCredential(credential, expectedRefreshToken: business.refreshToken)
        }
    }

    private func handleCredentialFailure(_ failure: IMCredentialRecoveryBudget.Failure) {
        needsAuthentication = true
        loggedIn = false; sdkConnected = false
        automaticLogoutExpected = true
        retentionTask?.cancel(); retentionTask = nil
        conversationReadRetryTask?.cancel(); conversationReadRetryTask = nil
        syncTimeout?.cancel(); syncTimeout = nil
        cancelEmptyConversationReload()
        recentHistory.stop(); checkedRecentGroup = nil; activeHistoryFailureCursor = nil
        let canRecover = credentialRecoveryBudget.reserve(failure)
        if recoveryLoginInProgress { recoveryLoginRejected = true }
        // 互踢或恢复中再次拒绝也要撤销当前票据，不能等下次启动继续复用。
        if let token = bootstrapToken?.token {
            let refresh = business.refreshToken
            Task {
                try? await NativeSessionVault.shared.clearIMCredential(expectedUserID: account.profile.id,
                    apiBaseURL: configuration.baseURL.absoluteString, expectedRefreshToken: refresh, token: token)
            }
        }
        if failure == .kicked {
            credentialRecoveryTask?.cancel()
            connection = "账号已在其他设备登录"
            lastError = connection + "，请重新登录。"
        } else if credentialRecoveryTask != nil {
            publish(); return
        } else {
            connection = "聊天凭据失效"
            lastError = canRecover ? "正在恢复聊天认证…" : credentialFailureMessage()
        }
        guard credentialRecoveryTask == nil else { publish(); return }
        let current = generation, invalidToken = bootstrapToken?.token, refresh = business.refreshToken
        credentialRecoveryTask = Task { [weak self] in
            guard let self = self else { return }
            defer { self.recoveryLoginInProgress = false; self.credentialRecoveryTask = nil; self.publish() }
            do {
                if let invalidToken = invalidToken {
                    try await NativeSessionVault.shared.clearIMCredential(expectedUserID: self.account.profile.id,
                        apiBaseURL: self.configuration.baseURL.absoluteString, expectedRefreshToken: refresh, token: invalidToken)
                }
                guard canRecover else { return }
                // 启动登录及手动重试先释放 SDK 单例；等待本身不触发新请求。
                self.credentialRecoveryStage = "waitingForLoginCallback"
                let waitingSince = ProcessInfo.processInfo.systemUptime
                while Self.switching || self.retryingConnection {
                    guard ProcessInfo.processInfo.systemUptime - waitingSince < 30 else { throw IMCredentialRecoveryError.sdkBusy }
                    try await Task.sleep(nanoseconds: 50_000_000)
                    try self.require(current)
                }
                try self.require(current)
                guard !self.credentialRecoveryBudget.kicked else { return }
                self.credentialRecoveryStage = "waitingForAutomaticLogout"
                try await OpenIMSessionBarrier.waitForLogout(status: {
                    try self.require(current)
                    return self.bridge.loginPending() ? 2 : self.bridge.loginStatus()
                })
                self.automaticLogoutExpected = false
                self.credentialRecoveryStage = "requestingCredential"
                let token = try await self.business.imToken()
                try self.require(current)
                guard !self.credentialRecoveryBudget.kicked else { return }
                if let previous = self.bootstrapToken {
                    guard token.userId == previous.userId, token.apiAddr == previous.apiAddr, token.wsAddr == previous.wsAddr else { throw APIError.invalidCredentials }
                }
                self.rejectedCredentialReused = token.token == invalidToken
                try IMCredentialRecoveryError.requireReplacement(token.token, rejected: invalidToken)
                try await self.saveIMCredential(token)
                try self.require(current)
                guard !self.credentialRecoveryBudget.kicked else { return }
                let ticket = try await self.coordinator.beginAuthentication(ownerKey: self.configuration.baseURL.absoluteString + "|" + self.account.profile.id)
                self.ticket = ticket
                self.bootstrapToken = token; self.loggedIn = false
                self.recoveryLoginRejected = false; self.recoveryLoginInProgress = true
                self.credentialRecoveryStage = "loggingIn"
                _ = try await self.call { self.bridge.login(userID: token.userId, token: token.token, completion: $0) }
                try self.require(current)
                guard !self.credentialRecoveryBudget.kicked, !self.recoveryLoginRejected else { throw APIError.invalidCredentials }
                // login 成功只表示本机开库完成；在线恢复必须等连接成功事件。
                self.credentialRecoveryStage = "waitingForConnection"
                let connectionSince = ProcessInfo.processInfo.systemUptime
                while !self.sdkConnected {
                    guard !self.credentialRecoveryBudget.kicked, !self.recoveryLoginRejected else { throw APIError.invalidCredentials }
                    guard ProcessInfo.processInfo.systemUptime - connectionSince < 25 else { throw IMCredentialRecoveryError.connectionNotReady }
                    try await Task.sleep(nanoseconds: 50_000_000)
                    try self.require(current)
                }
                _ = await self.coordinator.authenticationSucceeded(ticket, businessUserID: self.account.profile.id, imUserID: token.userId)
                try self.require(current)
                guard !self.credentialRecoveryBudget.kicked, !self.recoveryLoginRejected else { throw APIError.invalidCredentials }
                self.recoveryLoginInProgress = false
                self.credentialRecoveryStage = "ready"
                self.needsAuthentication = false; self.connection = "聊天认证已恢复"
                self.lastSDKReadFailure = nil
                await self.resumeAfterSDKLogin()
            } catch {
                guard self.isActive, self.generation == current, !Task.isCancelled else { return }
                self.lastSDKReadFailure = OpenIMReadFailure(error: error) ?? self.lastSDKReadFailure
                if error as? IMCredentialRecoveryError == .connectionNotReady { self.credentialRecoveryStage = "waitingForConnection" }
                else { self.credentialRecoveryStage = self.rejectedCredentialReused ? "credentialUnchanged" : "failed" }
                if self.credentialRecoveryBudget.kicked { self.lastError = "账号已在其他设备登录，请重新登录。" }
                else if let recoveryError = error as? IMCredentialRecoveryError { self.lastError = recoveryError.localizedDescription + self.credentialCodeSuffix }
                else { self.lastError = self.credentialFailureMessage() }
            }
        }
        publish()
    }

    private var credentialCodeSuffix: String {
        guard let failure = lastSDKReadFailure, failure.code != 0 else { return "" }
        return "（SDK \(failure.code)）"
    }
    private func credentialFailureMessage() -> String {
        if rejectedCredentialReused { return IMCredentialRecoveryError.unchangedCredential.localizedDescription + credentialCodeSuffix }
        return "聊天认证尚未恢复，请查看调试资讯；聊天记录已保留。" + credentialCodeSuffix
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
        pinPatchTail?.task.cancel(); pinPatchTail = nil
        await NativeRecentMediaCache.shared.invalidate()
        credentialRecoveryTask?.cancel(); credentialRecoveryTask = nil
        bootstrapToken = nil; conversationReadRetryTask?.cancel(); conversationReadRetryTask = nil
        syncTimeout?.cancel(); syncTimeout = nil; cancelEmptyConversationReload(); sdkConnected = false; monitor.cancel()
        retentionTask?.cancel(); retentionTask = nil
        for token in notifications { NotificationCenter.default.removeObserver(token) }
        notifications.removeAll()
        for reply in pending.values { reply.finish(.failure(NativeChatError.inactive)) }
        pending.removeAll()
        queuedEvents.removeAll()
        publishTask?.cancel(); publishTask = nil
        reconciliationTasks.values.forEach { $0.cancel() }; reconciliationTasks.removeAll()
        directForwardTasks.values.forEach { $0.cancel() }
        directForwardTasks.removeAll(); directForwardNotices.removeAll(); latestLocalForwards.removeAll()
        await forwardDelivery?.stop()
        forwardDelivery = nil
        visibilityRefreshTasks.values.forEach { $0.cancel() }; visibilityRefreshTasks.removeAll()
        historyRefreshTasks.values.forEach { $0.cancel() }; historyRefreshTasks.removeAll(); localHistoryCursors.removeAll()
        completedHistoryPages.removeAll(); historyRequests.removeAll(); historyVersions.removeAll()
        recentHistory.stop(); activeHistoryRoom = nil; checkedRecentGroup = nil; activeHistoryFailureCursor = nil
        retentionRefreshTask?.cancel(); retentionRefreshTask = nil
        // 固定版 unInitSDK 不关闭已登录会话；必须先等实际 login/logout 回调释放旧核心。
        if initialized, Self.current === self {
            await finishSDKSession()
        }
        // 等待此前已入队的旧outbox写操作结束，新owner才能读取同一账号文件。
        if let outbox = outbox { _ = await outbox.snapshot() }
        if Self.current === self, !initialized { Self.current = nil }
        await coordinator.logout()
        await NativeImageCache.shared.invalidateSession()
        messages.removeAll(); conversations.removeAll(); conversationRefreshSeen = nil; pendingConversationReset = false; conversationStartup = ConversationStartupGate(); outboxEntries.removeAll(); outbox = nil
        lastError = sdkStopWarning ?? "已退出聊天会话"
        publish(); observers.removeAll()
    }

    private func finishSDKSession() async {
        do {
            let started = ProcessInfo.processInfo.systemUptime
            while bridge.loginPending() {
                guard ProcessInfo.processInfo.systemUptime - started < 25 else { throw IMCredentialRecoveryError.sdkBusy }
                try await Task.sleep(nanoseconds: 50_000_000)
            }
            if automaticLogoutExpected {
                try await OpenIMSessionBarrier.waitForLogout(status: { self.bridge.loginStatus() })
            } else if bridge.loginStatus() == 3 {
                // 已停止 App owner，不能走 require(isActive) 的普通请求包装。
                _ = try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<[String: Any], Error>) in
                    let reply = NativeReply(continuation)
                    reply.timeout = Task { @MainActor in
                        do { try await Task.sleep(nanoseconds: 25_000_000_000) } catch { return }
                        reply.finish(.failure(IMCredentialRecoveryError.sdkBusy))
                    }
                    bridge.logout { result, error in
                        Task { @MainActor in
                            if let error = error { reply.finish(.failure(error)) }
                            else { reply.finish(.success(result ?? [:])) }
                        }
                    }
                }
            }
            guard bridge.shutdown() else { throw IMCredentialRecoveryError.sdkBusy }
            initialized = false
        } catch {
            sdkStopWarning = "上一聊天会话退出未完成，请完全关闭 App 后重开；聊天记录已保留。"
            business.logoutWarning = sdkStopWarning
        }
    }

    func logout() async {
        if let stopTask = stopTask { await stopTask.value; return }
        // stop与logout共用一个task；新owner.start必须等完整旧logout/unInit结束。
        let task = Task { @MainActor in
            self.needsAuthentication = true; self.loggedIn = false
            let refresh = self.business.refreshToken
            var warnings: [String] = []
            do { try await NativeSessionVault.shared.clear(expectedUserID: self.account.profile.id, expectedRefreshToken: refresh) }
            catch { warnings.append("本机登录凭据清理失败：" + error.localizedDescription) }
            do { let _: EmptyReply = try await self.api.businessRequest("auth/logout", method: "POST", body: ["refreshToken": .string(refresh)], accessToken: self.business.accessToken) }
            catch { warnings.append("服务端会话撤销未确认：" + error.localizedDescription) }
            self.business.logoutWarning = warnings.isEmpty ? nil : warnings.joined(separator: "；")
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
        guard isActive, loggedIn else { return }
        if loadingConversations { if reset { pendingConversationReset = true }; return }
        let fullSnapshot = reset || !conversationStartup.ready
        guard fullSnapshot || !conversationsEnd else { return }
        let current = generation, requestID = UUID()
        let requestStarted = ProcessInfo.processInfo.systemUptime
        let queryStart = conversations
        conversationRequest = requestID; conversationChangesDuringRequest = []; conversationHiddenDuringRequest = []; loadingConversations = true; publish()
        defer {
            if conversationRequest == requestID {
                loadingConversations = false
                let refreshAgain = pendingConversationReset; pendingConversationReset = false
                publish()
                if refreshAgain, isActive, generation == current {
                    Task { [weak self] in await self?.loadConversations(reset: true) }
                } else { scheduleEmptyConversationReload() }
            }
        }
        do {
            let offset = fullSnapshot ? 0 : conversationOffset
            let result: [String: Any]
            if fullSnapshot {
                let rows = try await ConversationSnapshotRead.read(pageSize: 40, all: {
                    let snapshot = try await self.call { self.bridge.allConversations(completion: $0) }
                    return snapshot["items"] as? [[String: Any]] ?? []
                }, page: { offset, count in
                    let page = try await self.call { self.bridge.conversations(offset: offset, count: count, completion: $0) }
                    return page["items"] as? [[String: Any]] ?? []
                }, identity: { $0["id"] as? String ?? "" }, onFallback: { failure in
                    self.lastSDKReadFailure = failure; self.conversationSnapshotFallbacks += 1
                })
                result = ["items": rows]
            }
            else { result = try await call { bridge.conversations(offset: offset, count: 40, completion: $0) } }
            try require(current)
            guard conversationRequest == requestID, !needsAuthentication else { return }
            let rows = (result["items"] as? [[String: Any]] ?? []).compactMap(NativeConversation.init)
            let localChanges = ConversationRefreshPolicy.changesSince(start: queryStart, current: conversations, identity: { $0.id })
            let resolved: [NativeConversation]
            if fullSnapshot && !conversationStartup.ready {
                resolved = conversationStartup.complete(snapshot: rows, changes: conversationChangesDuringRequest + localChanges, identity: { $0.id })
            } else { resolved = ConversationRefreshPolicy.resolve(page: rows, changes: conversationChangesDuringRequest + localChanges, identity: { $0.id }) }
            mergeConversations(resolved, replacing: fullSnapshot)
            conversations.removeAll { conversationHiddenDuringRequest.contains($0.id) }
            if fullSnapshot { conversationRefreshSeen = Set(rows.map(\.id)) }
            else if conversationRefreshSeen != nil { conversationRefreshSeen?.formUnion(rows.map(\.id)) }
            conversationRefreshSeen?.formUnion(resolved.map(\.id))
            conversationRefreshSeen?.subtract(conversationHiddenDuringRequest)
            conversationOffset = offset + rows.count
            conversationsEnd = fullSnapshot || rows.count < 40
            if conversationsEnd, let completeIDs = conversationRefreshSeen {
                conversations.removeAll { !completeIDs.contains($0.id) }; conversationRefreshSeen = nil
            }
            if fullSnapshot {
                conversationSnapshotCount = rows.count
                conversationSnapshotMilliseconds = Int((ProcessInfo.processInfo.systemUptime - requestStarted) * 1000)
            }
            localReadable = true; storeLabel = "本地可读"; lastError = nil
            conversationReadRetryTask?.cancel(); conversationReadRetryTask = nil; conversationReadRetryBudget.reset()
            if let ticket = ticket { _ = await coordinator.updateLocalStore(.readable, for: ticket) }
            await advanceSyncIfReadable()
            scheduleRetentionRefresh()
            if !needsAuthentication {
                recentHistory.onUpdate = { [weak self] in self?.publish() }
                recentHistory.warmUp(conversations, context: business)
            }
        } catch {
            guard isActive, generation == current else { return }
            guard !needsAuthentication else { return }
            let failure = OpenIMReadFailure(error: error)
            lastSDKReadFailure = failure
            lastError = failure?.message ?? error.localizedDescription
            if failure?.reason == .notLoggedIn { loggedIn = false }
            if failure?.reason == .kicked { handleCredentialFailure(.kicked) }
            else if failure?.reason == .authentication { handleCredentialFailure(.invalid) }
            cancelEmptyConversationReload(clearBudget: false)
            if let failure = failure, failure.canRetryRead, !scheduleConversationReadRetry(failure) {
                lastError = "聊天数据暂不可读，自动重试已停止，请点击状态重试（SDK \(failure.code)）。"
            }
        }
    }

    @discardableResult
    private func scheduleConversationReadRetry(_ failure: OpenIMReadFailure) -> Bool {
        guard isActive, loggedIn, !needsAuthentication else { return false }
        if conversationReadRetryTask != nil { return true }
        guard let delay = conversationReadRetryBudget.reserve(failure: failure, now: ProcessInfo.processInfo.systemUptime) else { return false }
        let current = generation
        conversationReadRetryTask = Task { [weak self] in
            do { try await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000)) } catch { return }
            guard let self = self, self.isActive, self.generation == current, !self.needsAuthentication else { return }
            self.conversationReadRetryTask = nil
            await self.loadConversations(reset: true)
        }
        return true
    }

    private func cancelEmptyConversationReload(clearBudget: Bool = true) {
        emptyConversationTask?.cancel(); emptyConversationTask = nil; emptyConversationTaskID = nil
        if clearBudget { emptyConversationBudget.cancel() }
    }

    private func scheduleEmptyConversationReload() {
        guard isActive, !needsAuthentication, !loadingConversations, emptyConversationTask == nil,
              let delay = emptyConversationBudget.reserve(now: ProcessInfo.processInfo.systemUptime, connected: sdkConnected, loggedIn: loggedIn, syncing: syncing && pendingSync == nil, empty: conversations.isEmpty) else { return }
        let current = generation, sequence = syncEventSequence, taskID = UUID()
        emptyConversationTaskID = taskID
        emptyConversationTask = Task { [weak self] in
            do { try await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000)) } catch { return }
            guard let self = self, !Task.isCancelled, self.isActive, self.generation == current,
                  self.syncEventSequence == sequence, self.sdkConnected, self.loggedIn, !self.needsAuthentication,
                  self.syncing, self.pendingSync == nil, self.conversations.isEmpty,
                  self.emptyConversationBudget.withinWindow(now: ProcessInfo.processInfo.systemUptime) else {
                if let self = self, self.emptyConversationTaskID == taskID { self.emptyConversationTask = nil; self.emptyConversationTaskID = nil }
                return
            }
            await self.loadConversations(reset: true)
            guard self.emptyConversationTaskID == taskID else { return }
            self.emptyConversationTask = nil; self.emptyConversationTaskID = nil
            self.scheduleEmptyConversationReload()
        }
    }

    private func mergeConversations(_ rows: [NativeConversation], replacing: Bool = false) {
        let previous = conversations.map(\.id)
        let previousIDs = Set(previous)
        var byID: [String: NativeConversation] = replacing ? [:] : Dictionary(conversations.map { ($0.id, $0) }, uniquingKeysWith: { _, b in b })
        for row in rows {
            if !row.latestMessageID.isEmpty { lastKnownPreview[row.id] = row }
            if let local = latestLocalForwards[row.id],
               row.latestMessageID == local.clientMsgID || row.timestamp > local.createdAt {
                latestLocalForwards.removeValue(forKey: row.id)
            }
            byID[row.id] = row
        }
        let candidates = replacing ? rows : conversations + rows.filter { !previousIDs.contains($0.id) }
        let order = ConversationOrderPolicy.orderedIDs(candidates.map { source in
            let row = byID[source.id] ?? source
            return ConversationOrderEntry(id: row.id, pinned: row.pinned, timestamp: row.timestamp)
        }, previous: previous)
        var seen = Set<String>()
        conversations = order.filter { seen.insert($0).inserted }.compactMap { byID[$0] }
        if replacing { lastKnownPreview = lastKnownPreview.filter { byID[$0.key] != nil } }
    }

    func openConversation(target: String, type: Int) async throws -> NativeConversation {
        let current = generation
        guard loggedIn, [1, 3].contains(type) else { throw NativeChatError.unavailable }
        let result = try await call { bridge.conversation(target: target, type: type, completion: $0) }
        try require(current)
        guard let conversation = NativeConversation(result), conversation.canOpen else { throw NativeChatError.invalidMessage }
        if conversationStartup.receive([conversation]) { mergeConversations([conversation]) }
        publish(); return conversation
    }

    func beginHistoryPresentation(_ conversation: NativeConversation, allowsPreview: Bool) {
        if activeHistoryRoom != conversation.id { activeHistoryFailureCursor = nil }
        activeHistoryRoom = conversation.id
        guard allowsPreview, loggedIn, !needsAuthentication, !isRoomDismissed(conversation),
              (messages[conversation.id] ?? []).isEmpty else { return }
        let latest = conversations.first(where: { $0.id == conversation.id }) ?? conversation
        recentHistory.open(latest, context: business)
    }

    func endHistoryPresentation(_ conversation: NativeConversation) {
        recentHistory.close(conversation.id)
        guard activeHistoryRoom == conversation.id else { return }
        activeHistoryRoom = nil; checkedRecentGroup = nil
        activeHistoryFailureCursor = nil
    }

    func recentHistoryPreview(in conversation: NativeConversation) -> [ChatTextItem] {
        guard activeHistoryRoom == conversation.id, checkedRecentGroup == conversation.id,
              !needsAuthentication, activeHistoryFailureCursor != "",
              visibility.hasConfirmedBoundary(conversation.id), (messages[conversation.id] ?? []).isEmpty else { return [] }
        if let page = completedHistoryPages[conversation.id]?[""], !syncing || !page.isEnd { return [] }
        let latest = conversations.first(where: { $0.id == conversation.id }) ?? conversation
        guard let preview = recentHistory.cached(latest) else { return [] }
        return preview.filter {
            !deletedIDs.contains($0.id) && !revokedIDs.contains($0.id) && visibility.permits($0, conversationID: conversation.id)
        }
    }

    func historyNeedsRetry(_ conversation: NativeConversation, cursor: String) -> Bool {
        activeHistoryRoom == conversation.id && activeHistoryFailureCursor == cursor
    }

    func retryHistory(_ conversation: NativeConversation, cursor: String) {
        if historyNeedsRetry(conversation, cursor: cursor) { activeHistoryFailureCursor = nil }
        completedHistoryPages[conversation.id]?[cursor] = nil
        localHistoryCursors[conversation.id]?[cursor] = nil
    }

    func history(_ conversation: NativeConversation, cursor: String) async throws -> NativeHistoryPage {
        let current = generation
        guard conversation.canOpen, loggedIn, !needsAuthentication else { throw NativeChatError.unavailable }
        if conversation.type == 3, !isRoomDismissed(conversation) {
            if visibility.hasConfirmedBoundary(conversation.id) {
                scheduleVisibilityRefresh(conversation)
            } else {
                do { try await refreshGroupVisibility(conversation) }
                catch NativeChatError.groupDismissed { return NativeHistoryPage(messages: [], isEnd: true, lastMinSeq: 0) }
            }
        }
        try require(current)
        if isRoomDismissed(conversation), !visibility.hasConfirmedBoundary(conversation.id) {
            return NativeHistoryPage(messages: [], isEnd: true, lastMinSeq: 0)
        }
        if let completed = completedHistoryPage(conversation, cursor: cursor) { return completed }
        scheduleHistoryRefresh(conversation, cursor: cursor)
        let version = historyVersions[conversation.id]
        let cursorTime = messages[conversation.id]?.first(where: { $0.id == cursor })?.timestamp
        let position = cursorTime.map { Int($0 / 1000) + 1 } ?? (Int(Date().timeIntervalSince1970) + 1)
        let anchor = localHistoryCursors[conversation.id]?[cursor] ?? (position: position, page: 1, exhausted: false)
        if anchor.exhausted { return NativeHistoryPage(messages: [], isEnd: false, lastMinSeq: 0, isLocalPreview: true, localExhausted: true) }
        let timeout: UInt64 = cursor.isEmpty ? 10_000_000_000 : 25_000_000_000
        let result = try await call(timeout: timeout) { bridge.localHistory(conversation: conversation.id, position: anchor.position, page: anchor.page, count: historyPageSize, completion: $0) }
        let items = (result["items"] as? [[String: Any]] ?? []).compactMap(Self.item)
        let exhausted = result["localExhausted"] as? Bool ?? false
        try require(current)
        guard historyVersions[conversation.id] == version else { throw NativeChatError.inactive }
        localHistoryCursors[conversation.id, default: [:]][cursor] = (anchor.position, anchor.page + 1, exhausted)
        mergeMessages(items, conversationID: conversation.id)
        localReadable = true; storeLabel = "本地可读"
        if let ticket = ticket { _ = await coordinator.updateLocalStore(.readable, for: ticket) }
        try require(current)
        publish()
        // 搜索不支持所有消息类型，不能推进正式 SDK 游标或宣称到达历史开头。
        return NativeHistoryPage(messages: items, isEnd: false, lastMinSeq: 0, isLocalPreview: true, localExhausted: exhausted)
    }

    func completedHistoryPage(_ conversation: NativeConversation, cursor: String) -> NativeHistoryPage? {
        completedHistoryPages[conversation.id]?[cursor]
    }

    private func scheduleHistoryRefresh(_ conversation: NativeConversation, cursor: String) {
        let key = conversation.id + "|" + cursor
        guard historyRefreshTasks[key] == nil, completedHistoryPages[conversation.id]?[cursor] == nil else { return }
        historyRequests[key] = (conversation, cursor)
        if historyNeedsRetry(conversation, cursor: cursor) { activeHistoryFailureCursor = nil }
        let current = generation, version = historyVersions[conversation.id] ?? UUID()
        historyVersions[conversation.id] = version
        historyRefreshTasks[key] = Task { [weak self] in
            guard let self = self else { return }
            defer { if self.generation == current, self.historyVersions[conversation.id] == version { self.historyRefreshTasks[key] = nil } }
            do {
                let timeout: UInt64 = cursor.isEmpty ? 10_000_000_000 : 25_000_000_000
                let result = try await self.call(timeout: timeout) {
                    self.bridge.history(conversation: conversation.id, cursor: cursor, count: self.historyPageSize, completion: $0)
                }
                try self.require(current)
                guard self.historyVersions[conversation.id] == version else { return }
                let items = (result["items"] as? [[String: Any]] ?? []).compactMap(Self.item)
                let isEnd = result["isEnd"] as? Bool ?? false
                if !isEnd && (items.isEmpty || (!cursor.isEmpty && items.allSatisfy { $0.id == cursor })) { throw NativeChatError.noCursor }
                self.completedHistoryPages[conversation.id, default: [:]][cursor] = NativeHistoryPage(messages: items, isEnd: isEnd, lastMinSeq: (result["lastMinSeq"] as? NSNumber)?.intValue ?? 0)
                if !cursor.isEmpty || !items.isEmpty { self.historyRequests[key] = nil }
                self.mergeMessages(items, conversationID: conversation.id); self.publish()
                for item in items where NativeMessagePin.control(item) != nil {
                    try self.require(current)
                    guard self.historyVersions[conversation.id] == version else { return }
                    try await self.applyPinControl(item, conversation: conversation)
                }
                guard self.historyVersions[conversation.id] == version else { return }
                await self.reconcile(conversationID: conversation.id)
            } catch {
                // 高级接口补洞失败不覆盖已读本地记录，不伪造结束；下拉或重连可重试。
                guard self.isActive, self.generation == current, !Task.isCancelled,
                      self.historyVersions[conversation.id] == version else { return }
                if self.activeHistoryRoom == conversation.id {
                    self.activeHistoryFailureCursor = cursor
                    self.publish()
                }
            }
        }
    }

    private static func item(_ data: [String: Any]) -> ChatTextItem? {
        guard let id = data["id"] as? String, !id.isEmpty else { return nil }
        let type = (data["contentType"] as? NSNumber)?.intValue ?? 101
        let sequence = (data["seq"] as? NSNumber)?.intValue ?? 0, rawStatus = (data["status"] as? NSNumber)?.intValue ?? 0
        // 正服务序号证明已受理；迟到的本地失败不能覆盖它，撤回仍按撤回显示。
        let status = sequence > 0 && rawStatus != 4 ? 2 : rawStatus
        let media = [102, 103, 104, 105].contains(type) ? ChatMedia(
            kind: type, url: data["mediaURL"] as? String ?? "", thumbnail: data["thumbnail"] as? String ?? "",
            localPath: data["localPath"] as? String ?? "", filename: data["filename"] as? String ?? "",
            duration: (data["duration"] as? NSNumber)?.intValue ?? 0, byteCount: (data["mediaBytes"] as? NSNumber)?.int64Value,
            videoFormat: (data["videoType"] as? String).flatMap(ChatVideoFormat.init(openIMType:))) : nil
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

    private func accountMediaStore() throws -> AccountMediaStore {
        guard isActive, let root = storageDirectory else { throw NativeChatError.unavailable }
        return AccountMediaStore(accountDirectory: root)
    }

    func createMediaFile(data: Data, extension fileExtension: String) throws -> URL {
        try accountMediaStore().create(data: data, fileExtension: fileExtension)
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
    private func forwardCoordinator() throws -> NativeForwardDeliveryCoordinator {
        guard isActive, let root = storageDirectory else { throw NativeChatError.unavailable }
        if let existing = forwardDelivery { return existing }
        let expected = generation
        let coordinator = NativeForwardDeliveryCoordinator(context: business, accountDirectory: root,
            ownerIsActive: { [weak self] in self?.isActive == true && self?.generation == expected },
            onChange: { [weak self] in self?.publish() })
        forwardDelivery = coordinator
        return coordinator
    }

    func forwardSubmissions() async throws -> [NativeForwardSubmission] {
        try await forwardCoordinator().submissions()
    }

    func saveForwardSubmission(_ submission: NativeForwardSubmission) async throws {
        try await forwardCoordinator().save(submission)
    }

    func dispatchForwardInBackground(_ submission: NativeForwardSubmission) {
        do { try forwardCoordinator().dispatch(submission) }
        catch {
            lastError = "转发任务尚未准备好，请稍后重试。"
            publish()
        }
    }

    func forwardIsRunning(_ key: String) -> Bool { forwardDelivery?.isRunning(key) == true }

    func takeForwardNotice(in conversationID: String) -> String? {
        directForwardNotices.removeValue(forKey: conversationID) ?? forwardDelivery?.takeNotice(in: conversationID)
    }
    func enqueueDirectForward(messages: [ChatTextItem], snapshots: [ForwardMessageSnapshot],
                              to destinations: [NativeForwardDestination], from sourceID: String,
                              skipped: Int) async throws {
        guard canSend, let outbox, (1...100).contains(messages.count), messages.count == snapshots.count,
              (1...12).contains(destinations.count) else { throw NativeChatError.unavailable }
        let expected = generation
        let known = Dictionary(conversations.filter(\.canOpen).map {
            (NativeForwardDestination(imID: $0.target, type: $0.type), $0)
        }, uniquingKeysWith: { first, _ in first })
        let targets = try await withThrowingTaskGroup(of: NativeConversation.self) { group in
            for destination in destinations {
                group.addTask { @MainActor in
                    try self.require(expected)
                    if let cached = known[destination] { return cached }
                    return try await self.openConversation(target: destination.imID, type: destination.type)
                }
            }
            var result: [NativeConversation] = []
            for try await target in group { result.append(target) }
            return result
        }
        try Task.checkCancellation()
        try require(expected)
        let prepared = try zip(messages, snapshots).map { message, snapshot in
            try snapshot.applyingDirectForward(to: message.serialized)
        }
        let entries = try targets.map { target in
            try zip(prepared, snapshots).map { serialized, snapshot in
                guard let data = bridge.createForward(serialized), let item = Self.item(data),
                      item.contentType == snapshot.contentType, !item.serialized.isEmpty else { throw NativeChatError.invalidMessage }
                return OutboxEntry(clientMsgID: item.id, conversationID: target.id, targetID: target.target,
                                   sessionType: target.type, text: item.text, serializedMessage: item.serialized,
                                   createdAt: item.timestamp, forwardMedia: snapshot.contentType == 101 ? nil : snapshot)
            }
        }
        let queued = entries.flatMap { $0 }
        try require(expected)
        do { try await outbox.prepareBatch(queued) }
        catch { throw NativeChatError.persistence }
        // Once durable, cancellation of the picker must not cancel the account-owned delivery.
        guard isActive, generation == expected else { throw NativeChatError.inactive }
        for entry in queued where entry.createdAt >= (latestLocalForwards[entry.conversationID]?.createdAt ?? 0) {
            latestLocalForwards[entry.conversationID] = entry
        }
        await refreshOutbox()
        guard isActive, generation == expected else { throw NativeChatError.inactive }
        let job = UUID()
        directForwardTasks[job] = Task { [weak self] in
            guard let self else { return }
            defer { self.directForwardTasks.removeValue(forKey: job) }
            await self.deliverDirectForward(entries, snapshots: snapshots, outbox: outbox,
                                            sourceID: sourceID, skipped: skipped, expected: expected)
        }
    }

    private func deliverDirectForward(_ batches: [[OutboxEntry]], snapshots: [ForwardMessageSnapshot],
                                      outbox: PersistentOutbox, sourceID: String, skipped: Int, expected: UUID) async {
        // 同一条源媒体只归档一次。各会话独立发送，同一会话保留选中消息的顺序。
        let media = Dictionary(uniqueKeysWithValues: snapshots.enumerated().compactMap { index, snapshot in
            snapshot.contentType == 101 ? nil : (index, Task {
                try await self.archiveForwardMedia(snapshot, expected: expected)
            })
        })
        defer { media.values.forEach { $0.cancel() } }
        let failed = await withTaskGroup(of: Int.self) { group in
            for batch in batches {
                group.addTask { @MainActor in
                    var failures = 0
                    for (index, entry) in batch.enumerated() {
                        guard !Task.isCancelled, self.isActive, self.generation == expected else { break }
                        do { try await self.dispatch(entry, outbox: outbox, forwardArchive: media[index]) }
                        catch { failures += 1 }
                    }
                    return failures
                }
            }
            var failures = 0
            for await count in group { failures += count }
            return failures
        }
        guard !Task.isCancelled, isActive, generation == expected else { return }
        var notice = failed == 0 ? "转发成功" : "有 \(failed) 条转发未完成，请在目标会话查看状态。"
        if skipped > 0 { notice += " 已跳过 \(skipped) 个不可用的接收对象。" }
        directForwardNotices[sourceID] = notice
        publish()
    }

    private func archiveForwardMedia(_ snapshot: ForwardMessageSnapshot, expected: UUID) async throws -> ForwardMessageSnapshot {
        try Task.checkCancellation()
        try require(expected)
        let policy = business.media
        let cacheEpoch = await NativeImageCache.shared.mutationEpoch()
        try require(expected)
        let archiveSource = snapshot.forMediaArchive(using: policy)
        let archived: ForwardMessageSnapshot = try await business.request("forward-media/preserve", method: "POST", body: ["sourceSnapshot": archiveSource.body])
        try require(expected)
        for (source, destination) in archiveSource.imageCopies(to: archived) {
            guard policy.absolute(source)?.scheme == "https", policy.absolute(destination)?.scheme == "https" else { continue }
            for variant in [MediaURLPolicy.Variant.list, .preview] {
                try require(expected)
                await NativeImageCache.shared.aliasCached(from: policy.cacheIdentity(policy.image(source, variant: variant)),
                    to: policy.cacheIdentity(policy.image(destination, variant: variant)), expectedEpoch: cacheEpoch)
            }
        }
        try require(expected)
        return archived
    }

    func unpackMessage(_ serialized: String) -> ChatTextItem? { bridge.unpack(serialized).flatMap(Self.item) }
    func sendAt(_ text: String, users: [NativeGroupMember], all: Bool, quoted: ChatTextItem?, to conversation: NativeConversation, onPersisted: (() -> Void)? = nil) async throws {
        guard conversation.type == 3 else { throw NativeChatError.invalidMessage }; let current = generation
        var mentions: [[String: String]] = []
        for user in users { let peer: NativePeer = try await business.request("im/peers/\(user.id)"); try require(current); mentions.append(["id": peer.imUserId, "name": user.name]) }
        guard let message = bridge.createAt(text, users: mentions, all: all, quoted: quoted?.serialized ?? "") else { throw NativeChatError.invalidMessage }
        try await sendPrepared(message, to: conversation, onPersisted: onPersisted)
    }
    func inviteStatus(_ token: String) -> String? { inviteStatuses[token] }

    func inviteStatus(for item: ChatTextItem) -> String? {
        guard !inviteStatuses.isEmpty, let card = BusinessMessageCard(serialized: item.serialized), card.kind == .invitation else { return nil }
        return inviteStatus(card.token)
    }

    func beginOpeningInvite(_ token: String) -> Bool {
        guard isActive, inviteStatuses[token] == nil else { return false }
        updateInviteStatus("已查看邀请", token: token)
        return true
    }

    func updateInviteStatus(_ status: String, token: String) {
        guard isActive else { return }
        inviteStatuses[token] = status
        publish()
    }

    func pinnedMessage(in conversation: NativeConversation) -> NativeMessagePin? {
        let extra = conversations.first(where: { $0.id == conversation.id })?.extra ?? conversation.extra
        guard let data = extra.data(using: .utf8), let root = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any], let raw = root["pinnedMessage"] as? [String: Any], let pin = NativeMessagePin(raw) else { return nil }
        if let message = messages[conversation.id]?.first(where: { $0.id == pin.id }), !visibility.permits(message, conversationID: conversation.id) || revokedIDs.contains(pin.id) || deletedIDs.contains(pin.id) { return nil }
        return pin
    }
    func pinMessage(_ item: ChatTextItem, in conversation: NativeConversation, shared: Bool) async throws {
        guard item.status == 2, item.contentType < 1000 else { throw NativeChatError.invalidMessage }
        let type = [102: "image", 103: "voice", 104: "video", 105: "file", 108: "card"][item.contentType] ?? "text"
        try await updateMessagePin(id: item.id, preview: item.text, sender: item.senderName, type: type,
                                   in: conversation, shared: shared)
    }

    func unpinMessage(_ pin: NativeMessagePin, in conversation: NativeConversation) async throws {
        try await updateMessagePin(id: pin.id, preview: pin.preview, sender: pin.sender, type: pin.type,
                                   in: conversation, shared: pin.shared, removing: pin)
    }

    private func updateMessagePin(id: String, preview: String, sender: String, type: String,
                                  in conversation: NativeConversation, shared: Bool, removing: NativeMessagePin? = nil) async throws {
        let current = generation
        try require(current)
        if shared, conversation.type == 3 {
            let groupID = try await businessPeerID(conversation)
            let group: NativeGroup = try await business.request("groups/detail", query: [URLQueryItem(name: "groupId", value: groupID)])
            try require(current)
            guard group.canManage else { throw APIError.business(code: -1, message: "仅群主或管理员可更改全员置顶。") }
        }
        try Task.checkCancellation()
        if let removing {
            guard pinnedMessage(in: conversation)?.isSamePin(as: removing) == true else {
                throw APIError.business(code: -1, message: "置顶消息已变化，请刷新后重试。")
            }
        }
        var body: [String: Any] = [
            "action": removing == nil ? "pin" : "unpin", "clientMsgID": id, "preview": preview,
            "senderNickname": sender, "messageType": type, "scope": shared ? "shared" : "self",
            "pinnedAt": Int64(Date().timeIntervalSince1970 * 1000)
        ]
        var localPatch = body
        if let removing { localPatch["expectedPinnedAt"] = removing.timestamp }
        let payload = String(decoding: try JSONSerialization.data(withJSONObject: localPatch), as: UTF8.self)
        try await patchPin(payload, in: conversation, generation: current)
        try require(current)
        await loadConversations(reset: true)
        try require(current)
        if shared {
            body["businessKey"] = "message_pin"
            let control = String(decoding: try JSONSerialization.data(withJSONObject: body), as: UTF8.self)
            guard let message = bridge.createCustom(control) else { throw NativeChatError.invalidMessage }
            try await sendPrepared(message, to: conversation)
        }
    }
    func importMediaFile(_ source: URL) throws -> URL {
        try accountMediaStore().importFile(source)
    }

    func ownedMediaURL(_ path: String) -> URL? {
        guard let root = storageDirectory else { return nil }
        return AccountMediaStore(accountDirectory: root).ownedURL(path)
    }

    func importMediaFileInBackground(_ source: URL) async throws -> URL {
        let store = try accountMediaStore()
        let expected = generation
        let destination = try await store.importInBackground(source)
        do {
            try Task.checkCancellation()
            try require(expected)
            return destination
        } catch {
            try store.removeOwnedFile(destination)
            throw error
        }
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
        guard let owned = ownedMediaURL(file.path) else { throw NativeChatError.invalidMessage }
        if let snapshot = snapshot, ownedMediaURL(snapshot.path) == nil { throw NativeChatError.invalidMessage }
        guard let message = bridge.createMedia(kind: kind, path: owned.path, filename: filename, duration: duration,
                                               snapshot: snapshot?.path ?? "") else { throw NativeChatError.invalidMessage }
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
        guard !isRoomDismissed(conversation) else { throw NativeChatError.groupDismissed }
        guard let ledger = visibilityLedger else { throw NativeChatError.unavailable }
        struct RetentionResult: Decodable { let items: [GroupRetentionState] }
        let states: RetentionResult = try await business.request("im/group-retention/states", query: [URLQueryItem(name: "conversationIds", value: conversation.id)])
        try require(current)
        visibility = try await ledger.applyRetentionSnapshot(states.items, requested: [conversation.id]); try require(current)
        let target: NativeGroupPeer = try await business.request("im/groups/by-im/\(conversation.target)"); try require(current)
        groupTargets[conversation.id] = target
        if isRoomDismissed(conversation) {
            publish()
            throw NativeChatError.groupDismissed
        }
        struct Purges: Decodable { let items: [GroupMessagePurge] }
        let purges: Purges = try await business.request("groups/\(target.businessGroupId)/message-purges"); try require(current)
        visibility = try await ledger.applyPurges(purges.items, conversationID: conversation.id); try require(current)
        guard visibility.hasConfirmedBoundary(conversation.id) else { throw NativeChatError.unavailable }
        groupVisibilityReady.insert(conversation.id)
        if activeHistoryRoom == conversation.id { checkedRecentGroup = conversation.id }
        messages[conversation.id] = (messages[conversation.id] ?? []).filter { visibility.permits($0, conversationID: conversation.id) }
        publish()
    }
    func markRead(_ conversation: NativeConversation) async throws {
        guard !isRoomDismissed(conversation) else { return }
        let current = generation
        _ = try await call { bridge.markRead(conversation.id, completion: $0) }
        try require(current)
        let before = conversations.first { $0.id == conversation.id }
        let result = try await call { bridge.conversation(target: conversation.target, type: conversation.type, completion: $0) }
        try require(current)
        // 只刷新已读房间；查询期间新到的会话事件优先，不能被旧查询覆盖。
        if conversations.first(where: { $0.id == conversation.id }) == before,
           let updated = NativeConversation(result), updated.id == conversation.id {
            if loadingConversations { conversationChangesDuringRequest.append(updated) }
            if conversationStartup.receive([updated]) { mergeConversations([updated]) }
            publish()
        }
        if conversation.type == 3 {
            do {
                try await business.change("im/group-read-cursors/report", body: ["conversationId": .string(conversation.id)])
            } catch APIError.httpStatus(403) {
                // 已完成 OpenIM 标记。已退群或解散的会话无法上报群游标。
                scheduleVisibilityRefresh(conversation)
            } catch APIError.business(let code, _) where code == 403 {
                scheduleVisibilityRefresh(conversation)
            }
        }
    }
    func recall(_ item: ChatTextItem, in conversation: NativeConversation, reason: String? = nil) async throws {
        let current = generation
        try require(current)
        guard !revokedIDs.contains(item.id), pendingRecalls.insert(item.id).inserted else { return }
        publish()
        defer {
            pendingRecalls.remove(item.id)
            if isActive, generation == current { publish() }
        }
        let peer = try await businessPeerID(conversation)
        try require(current)
        var body: [String: JSONValue] = ["peerType": .string(conversation.type == 3 ? "group" : "c2c"), "peerId": .string(peer), "clientMsgId": .string(item.id), "seq": .number(Double(item.seq))]
        if let reason = reason, !reason.isEmpty { body["reason"] = .string(reason) }
        struct RecallResult: Decodable { let alreadyRecalled: Bool? }
        let result: RecallResult = try await business.request("im/messages/recall", method: "POST", body: body)
        // Once the server has accepted the change, record it even if the page just closed.
        guard isActive, generation == current else { throw NativeChatError.inactive }
        revokedIDs.insert(item.id)
        if result.alreadyRecalled != true, revokers[item.id] == nil {
            revokers[item.id] = (imUserID, business.profile.nickname)
        }
        mergeMessages([], conversationID: conversation.id)
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
        lastKnownPreview[conversation.id] = nil
        recentHistory.discard(conversation.id)
        checkedRecentGroup = nil
        historyVersions[conversation.id] = UUID(); completedHistoryPages[conversation.id] = nil; localHistoryCursors[conversation.id] = nil
        for key in Array(historyRequests.keys) where historyRequests[key]?.conversation.id == conversation.id {
            historyRefreshTasks[key]?.cancel(); historyRefreshTasks[key] = nil; historyRequests[key] = nil
        }
        let ids = Set((messages[conversation.id] ?? []).map(\.id) + outboxEntries.filter { $0.conversationID == conversation.id }.map(\.clientMsgID))
        if let ledger = visibilityLedger { visibility = try await ledger.hide(ids); try require(current) }
        deletedIDs.formUnion(ids); messages[conversation.id] = []; publish()
        _ = try await call { bridge.clear(conversation.id, completion: $0) }; await loadConversations(reset: true)
    }
    func pin(_ conversation: NativeConversation) async throws { try await setPinned(!conversation.pinned, conversation: conversation) }
    func mute(_ conversation: NativeConversation) async throws { try await setMuted(!conversation.muted, conversation: conversation) }
    func setPinned(_ value: Bool, conversation: NativeConversation) async throws {
        let current = generation
        _ = try await call { bridge.pin(conversation.id, pinned: value, completion: $0) }
        try require(current); try await refreshConversation(conversation, generation: current)
    }
    func setMuted(_ value: Bool, conversation: NativeConversation) async throws {
        let current = generation
        _ = try await call { bridge.mute(conversation.id, muted: value, completion: $0) }
        try require(current); try await refreshConversation(conversation, generation: current)
    }
    private func refreshConversation(_ conversation: NativeConversation, generation current: UUID) async throws {
        let before = conversations.first { $0.id == conversation.id }
        let result = try await call { bridge.conversation(target: conversation.target, type: conversation.type, completion: $0) }
        try require(current)
        // 设置只查询当前房间；等待期间有新事件时，优先保留事件里的完整会话。
        guard conversations.first(where: { $0.id == conversation.id }) == before,
              let updated = NativeConversation(result), updated.id == conversation.id else { return }
        if loadingConversations { conversationChangesDuringRequest.append(updated) }
        if conversationStartup.receive([updated]) { mergeConversations([updated]) }
        publish()
    }
    func hide(_ conversation: NativeConversation) async throws { let current = generation; _ = try await call { bridge.hide(conversation.id, completion: $0) }; try require(current); if loadingConversations { conversationHiddenDuringRequest.insert(conversation.id) }; conversations.removeAll { $0.id == conversation.id }; publish() }
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

    private func dispatch(_ entryToSend: OutboxEntry, outbox: PersistentOutbox,
                          forwardArchive: Task<ForwardMessageSnapshot, Error>? = nil) async throws {
        var entry = entryToSend
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
        do {
            if let snapshot = entry.forwardMedia {
                let archived: ForwardMessageSnapshot
                if let forwardArchive { archived = try await forwardArchive.value }
                else { archived = try await archiveForwardMedia(snapshot, expected: current) }
                try require(current)
                entry = try await outbox.protectForwardMedia(entry.clientMsgID, with: archived)
            } else {
                entry = try await prepareQuotedEntry(entry, outbox: outbox, expected: current)
            }
        } catch {
            try require(current)
            try await outbox.transition(entryToSend.clientMsgID, to: .failed)
            await refreshOutbox()
            throw error
        }
        try await outbox.transition(entry.clientMsgID, to: .sending)
        try require(current)
        await refreshOutbox()
        try require(current)
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
            // 本地明确拒绝可手动重试，网络/未知错误仍不得自动重发。
            let nativeError = error as NSError
            let rejected = nativeError.domain == "NativeOpenIM" && SendFailurePolicy.rejectedBeforeSubmission(nativeError.code)
            try? await outbox.transition(entry.clientMsgID, to: rejected ? .failed : .uncertain)
            if isActive, generation == current {
                let native = error as NSError
                lastSendErrorCode = native.domain == "NativeOpenIM" ? native.code : nil
                let code = lastSendErrorCode.map { "（SDK \($0)）" } ?? ""
                lastError = rejected ? "消息未发送，请稍后点按重试。" : "发送结果待确认" + code + "。"
            }
            await refreshOutbox()
            await reconcile(conversationID: entry.conversationID)
            try require(current)
            if messages[entry.conversationID]?.contains(where: { $0.id == entry.clientMsgID && $0.status == 2 }) == true { return }
            if !rejected { scheduleReconciliation(entry.conversationID) }
            throw error
        }
        await refreshOutbox()
    }

    private func prepareQuotedEntry(_ entry: OutboxEntry, outbox: PersistentOutbox, expected: UUID) async throws -> OutboxEntry {
        let context = business
        let prepared = try await QuoteMessagePreparation.prepare(serialized: entry.serializedMessage, mediaPolicy: context.media) { snapshot in
            try self.require(expected)
            let protected: ForwardMessageSnapshot = try await context.request("forward-media/preserve", method: "POST", body: ["sourceSnapshot": snapshot.body])
            try self.require(expected)
            return protected
        }
        try require(expected)
        guard prepared != entry.serializedMessage else { return entry }
        let updated = try await outbox.replaceUnsubmittedPayload(entry.clientMsgID, serialized: prepared)
        try require(expected)
        await refreshOutbox()
        try require(expected)
        return updated
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
        let isGroup = id.hasPrefix("sg_") || conversations.first(where: { $0.id == id })?.type == 3
        if isGroup, !groupVisibilityReady.contains(id) { return [] }
        let pending = outboxEntries.filter { $0.conversationID == id && $0.state != .accepted }.map { entry -> ChatTextItem in
            if let data = bridge.unpack(entry.serializedMessage), let item = Self.item(data) {
                return ChatTextItem(id: item.id, senderID: item.senderID.isEmpty ? imUserID : item.senderID, text: item.text, timestamp: item.timestamp, status: item.status, seq: item.seq, avatar: item.avatar, senderName: item.senderName, contentType: item.contentType, isRead: item.isRead, serialized: item.serialized, media: item.media)
            }
            return ChatTextItem(id: entry.clientMsgID, senderID: imUserID, text: entry.text, timestamp: entry.createdAt, status: 1)
        }
        return sanitize(ChatTextItem.merge(pending, messages[id] ?? []))
            .filter { visibility.permits($0, conversationID: id) && NativeMessagePin.control($0) == nil }
            .map { item in
                guard item.status == 4 || pendingRecalls.contains(item.id) else { return item }
                return recalledItem(item, text: recallLabel(for: item, group: isGroup))
            }
    }

    private func recallLabel(for item: ChatTextItem, group: Bool) -> String {
        let revoker = revokers[item.id]
        let name = revoker?.name.isEmpty == false ? revoker?.name : nil
        if pendingRecalls.contains(item.id), !revokedIDs.contains(item.id) { return "正在撤回…" }
        if revoker?.id == imUserID || (revoker == nil && item.senderID == imUserID) { return "你撤回了一条消息" }
        if item.senderID == imUserID, let revoker, !revoker.id.isEmpty { return "\(name ?? "管理员")撤回了你的消息" }
        if group { return "\(name ?? (item.senderName.isEmpty ? "群成员" : item.senderName))撤回了一条消息" }
        return "对方撤回了一条消息"
    }

    private func recalledItem(_ item: ChatTextItem, text: String) -> ChatTextItem {
        ChatTextItem(id: item.id, senderID: item.senderID, text: text, timestamp: item.timestamp, status: 4,
                     seq: item.seq, senderName: item.senderName)
    }

    private func sanitize(_ items: [ChatTextItem]) -> [ChatTextItem] {
        items.filter { !deletedIDs.contains($0.id) }.map { item in
            if revokedIDs.contains(item.id) { return recalledItem(item, text: "[消息已撤回]") }
            return readIDs.contains(item.id) ? item.read() : item
        }
    }

    private func mergeMessages(_ items: [ChatTextItem], conversationID: String) {
        for item in items where item.status == 4 { revokedIDs.insert(item.id) }
        messages[conversationID] = sanitize(ChatTextItem.merge(messages[conversationID] ?? [], items)).filter { visibility.permits($0, conversationID: conversationID) }
    }

    private func applyPinControl(_ item: ChatTextItem, conversation: NativeConversation) async throws {
        guard let pin = NativeMessagePin.control(item), visibility.permits(item, conversationID: conversation.id), item.status != 4 else { return }
        guard item.timestamp > (pinSyncTime[conversation.id] ?? 0) else { return }
        let body: [String: Any] = ["action": pin.action, "clientMsgID": pin.id, "preview": pin.preview,
            "senderNickname": pin.sender, "messageType": pin.type, "scope": "shared", "pinnedAt": item.timestamp,
            "requiresNewerRevision": true]
        let current = generation
        let payload = String(decoding: try JSONSerialization.data(withJSONObject: body), as: UTF8.self)
        try await patchPin(payload, in: conversation, generation: current)
        try require(current)
        pinSyncTime[conversation.id] = max(item.timestamp, pinSyncTime[conversation.id] ?? 0)
    }

    private func patchPin(_ payload: String, in conversation: NativeConversation, generation expected: UUID) async throws {
        try require(expected)
        let previous = pinPatchTail?.task
        let id = UUID()
        let task = Task { [self] in
            _ = await previous?.result
            try require(expected)
            _ = try await call { bridge.patchPin(conversation.id, payload: payload, completion: $0) }
        }
        pinPatchTail = (id, task)
        defer { if pinPatchTail?.id == id { pinPatchTail = nil } }
        return try await task.value
    }
    private func refreshRetentionBatch() async throws {
        let current = generation; guard let ledger = visibilityLedger else { throw NativeChatError.unavailable }
        let conversationIDs = conversations.filter { $0.type == 3 && GroupVisibility.supportsRetention($0.id) }.map(\.id)
        struct Result: Decodable { let items: [GroupRetentionState] }
        for start in stride(from: 0, to: conversationIDs.count, by: 50) {
            let batch = Array(conversationIDs[start..<min(start + 50, conversationIDs.count)])
            let result: Result = try await business.request("im/group-retention/states", query: [URLQueryItem(name: "conversationIds", value: batch.joined(separator: ","))]); try require(current)
            visibility = try await ledger.applyRetentionSnapshot(result.items, requested: Set(batch)); try require(current)
            groupVisibilityReady.formUnion(batch.filter { visibility.hasConfirmedBoundary($0) })
        }
        for id in messages.keys { messages[id] = (messages[id] ?? []).filter { visibility.permits($0, conversationID: id) } }; publish()
    }
    private func scheduleRetentionRefresh() {
        guard retentionRefreshTask == nil else { return }
        let current = generation
        retentionRefreshTask = Task { [weak self] in
            guard let self = self else { return }
            defer { if self.generation == current { self.retentionRefreshTask = nil } }
            do { try await self.refreshRetentionBatch() }
            catch { /* 失败保留已确认水位，不阻塞本地会话首屏。 */ }
        }
    }
    private func scheduleVisibilityRefresh(_ conversation: NativeConversation) {
        guard visibilityRefreshTasks[conversation.id] == nil else { return }
        let current = generation
        visibilityRefreshTasks[conversation.id] = Task { [weak self] in
            guard let self = self else { return }
            defer { if self.generation == current { self.visibilityRefreshTasks[conversation.id] = nil } }
            do { try await self.refreshGroupVisibility(conversation) }
            catch { /* 离线继续使用已持久确认的 floor 与成员清理快照。 */ }
        }
    }
    private func localForwardPreview(_ conversation: NativeConversation) -> OutboxEntry? {
        guard let entry = latestLocalForwards[conversation.id], entry.createdAt >= conversation.timestamp,
              !deletedIDs.contains(entry.clientMsgID), !revokedIDs.contains(entry.clientMsgID),
              visibility.permits(ChatTextItem(id: entry.clientMsgID, senderID: imUserID, text: entry.text,
                                               timestamp: entry.createdAt, status: 1), conversationID: conversation.id) else { return nil }
        return entry
    }

    var conversationsWithForwardPreviews: [NativeConversation] {
        guard !latestLocalForwards.isEmpty else { return conversations }
        return conversations.enumerated().map { ($0.offset, $0.element, conversationTimestamp($0.element)) }
            .sorted { lhs, rhs in
                if lhs.1.pinned != rhs.1.pinned { return lhs.1.pinned }
                return lhs.2 == rhs.2 ? lhs.0 < rhs.0 : lhs.2 > rhs.2
            }.map { $0.1 }
    }

    func conversationTimestamp(_ conversation: NativeConversation) -> Int64 {
        localForwardPreview(conversation)?.createdAt ?? conversation.timestamp
    }

    func conversationPreview(_ conversation: NativeConversation) -> String {
        if conversation.groupDismissed { return conversation.preview }
        if let queued = localForwardPreview(conversation) { return queued.text }
        if conversation.type == 3, !groupVisibilityReady.contains(conversation.id) { return "" }
        let previous = conversation.latestMessageID.isEmpty ? lastKnownPreview[conversation.id] : nil
        let candidate = previous.flatMap { revokedIDs.contains($0.latestMessageID) ? $0 : nil } ?? conversation
        let latest = ChatTextItem(id: candidate.latestMessageID.isEmpty ? "preview" : candidate.latestMessageID,
            senderID: candidate.latestSender, text: "", timestamp: candidate.timestamp, status: 2, seq: candidate.latestSeq)
        guard visibility.permits(latest, conversationID: conversation.id) else { return "" }
        if revokedIDs.contains(candidate.latestMessageID) { return "[撤回]" }
        return conversation.preview
    }
    func conversationUnread(_ conversation: NativeConversation) -> Int {
        guard conversation.unread > 0, !isGroupDismissed(conversation) else { return 0 }
        if conversation.type != 3 { return conversationPreview(conversation).isEmpty ? 0 : conversation.unread }
        let latest = ChatTextItem(id: conversation.latestMessageID, senderID: conversation.latestSender, text: "",
                                  timestamp: conversation.timestamp, status: 2, seq: conversation.latestSeq)
        return visibility.groupUnreadCount(conversation.unread, latest: latest, conversationID: conversation.id)
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
        case "connecting": sdkConnected = false; connection = "连接中"; cancelEmptyConversationReload(clearBudget: false)
        case "connected":
            sdkConnected = true; connection = "已连接"
            if needsAuthentication, credentialRecoveryStage == "waitingForConnection", credentialRecoveryTask == nil,
               !credentialRecoveryBudget.kicked, !recoveryLoginRejected, bridge.loginStatus() == 3, let ticket = ticket {
                _ = await coordinator.authenticationSucceeded(ticket, businessUserID: account.profile.id, imUserID: imUserID)
                guard isActive, generation == eventGeneration, !credentialRecoveryBudget.kicked,
                      !recoveryLoginRejected, credentialRecoveryStage == "waitingForConnection" else { return }
                needsAuthentication = false; credentialRecoveryStage = "ready"; lastSDKReadFailure = nil
            }
            if !loggedIn, !needsAuthentication, !Self.switching, initialized, bridge.loginStatus() == 3 {
                await resumeAfterSDKLogin()
                guard isActive, generation == eventGeneration else { return }
            }
            scheduleEmptyConversationReload()
            for request in Array(historyRequests.values) { scheduleHistoryRefresh(request.conversation, cursor: request.cursor) }
            for id in Set(outboxEntries.filter { $0.state == .uncertain }.map(\.conversationID)) { await reconcile(conversationID: id); guard isActive, generation == eventGeneration else { return } }
        case "connectFailed": sdkConnected = false; connection = "连接中断，等待 SDK 重连"; cancelEmptyConversationReload()
        case "kicked", "tokenExpired", "tokenInvalid":
            let code = (payload["code"] as? NSNumber)?.intValue ?? 0
            let reason = name == "kicked" ? "kicked" : "authentication"
            lastSDKReadFailure = OpenIMReadFailure(error: NSError(domain: "NativeOpenIM", code: code,
                userInfo: ["NativeIMReason": reason, "NativeIMOperation": "connection"]))
            handleCredentialFailure(name == "kicked" ? .kicked : (name == "tokenExpired" ? .expired : .invalid))
        case "syncStart":
            cancelEmptyConversationReload()
            emptyConversationBudget.begin(now: ProcessInfo.processInfo.systemUptime)
            if let old = attempt { _ = await coordinator.finishSync(.cancelled, attempt: old) }
            syncEventSequence &+= 1
            syncing = true; pendingSync = nil; attempt = nil; syncLabel = "同步中"
            await advanceSyncIfReadable()
            scheduleEmptyConversationReload()
            let sequence = syncEventSequence, current = generation
            syncTimeout?.cancel()
            syncTimeout = Task { [weak self] in
                do { try await Task.sleep(nanoseconds: 60_000_000_000) } catch { return }
                guard let self = self, self.isActive, self.generation == current, self.syncEventSequence == sequence else { return }
                await self.finishSync(.timedOut)
            }
        case "businessNotification":
            guard GroupJoinRequestNotice(payload: payload) != nil else { return }
            groupJoinRequestsRevision = UUID()
        case "syncFinish":
            groupJoinRequestsRevision = UUID()
            resetEmptyHistoryAfterSync()
            await finishSync(.completed)
            for request in Array(historyRequests.values) { scheduleHistoryRefresh(request.conversation, cursor: request.cursor) }
            if loggedIn { await loadConversations(reset: true) }
        case "syncFailed": await finishSync(.failed("SDK 同步失败"))
        case "syncProgress":
            syncLabel = "同步中 \((payload["progress"] as? NSNumber)?.intValue ?? 0)%"
            scheduleEmptyConversationReload()
        case "conversations":
            let changed = (payload["items"] as? [[String: Any]] ?? []).compactMap(NativeConversation.init)
            guard !changed.isEmpty else { return }
            guard conversationStartup.receive(changed) else { bufferedStartupEventCount += changed.count; return }
            if loadingConversations { conversationChangesDuringRequest.append(contentsOf: changed) }
            conversationRefreshSeen?.formUnion(changed.map(\.id))
            let previous = conversations
            mergeConversations(changed)
            if conversations == previous { return }
            if !conversations.isEmpty { cancelEmptyConversationReload() }
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
            if let id = payload["id"] as? String, !id.isEmpty {
                if name == "deleted" { deletedIDs.insert(id) }
                else {
                    revokedIDs.insert(id)
                    let revokerID = payload["revokerID"] as? String ?? ""
                    let nickname = payload["revokerNickname"] as? String ?? ""
                    if !revokerID.isEmpty || !nickname.isEmpty { revokers[id] = (revokerID, nickname) }
                }
                for key in Array(messages.keys) {
                    messages[key] = sanitize(messages[key] ?? [])
                }
            }
        default: break
        }
        publish()
    }

    private func resetEmptyHistoryAfterSync() {
        let emptyIDs = Set(historyRequests.values.filter {
            $0.cursor.isEmpty && (messages[$0.conversation.id] ?? []).isEmpty
        }.map { $0.conversation.id })
        for id in emptyIDs {
            // 首登空库的结束页在同步后失效；已显示历史与可见边界均保留。
            historyVersions[id] = UUID()
            localHistoryCursors[id] = nil; completedHistoryPages[id] = nil
            for key in Array(historyRequests.keys) where historyRequests[key]?.conversation.id == id {
                historyRefreshTasks[key]?.cancel(); historyRefreshTasks[key] = nil
            }
            historyReloadRevisions[id, default: 0] &+= 1
        }
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
        cancelEmptyConversationReload()
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
                self.publish()
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
