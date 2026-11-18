import XCTest
@testable import IMCore

private final class AudioSessionTrace: @unchecked Sendable {
    private let lock = NSLock()
    private var values: [String] = []
    func append(_ value: String) { lock.lock(); defer { lock.unlock() }; values.append(value) }
    var events: [String] { lock.lock(); defer { lock.unlock() }; return values }
}

final class AudioSessionCoordinatorTests: XCTestCase {
    enum Failure: Error { case activation, deactivation }

    func testUnusedPageDoesNotDeactivateGlobalAudio() async throws {
        let trace = AudioSessionTrace()
        let session = AudioSessionCoordinator(activate: { _ in trace.append("activate") }, deactivate: { trace.append("deactivate") })
        try await session.deactivate(owner: UUID())
        XCTAssertEqual(trace.events, [])
    }

    @MainActor
    func testAudioWorkRunsOutsideMainThreadAndReleaseIsIdempotent() async throws {
        let trace = AudioSessionTrace(); let owner = UUID()
        let session = AudioSessionCoordinator(activate: { _ in
            trace.append(Thread.isMainThread ? "mainActivate" : "backgroundActivate")
        }, deactivate: {
            trace.append(Thread.isMainThread ? "mainDeactivate" : "backgroundDeactivate")
        })
        try await session.activate(owner: owner, mode: .recording)
        try await session.deactivate(owner: owner)
        try await session.deactivate(owner: owner)
        XCTAssertEqual(trace.events, ["backgroundActivate", "backgroundDeactivate"])
    }

    func testLateOldPageReleaseCannotStopNewPageAudio() async throws {
        let trace = AudioSessionTrace(); let old = UUID(); let current = UUID()
        let session = AudioSessionCoordinator(activate: { mode in
            trace.append(mode == .recording ? "record" : "play")
        }, deactivate: { trace.append("deactivate") })
        try await session.activate(owner: old, mode: .recording)
        try await session.activate(owner: current, mode: .playback)
        try await session.deactivate(owner: old)
        XCTAssertEqual(trace.events, ["record", "play"])
        try await session.deactivate(owner: current)
        XCTAssertEqual(trace.events, ["record", "play", "deactivate"])
    }

    func testAlreadyCancelledStartNeverTouchesAudio() async {
        let trace = AudioSessionTrace()
        let session = AudioSessionCoordinator(activate: { _ in trace.append("activate") }, deactivate: { trace.append("deactivate") })
        let task = Task {
            withUnsafeCurrentTask { $0?.cancel() }
            try await session.activate(owner: UUID(), mode: .recording)
        }
        do { try await task.value; XCTFail("Cancelled recording cannot start") }
        catch { XCTAssertTrue(error is CancellationError) }
        XCTAssertEqual(trace.events, [])
    }

    @MainActor
    func testLeavingDuringActivationReleasesAudioBeforeReturning() async throws {
        let started = expectation(description: "Activation began")
        let gate = DispatchSemaphore(value: 0)
        let trace = AudioSessionTrace(); let owner = UUID()
        let session = AudioSessionCoordinator(activate: { _ in
            trace.append("activate"); started.fulfill()
            _ = gate.wait(timeout: .now() + 5)
        }, deactivate: { trace.append("deactivate") })
        let task = Task { try await session.activate(owner: owner, mode: .recording) }
        await fulfillment(of: [started], timeout: 5)
        task.cancel(); gate.signal()
        do { try await task.value; XCTFail("A page that has left cannot retain audio") }
        catch { XCTAssertTrue(error is CancellationError) }
        try await session.deactivate(owner: owner)
        XCTAssertEqual(trace.events, ["activate", "deactivate"])
    }

    func testActivationFailureDoesNotAcquireOwnership() async throws {
        let trace = AudioSessionTrace(); let owner = UUID()
        let session = AudioSessionCoordinator(activate: { _ in throw Failure.activation }, deactivate: { trace.append("deactivate") })
        do { try await session.activate(owner: owner, mode: .recording); XCTFail("Failure must propagate") }
        catch { XCTAssertTrue(error is Failure) }
        try await session.deactivate(owner: owner)
        XCTAssertEqual(trace.events, [])
    }
}
