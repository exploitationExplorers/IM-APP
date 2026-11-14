import Foundation
import Security
import IMCore

struct SavedBusinessLogin: Codable, Sendable {
    let schema: Int
    let apiBaseURL: String
    let authentication: AuthResult
    let profile: UserProfile
    let expiresAt: Date

    init(account: BusinessAccountSession, configuration: APIConfiguration, expiresAt: Date? = nil) {
        schema = 1; apiBaseURL = configuration.baseURL.absoluteString
        authentication = account.authentication; profile = account.profile
        self.expiresAt = expiresAt ?? Date().addingTimeInterval(TimeInterval(account.authentication.expiresIn))
    }
    func validate() throws -> APIConfiguration {
        guard schema == 1, !profile.id.isEmpty, profile.id == authentication.user.id,
              !authentication.accessToken.isEmpty, !authentication.refreshToken.isEmpty,
              authentication.expiresIn > 0, expiresAt.timeIntervalSince1970.isFinite else { throw NativeVaultError.invalid }
        return try APIConfiguration(baseURL: apiBaseURL)
    }
    var account: BusinessAccountSession { BusinessAccountSession(authentication: authentication, profile: profile) }
}

enum NativeVaultError: LocalizedError {
    case invalid, unavailable
    var errorDescription: String? {
        switch self {
        case .invalid: return "已保存的登录信息格式无效，请重新登录；聊天记录未删除。"
        case .unavailable: return "暂时无法读写安全登录信息，请解锁设备后重试；聊天记录未删除。"
        }
    }
}

/// 首次解锁后可用、不可云同步的 Keychain 项；不保存密码或 SDK Token。
actor NativeSessionVault {
    static let shared = NativeSessionVault()
    private let service = (Bundle.main.bundleIdentifier ?? "com.im.nativebootstrap.staging") + ".business.login"
    private let accountName = "current-session-v1"

    private var query: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: service, kSecAttrAccount as String: accountName,
         kSecAttrSynchronizable as String: false]
    }

    func load() throws -> SavedBusinessLogin? {
        try Task.checkCancellation()
        var request = query
        request[kSecReturnData as String] = true
        request[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        let status = SecItemCopyMatching(request as CFDictionary, &item)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = item as? Data else { throw NativeVaultError.unavailable }
        guard data.count <= 256 * 1024, let saved = try? JSONDecoder().decode(SavedBusinessLogin.self, from: data) else { throw NativeVaultError.invalid }
        _ = try saved.validate()
        return saved
    }

    func save(_ saved: SavedBusinessLogin, expectedRefreshToken: String? = nil) throws {
        try Task.checkCancellation()
        if let expected = expectedRefreshToken {
            guard let existing = try load(), existing.profile.id == saved.profile.id,
                  existing.apiBaseURL == saved.apiBaseURL,
                  existing.authentication.refreshToken == expected else { throw CancellationError() }
        }
        _ = try saved.validate()
        let data = try JSONEncoder().encode(saved)
        guard data.count <= 256 * 1024 else { throw NativeVaultError.invalid }
        let updates: [String: Any] = [kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly]
        var status = SecItemUpdate(query as CFDictionary, updates as CFDictionary)
        if status == errSecItemNotFound {
            status = SecItemAdd(query.merging(updates) { _, new in new } as CFDictionary, nil)
        }
        guard status == errSecSuccess else { throw NativeVaultError.unavailable }
    }

    func clear(expectedUserID: String? = nil, expectedRefreshToken: String? = nil) throws {
        if expectedUserID != nil || expectedRefreshToken != nil, let existing = try load() {
            if let expected = expectedUserID, existing.profile.id != expected { return }
            if let expected = expectedRefreshToken, existing.authentication.refreshToken != expected { return }
        }
        let status = SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw NativeVaultError.unavailable }
    }
}
