import Foundation

/// 页面显式启动/停止，平台生命周期由 App 适配。失败保留上次计数，迟到结果不得回写。
@MainActor
public final class PendingJoinRequestMonitor {
    public private(set) var count = 0
    public private(set) var hasLoaded = false
    public private(set) var errorDescription: String?
    public var onChange: (() -> Void)?

    private let load: @MainActor @Sendable () async throws -> Int
    private let pause: @Sendable () async throws -> Void
    private var task: Task<Void, Never>?
    private var generation: UUID?

    public init(
        load: @escaping @MainActor @Sendable () async throws -> Int,
        pause: @escaping @Sendable () async throws -> Void = { try await Task.sleep(nanoseconds: 10_000_000_000) }
    ) {
        self.load = load
        self.pause = pause
    }

    deinit { task?.cancel() }

    public func start() {
        guard task == nil else { return }
        let expected = UUID()
        generation = expected
        let load = load
        let pause = pause
        task = Task { [weak self] in
            while !Task.isCancelled {
                let result: Result<Int, Error>
                do { result = .success(try await load()) }
                catch { result = .failure(error) }
                guard !Task.isCancelled, self?.generation == expected else { return }
                let previousCount = self?.count
                let previousError = self?.errorDescription
                let previouslyLoaded = self?.hasLoaded
                switch result {
                case .success(let value):
                    self?.count = max(0, value)
                    self?.hasLoaded = true
                    self?.errorDescription = nil
                case .failure(let error):
                    self?.errorDescription = error.localizedDescription
                }
                if previousCount != self?.count || previousError != self?.errorDescription || previouslyLoaded != self?.hasLoaded {
                    self?.onChange?()
                }
                do { try await pause() }
                catch { return }
            }
        }
    }

    public func stop() {
        generation = nil
        task?.cancel()
        task = nil
    }
}
