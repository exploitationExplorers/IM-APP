import XCTest
@testable import IMCore

@MainActor
final class PendingJoinRequestMonitorTests: XCTestCase {
    private enum Failure: Error { case offline }

    private final class Driver {
        var requests: [CheckedContinuation<Int, Error>] = []
        var pauses: [CheckedContinuation<Void, Never>] = []
        var onRequest: (() -> Void)?
        var onPause: (() -> Void)?

        func load() async throws -> Int {
            try await withCheckedThrowingContinuation { continuation in
                requests.append(continuation)
                onRequest?()
            }
        }

        func pause() async {
            await withCheckedContinuation { continuation in
                pauses.append(continuation)
                onPause?()
            }
        }
    }

    func testSingleLoopKeepsLastCountOnFailureAndDoesNotPublishAfterStop() async {
        let driver = Driver()
        let monitor = PendingJoinRequestMonitor(load: { try await driver.load() }, pause: { await driver.pause() })
        let firstRequest = expectation(description: "首次请求")
        driver.onRequest = { firstRequest.fulfill() }
        monitor.start()
        monitor.start()
        await fulfillment(of: [firstRequest], timeout: 2)
        XCTAssertEqual(driver.requests.count, 1)

        let loaded = expectation(description: "计数更新")
        let paused = expectation(description: "等待刷新间隔")
        monitor.onChange = { loaded.fulfill() }
        driver.onPause = { paused.fulfill() }
        driver.requests.removeFirst().resume(returning: 7)
        await fulfillment(of: [loaded, paused], timeout: 2)
        XCTAssertEqual(monitor.count, 7)
        XCTAssertTrue(monitor.hasLoaded)

        let secondRequest = expectation(description: "第二次请求")
        driver.onRequest = { secondRequest.fulfill() }
        driver.pauses.removeFirst().resume()
        await fulfillment(of: [secondRequest], timeout: 2)
        let failed = expectation(description: "失败保留计数")
        let secondPause = expectation(description: "失败后仍按间隔刷新")
        monitor.onChange = { failed.fulfill() }
        driver.onPause = { secondPause.fulfill() }
        driver.requests.removeFirst().resume(throwing: Failure.offline)
        await fulfillment(of: [failed, secondPause], timeout: 2)
        XCTAssertEqual(monitor.count, 7)
        XCTAssertNotNil(monitor.errorDescription)

        monitor.stop()
        driver.onRequest = { XCTFail("停止后不能发起新请求") }
        monitor.onChange = { XCTFail("停止后不能发布结果") }
        driver.pauses.removeFirst().resume()
    }

    func testRestartRejectsLateResultFromPreviousGeneration() async {
        let driver = Driver()
        let monitor = PendingJoinRequestMonitor(load: { try await driver.load() }, pause: { await driver.pause() })
        let oldRequest = expectation(description: "旧代次请求")
        driver.onRequest = { oldRequest.fulfill() }
        monitor.start()
        await fulfillment(of: [oldRequest], timeout: 2)
        let old = driver.requests.removeFirst()
        monitor.stop()

        let newRequest = expectation(description: "新代次请求")
        driver.onRequest = { newRequest.fulfill() }
        monitor.start()
        await fulfillment(of: [newRequest], timeout: 2)
        let changed = expectation(description: "仅新代次发布")
        changed.assertForOverFulfill = true
        let paused = expectation(description: "新代次开始等待")
        monitor.onChange = { changed.fulfill() }
        driver.onPause = { paused.fulfill() }
        old.resume(returning: 99)
        driver.requests.removeFirst().resume(returning: 3)
        await fulfillment(of: [changed, paused], timeout: 2)
        XCTAssertEqual(monitor.count, 3)
        monitor.stop()
        driver.pauses.removeFirst().resume()
    }

    private final class SnapshotDriver {
        var requests: [CheckedContinuation<PendingJoinRequestSnapshot, Error>] = []
        var pauses: [CheckedContinuation<Void, Never>] = []
        var onRequest: (() -> Void)?
        var onPause: (() -> Void)?

        func load() async throws -> PendingJoinRequestSnapshot {
            try await withCheckedThrowingContinuation { continuation in
                requests.append(continuation)
                onRequest?()
            }
        }

