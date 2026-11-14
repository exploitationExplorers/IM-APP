import Foundation

/// 与旧 App 的 chatMediaUrl.ts 一致：签名保真、旧聊天图重签、按桶限制缩图。
public struct MediaURLPolicy: Sendable {
    public enum Variant: String, Sendable { case list, preview = "preview-mobile", avatar }
    public let businessBaseURL: URL
    public let accountScope: String
    public init(businessBaseURL: URL, accountScope: String = "anonymous") { self.businessBaseURL = businessBaseURL; self.accountScope = accountScope }
    private let chatHosts: Set<String> = ["oss-chat.whs188.xin", "oss-chat-test.xn--jprz53bj9s.com"]
    private let businessHosts: Set<String> = ["oss-business.whs188.xin", "oss-business-test.xn--jprz53bj9s.com"]
    private let chatPrefixes = ["im-app-production/chat/", "oss-test/chat/"]
    private let businessPrefixes = ["im-app-production/business/", "oss-test/business/"]
    private let images: Set<String> = ["jpg", "jpeg", "png", "webp", "bmp", "gif", "tif", "tiff", "heic", "heif", "avif"]
    private let nonImages: Set<String> = ["mp4", "mov", "m4v", "webm", "mkv", "avi", "aac", "m4a", "mp3", "wav", "ogg", "flac", "pdf", "zip", "rar", "7z", "doc", "docx", "xls", "xlsx", "ppt", "pptx"]

