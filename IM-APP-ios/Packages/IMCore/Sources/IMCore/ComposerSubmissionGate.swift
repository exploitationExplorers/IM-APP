import Foundation

/// 仅保护草稿持久化窗口；旧发送的迟到完成不能解锁新一轮提交。
public struct ComposerSubmissionGate: Sendable {
    private var active: UUID?
    public var isSubmitting: Bool { active != nil }

    public init() {}

    public mutating func begin() -> UUID? {
        guard active == nil else { return nil }
        let id = UUID()
        active = id
        return id
    }

    @discardableResult
    public mutating func finish(_ id: UUID) -> Bool {
        guard active == id else { return false }
        active = nil
        return true
    }
}
