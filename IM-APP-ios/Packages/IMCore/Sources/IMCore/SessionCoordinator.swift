import Foundation

public struct SessionTicket: Equatable, Sendable {
    public let ownerKey: String
    public let generation: UInt64
}

public struct SyncAttempt: Equatable, Sendable {
    public let session: SessionTicket
    public let sequence: UInt64
}

public enum AuthenticationState: Equatable, Sendable {
    case signedOut
    case authenticating
    case authenticated
    case failed(String)
}

public enum LocalStoreState: Equatable, Sendable {
    case closed
    case opening
    case readable
    case blocked(String)
}

public enum SyncState: Equatable, Sendable {
    case idle
    case running
    case completed
    case failed(String)
    case timedOut
    case cancelled
}

public struct SessionSnapshot: Equatable, Sendable {
    public let ticket: SessionTicket?
    public let authentication: AuthenticationState
    public let businessUserID: String?
    public let imUserID: String?
    public let localStore: LocalStoreState
    public let sync: SyncState
}

/// 只负责应用会话状态，不冒充 SDK 的数据库或内部同步游标。
public actor SessionCoordinator {
    private var generation: UInt64 = 0
    private var ticket: SessionTicket?
    private var authentication: AuthenticationState = .signedOut
    private var businessUserID: String?
    private var imUserID: String?
    private var localStore: LocalStoreState = .closed
    private var sync: SyncState = .idle
    private var syncSequence: UInt64 = 0
    private var activeSync: SyncAttempt?

    public init() {}

    /// 一次原子操作产生账号与代次；相同账号的重登也隔离旧请求。
    public func beginAuthentication(ownerKey: String) throws -> SessionTicket {
        // actor 排队期间可能已取消；必须在变更代次之前检查。
        try Task.checkCancellation()
        generation &+= 1
        let next = SessionTicket(ownerKey: ownerKey, generation: generation)
        ticket = next
        authentication = .authenticating
        businessUserID = nil
        imUserID = nil
        localStore = .closed
        sync = .idle
        activeSync = nil
        return next
    }

    public func accepts(_ candidate: SessionTicket) -> Bool {
        ticket == candidate
    }

    @discardableResult
    public func authenticationSucceeded(_ candidate: SessionTicket, businessUserID: String, imUserID: String) -> Bool {
        guard accepts(candidate), authentication == .authenticating,
              !businessUserID.isEmpty, !imUserID.isEmpty else { return false }
        self.businessUserID = businessUserID
        self.imUserID = imUserID
        authentication = .authenticated
        // 拿到认证结果不能证明 SDK 开库成功；两项状态仍然独立。
        return true
    }

    @discardableResult
    public func authenticationFailed(_ candidate: SessionTicket, reason: String) -> Bool {
        guard accepts(candidate), authentication == .authenticating else { return false }
        authentication = .failed(reason)
        return true
    }

    @discardableResult
    public func updateLocalStore(_ state: LocalStoreState, for candidate: SessionTicket) -> Bool {
        guard accepts(candidate), authentication == .authenticated else { return false }
        localStore = state
        if state != .readable, activeSync != nil {
            activeSync = nil
            sync = .cancelled
        }
        return true
    }

    public func beginSync(for candidate: SessionTicket) -> SyncAttempt? {
        guard accepts(candidate), authentication == .authenticated, localStore == .readable,
              activeSync == nil else { return nil }
        syncSequence &+= 1
        let attempt = SyncAttempt(session: candidate, sequence: syncSequence)
        activeSync = attempt
        sync = .running
        return attempt
    }

    @discardableResult
    public func finishSync(_ state: SyncState, attempt: SyncAttempt) -> Bool {
        guard accepts(attempt.session), activeSync == attempt, sync == .running else { return false }
        switch state {
        case .completed:
            guard localStore == .readable else { return false }
        case .failed, .timedOut, .cancelled: break
        case .idle, .running: return false
        }
        activeSync = nil
        sync = state
        // 失败/超时不关闭已可读本地库，也不触发删除或重建。
        return true
    }

    public func logout() {
        generation &+= 1
        ticket = nil
        authentication = .signedOut
        businessUserID = nil
        imUserID = nil
        localStore = .closed
        sync = .idle
        activeSync = nil
    }

    /// UI 取消只退出该次会话；迟到的取消任务不能关闭新会话。
    @discardableResult
    public func logout(ifCurrent candidate: SessionTicket) -> Bool {
        guard accepts(candidate) else { return false }
        logout()
        return true
    }

    public func snapshot() -> SessionSnapshot {
        SessionSnapshot(ticket: ticket, authentication: authentication, businessUserID: businessUserID,
                        imUserID: imUserID, localStore: localStore, sync: sync)
    }
}