    /// 身份与下载地址分离；未知地址和 capability token 保真，不跨账号复用私有内容。
    public func cacheIdentity(_ raw: String) -> String {
        let namespace = "media-v2\n\(businessBaseURL.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/")))\n\(accountScope)\n"
        guard let url = absolute(raw), let parts = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return namespace + raw }
        let sameOrigin = url.scheme?.lowercased() == businessBaseURL.scheme?.lowercased() && url.host?.lowercased() == businessBaseURL.host?.lowercased() && url.port == businessBaseURL.port
        let host = url.host?.lowercased() ?? "", path = parts.percentEncodedPath
        let capability = sameOrigin && path == "/api/v1/public/oss-media"
        let objectRoute = sameOrigin && path.hasPrefix("/object/")
        let knownChat = chatHosts.contains(host) && chatPrefixes.contains { path.hasPrefix("/" + $0) }
        let knownBusiness = businessHosts.contains(host) && businessPrefixes.contains { path.hasPrefix("/" + $0) }
        guard capability || objectRoute || knownChat || knownBusiness else { return namespace + raw.components(separatedBy: "#")[0] }
        let temporaryAuth: Set<String> = ["ossaccesskeyid", "signature", "expires", "security-token", "x-oss-access-key-id", "x-oss-signature", "x-oss-expires", "x-oss-date", "x-oss-security-token", "x-oss-credential", "x-oss-signature-version", "x-oss-additional-headers", "x-amz-algorithm", "x-amz-credential", "x-amz-date", "x-amz-expires", "x-amz-signedheaders", "x-amz-signature", "x-amz-security-token"]
        let pairs = (parts.percentEncodedQuery ?? "").split(separator: "&").map(String.init).filter { pair in
            let name = String(pair.split(separator: "=", maxSplits: 1, omittingEmptySubsequences: false)[0]).removingPercentEncoding?.lowercased() ?? ""
            return capability || !temporaryAuth.contains(name)
        }
        let names = pairs.map { String($0.split(separator: "=", maxSplits: 1, omittingEmptySubsequences: false)[0]).removingPercentEncoding ?? "" }
        guard Set(names).count == names.count else { return namespace + raw.components(separatedBy: "#")[0] }
        let query = pairs.sorted().joined(separator: "&")
        var origin = parts; origin.path = ""; origin.query = nil; origin.fragment = nil
        return namespace + (origin.string ?? "") + path + (query.isEmpty ? "" : "?" + query)
    }

    public func image(_ raw: String, variant: Variant = .list) -> String {
        let raw = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let url = absolute(raw), var parts = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return raw }
        let path = url.path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        let ext = (path as NSString).pathExtension.lowercased()
        let host = url.host?.lowercased() ?? ""
        let signed = signature(parts)
        // 动图不能经过转 WebP 的静态缩图入口，稳定代理的 key 也可能是 GIF。
        if isGIF(raw) { return original(raw) }
        let edge = variant == .list ? "360" : "960"
        if variant != .avatar, let key = logicalChatKey(url, parts: parts), !nonImages.contains(ext) {
            var destination = URLComponents(url: businessBaseURL, resolvingAgainstBaseURL: false)!
            destination.path = "/object/" + key.split(separator: "/").joined(separator: "/")
            destination.queryItems = thumbnail(edge)
            destination.fragment = nil
            return destination.url?.absoluteString ?? raw
        }
        // 其余签名 URL 必须字节级原样，不能通过 URLComponents 重编码后返回。
        if signed { return raw }
        if url.path == "/api/v1/public/oss-media", images.contains(query(parts, "key").map { ($0 as NSString).pathExtension.lowercased() } ?? ""),
           !(query(parts, "token") ?? "").isEmpty {
            set(&parts, key: "variant", value: variant.rawValue)
            return parts.url?.absoluteString ?? raw
        }
        if variant != .avatar, url.path.hasPrefix("/object/"), !nonImages.contains(ext) {
            for item in thumbnail(edge) { set(&parts, key: item.name, value: item.value ?? "") }
            return parts.url?.absoluteString ?? raw
        }
        let businessObject = businessHosts.contains(host) && businessPrefixes.contains(where: { path.hasPrefix($0) })
        let chatObject = chatHosts.contains(host) && chatPrefixes.contains(where: { path.hasPrefix($0) })
        if images.contains(ext), businessObject || (variant != .avatar && chatObject), query(parts, "x-oss-process") == nil {
            let process: String
            switch variant {
            case .list: process = "image/resize,w_360/quality,q_60/format,webp"
            case .preview: process = "image/resize,w_960/quality,q_72/format,webp"
            case .avatar: process = "image/resize,w_128/quality,q_70/format,webp"
            }
            set(&parts, key: "x-oss-process", value: process)
            return parts.url?.absoluteString ?? raw
        }
        return raw.hasPrefix("/") ? url.absoluteString : raw
    }

    public func original(_ raw: String) -> String {
        guard let url = absolute(raw), var parts = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return raw }
        if signature(parts) {
            if let key = logicalChatKey(url, parts: parts), !nonImages.contains((key as NSString).pathExtension.lowercased()) {
                var origin = URLComponents(url: businessBaseURL, resolvingAgainstBaseURL: false)!
                origin.path = "/object/" + key; origin.query = nil; origin.fragment = nil
                return origin.url?.absoluteString ?? raw
            }
            return raw
        }
        var removed: Set<String> = ["x-oss-process", "variant"]
        if url.path.hasPrefix("/object/") { removed.formUnion(["type", "width", "height", "format"]) }
        parts.queryItems = parts.queryItems?.filter { !removed.contains($0.name) }
        if parts.queryItems?.isEmpty == true { parts.queryItems = nil }
        return parts.url?.absoluteString ?? raw
    }
    /// 已知旧测试聊天桶的视频签名可过期；仅在 host、桶前缀与视频扩展名同时匹配时恢复稳定入口。
    public func playback(_ raw: String) -> String {
        guard let url = absolute(raw), let parts = URLComponents(url: url, resolvingAgainstBaseURL: false),
              ["mp4", "mov", "m4v", "webm", "mkv", "avi"].contains(url.pathExtension.lowercased()), let key = logicalChatKey(url, parts: parts) else { return original(raw) }
        var destination = URLComponents(url: businessBaseURL, resolvingAgainstBaseURL: false)!
        destination.path = "/object/" + key; destination.query = nil; destination.fragment = nil
        return destination.url?.absoluteString ?? raw
    }
    public func isGIF(_ raw: String) -> Bool {
        guard let url = absolute(raw), let parts = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return false }
        return url.path.lowercased().hasSuffix(".gif") || (query(parts, "key")?.lowercased().hasSuffix(".gif") ?? false)
    }

    private func logicalChatKey(_ url: URL, parts: URLComponents) -> String? {
        let host = url.host?.lowercased() ?? ""
        guard chatHosts.contains(host), host != "oss-chat.whs188.xin", signature(parts) else { return nil }
        let path = url.path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        guard let prefix = chatPrefixes.first(where: { path.hasPrefix($0) }) else { return nil }
        let key = String(path.dropFirst(prefix.count)); return key.isEmpty ? nil : key
    }

    public func absolute(_ raw: String) -> URL? {
        let value: URL?
        if raw.hasPrefix("/"), !raw.hasPrefix("//") {
            var origin = URLComponents(url: businessBaseURL, resolvingAgainstBaseURL: false)
            origin?.path = "/"; origin?.query = nil; origin?.fragment = nil
            value = URL(string: raw, relativeTo: origin?.url)?.absoluteURL
        } else { value = URL(string: raw) }
        guard let url = value, ["https", "http"].contains(url.scheme?.lowercased() ?? ""),
              url.host != nil, url.user == nil, url.password == nil else { return nil }
        if url.scheme?.lowercased() == "http", url.host == "8.154.44.197", url.port == nil || url.port == 80,
           let source = URLComponents(url: url, resolvingAgainstBaseURL: false), !signature(source),
           ["/object/", "/openim/", "/minio/", "/openim-api/"].contains(where: { url.path.hasPrefix($0) }) {
            var origin = URLComponents(url: businessBaseURL, resolvingAgainstBaseURL: false)!
            origin.percentEncodedPath = source.percentEncodedPath; origin.percentEncodedQuery = source.percentEncodedQuery; origin.percentEncodedFragment = source.percentEncodedFragment
            return origin.url
        }
        return url
    }
    private func signature(_ parts: URLComponents) -> Bool {
        let keys = Set((parts.queryItems ?? []).map { $0.name.lowercased() })
        return keys.contains("x-oss-signature") || keys.contains("x-amz-signature") ||
        (keys.contains("ossaccesskeyid") && keys.contains("signature"))
    }
    private func query(_ parts: URLComponents, _ key: String) -> String? { parts.queryItems?.first { $0.name == key }?.value }
    private func set(_ parts: inout URLComponents, key: String, value: String) {
        parts.queryItems = (parts.queryItems ?? []).filter { $0.name != key } + [URLQueryItem(name: key, value: value)]
    }
    private func thumbnail(_ edge: String) -> [URLQueryItem] {
        [URLQueryItem(name: "type", value: "image"), URLQueryItem(name: "width", value: edge), URLQueryItem(name: "height", value: edge), URLQueryItem(name: "format", value: "webp")]
    }
}
