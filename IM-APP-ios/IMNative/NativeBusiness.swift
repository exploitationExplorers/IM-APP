import Foundation
import IMCore
import UIKit

struct NativePage<Item: Decodable>: Decodable {
    let items: [Item]
    let nextCursor: String?
    let hasMore: Bool
    private enum CodingKeys: String, CodingKey { case items, nextCursor, hasMore }
    init(from decoder: Decoder) throws {
        if let array = try? decoder.singleValueContainer().decode([Item].self) { items = array; nextCursor = nil; hasMore = false; return }
        if let text = try? decoder.singleValueContainer().decode(String.self), let data = text.data(using: .utf8), text.first == "[" || text.first == "{" {
            self = try JSONDecoder().decode(Self.self, from: data); return
        }
        if let nested = try? decoder.container(keyedBy: NativeBusinessKey.self), nested.contains(NativeBusinessKey("data")) {
            self = try nested.decode(Self.self, forKey: NativeBusinessKey("data")); return
        }
        let c = try decoder.container(keyedBy: CodingKeys.self)
        items = try c.decode([Item].self, forKey: .items)
        nextCursor = try c.decodeIfPresent(String.self, forKey: .nextCursor)
        hasMore = try c.decodeIfPresent(Bool.self, forKey: .hasMore) ?? false
    }
}
struct NativeTag: Decodable { let id: String; let name: String; let memberCount: Int? }
struct NativeContact: Decodable {
    let id: String; let publicId: String?; let nickname: String; let avatar: String
    let commonGroups: [NativeGroup]?
    let remark: String?; let isBlocked: Bool?; let tags: [NativeTag]?; let friendSince: String?; let lastSeenAt: String?; let bio: String?
    var displayName: String { (remark?.isEmpty == false ? remark : nil) ?? nickname }
}
struct NativeFriendRequest: Decodable { let id: String; let fromUser: NativeContact; let message: String; let status: String; let createdAt: String }
struct NativeFriendRequests: Decodable {
    let pending: [NativeFriendRequest]; let recent: [NativeFriendRequest]
    init(from decoder: Decoder) throws {
        if let all = try? decoder.singleValueContainer().decode([NativeFriendRequest].self) { pending = all.filter { $0.status == "pending" }; recent = all.filter { $0.status != "pending" }; return }
        let c = try decoder.container(keyedBy: NativeBusinessKey.self)
        if c.contains(NativeBusinessKey("data")) { self = try c.decode(Self.self, forKey: NativeBusinessKey("data")); return }
        pending = try c.decodeIfPresent([NativeFriendRequest].self, forKey: NativeBusinessKey("pending")) ?? []
        recent = try c.decodeIfPresent([NativeFriendRequest].self, forKey: NativeBusinessKey("recent")) ?? []
    }
}
struct NativeBusinessKey: CodingKey {
    let stringValue: String; let intValue: Int? = nil
    init(_ value: String) { stringValue = value }
    init?(stringValue: String) { self.stringValue = stringValue }
    init?(intValue: Int) { return nil }
}
extension KeyedDecodingContainer where Key == NativeBusinessKey {
    func value<T: Decodable>(_ key: String, _ type: T.Type = T.self) throws -> T? {
        let upper = key == "id" ? "ID" : key.prefix(1).uppercased() + key.dropFirst()
        return try decodeIfPresent(type, forKey: NativeBusinessKey(key)) ?? decodeIfPresent(type, forKey: NativeBusinessKey(upper))
    }
}
struct NativePrivacy: Decodable { let requireFriendApproval: Bool; let requireGroupApproval: Bool }
struct NativeQRIdentity: Decodable { let nickname: String?; let name: String?; let avatar: String? }
struct NativeQR: Decodable { let payload: String; let expiresAt: String?; let user: NativeQRIdentity?; let group: NativeQRIdentity? }
struct NativePeer: Decodable {
    let businessUserId: String; let imUserId: String; let nickname: String?; let avatar: String?; let canChat: Bool; let denyReason: String?
}
struct NativeGroupPeer: Decodable {
    let businessGroupId: String; let imGroupId: String; let canChat: Bool; let denyReason: String?; let mutedUntil: String?
}
struct NativeGroupPermissions: Decodable {
    let canEditProfile: Bool; let canEditAnnouncement: Bool; let canViewQRCode: Bool
    let canManageMembers: Bool; let canEditMyNickname: Bool; let canReport: Bool
}
struct NativeGroup: Decodable {
    let id: String; let name: String; let avatar: String; let publicId: String?; let publicIdChangeUsed: Bool?; let ownerId: String?; let memberCount: Int?
    let announcement: String?; let announcementImages: [String]?; let myRole: String?; let role: String?
    let joinMode: String?; let allMuted: Bool?; let allowMemberAddFriend: Bool?; let myNickname: String?; let remark: String?
    let canChat: Bool?; let denyReason: String?; let permissions: NativeGroupPermissions?; let status: String?
    var isOwner: Bool { ["owner", "100"].contains(myRole ?? "") || ["owner", "100"].contains(role ?? "") }
    var canManage: Bool { permissions?.canManageMembers ?? (isOwner || ["admin", "60"].contains(myRole ?? "")) }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: NativeBusinessKey.self)
        guard let id: String = try c.value("id"), !id.isEmpty else { throw APIError.invalidResponse }; self.id = id
        name = try c.value("name") ?? ""; avatar = try c.value("avatar") ?? ""; publicId = try c.value("publicId"); publicIdChangeUsed = try c.value("publicIdChangeUsed"); ownerId = try c.value("ownerId"); memberCount = try c.value("memberCount")
        announcement = try c.value("announcement"); announcementImages = try c.value("announcementImages"); myRole = try c.value("myRole"); role = try c.value("role")
        joinMode = try c.value("joinMode"); allMuted = try c.value("allMuted"); allowMemberAddFriend = try c.value("allowMemberAddFriend"); myNickname = try c.value("myNickname"); remark = try c.value("remark")
        canChat = try c.value("canChat"); denyReason = try c.value("denyReason"); permissions = try c.value("permissions"); status = try c.value("status")
    }
}
struct NativeGroupMember: Decodable {
    let id: String; let nickname: String; let groupNickname: String?; let displayName: String?; let avatar: String
    let role: String; let memberRemark: String?; let isMuted: Bool?; let joinedAt: String?
    var name: String { displayName ?? groupNickname ?? nickname }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: NativeBusinessKey.self)
        guard let id: String = try c.value("id"), !id.isEmpty else { throw APIError.invalidResponse }; self.id = id
        nickname = try c.value("nickname") ?? ""; groupNickname = try c.value("groupNickname"); displayName = try c.value("displayName"); avatar = try c.value("avatar") ?? ""
        role = (try c.value("role", String.self) ?? "member").lowercased(); memberRemark = try c.value("memberRemark"); isMuted = try c.value("isMuted"); joinedAt = try c.value("joinedAt")
    }
}
struct NativeJoinRequest: Decodable { let id: String; let remark: String; let status: String; let createdAt: String; let applicant: NativeContact }
struct NativeAnnouncement: Decodable { let id: String; let content: String; let images: [String]?; let publisherName: String?; let createdAt: String }
struct NativeFavorites: Decodable {
    let id: String; let messageId: String; let type: String; let content: String; let senderId: String; let conversationId: String; let createdAt: String
}
struct NativeFileObject: Decodable { let id: String; let url: String?; let thumbnailUrl: String? }
struct NativeUpload: Decodable {
    let file: NativeFileObject; let uploadUrl: String; let formUrl: String?; let formData: [String: String]?; let headers: [String: String]?
}