        func pause() async {
            await withCheckedContinuation { continuation in
                pauses.append(continuation)
                onPause?()
            }
        }
    }

    private func snapshot(_ character: Character) throws -> PendingJoinRequestSnapshot {
        let id = "sg_" + String(repeating: String(character), count: 32)
        let data = try JSONSerialization.data(withJSONObject: [["groupId": "public", "groupConversationId": id, "count": 2]])
        return PendingJoinRequestSnapshot(rows: try JSONDecoder().decode([PendingGroupJoinCount].self, from: data))
    }

    func testRefreshInterruptsPausePublishesMovedGroupAndKeepsSnapshotOnFailure() async throws {
        let driver = SnapshotDriver()
        let monitor = PendingJoinRequestMonitor(loadSnapshot: { try await driver.load() }, pause: { await driver.pause() })
        let first = expectation(description: "initial request")
        driver.onRequest = { first.fulfill() }
        monitor.start()
        await fulfillment(of: [first], timeout: 2)
        let initialPause = expectation(description: "initial pause")
        driver.onPause = { initialPause.fulfill() }
        driver.requests.removeFirst().resume(returning: try snapshot("a"))
        await fulfillment(of: [initialPause], timeout: 2)

        let refreshed = expectation(description: "refresh without waiting interval")
        driver.onRequest = { refreshed.fulfill() }
        monitor.refresh()
        await fulfillment(of: [refreshed], timeout: 2)
        // The cancelled interval may finish late; it cannot create another request.
        driver.pauses.removeFirst().resume()
        let moved = expectation(description: "same count different group publishes")
        monitor.onChange = { moved.fulfill() }
        let movedPause = expectation(description: "pause after moved group")
        driver.onPause = { movedPause.fulfill() }
        let expected = try snapshot("b")
        driver.requests.removeFirst().resume(returning: expected)
        await fulfillment(of: [moved, movedPause], timeout: 2)
        XCTAssertEqual(monitor.snapshot, expected)

        let failedRequest = expectation(description: "request that fails")
        driver.onRequest = { failedRequest.fulfill() }
        monitor.refresh()
        await fulfillment(of: [failedRequest], timeout: 2)
        driver.pauses.removeFirst().resume()
        let failed = expectation(description: "failure published")
        monitor.onChange = { failed.fulfill() }
        let failurePause = expectation(description: "failure keeps polling")
        driver.onPause = { failurePause.fulfill() }
        driver.requests.removeFirst().resume(throwing: Failure.offline)
        await fulfillment(of: [failed, failurePause], timeout: 2)
        XCTAssertEqual(monitor.snapshot, expected)
        XCTAssertNotNil(monitor.errorDescription)
        monitor.stop()
        driver.pauses.removeFirst().resume()
    }

    func testNotificationBurstCoalescesWhileLoadingAndStopRejectsLateResult() async throws {
        let driver = SnapshotDriver()
        let monitor = PendingJoinRequestMonitor(loadSnapshot: { try await driver.load() }, pause: { await driver.pause() })
        let first = expectation(description: "first request")
        driver.onRequest = { first.fulfill() }
        monitor.start()
        await fulfillment(of: [first], timeout: 2)
        for _ in 0..<20 { monitor.refresh() }
        let followup = expectation(description: "one coalesced followup")
        followup.assertForOverFulfill = true
        driver.onRequest = { followup.fulfill() }
        driver.requests.removeFirst().resume(returning: try snapshot("a"))
        await fulfillment(of: [followup], timeout: 2)
        XCTAssertEqual(driver.requests.count, 1)
        XCTAssertTrue(driver.pauses.isEmpty)
        let beforeStop = monitor.snapshot
        monitor.stop()
        monitor.onChange = { XCTFail("late response after stop") }
        driver.onRequest = { XCTFail("refresh cannot restart a stopped monitor") }
        monitor.refresh()
        driver.requests.removeFirst().resume(returning: try snapshot("b"))
        // Drain queued main actor work deterministically, without a timed sleep.
        await Task.yield()
        XCTAssertEqual(monitor.snapshot, beforeStop)
    }

}
