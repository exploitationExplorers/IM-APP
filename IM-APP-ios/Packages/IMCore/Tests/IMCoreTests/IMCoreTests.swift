import XCTest
@testable import IMCore
import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

private actor FakeTransport: HTTPTransport {
    private var responses: [Result<HTTPResponse, APIError>]
    private var requests: [URLRequest] = []

    init(_ responses: [Result<HTTPResponse, APIError>]) { self.responses = responses }

    func send(_ request: URLRequest) async throws -> HTTPResponse {
        requests.append(request)
        guard !responses.isEmpty else { throw APIError.transport }
        return try responses.removeFirst().get()
    }

    func capturedRequests() -> [URLRequest] { requests }
}

final class APIClientTests: XCTestCase {
    private func fixture(_ name: String) throws -> Data {
        let url = try XCTUnwrap(Bundle.module.url(forResource: name, withExtension: "json", subdirectory: "Fixtures"))
        return try Data(contentsOf: url)
    }

    private func client(_ transport: FakeTransport) throws -> APIClient {
        APIClient(configuration: try APIConfiguration(baseURL: "https://test.example.invalid"), transport: transport)
    }

    func testConfigurationRequiresExplicitHTTPSAndRejectsCredentialsAndQuery() throws {
        for address in ["", "http://test.example.invalid", "https://user:password@test.example.invalid", "https://test.example.invalid?token=x", "https://test.example.invalid/unexpected"] {
            XCTAssertThrowsError(try APIConfiguration(baseURL: address))
        }
        let config = try APIConfiguration(baseURL: "https://test.example.invalid/api/v1/")
        XCTAssertEqual(config.baseURL.absoluteString, "https://test.example.invalid/api/v1/")
    }

    func testSharedFixturesKeepBusinessAndIMIdentitySeparate() throws {
        let auth = try JSONDecoder().decode(APIEnvelope<AuthResult>.self, from: fixture("auth-success"))
        let im = try JSONDecoder().decode(APIEnvelope<IMToken>.self, from: fixture("im-token-success"))
        XCTAssertEqual(auth.data?.user.id, "business-fixture-user")
        XCTAssertEqual(im.data?.userId, "im-fixture-user")
        XCTAssertNotEqual(auth.data?.user.id, im.data?.userId)
    }

    func testPasswordRequestMatchesSharedPayloadAndStaticRoute() async throws {
        let response = HTTPResponse(status: 200, body: try fixture("auth-success"))
        let transport = FakeTransport([.success(response)])
        let api = try client(transport)
        let auth = try await api.passwordLogin(PasswordLoginRequest(countryCode: "+86", phone: "13000000000", password: "synthetic-test-password", deviceId: "native-fixture-device"))
        XCTAssertEqual(auth.user.id, "business-fixture-user")
        let requests = await transport.capturedRequests()
        let request = try XCTUnwrap(requests.first)
        XCTAssertEqual(request.url?.path, "/api/v1/auth/login")
        XCTAssertEqual(request.httpMethod, "POST")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Content-Type"), "application/json")
        XCTAssertNil(request.value(forHTTPHeaderField: "Authorization"))
        let actual = try JSONSerialization.jsonObject(with: XCTUnwrap(request.httpBody)) as? [String: String]
        let expected = try JSONSerialization.jsonObject(with: fixture("password-login-request")) as? [String: String]
        XCTAssertEqual(actual, expected)
    }

    func testBusinessLoginFetchesActualProfileAndNeverIssuesUnusedIMToken() async throws {
        var object = try XCTUnwrap(JSONSerialization.jsonObject(with: fixture("profile-success")) as? [String: Any])
        var data = try XCTUnwrap(object["data"] as? [String: Any])
        data["nickname"] = "更新后的昵称"
        object["data"] = data
        let transport = FakeTransport([
            .success(HTTPResponse(status: 200, body: try fixture("auth-success"))),
            .success(HTTPResponse(status: 200, body: try JSONSerialization.data(withJSONObject: object)))
        ])
        let account = try await client(transport).businessPasswordLogin(PasswordLoginRequest(countryCode: "+86", phone: "13000000000", password: "synthetic", deviceId: "test"))
        XCTAssertEqual(account.profile.id, account.authentication.user.id)
        XCTAssertEqual(account.profile.nickname, "更新后的昵称")
        XCTAssertNil(account.profileLoadWarning)
        let requests = await transport.capturedRequests()
        XCTAssertEqual(requests.compactMap { $0.url?.path }, ["/api/v1/auth/login", "/api/v1/me"])
        XCTAssertEqual(requests.map { $0.httpMethod }, ["POST", "GET"])
        let profileRequest = try XCTUnwrap(requests.last)
        XCTAssertNil(profileRequest.httpBody)
        XCTAssertEqual(profileRequest.value(forHTTPHeaderField: "Authorization"), "Bearer synthetic-access-token")
    }

