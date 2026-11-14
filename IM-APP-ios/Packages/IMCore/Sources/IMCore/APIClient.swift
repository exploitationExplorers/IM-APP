import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

public enum APIError: Error, Equatable, LocalizedError, Sendable {
    case invalidConfiguration
    case invalidResponse
    case httpStatus(Int)
    case business(code: Int, message: String)
    case emptyPayload
    case invalidCredentials
    case platformMismatch
    case profileMismatch
    case cancelled
    case timedOut
    case transport

    public var errorDescription: String? {
        switch self {
        case .invalidConfiguration: return "请填写有效的 HTTPS 服务地址。"
        case .invalidResponse: return "服务返回的数据格式不正确。"
        case .httpStatus(let status): return "请求失败，HTTP 状态码 \(status)。"
        case .business(_, let message): return message
        case .emptyPayload: return "服务未返回需要的数据。"
        case .invalidCredentials: return "认证结果缺少有效身份或凭据。"
        case .platformMismatch: return "IM Token 的平台与 iOS 不一致。"
        case .profileMismatch: return "账号资料与登录身份不一致，请重新登录。"
        case .cancelled: return "请求已取消。"
        case .timedOut: return "请求超时，请重试。"
        case .transport: return "网络请求失败，请检查连接。"
        }
    }
}

public struct APIConfiguration: Sendable {
    public let baseURL: URL

    /// 仅接受显式 HTTPS 地址；默认业务入口由 App 配置，不在核心中隐式决定。
    public init(baseURL: String) throws {
        guard var components = URLComponents(string: baseURL.trimmingCharacters(in: .whitespacesAndNewlines)),
              components.scheme?.lowercased() == "https",
              let host = components.host, !host.isEmpty,
              components.user == nil, components.password == nil,
              components.query == nil, components.fragment == nil else {
            throw APIError.invalidConfiguration
        }
        let path = components.path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        guard path.isEmpty || path == "api/v1" else { throw APIError.invalidConfiguration }
        components.path = "/api/v1/"
        guard let url = components.url else { throw APIError.invalidConfiguration }
        self.baseURL = url
    }
}

public struct HTTPResponse: Sendable {
    public let status: Int
    public let body: Data

    public init(status: Int, body: Data) {
        self.status = status
        self.body = body
    }
}

public protocol HTTPTransport: Sendable {
    func send(_ request: URLRequest) async throws -> HTTPResponse
}

private final class RejectRedirectDelegate: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) {
        // 认证请求不自动跳转；避免将凭据交给另一个主机或降级到 HTTP。
        completionHandler(nil)
    }
}

public final class URLSessionTransport: HTTPTransport, @unchecked Sendable {
    private let session: URLSession

    public init() {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.urlCache = nil
        configuration.httpCookieStorage = nil
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        self.session = URLSession(configuration: configuration, delegate: RejectRedirectDelegate(), delegateQueue: nil)
    }

    public func send(_ request: URLRequest) async throws -> HTTPResponse {
        let (data, response) = try await session.data(for: request)
        guard let response = response as? HTTPURLResponse else { throw APIError.invalidResponse }
        return HTTPResponse(status: response.statusCode, body: data)
    }
}

public struct APIClient: Sendable {
    private let configuration: APIConfiguration
    private let transport: any HTTPTransport

    public init(configuration: APIConfiguration, transport: any HTTPTransport = URLSessionTransport()) {
        self.configuration = configuration
        self.transport = transport
    }

    public func passwordLogin(_ input: PasswordLoginRequest) async throws -> AuthResult {
        let result: AuthResult = try await post("auth/login", body: input)
        try validate(result)
        return result
    }

    /// 只调用既有业务登录和资料接口；尚无 SDK 时不申请可能挤掉旧会话的 IM Token。
    public func businessPasswordLogin(_ input: PasswordLoginRequest) async throws -> BusinessAccountSession {
        let auth = try await passwordLogin(input)
        do {
            let profile = try await currentUser(accessToken: auth.accessToken, expectedUserID: auth.user.id)
            return BusinessAccountSession(authentication: auth, profile: profile, profileLoadWarning: nil)
        } catch {
            try Task.checkCancellation()
            if let apiError = error as? APIError {
                if apiError == .cancelled || apiError == .profileMismatch { throw apiError }
            }
            // 资料接口失败时仅使用同一次登录已返回的真实账号资料，不绑定其他身份。
            return BusinessAccountSession(authentication: auth, profile: auth.user,
                profileLoadWarning: "个人资料加载异常，当前显示本次登录返回的资料。")
        }
    }

    public func currentUser(accessToken: String, expectedUserID: String) async throws -> UserProfile {
        guard !accessToken.isEmpty, !expectedUserID.isEmpty else { throw APIError.invalidCredentials }
        let profile: UserProfile = try await request("me", method: "GET", accessToken: accessToken)
        guard profile.id == expectedUserID else { throw APIError.profileMismatch }
        return profile
    }

    public func smsLogin(_ input: SMSLoginRequest) async throws -> AuthResult {
        let result: AuthResult = try await post("auth/login/sms", body: input)
        try validate(result)
        return result
    }

    public func sendSMS(_ input: SendSMSRequest) async throws -> SMSResult {
        try await post("auth/sms/send", body: input)
    }

    public func register(countryCode: String, phone: String, code: String, password: String, deviceID: String) async throws -> AuthResult {
        let result: AuthResult = try await post("auth/register", body: ["countryCode": countryCode, "phone": phone, "code": code, "password": password, "deviceId": deviceID])
        try validate(result); return result
    }

    public func resetPassword(countryCode: String, phone: String, code: String, password: String) async throws {
        let _: EmptyReply = try await post("auth/password/reset", body: ["countryCode": countryCode, "phone": phone, "code": code, "password": password])
    }

