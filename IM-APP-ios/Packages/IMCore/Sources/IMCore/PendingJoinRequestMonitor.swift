import Foundation

/// 页面显式启动/停止，平台生命周期由 App 适配。失败保留上次计数，迟到结果不得回写。
@MainActor
public final class PendingJoinRequestMonitor {
    public private(set) var snapshot = PendingJoinRequestSnapshot(count: 0)
    public var count: Int { snapshot.count }
    public private(set) var hasLoaded = false
    public private(set) var errorDescription: String?
    public var onChange: (() -> Void)?

    private let load: @MainActor @Sendable () async throws -> PendingJoinRequestSnapshot
    private let pause: @Sendable () async throws -> Void
    private var task: Task<Void, Never>?
    private var generation: UUID?
    private var isLoading = false
    private var refreshPending = false

    public convenience init(
        load: @escaping @MainActor @Sendable () async throws -> Int,
        pause: @escaping @Sendable () async throws -> Void = { try await Task.sleep(nanoseconds: 10_000_000_000) }
    ) {
        self.init(loadSnapshot: { PendingJoinRequestSnapshot(count: try await load()) }, pause: pause)
    }

    public init(
        loadSnapshot: @escaping @MainActor @Sendable () async throws -> PendingJoinRequestSnapshot,
        pause: @escaping @Sendable () async throws -> Void = { try await Task.sleep(nanoseconds: 10_000_000_000) }
    ) {
        self.load = loadSnapshot
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
                guard self?.generation == expected else { return }
                self?.isLoading = true
                let result: Result<PendingJoinRequestSnapshot, Error>
                do { result = .success(try await load()) }
                catch { result = .failure(error) }
                guard !Task.isCancelled, self?.generation == expected else { return }
                self?.isLoading = false
                let previous = self?.snapshot
                let previousError = self?.errorDescription
                let previouslyLoaded = self?.hasLoaded
                switch result {
                case .success(let value):
                    self?.snapshot = value
                    self?.hasLoaded = true
                    self?.errorDescription = nil
                case .failure(let error):
                    self?.errorDescription = error.localizedDescription
                }
                if previous != self?.snapshot || previousError != self?.errorDescription || previouslyLoaded != self?.hasLoaded {
                    self?.onChange?()
                }
                guard !Task.isCancelled, self?.generation == expected else { return }
                if self?.refreshPending == true {
                    self?.refreshPending = false
                    continue
                }
                do { try await pause() }
                catch { return }
            }
        }
    }

    /// Coalesce notification bursts while loading; interrupt only the polling interval.
    public func refresh() {
        guard task != nil else { return }
        if isLoading {
            refreshPending = true
        } else {
            stop()
            start()
        }
    }

    public func stop() {
        generation = nil
        task?.cancel()
        task = nil
        isLoading = false
        refreshPending = false
    }
}