    func testProfileFailureUsesOnlyRealProfileFromSameAuthentication() async throws {
        let transport = FakeTransport([
            .success(HTTPResponse(status: 200, body: try fixture("auth-success"))),
            .success(HTTPResponse(status: 503, body: Data("unavailable".utf8)))
        ])
        let account = try await client(transport).businessPasswordLogin(PasswordLoginRequest(countryCode: "+86", phone: "13000000000", password: "synthetic", deviceId: "test"))
        XCTAssertEqual(account.profile, account.authentication.user)
        XCTAssertNotNil(account.profileLoadWarning)
    }

    func testProfileIdentityMismatchCannotBindDifferentAccount() async throws {
        var object = try XCTUnwrap(JSONSerialization.jsonObject(with: fixture("profile-success")) as? [String: Any])
        var data = try XCTUnwrap(object["data"] as? [String: Any])
        data["id"] = "another-business-account"
        object["data"] = data
        let transport = FakeTransport([
            .success(HTTPResponse(status: 200, body: try fixture("auth-success"))),
            .success(HTTPResponse(status: 200, body: try JSONSerialization.data(withJSONObject: object)))
        ])
        do {
            _ = try await client(transport).businessPasswordLogin(PasswordLoginRequest(countryCode: "+86", phone: "13000000000", password: "synthetic", deviceId: "test"))
            XCTFail("资料身份不一致时不得进入账号页面")
        } catch let error as APIError { XCTAssertEqual(error, .profileMismatch) }
    }

    func testProfileCancellationCannotBecomeFallbackLoginSuccess() async throws {
        let transport = FakeTransport([
            .success(HTTPResponse(status: 200, body: try fixture("auth-success"))),
            .failure(.cancelled)
        ])
        do {
            _ = try await client(transport).businessPasswordLogin(PasswordLoginRequest(countryCode: "+86", phone: "13000000000", password: "synthetic", deviceId: "test"))
            XCTFail("取消不得回退为已登录")
        } catch let error as APIError { XCTAssertEqual(error, .cancelled) }
    }

    func testProfileRequiresBothCredentialAndExpectedBusinessIdentity() async throws {
        let transport = FakeTransport([])
        for values in [("", "business-id"), ("synthetic-access-token", "")] {
            do {
                _ = try await client(transport).currentUser(accessToken: values.0, expectedUserID: values.1)
                XCTFail("缺少身份或凭据不应请求资料")
            } catch let error as APIError { XCTAssertEqual(error, .invalidCredentials) }
        }
        let requests = await transport.capturedRequests()
        XCTAssertTrue(requests.isEmpty)
    }

    func testOtherFourRoutesAndIOSPlatformHeader() async throws {
        var imObject = try XCTUnwrap(JSONSerialization.jsonObject(with: fixture("im-token-success")) as? [String: Any])
        var imData = try XCTUnwrap(imObject["data"] as? [String: Any])
        imData["platform"] = 1
        imObject["data"] = imData
        let transport = FakeTransport([
            .success(HTTPResponse(status: 200, body: try fixture("auth-success"))),
            .success(HTTPResponse(status: 200, body: try fixture("sms-success"))),
            .success(HTTPResponse(status: 200, body: try fixture("refresh-success"))),
            .success(HTTPResponse(status: 200, body: try JSONSerialization.data(withJSONObject: imObject)))
        ])
        let api = try client(transport)
        _ = try await api.smsLogin(SMSLoginRequest(countryCode: "+86", phone: "13000000000", code: "123456", deviceId: "test-device"))
        let sms = try await api.sendSMS(SendSMSRequest(countryCode: "+86", phone: "13000000000", deviceId: "test-device"))
        XCTAssertEqual(sms.retryAfterSec, 60)
        let tokens = try await api.refreshToken(RefreshTokenRequest(refreshToken: "synthetic-refresh-token", deviceId: "test-device"))
        XCTAssertEqual(tokens.expiresIn, 86400)
        let im = try await api.imToken(accessToken: tokens.accessToken)
        XCTAssertEqual(im.platform, 1)
        let requests = await transport.capturedRequests()
        XCTAssertEqual(requests.compactMap { $0.url?.path }, ["/api/v1/auth/login/sms", "/api/v1/auth/sms/send", "/api/v1/auth/token/refresh", "/api/v1/im/token"])
        let last = try XCTUnwrap(requests.last)
        XCTAssertEqual(last.value(forHTTPHeaderField: "Authorization"), "Bearer synthetic-refreshed-access")
        let json = try JSONSerialization.jsonObject(with: XCTUnwrap(last.httpBody)) as? [String: Int]
        XCTAssertEqual(json, ["platformId": 1])
    }

