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
}