@MainActor
final class NativeBusinessContext {
    let api: APIClient
    let configuration: APIConfiguration
    private var authentication: AuthResult
    var accessToken: String { authentication.accessToken }
    var refreshToken: String { authentication.refreshToken }
    var logoutWarning: String?
    private var refreshTask: Task<Void, Error>?
    private var profileTask: Task<Void, Error>?
    private var pendingProfileValidation = false
    private var invalidProfile = false
    private let ownerIsActive: () -> Bool
    let userID: String
    var profile: UserProfile
    var media: MediaURLPolicy { MediaURLPolicy(businessBaseURL: configuration.baseURL, accountScope: userID) }
    init(account: BusinessAccountSession, configuration: APIConfiguration, ownerIsActive: @escaping () -> Bool) {
        self.configuration = configuration; api = APIClient(configuration: configuration)
        authentication = account.authentication; userID = account.profile.id; profile = account.profile
        self.ownerIsActive = ownerIsActive
    }
    func request<T: Decodable>(_ path: String, method: String = "GET", query: [URLQueryItem] = [], body: [String: JSONValue]? = nil) async throws -> T {
        guard ownerIsActive() else { throw APIError.cancelled }
        guard !invalidProfile else { throw APIError.profileMismatch }
        if pendingProfileValidation { try await finishProfileValidation() }
        let used = accessToken
        do { let result: T = try await api.businessRequest(path, method: method, query: query, body: body, accessToken: used); try Task.checkCancellation(); guard ownerIsActive() else { throw APIError.cancelled }; return result }
        catch {
            guard expired(error), !path.hasPrefix("auth/") else { throw error }
            if used == accessToken { try await refreshSession() }
            guard ownerIsActive() else { throw APIError.cancelled }
            do { let result: T = try await api.businessRequest(path, method: method, query: query, body: body, accessToken: accessToken); try Task.checkCancellation(); guard ownerIsActive() else { throw APIError.cancelled }; return result }
            catch { if expired(error) { throw APIError.business(code: 401, message: "登录已过期，请退出后重新登录。") }; throw error }
        }
    }
    func change(_ path: String, method: String = "POST", body: [String: JSONValue]? = [:]) async throws {
        let _: EmptyReply = try await request(path, method: method, body: body)
    }
    func refreshProfile() async throws {
        let fresh: UserProfile = try await request("me")
        guard fresh.id == userID else { throw APIError.profileMismatch }; profile = fresh
    }
    private func expired(_ error: Error) -> Bool {
        if let apiError = error as? APIError { switch apiError { case .httpStatus(401), .business(code: 401, message: _): return true; default: return false } }; return false
    }
    private func refreshSession() async throws {
        if let task = refreshTask { try await task.value; return }
        let oldRefresh = refreshToken
        let task = Task { @MainActor in
            guard self.ownerIsActive() else { throw APIError.cancelled }
            let device = UIDevice.current.identifierForVendor?.uuidString ?? "ios-native"
            let pair = try await self.api.refreshToken(RefreshTokenRequest(refreshToken: oldRefresh, deviceId: device))
            try Task.checkCancellation(); guard self.ownerIsActive() else { throw APIError.cancelled }
            let auth = AuthResult(accessToken: pair.accessToken, refreshToken: pair.refreshToken, expiresIn: pair.expiresIn, user: self.profile)
            // 旋转后先保存新token，避免 /me 失败或强杀使旧refresh被重复消费。
            try await NativeSessionVault.shared.save(SavedBusinessLogin(account: BusinessAccountSession(authentication: auth, profile: self.profile), configuration: self.configuration), expectedRefreshToken: oldRefresh)
            try Task.checkCancellation(); guard self.ownerIsActive() else { throw APIError.cancelled }
            // 新refresh已旋转，立即保留新pair；资料验证失败后也不能再消费旧refresh。
            self.authentication = auth; self.pendingProfileValidation = true
            try await self.finishProfileValidation()
        }
        refreshTask = task
        defer { refreshTask = nil }
        do { try await task.value }
        catch { if expired(error) { throw APIError.business(code: 401, message: "登录已过期，请退出后重新登录。") }; throw error }
    }
    private func finishProfileValidation() async throws {
        guard !invalidProfile else { throw APIError.profileMismatch }
        if let task = profileTask { try await task.value; return }
        let auth = authentication
        let task = Task { @MainActor in
            do {
                let profile = try await self.api.currentUser(accessToken: auth.accessToken, expectedUserID: self.userID)
                try Task.checkCancellation(); guard self.ownerIsActive(), self.authentication.refreshToken == auth.refreshToken else { throw APIError.cancelled }
                try await NativeSessionVault.shared.save(SavedBusinessLogin(account: BusinessAccountSession(authentication: auth, profile: profile), configuration: self.configuration), expectedRefreshToken: auth.refreshToken)
                guard self.ownerIsActive() else { throw APIError.cancelled }; self.profile = profile; self.pendingProfileValidation = false
            } catch APIError.profileMismatch { self.invalidProfile = true; throw APIError.profileMismatch }
        }
        profileTask = task; defer { profileTask = nil }; try await task.value
    }
    func contacts(keyword: String = "", sort: String = "recent", cursor: String? = nil) async throws -> NativePage<NativeContact> {
        var query = [URLQueryItem(name: "limit", value: "50"), URLQueryItem(name: "sort", value: sort)]
        if !keyword.isEmpty { query.append(URLQueryItem(name: "keyword", value: keyword)) }
        if let cursor = cursor, !cursor.isEmpty { query.append(URLQueryItem(name: "cursor", value: cursor)) }
        return try await request("contacts", query: query)
    }
    func upload(data: Data, filename: String, contentType: String, purpose: String) async throws -> NativeFileObject {
        let upload: NativeUpload = try await request("files/uploads", method: "POST", body: ["purpose": .string(purpose), "fileName": .string(filename), "contentType": .string(contentType), "size": .number(Double(data.count))])
        let rawURL = upload.formUrl ?? upload.uploadUrl
        guard let url = URL(string: rawURL), url.scheme == "https", url.host != nil, url.user == nil, url.password == nil else { throw APIError.invalidResponse }
        var request = URLRequest(url: url); request.timeoutInterval = 60
        // 对象存储请求单独构造，绝不附加业务 Authorization。
        if let fields = upload.formData, !fields.isEmpty {
            let boundary = "im-" + UUID().uuidString
            request.httpMethod = "POST"; request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
            var payload = Data()
            for key in fields.keys.sorted() {
                guard !key.contains("\r"), !key.contains("\n"), !key.contains("\"") else { throw APIError.invalidResponse }
                payload.append(Data("--\(boundary)\r\nContent-Disposition: form-data; name=\"\(key)\"\r\n\r\n\(fields[key]!)\r\n".utf8))
            }
            payload.append(Data("--\(boundary)\r\nContent-Disposition: form-data; name=\"file\"; filename=\"upload\"\r\nContent-Type: \(contentType)\r\n\r\n".utf8))
            payload.append(data); payload.append(Data("\r\n--\(boundary)--\r\n".utf8)); request.httpBody = payload
        } else { request.httpMethod = "PUT"; request.httpBody = data; request.setValue(contentType, forHTTPHeaderField: "Content-Type") }
        for (key, value) in upload.headers ?? [:] where key.lowercased() != "authorization" { request.setValue(value, forHTTPHeaderField: key) }
        let response = try await URLSessionTransport().send(request)
        guard (200..<300).contains(response.status) else { throw APIError.httpStatus(response.status) }
        return try await self.request("files/uploads/complete", method: "POST", body: ["fileId": .string(upload.file.id)])
    }
}
