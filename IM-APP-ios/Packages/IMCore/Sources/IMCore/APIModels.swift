import Foundation

public struct APIEnvelope<Payload: Decodable>: Decodable {
    public let code: Int
    public let message: String
    public let data: Payload?
}

public struct UserProfile: Codable, Equatable, Sendable {
    public let id: String
    public let phoneMasked: String
    public let countryCode: String
    public let publicId: String
    public let nickname: String
    public let avatar: String
    public let bio: String
    public let status: String
    public let createdAt: String
    public let hasPassword: Bool
}

public struct AuthResult: Codable, Equatable, Sendable {
    public let accessToken: String
    public let refreshToken: String
    public let expiresIn: Int
    public let user: UserProfile
}

/// 业务账号会话仅保存在内存；它不代表 IM SDK 已登录或消息库已经可读。
public struct BusinessAccountSession: Equatable, Sendable {
    public let authentication: AuthResult
    public let profile: UserProfile
    public let profileLoadWarning: String?
}

public struct TokenPair: Codable, Equatable, Sendable {
    public let accessToken: String
    public let refreshToken: String
    public let expiresIn: Int
}

public struct SMSResult: Codable, Equatable, Sendable {
    public let retryAfterSec: Int
    public let expiresIn: Int
    public let devCode: String?
}

public struct IMToken: Codable, Equatable, Sendable {
    public let userId: String
    public let token: String
    public let platform: Int
    public let expireSec: Int
    public let apiAddr: String
    public let wsAddr: String
}

public struct PasswordLoginRequest: Encodable, Sendable {
    public let countryCode: String
    public let phone: String
    public let password: String
    public let deviceId: String

    public init(countryCode: String, phone: String, password: String, deviceId: String) {
        self.countryCode = countryCode
        self.phone = phone
        self.password = password
        self.deviceId = deviceId
    }
}

public struct SMSLoginRequest: Encodable, Sendable {
    public let countryCode: String
    public let phone: String
    public let code: String
    public let deviceId: String

    public init(countryCode: String, phone: String, code: String, deviceId: String) {
        self.countryCode = countryCode
        self.phone = phone
        self.code = code
        self.deviceId = deviceId
    }
}

public struct SendSMSRequest: Encodable, Sendable {
    public let countryCode: String
    public let phone: String
    public let scene: String
    public let deviceId: String

    public init(countryCode: String, phone: String, scene: String = "login", deviceId: String) {
        self.countryCode = countryCode
        self.phone = phone
        self.scene = scene
        self.deviceId = deviceId
    }
}

public struct RefreshTokenRequest: Encodable, Sendable {
    public let refreshToken: String
    public let deviceId: String

    public init(refreshToken: String, deviceId: String) {
        self.refreshToken = refreshToken
        self.deviceId = deviceId
    }
}
