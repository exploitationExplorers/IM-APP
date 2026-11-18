import Foundation

public enum RecentChatMediaScope: String, Sendable {
    case direct, group

    public var lifetime: TimeInterval { (self == .group ? 7 : 14) * 86_400 }
}

public struct RecentChatMediaJob: Hashable, Sendable {
    public let resource: RecentChatMediaResource
    public let expiresAt: Date
}

/// Resource addresses are normalized once for prefetch and on-demand viewing.
public struct RecentChatMediaResource: Hashable, Sendable {
    public let url: URL
    public let identity: String
    public let limit: Int64
    public enum Kind: Hashable, Sendable { case image, audio, video, file }
    public let kind: Kind

    private static let megabyte: Int64 = 1024 * 1024

    private init?(address: String, policy: MediaURLPolicy, limit: Int64, kind: Kind) {
        guard let url = policy.absolute(address), url.scheme == "https" else { return nil }
        self.url = url
        self.identity = policy.cacheIdentity(address)
        self.limit = limit
        self.kind = kind
    }

    public static func image(_ address: String, policy: MediaURLPolicy) -> Self? {
        Self(address: address, policy: policy, limit: 16 * megabyte, kind: .image)
    }

    public static func attachment(_ media: ChatMedia, policy: MediaURLPolicy) -> Self? {
        let limit: Int64
        let address: String
        let kind: Kind
        switch media.kind {
        case 103:
            kind = .audio
            limit = 32 * megabyte
            address = policy.original(media.url)
        case 104:
            kind = .video
            limit = 20 * megabyte
            address = policy.playback(media.url)
        case 105:
            kind = .file
            limit = 5 * megabyte
            address = policy.original(media.url)
        default:
            return nil
        }
        return Self(address: address, policy: policy, limit: limit, kind: kind)
    }

    public static func prefetch(_ items: [ChatTextItem], policy: MediaURLPolicy, scope: RecentChatMediaScope, now: Date) -> [RecentChatMediaJob] {
        var seen = Set<String>()
        let cutoff = now.timeIntervalSince1970 - scope.lifetime
        func timestamp(_ item: ChatTextItem) -> TimeInterval {
            item.timestamp < 10_000_000_000 ? Double(item.timestamp) : Double(item.timestamp) / 1000
        }
        return items.reversed().lazy.filter { item in
            guard item.status == 2, let kind = item.media?.kind, (102...105).contains(kind), item.timestamp > 0 else { return false }
            return timestamp(item) > cutoff
        }.prefix(200).flatMap { item -> [RecentChatMediaJob] in
            guard let media = item.media else { return [] }
            var resources: [Self] = []
            if media.kind == 102 || media.kind == 104 {
                let thumbnail = media.thumbnail.isEmpty && media.kind == 102 ? media.url : media.thumbnail
                if let image = image(policy.image(thumbnail, variant: .list), policy: policy) { resources.append(image) }
            }
            if media.kind == 102 {
                if let image = image(policy.original(media.url), policy: policy) { resources.append(image) }
            } else if let body = attachment(media, policy: policy), media.kind == 103 || (media.byteCount.map { $0 > 0 && $0 <= body.limit } ?? false) {
                resources.append(body)
            }
            let expiry = Date(timeIntervalSince1970: timestamp(item) + scope.lifetime)
            return resources.compactMap { resource in
                guard seen.insert(resource.identity).inserted else { return nil }
                return RecentChatMediaJob(resource: resource, expiresAt: expiry)
            }
        }
    }
}
