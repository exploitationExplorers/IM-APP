import XCTest
@testable import IMCore

final class IMCredentialTests: XCTestCase {
    private let user = "01234567-89ab-cdef-0123-456789abcdef"
    private let now = Date(timeIntervalSince1970: 10_000)
    private var configuration: APIConfiguration { try! APIConfiguration(baseURL: "https://business.invalid") }

    private func credential(age: TimeInterval = 0, ttl: Int = 3_600, jwtExpiry: Double? = nil) -> IMBootstrapCredential {
        var value = "test-sdk-ticket"
        if let expiry = jwtExpiry {
            let data = try! JSONSerialization.data(withJSONObject: ["exp": expiry])
            let payload = data.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
            value = "header." + payload + ".test-signature"
        }
        return IMBootstrapCredential(businessUserID: user, apiBaseURL: configuration.baseURL.absoluteString,
            token: IMToken(userId: user.replacingOccurrences(of: "-", with: ""), token: value, platform: 1, expireSec: ttl,
                apiAddr: "https://im.invalid", wsAddr: "wss://im.invalid"), savedAt: now.addingTimeInterval(-age))
    }

    func testRestartsDoNotExtendCredentialExpiryAndKeepOfflineIdentity() throws {
        let saved = credential(age: 3_600)
        let restored = try JSONDecoder().decode(IMBootstrapCredential.self, from: JSONEncoder().encode(saved))
        XCTAssertThrowsError(try restored.validForLogin(businessUserID: user, configuration: configuration, now: now))
        XCTAssertEqual(try restored.validated(businessUserID: user, configuration: configuration).userId, user.replacingOccurrences(of: "-", with: ""))
    }

    func testLoginRefreshesAtSixtySecondBoundary() throws {
        XCTAssertNoThrow(try credential(age: 3_539).validForLogin(businessUserID: user, configuration: configuration, now: now))
        XCTAssertThrowsError(try credential(age: 3_540).validForLogin(businessUserID: user, configuration: configuration, now: now))
        XCTAssertThrowsError(try credential(age: 5_000).validForLogin(businessUserID: user, configuration: configuration, now: now))
    }

    func testJWTExpiryCannotBeExtendedByFreshCacheTimestamp() throws {
        XCTAssertThrowsError(try credential(jwtExpiry: 9_999).validForLogin(businessUserID: user, configuration: configuration, now: now))
        XCTAssertThrowsError(try credential(jwtExpiry: 10_060).validForLogin(businessUserID: user, configuration: configuration, now: now))
        XCTAssertNoThrow(try credential(jwtExpiry: 10_061).validForLogin(businessUserID: user, configuration: configuration, now: now))
        XCTAssertThrowsError(try credential(age: 3_600, jwtExpiry: 20_000).validForLogin(businessUserID: user, configuration: configuration, now: now))
    }

    func testClockRollbackAndOwnerMismatchCannotMakeOnlineCredentialValid() throws {
        XCTAssertThrowsError(try credential(age: -61).validForLogin(businessUserID: user, configuration: configuration, now: now))
        XCTAssertNoThrow(try credential(age: -59).validForLogin(businessUserID: user, configuration: configuration, now: now))
        XCTAssertThrowsError(try credential().validForLogin(businessUserID: "another-user", configuration: configuration, now: now))
        XCTAssertThrowsError(try credential().validForLogin(businessUserID: user, configuration: APIConfiguration(baseURL: "https://other.invalid"), now: now))
    }

    func testDuplicateExpiryAndInvalidEventsCannotLoopRecovery() {
        var expired = IMCredentialRecoveryBudget()
        XCTAssertTrue(expired.reserve(.expired))
        XCTAssertFalse(expired.reserve(.expired))
        XCTAssertFalse(expired.reserve(.invalid))
        XCTAssertEqual(expired.attempts, 1)
        var invalid = IMCredentialRecoveryBudget()
        XCTAssertTrue(invalid.reserve(.invalid))
        XCTAssertFalse(invalid.reserve(.expired))
        XCTAssertEqual(invalid.attempts, 1)
    }

