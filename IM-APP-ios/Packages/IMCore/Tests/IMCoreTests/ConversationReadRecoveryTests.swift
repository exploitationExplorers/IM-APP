import XCTest
@testable import IMCore

final class ConversationReadRecoveryTests: XCTestCase {
    private func failure(code: Int = 10005, reason: String = "unknown", operation: String = "conversationSnapshot") -> NSError {
        NSError(domain: "NativeOpenIM", code: code, userInfo: ["NativeIMReason": reason, "NativeIMOperation": operation])
    }
    func testUnknownCodeIsNotMistakenForResourceNotReady() throws {
        let unknown = try XCTUnwrap(OpenIMReadFailure(error: failure()))
        XCTAssertEqual(unknown.reason, .unknown); XCTAssertFalse(unknown.canRetryRead)
        XCTAssertTrue(unknown.canTryPagedSnapshot)
        let resource = try XCTUnwrap(OpenIMReadFailure(error: failure(code: 10004, reason: "resourceNotReady")))
        XCTAssertEqual(resource.reason, .resourceNotReady); XCTAssertTrue(resource.canRetryRead)
        XCTAssertFalse(resource.canTryPagedSnapshot)
    }
    func testDiagnosticsRejectUntrustedOperationAndReasonAndDoNotEchoRawData() throws {
        let error = failure(reason: "sensitive arbitrary payload", operation: "https://private.invalid/token")
        let facts = try XCTUnwrap(OpenIMReadFailure(error: error))
        XCTAssertEqual(facts.reason, .unknown); XCTAssertEqual(facts.operation, "unknown")
        XCTAssertFalse(facts.message.contains("payload")); XCTAssertFalse(facts.message.contains("private.invalid"))
        XCTAssertNil(OpenIMReadFailure(error: NSError(domain: "Other", code: 10005)))
    }
    func testLoginStorageAndAuthenticationFailuresCannotTriggerPagedFallback() throws {
        XCTAssertFalse(try XCTUnwrap(OpenIMReadFailure(error: failure(operation: "login"))).canTryPagedSnapshot)
        for reason in ["authentication", "notLoggedIn", "storageSchema", "storageCorrupt", "storageAccess", "storageFull"] {
            let facts = try XCTUnwrap(OpenIMReadFailure(error: failure(reason: reason)))
            XCTAssertFalse(facts.canTryPagedSnapshot); XCTAssertFalse(facts.canRetryRead)
        }
    }
    func testResourceAndBusyRecoveryIsBoundedAndDoesNotDependOnSyncEvents() throws {
        var budget = ConversationReadRetryBudget()
        let resource = try XCTUnwrap(OpenIMReadFailure(error: failure(code: 10004, reason: "resourceNotReady")))
        for (index, delay) in [0.5, 1.0, 2.0, 4.0].enumerated() {
            XCTAssertEqual(budget.reserve(failure: resource, now: 10 + Double(index)), delay)
        }
        XCTAssertNil(budget.reserve(failure: resource, now: 15)); XCTAssertEqual(budget.attempts, 4)
        budget.reset()
        let busy = try XCTUnwrap(OpenIMReadFailure(error: failure(reason: "storageBusy")))
        XCTAssertEqual(budget.reserve(failure: busy, now: 100), 0.5)
        XCTAssertNil(budget.reserve(failure: busy, now: 130))
        budget.reset()
        XCTAssertNil(budget.reserve(failure: try XCTUnwrap(OpenIMReadFailure(error: failure())), now: 200))
        XCTAssertEqual(budget.attempts, 0)
    }
    @MainActor
    func testSuccessfulFullSnapshotDoesNotPerformFallback() async throws {
        var paged = false
        let rows = try await ConversationSnapshotRead.read(pageSize: 2, all: { ["A", "B", "C"] }, page: { _, _ in paged = true; return [] }, identity: { $0 })
        XCTAssertEqual(rows, ["A", "B", "C"]); XCTAssertFalse(paged)
    }
    @MainActor
    func testUnknownFullReadFallsBackToCompletePagedSnapshot() async throws {
        var offsets: [Int] = [], fallback = 0
        let rows = try await ConversationSnapshotRead.read(pageSize: 2, all: { throw self.failure() }, page: { offset, count in
            XCTAssertEqual(count, 2); offsets.append(offset)
            return offset == 0 ? ["A", "B"] : ["C"]
        }, identity: { $0 }, onFallback: { _ in fallback += 1 })
        XCTAssertEqual(rows, ["A", "B", "C"]); XCTAssertEqual(offsets, [0, 2]); XCTAssertEqual(fallback, 1)
    }
    @MainActor
    func testPartialPageFailureDoesNotPublishOrReturnAnIncompleteSnapshot() async throws {
        var published = ["previous"]
        do {
            published = try await ConversationSnapshotRead.read(pageSize: 2, all: { throw self.failure() }, page: { offset, _ in
                if offset == 0 { return ["A", "B"] }
                throw self.failure(reason: "storageAccess", operation: "conversationPage")
            }, identity: { $0 })
            XCTFail("Should retain the previous complete snapshot")
        } catch { XCTAssertEqual(published, ["previous"]) }
    }
    @MainActor
    func testRepeatedPageStopsWithoutAnEndlessReadLoop() async throws {
        var pages = 0
        do {
            _ = try await ConversationSnapshotRead.read(pageSize: 2, all: { throw self.failure() }, page: { _, _ in pages += 1; return ["A", "B"] }, identity: { $0 })
            XCTFail("A repeated page must fail")
        } catch { XCTAssertTrue(error is ConversationSnapshotRead.ReadError); XCTAssertEqual(pages, 2) }
    }
    @MainActor
    func testEmptySuccessfulFallbackIsAnActualEmptySnapshot() async throws {
        let rows: [String] = try await ConversationSnapshotRead.read(pageSize: 2, all: { throw self.failure() }, page: { _, _ in [] }, identity: { $0 })
        XCTAssertEqual(rows, [])
    }
    @MainActor
    func testAuthenticationFailureIsPropagatedWithoutAlternateRead() async throws {
        var paged = false
        do {
            let _: [String] = try await ConversationSnapshotRead.read(pageSize: 2, all: { throw self.failure(reason: "authentication") }, page: { _, _ in paged = true; return [] }, identity: { $0 })
            XCTFail("Authentication must fail")
        } catch { XCTAssertFalse(paged); XCTAssertEqual(OpenIMReadFailure(error: error)?.reason, .authentication) }
    }
}