    public func refreshToken(_ input: RefreshTokenRequest) async throws -> TokenPair {
        let result: TokenPair = try await post("auth/token/refresh", body: input)
        guard !result.accessToken.isEmpty, !result.refreshToken.isEmpty, result.expiresIn > 0 else {
            throw APIError.invalidCredentials
        }
        return result
    }

    public func imToken(accessToken: String) async throws -> IMToken {
        struct Input: Encodable { let platformId: Int }
        guard !accessToken.isEmpty else { throw APIError.invalidCredentials }
        let result: IMToken = try await post("im/token", body: Input(platformId: 1), accessToken: accessToken)
        guard result.platform == 1 else { throw APIError.platformMismatch }
        guard !result.userId.isEmpty, !result.token.isEmpty, result.expireSec > 0 else {
            throw APIError.invalidCredentials
        }
        let api = try IMEndpointPolicy.resolve(result.apiAddr, webSocket: false, businessBaseURL: configuration.baseURL)
        let ws = try IMEndpointPolicy.resolve(result.wsAddr, webSocket: true, businessBaseURL: configuration.baseURL)
        return IMToken(userId: result.userId, token: result.token, platform: result.platform,
                       expireSec: result.expireSec, apiAddr: api, wsAddr: ws)
    }

    private func validate(_ result: AuthResult) throws {
        guard !result.accessToken.isEmpty, !result.refreshToken.isEmpty,
              !result.user.id.isEmpty, result.expiresIn > 0 else {
            throw APIError.invalidCredentials
        }
    }

    private func post<Input: Encodable, Output: Decodable>(
        _ path: String, body: Input, accessToken: String? = nil
    ) async throws -> Output {
        try await request(path, method: "POST", body: JSONEncoder().encode(body), accessToken: accessToken)
    }

    /// 所有业务调用仍走同一 HTTPS origin。仅允许相对接口路径，查询通过 URLQueryItem 编码。
    public func businessRequest<Output: Decodable>(
        _ path: String, method: String = "GET", query: [URLQueryItem] = [],
        body: [String: JSONValue]? = nil, accessToken: String
    ) async throws -> Output {
        guard !accessToken.isEmpty else { throw APIError.invalidCredentials }
        return try await request(path, method: method, body: body.map { try JSONEncoder().encode($0) },
                                 accessToken: accessToken, query: query)
    }

    public func publicRequest<Output: Decodable>(_ path: String, query: [URLQueryItem] = []) async throws -> Output {
        guard path.hasPrefix("public/") else { throw APIError.invalidConfiguration }
        return try await request(path, method: "GET", query: query)
    }

    private func request<Output: Decodable>(
        _ path: String, method: String, body: Data? = nil, accessToken: String? = nil,
        query: [URLQueryItem] = []
    ) async throws -> Output {
        guard !path.isEmpty, !path.hasPrefix("/"), !path.contains(":"), !path.contains("?"),
              !path.contains("#"), !path.split(separator: "/").contains(".."),
              ["GET", "POST", "PUT", "PATCH", "DELETE"].contains(method),
              var components = URLComponents(url: configuration.baseURL.appendingPathComponent(path), resolvingAgainstBaseURL: false)
        else { throw APIError.invalidConfiguration }
        if !query.isEmpty { components.queryItems = query }
        guard let url = components.url else { throw APIError.invalidConfiguration }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.timeoutInterval = 20
        if body != nil { request.setValue("application/json", forHTTPHeaderField: "Content-Type") }
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let accessToken = accessToken {
            request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        }
        request.httpBody = body
        do {
            try Task.checkCancellation()
            let response = try await transport.send(request)
            try Task.checkCancellation()
            guard (200..<300).contains(response.status) else {
                if let failure = try? JSONDecoder().decode(BusinessFailure.self, from: response.body), failure.code != 0 {
                    throw APIError.business(code: failure.code, message: safeMessage(failure.message))
                }
                throw APIError.httpStatus(response.status)
            }
            let envelope: APIEnvelope<Output>
            do { envelope = try JSONDecoder().decode(APIEnvelope<Output>.self, from: response.body) }
            catch { throw APIError.invalidResponse }
            guard envelope.code == 0 else { throw APIError.business(code: envelope.code, message: safeMessage(envelope.message)) }
            if envelope.data == nil, let empty = EmptyReply() as? Output { return empty }
            guard let payload = envelope.data else { throw APIError.emptyPayload }
            return payload
        } catch is CancellationError {
            throw APIError.cancelled
        } catch let error as URLError {
            if error.code == .cancelled { throw APIError.cancelled }
            if error.code == .timedOut { throw APIError.timedOut }
            throw APIError.transport
        } catch let error as APIError {
            throw error
        } catch {
            throw APIError.transport
        }
    }

    private struct BusinessFailure: Decodable {
        let code: Int
        let message: String
    }

    /// 只向 UI 返回有界的人类可读 message；不显示原始正文、HTML 或疑似凭据。
    private func safeMessage(_ message: String) -> String {
        let fallback = "请求失败，请稍后重试。"
        guard message.utf8.count <= 1_024 else { return fallback }
        let flattened = message.components(separatedBy: .whitespacesAndNewlines).filter { !$0.isEmpty }.joined(separator: " ")
        let lower = flattened.lowercased()
        guard !flattened.isEmpty,
              !["token", "bearer", "authorization", "password", "secret", "credential", "http://", "https://"].contains(where: { lower.contains($0) }),
              flattened.rangeOfCharacter(from: CharacterSet(charactersIn: "<>{}[]").union(.controlCharacters)) == nil,
              flattened.range(of: "[A-Za-z0-9_+/=-]{32,}", options: .regularExpression) == nil else { return fallback }
        return String(flattened.prefix(160))
    }
}