    func testHTTPAndBusinessFailureNeverReturnAuthentication() async throws {
        let errorBody = try fixture("api-error")
        for response in [HTTPResponse(status: 401, body: errorBody), HTTPResponse(status: 200, body: errorBody)] {
            let api = try client(FakeTransport([.success(response)]))
            do {
                _ = try await api.passwordLogin(PasswordLoginRequest(countryCode: "+86", phone: "13000000000", password: "synthetic", deviceId: "test"))
                XCTFail("失败响应不应返回认证成功")
            } catch let error as APIError {
                XCTAssertEqual(error, .business(code: 1, message: "账号或密码错误"))
            }
        }
    }

    func testBusinessMessagesAreBoundedAndDoNotExposeCredentialOrMarkup() async throws {
        let fallback = "请求失败，请稍后重试。"
        let longText = String(repeating: "请稍后重试", count: 40)
        for message in [longText, "Bearer synthetic-access-token", "<html>proxy error</html>", "eyJhbGciOiJIUzI1NiJ9.abcdefghijklmnopqrstuvwxyz0123456789", "", "\u{0000}invalid"] {
            let body = try JSONSerialization.data(withJSONObject: ["code": 1, "message": message, "data": NSNull()])
            let api = try client(FakeTransport([.success(HTTPResponse(status: 400, body: body))]))
            do {
                _ = try await api.passwordLogin(PasswordLoginRequest(countryCode: "+86", phone: "13000000000", password: "synthetic", deviceId: "test"))
                XCTFail("错误 message 不应成为成功")
            } catch let error as APIError {
                let expected = message == longText ? String(longText.prefix(160)) : fallback
                XCTAssertEqual(error, .business(code: 1, message: expected))
                XCTAssertLessThanOrEqual(error.localizedDescription.count, 160)
            }
        }
    }

    func testHTTPFailureWithNoValidBusinessEnvelopeDoesNotExposeRawBody() async throws {
        for status in [302, 401, 502] {
            let transport = FakeTransport([.success(HTTPResponse(status: status, body: Data("<html>Bearer private-response-token</html>".utf8)))])
            do {
                _ = try await client(transport).currentUser(accessToken: "synthetic-access-token", expectedUserID: "business-id")
                XCTFail("无效 HTTP 返回不应成为资料")
            } catch let error as APIError {
                XCTAssertEqual(error, .httpStatus(status))
                XCTAssertFalse(error.localizedDescription.contains("private-response-token"))
            }
        }
    }

    func testNullOrMalformedPayloadDoesNotBecomeSuccess() async throws {
        for body in [Data("{\"code\":0,\"message\":\"ok\",\"data\":null}".utf8), Data("not-json".utf8)] {
            let api = try client(FakeTransport([.success(HTTPResponse(status: 200, body: body))]))
            do {
                _ = try await api.refreshToken(RefreshTokenRequest(refreshToken: "synthetic", deviceId: "test"))
                XCTFail("缺少有效数据时必须失败")
            } catch let error as APIError {
                XCTAssertTrue(error == .emptyPayload || error == .invalidResponse)
            }
        }
    }

    func testTimeoutAndCancellationAreDistinct() async throws {
        for expected in [APIError.timedOut, .cancelled] {
            let api = try client(FakeTransport([.failure(expected)]))
            do {
                _ = try await api.sendSMS(SendSMSRequest(countryCode: "+86", phone: "13000000000", deviceId: "test"))
                XCTFail("网络失败不能变为成功")
            } catch let error as APIError { XCTAssertEqual(error, expected) }
        }
    }

    func testAndroidTokenCannotAuthenticateIOSSDK() async throws {
        let transport = FakeTransport([.success(HTTPResponse(status: 200, body: try fixture("im-token-success")))])
        let api = try client(transport)
        do {
            _ = try await api.imToken(accessToken: "synthetic-access-token")
            XCTFail("Android Token 不能交给 iOS SDK")
        } catch let error as APIError { XCTAssertEqual(error, .platformMismatch) }
    }