    func testKickBlocksRecoveryBeforeAndDuringCredentialRefresh() {
        var kicked = IMCredentialRecoveryBudget()
        XCTAssertFalse(kicked.reserve(.kicked))
        XCTAssertFalse(kicked.reserve(.expired))
        XCTAssertFalse(kicked.reserve(.invalid))
        XCTAssertTrue(kicked.kicked)
        XCTAssertEqual(kicked.attempts, 0)
        var refreshing = IMCredentialRecoveryBudget()
        XCTAssertTrue(refreshing.reserve(.invalid))
        XCTAssertFalse(refreshing.reserve(.kicked))
        XCTAssertFalse(refreshing.reserve(.invalid))
        XCTAssertTrue(refreshing.kicked)
        XCTAssertEqual(refreshing.attempts, 1)
    }

    @MainActor
    func testRecoveryWaitsForSDKAutomaticLogoutToFinish() async throws {
        let states = [3, 3, 2, 1]
        var index = 0
        var time: TimeInterval = 0
        try await OpenIMSessionBarrier.waitForLogout(status: { states[index] }, now: { time }, pause: {
            index += 1; time += 0.05
        })
        XCTAssertEqual(index, 3)
        XCTAssertEqual(states[index], 1)
    }

    @MainActor
    func testStuckSDKLogoutFailsWithoutAttemptingAnotherLogin() async {
        var time: TimeInterval = 0
        var reads = 0
        do {
            try await OpenIMSessionBarrier.waitForLogout(timeout: 0.1, status: { reads += 1; return 3 }, now: { time }, pause: { time += 0.05 })
            XCTFail("A still active SDK must not permit login")
        } catch { XCTAssertEqual(error as? IMCredentialRecoveryError, .sdkBusy) }
        XCTAssertEqual(reads, 3)
    }

    @MainActor
    func testUninitializedSDKIsNotTreatedAsCompletedLogout() async {
        do {
            try await OpenIMSessionBarrier.waitForLogout(status: { 0 }, pause: { XCTFail("Uninitialized SDK cannot recover in place") })
            XCTFail("Uninitialized SDK must fail")
        } catch { XCTAssertEqual(error as? IMCredentialRecoveryError, .sdkBusy) }
    }

    @MainActor
    func testCancellationStopsWaitingForAutomaticLogout() async {
        do {
            try await OpenIMSessionBarrier.waitForLogout(status: { 3 }, pause: { throw CancellationError() })
            XCTFail("Cancelled owner must not continue to login")
        } catch { XCTAssertTrue(error is CancellationError) }
    }

    func testRejectedTicketCannotBeSavedOrRetriedAsItsOwnReplacement() throws {
        XCTAssertThrowsError(try IMCredentialRecoveryError.requireReplacement("rejected-ticket", rejected: "rejected-ticket")) {
            XCTAssertEqual($0 as? IMCredentialRecoveryError, .unchangedCredential)
        }
        XCTAssertNoThrow(try IMCredentialRecoveryError.requireReplacement("new-ticket", rejected: "rejected-ticket"))
        XCTAssertNoThrow(try IMCredentialRecoveryError.requireReplacement("new-ticket", rejected: nil))
    }

    func testConnectionRejectionRetainsSafeSDKCodeAndOperation() throws {
        let failure = try XCTUnwrap(OpenIMReadFailure(error: NSError(domain: "NativeOpenIM", code: 1507,
            userInfo: ["NativeIMReason": "authentication", "NativeIMOperation": "connection"])))
        XCTAssertEqual(failure.code, 1507)
        XCTAssertEqual(failure.operation, "connection")
        XCTAssertEqual(failure.reason, .authentication)
        XCTAssertFalse(failure.canRetryRead)
        XCTAssertFalse(failure.canTryPagedSnapshot)
    }
}
