import Foundation

/// 全局音频会话在后台串行切换；迟到的页面清理只能释放自己的会话。
public actor AudioSessionCoordinator {
    public enum Mode: Sendable { case recording, playback }
    private let activateSession: @Sendable (Mode) throws -> Void
    private let deactivateSession: @Sendable () throws -> Void
    private var owner: UUID?

    public init(activate: @escaping @Sendable (Mode) throws -> Void, deactivate: @escaping @Sendable () throws -> Void) {
        activateSession = activate; deactivateSession = deactivate
    }

    public func activate(owner: UUID, mode: Mode) throws {
        try Task.checkCancellation()
        try activateSession(mode)
        self.owner = owner
        if Task.isCancelled {
            try deactivate(owner: owner)
            throw CancellationError()
        }
    }

    public func deactivate(owner: UUID) throws {
        guard self.owner == owner else { return }
        try deactivateSession()
        self.owner = nil
    }
}