    func testIMEndpointsRejectMissingHostsAndEmbeddedCredentials() async throws {
        for address in ["https:missing-host", "https://user:password@im.example.invalid", "http://im.example.invalid"] {
            var object = try XCTUnwrap(JSONSerialization.jsonObject(with: fixture("im-token-success")) as? [String: Any])
            var data = try XCTUnwrap(object["data"] as? [String: Any])
            data["platform"] = 1
            data["apiAddr"] = address
            object["data"] = data
            let transport = FakeTransport([.success(HTTPResponse(status: 200, body: try JSONSerialization.data(withJSONObject: object)))])
            let api = try client(transport)
            do {
                _ = try await api.imToken(accessToken: "synthetic-access-token")
                XCTFail("无效或带凭据的 SDK 地址必须拒绝")
            } catch let error as APIError { XCTAssertEqual(error, .invalidCredentials) }
        }
    }
}

final class SessionCoordinatorTests: XCTestCase {
    func testNewAccountRejectsOldAuthenticationAndSDKCallbacks() async throws {
        let coordinator = SessionCoordinator()
        let a = try await coordinator.beginAuthentication(ownerKey: "staging/account-A")
        let b = try await coordinator.beginAuthentication(ownerKey: "staging/account-B")
        let oldAuth = await coordinator.authenticationSucceeded(a, businessUserID: "business-A", imUserID: "im-A")
        let newAuth = await coordinator.authenticationSucceeded(b, businessUserID: "business-B", imUserID: "im-B")
        let oldStore = await coordinator.updateLocalStore(.readable, for: a)
        let state = await coordinator.snapshot()
        XCTAssertFalse(oldAuth)
        XCTAssertTrue(newAuth)
        XCTAssertFalse(oldStore)
        XCTAssertEqual(state.businessUserID, "business-B")
        XCTAssertEqual(state.imUserID, "im-B")
    }

    func testSameAccountNewAttemptInvalidatesPriorTicket() async throws {
        let coordinator = SessionCoordinator()
        let first = try await coordinator.beginAuthentication(ownerKey: "staging/account-A")
        let second = try await coordinator.beginAuthentication(ownerKey: "staging/account-A")
        let acceptsOld = await coordinator.accepts(first)
        XCTAssertFalse(acceptsOld)
        XCTAssertNotEqual(first, second)
    }

    func testLogoutRejectsDelayedResults() async throws {
        let coordinator = SessionCoordinator()
        let ticket = try await coordinator.beginAuthentication(ownerKey: "staging/account-A")
        _ = await coordinator.authenticationSucceeded(ticket, businessUserID: "business-A", imUserID: "im-A")
        _ = await coordinator.updateLocalStore(.readable, for: ticket)
        guard let attempt = await coordinator.beginSync(for: ticket) else { return XCTFail("应能开始同步") }
        await coordinator.logout()
        let accepted = await coordinator.finishSync(.completed, attempt: attempt)
        let state = await coordinator.snapshot()
        XCTAssertFalse(accepted)
        XCTAssertEqual(state.authentication, .signedOut)
        XCTAssertNil(state.imUserID)
    }

    func testAuthenticationDoesNotImplyOpenStoreOrCompletedSync() async throws {
        let coordinator = SessionCoordinator()
        let ticket = try await coordinator.beginAuthentication(ownerKey: "staging/account-A")
        _ = await coordinator.authenticationSucceeded(ticket, businessUserID: "business-A", imUserID: "im-A")
        let state = await coordinator.snapshot()
        XCTAssertEqual(state.localStore, .closed)
        XCTAssertEqual(state.sync, .idle)
        XCTAssertNotEqual(state.businessUserID, state.imUserID)
    }

    func testFailureAndTimeoutPreserveReadableStoreWithoutCompletingSync() async throws {
        let coordinator = SessionCoordinator()
        let ticket = try await coordinator.beginAuthentication(ownerKey: "staging/account-A")
        _ = await coordinator.authenticationSucceeded(ticket, businessUserID: "business-A", imUserID: "im-A")
        _ = await coordinator.updateLocalStore(.readable, for: ticket)
        for failure in [SyncState.failed("network"), .timedOut, .cancelled] {
            guard let attempt = await coordinator.beginSync(for: ticket) else { return XCTFail("应能开始同步") }
            _ = await coordinator.finishSync(failure, attempt: attempt)
            let state = await coordinator.snapshot()
            XCTAssertEqual(state.localStore, .readable)
            XCTAssertEqual(state.sync, failure)
            XCTAssertNotEqual(state.sync, .completed)
        }
    }

    func testOutOfOrderCompletionIsRejected() async throws {
        let coordinator = SessionCoordinator()
        let ticket = try await coordinator.beginAuthentication(ownerKey: "staging/account-A")
        _ = await coordinator.authenticationSucceeded(ticket, businessUserID: "business-A", imUserID: "im-A")
        let beforeReadable = await coordinator.beginSync(for: ticket)
        XCTAssertNil(beforeReadable)
        _ = await coordinator.updateLocalStore(.readable, for: ticket)
        guard let attempt = await coordinator.beginSync(for: ticket) else { return XCTFail("应能开始同步") }
        let duplicate = await coordinator.beginSync(for: ticket)
        XCTAssertNil(duplicate)
        let completed = await coordinator.finishSync(.completed, attempt: attempt)
        XCTAssertTrue(completed)
    }

    func testOldSyncAttemptCannotCompleteANewerAttemptInSameSession() async throws {
        let coordinator = SessionCoordinator()
        let ticket = try await coordinator.beginAuthentication(ownerKey: "staging/account-A")
        _ = await coordinator.authenticationSucceeded(ticket, businessUserID: "business-A", imUserID: "im-A")
        _ = await coordinator.updateLocalStore(.readable, for: ticket)
        guard let first = await coordinator.beginSync(for: ticket) else { return XCTFail("应能开始同步") }
        _ = await coordinator.finishSync(.timedOut, attempt: first)
        guard let second = await coordinator.beginSync(for: ticket) else { return XCTFail("应能重试同步") }
        let lateCompletion = await coordinator.finishSync(.completed, attempt: first)
        let state = await coordinator.snapshot()
        XCTAssertFalse(lateCompletion)
        XCTAssertEqual(state.sync, .running)
        let accepted = await coordinator.finishSync(.completed, attempt: second)
        XCTAssertTrue(accepted)
    }

    func testDelayedCancellationDoesNotLogoutNewAccount() async throws {
        let coordinator = SessionCoordinator()
        let a = try await coordinator.beginAuthentication(ownerKey: "staging/account-A")
        let b = try await coordinator.beginAuthentication(ownerKey: "staging/account-B")
        let cancelledOld = await coordinator.logout(ifCurrent: a)
        let stillAcceptsNew = await coordinator.accepts(b)
        XCTAssertFalse(cancelledOld)
        XCTAssertTrue(stillAcceptsNew)
    }

    func testLosingReadableStoreInvalidatesActiveSyncAttempt() async throws {
        let coordinator = SessionCoordinator()
        let ticket = try await coordinator.beginAuthentication(ownerKey: "staging/account-A")
        _ = await coordinator.authenticationSucceeded(ticket, businessUserID: "business-A", imUserID: "im-A")
        _ = await coordinator.updateLocalStore(.readable, for: ticket)
        guard let attempt = await coordinator.beginSync(for: ticket) else { return XCTFail("应能开始同步") }
        _ = await coordinator.updateLocalStore(.blocked("file-protection"), for: ticket)
        let completed = await coordinator.finishSync(.completed, attempt: attempt)
        let state = await coordinator.snapshot()
        XCTAssertFalse(completed)
        XCTAssertEqual(state.localStore, .blocked("file-protection"))
        XCTAssertEqual(state.sync, .cancelled)
    }

    func testCancelledAuthenticationStartPreservesCurrentSession() async throws {
        let coordinator = SessionCoordinator()
        let current = try await coordinator.beginAuthentication(ownerKey: "staging/current-account")
        let cancelledTask = Task<SessionTicket, Error> {
            // 在进入 actor 之前确定性地取消当前任务，不依赖 sleep 或调度顺序。
            withUnsafeCurrentTask { task in task?.cancel() }
            return try await coordinator.beginAuthentication(ownerKey: "staging/cancelled-account")
        }
        do {
            _ = try await cancelledTask.value
            XCTFail("已取消的任务不能创建认证会话")
        } catch is CancellationError {
            // 保留当前会话，不能因取消的旧任务改变 generation。
        }
        let state = await coordinator.snapshot()
        let stillAcceptsCurrent = await coordinator.accepts(current)
        XCTAssertEqual(state.ticket, current)
        XCTAssertTrue(stillAcceptsCurrent)
    }

    func testLocalSampleHasStableKeysAndNoNetworkDeliveryState() async {
        let sample = LocalSampleConversation()
        let original = await sample.snapshot()
        let messages = await sample.append("  本地文字  ")
        XCTAssertEqual(messages.count, original.count + 1)
        XCTAssertEqual(messages.first?.id, original.first?.id)
        XCTAssertEqual(messages.last?.text, "本地文字")
        let afterBlank = await sample.append("  ")
        XCTAssertEqual(afterBlank.count, messages.count)
        await sample.clear()
        let cleared = await sample.snapshot()
        XCTAssertTrue(cleared.isEmpty)
    }
}
