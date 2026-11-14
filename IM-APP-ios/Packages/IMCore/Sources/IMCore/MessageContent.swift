import Foundation

/// 同时兼容旧收藏中的裸地址与聊天消息 JSON 快照。
public struct FavoriteContent: Equatable, Sendable {
    public let url: String
    public let thumbnail: String
    public let filename: String
    public let duration: Int
    public init(type: String, content: String) {
        let root = (content.data(using: .utf8).flatMap { try? JSONSerialization.jsonObject(with: $0) }) as? [String: Any] ?? [:]
        func text(_ keys: [String]) -> String {
            for key in keys { if let value = root[key] as? String, !value.isEmpty { return value } }
            return ""
        }
        var value = text(["url", "path", "sourceUrl", "sourceURL", "videoUrl", "VideoUrl", "fileUrl", "FileUrl", "soundUrl", "SoundUrl"])
        if value.isEmpty, let picture = root["sourcePicture"] as? [String: Any] ?? root["SourcePicture"] as? [String: Any] { value = (picture["url"] ?? picture["URL"]) as? String ?? "" }
        if value.isEmpty, root.isEmpty, type != "text" { value = content.trimmingCharacters(in: .whitespacesAndNewlines) }
        url = value
        thumbnail = text(["snapshotUrl", "snapshotPath", "SnapshotUrl", "thumbnailUrl"])
        filename = text(["name", "filename", "fileName", "FileName"])
        duration = (root["duration"] as? NSNumber)?.intValue ?? (root["duration"] as? String).flatMap(Int.init) ?? 0
    }
    public static func snapshot(type: String, media: ChatMedia?, text: String) throws -> String {
        guard let media = media else { return text }
        guard !media.url.isEmpty, !media.url.hasPrefix("file:") else { throw APIError.business(code: -1, message: "媒体尚未上传完成，暂不能收藏。") }
        if type == "image" { return media.url }
        var body: [String: Any] = ["url": media.url, "duration": media.duration]
        if type == "voice" { body["path"] = media.url }
        if !media.thumbnail.isEmpty { body["snapshotUrl"] = media.thumbnail }
        if !media.filename.isEmpty { body["name"] = media.filename }
        return String(decoding: try JSONSerialization.data(withJSONObject: body, options: [.sortedKeys]), as: UTF8.self)
    }
}

/// 扫码只解析业务数据；扫码 URL 永远不会被当成网页直接打开。
public struct QRBusinessPayload: Equatable, Sendable {
    public let raw: String
    public let kind: String?
    public let token: String?
    public let publicID: String?
    public init(_ input: String) {
        raw = input.trimmingCharacters(in: .whitespacesAndNewlines)
        if let data = raw.data(using: .utf8), let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] {
            kind = json["type"] as? String; token = json["token"] as? String; publicID = json["publicId"] as? String
        } else if let components = URLComponents(string: raw), ["http", "https"].contains(components.scheme?.lowercased() ?? "") {
            let query = components.queryItems ?? []
            let type = query.first(where: { $0.name == "qrcodetype" })?.value
            kind = type == "u" ? "user" : type == "g" ? "group" : nil
            token = query.first(where: { $0.name == "qrcode" })?.value; publicID = nil
        } else { kind = nil; token = raw.isEmpty ? nil : raw; publicID = nil }
    }
    public var requestBody: [String: JSONValue] {
        var body: [String: JSONValue] = ["token": .string(token ?? raw), "payload": .string(raw)]
        if raw.lowercased().hasPrefix("http") { body["qrcode"] = .string(raw) }
        return body
    }
}

public struct ForwardMessageSnapshot: Codable, Equatable, Sendable {
    public let contentType: Int
    public let content: JSONValue
    public var body: JSONValue { .object(["contentType": .number(Double(contentType)), "content": content]) }
    /// 同一已确认转发任务的同字段 URL 对应关系；不跨原图、缩略图规格猜测字节相同。
    public func imageCopies(to archived: ForwardMessageSnapshot) -> [(source: String, destination: String)] {
        guard contentType == 102, archived.contentType == 102,
              case .object(let source) = content, case .object(let destination) = archived.content else { return [] }
        var copies: [(source: String, destination: String)] = []
        for key in ["sourcePicture", "bigPicture", "snapshotPicture"] {
            guard case .object(let from)? = source[key], case .object(let to)? = destination[key],
                  case .string(let original)? = from["url"], case .string(let rewritten)? = to["url"], !original.isEmpty, !rewritten.isEmpty else { continue }
            copies.append((original, rewritten))
        }
        return copies
    }
    public static func make(serialized: String, mediaPolicy: MediaURLPolicy? = nil) throws -> Self {
        guard let data = serialized.data(using: .utf8), let root = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { throw APIError.invalidResponse }
        return try build(root, depth: 0, mediaPolicy: mediaPolicy)
    }
    private static func build(_ raw: [String: Any], depth: Int, mediaPolicy: MediaURLPolicy?) throws -> Self {
        guard depth <= 6 else { throw APIError.business(code: -1, message: "引用消息层级过深，无法转发。") }
        let root = normalize(raw)
        let type = (root["contentType"] as? NSNumber)?.intValue ?? 0
        let keys = [101: "textElem", 102: "pictureElem", 103: "soundElem", 104: "videoElem", 105: "fileElem", 106: "atTextElem", 107: "mergeElem", 108: "cardElem", 109: "locationElem", 110: "customElem", 114: "quoteElem", 115: "faceElem", 117: "advancedTextElem"]
        guard let key = keys[type] else { throw APIError.business(code: -1, message: "该消息不支持转发。") }
        var element = root[key] as? [String: Any]
        if element?.isEmpty != false, let text = root["content"] as? String, let data = text.data(using: .utf8) { element = ((try? JSONSerialization.jsonObject(with: data)) as? [String: Any]).map(normalize) }
        guard var content = element else { throw APIError.invalidResponse }
        // 服务端任务永远不读取本机路径；媒体必须已经有服务端地址。
        for key in ["sourcePath", "soundPath", "videoPath", "snapshotPath", "filePath"] where content[key] != nil { content[key] = "" }
        if [103, 105].contains(type) { guard let url = content["sourceUrl"] as? String, !url.isEmpty, !url.hasPrefix("file:") else { throw APIError.business(code: -1, message: "媒体尚未上传完成，暂不能转发。") } }
        if type == 104 { guard let url = content["videoUrl"] as? String, !url.isEmpty, !url.hasPrefix("file:") else { throw APIError.business(code: -1, message: "视频尚未上传完成，暂不能转发。") } }
        if type == 102 {
            // 旧 App 消息可能仅包含 bigPicture；不把发送者设备路径当成远程原图。
            let candidates = ["sourcePicture", "bigPicture", "snapshotPicture"].compactMap { content[$0] as? [String: Any] }
            guard var picture = candidates.first(where: { value in
                guard let text = value["url"] as? String, let url = URLComponents(string: text), url.user == nil, url.password == nil else { return false }
                if let resolved = mediaPolicy?.absolute(text) { return resolved.scheme?.lowercased() == "https" }
                return (url.scheme?.lowercased() == "https" && url.host?.isEmpty == false) || (url.scheme == nil && text.hasPrefix("/") && !text.hasPrefix("//"))
            }), let url = picture["url"] as? String else { throw APIError.business(code: -1, message: "图片尚未上传完成，暂不能转发。") }
            // 与旧端转发快照一致，原图去除已知的旧缩略图加工前缀，绝不改未知签名。
            if let policy = mediaPolicy { picture["url"] = policy.original(url) }
            let fallbackType = candidates.compactMap { ($0["type"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) }.first { !$0.isEmpty } ?? "image/jpeg"
            func complete(_ value: [String: Any]) -> [String: Any] {
                var result = value
                if (result["type"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty != false { result["type"] = fallbackType }
                return result
            }
            picture = complete(picture)
            content["sourcePicture"] = picture
            // OpenIM 服务端要求每个规格都有 type/url；保留已有缩略图与尺寸，缺失规格才回退原图。
            for key in ["bigPicture", "snapshotPicture"] {
                if let value = content[key] as? [String: Any], let remote = value["url"] as? String, !remote.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { content[key] = complete(value) }
                else { content[key] = picture }
            }
        }
        func embedded(_ value: [String: Any]) throws -> [String: Any] {
            let value = normalize(value), snapshot = try build(value, depth: depth + 1, mediaPolicy: mediaPolicy)
            let contentData = try JSONEncoder().encode(snapshot.content)
            var result = value; result["contentType"] = snapshot.contentType; result["content"] = String(decoding: contentData, as: UTF8.self)
            let elementKeys = [101: "textElem", 102: "pictureElem", 103: "soundElem", 104: "videoElem", 105: "fileElem", 106: "atTextElem", 107: "mergeElem", 108: "cardElem", 109: "locationElem", 110: "customElem", 114: "quoteElem", 115: "faceElem", 117: "advancedTextElem"]
            if let key = elementKeys[snapshot.contentType] { result[key] = try JSONSerialization.jsonObject(with: contentData) }
            return result
        }
        if [106, 114].contains(type), let quoted = content["quoteMessage"] as? [String: Any] { content["quoteMessage"] = try embedded(quoted) }
        if type == 107 {
            var source = content["multiMessage"]
            if let text = source as? String, let data = text.data(using: .utf8) { source = try JSONSerialization.jsonObject(with: data) }
            guard let messages = source as? [[String: Any]], !messages.isEmpty else { throw APIError.invalidResponse }
            content["multiMessage"] = try messages.map(embedded)
        }
        let data = try JSONSerialization.data(withJSONObject: content)
        return Self(contentType: type, content: try JSONDecoder().decode(JSONValue.self, from: data))
    }
    private static func normalize(_ raw: [String: Any]) -> [String: Any] {
        let aliases = ["SourceURL": "sourceUrl", "sourceURL": "sourceUrl", "VideoURL": "videoUrl", "videoURL": "videoUrl", "SnapshotURL": "snapshotUrl", "snapshotURL": "snapshotUrl", "URL": "url", "Url": "url", "UUID": "uuid"]
        var result: [String: Any] = [:]
        for (key, value) in raw {
            let name = aliases[key] ?? key.prefix(1).lowercased() + key.dropFirst()
            if let object = value as? [String: Any] { result[name] = normalize(object) }
            else if let array = value as? [[String: Any]] { result[name] = array.map(normalize) }
            else { result[name] = value }
        }; return result
    }
}

/// 封面几何与播放时长从真实视频元数据读取，兼容旧 App 的 JSON content。
public struct VideoMessageMetadata: Equatable, Sendable {
    public let hasDimensions: Bool
    public let width: Double
    public let height: Double
    public let duration: Int
    public let thumbnail: String
    public let localThumbnail: String
    public init(serialized: String, duration fallbackDuration: Int = 0) {
        let root = MessagePayload.object(serialized) ?? [:]
        let stored = MessagePayload.object(MessagePayload.value(root, "content")) ?? [:]
        let direct = MessagePayload.object(MessagePayload.value(root, "videoElem")) ?? [:]
        let embedded = MessagePayload.object(MessagePayload.value(stored, "videoElem")) ?? stored
        let sources = [direct, embedded]
        func positive(_ key: String) -> Int { sources.map { MessagePayload.number($0, key) }.first { $0 > 0 } ?? 0 }
        let snapshotWidth = positive("snapshotWidth"), snapshotHeight = positive("snapshotHeight")
        let videoWidth = positive("videoWidth"), videoHeight = positive("videoHeight")
        if snapshotWidth > 0, snapshotHeight > 0 { width = Double(snapshotWidth); height = Double(snapshotHeight); hasDimensions = true }
        else if videoWidth > 0, videoHeight > 0 { width = Double(videoWidth); height = Double(videoHeight); hasDimensions = true }
        else { width = 280; height = 210; hasDimensions = false }
        duration = max(0, positive("duration") > 0 ? positive("duration") : fallbackDuration)
        thumbnail = sources.map { MessagePayload.text($0, "snapshotUrl") }.first { !$0.isEmpty } ?? ""
        localThumbnail = sources.map { MessagePayload.text($0, "snapshotPath") }.first { !$0.isEmpty } ?? ""
    }
    public func fitted(maxWidth: Double, maxHeight: Double) -> (width: Double, height: Double) {
        guard maxWidth.isFinite, maxHeight.isFinite, maxWidth > 0, maxHeight > 0 else { return (0, 0) }
        let scale = min(maxWidth / width, maxHeight / height)
        return (width * scale, height * scale)
    }
    public var durationLabel: String { String(format: "%d:%02d", duration / 60, duration % 60) }
    public static func preparedDuration(seconds: Double) throws -> Int {
        guard seconds.isFinite, seconds > 0, seconds.rounded() < Double(Int.max) else { throw APIError.invalidResponse }
        return max(1, Int(seconds.rounded()))
    }
}


/// 仅识别既有业务卡片；未知自定义消息不能触发接口或外部导航。
public struct BusinessMessageCard: Equatable, Sendable {
    public enum Kind: String, Sendable { case invitation = "group_invite", joinRequest = "group_join_request" }
    public let kind: Kind; public let groupID: String; public let groupName: String; public let avatar: String
    public let token: String; public let requestID: String; public let applicantName: String; public let memberCount: Int
    public init?(serialized: String) {
        guard let root = MessagePayload.object(serialized), MessagePayload.number(root, "contentType") == 110 else { return nil }
        let element = MessagePayload.object(MessagePayload.value(root, "customElem")) ?? MessagePayload.object(MessagePayload.value(root, "content")) ?? [:]
        let data = MessagePayload.object(MessagePayload.value(element, "data")) ?? element
        guard let kind = Kind(rawValue: MessagePayload.text(data, "businessKey")) else { return nil }
        let id = MessagePayload.text(data, "groupId"); guard !id.isEmpty, id.rangeOfCharacter(from: CharacterSet(charactersIn: "/?#\\")) == nil else { return nil }
        let token = MessagePayload.text(data, "token"), request = MessagePayload.text(data, "requestId")
        guard kind == .invitation ? !token.isEmpty : !request.isEmpty else { return nil }
        self.kind = kind; groupID = id; self.token = token; requestID = request
        let name = MessagePayload.text(data, "groupName"); groupName = name.isEmpty ? "群聊" : name
        avatar = MessagePayload.text(data, kind == .invitation ? "groupAvatar" : "applicantAvatar")
        applicantName = MessagePayload.text(data, "applicantNickname"); memberCount = MessagePayload.number(data, "memberCount")
    }
    public var title: String { kind == .invitation ? "邀请你加入群聊" : "入群申请" }
    public var summary: String { kind == .invitation ? "\(groupName)（\(memberCount)人）" : "\(applicantName.isEmpty ? "申请人" : applicantName)申请加入“\(groupName)”" }
    public var actionTitle: String { kind == .invitation ? "申请加入" : "查看申请" }
}

public struct MessageQuoteReference: Equatable, Sendable {
    public let id: String; public let sender: String; public let summary: String; public let image: String
    public init?(serialized: String) {
        guard let root = MessagePayload.object(serialized) else { return nil }
        let type = MessagePayload.number(root, "contentType"); guard [106, 114].contains(type) else { return nil }
        let element = MessagePayload.object(MessagePayload.value(root, type == 106 ? "atTextElem" : "quoteElem")) ?? MessagePayload.object(MessagePayload.value(root, "content")) ?? [:]
        guard let quoted = MessagePayload.object(MessagePayload.value(element, "quoteMessage")) else { return nil }
        let id = MessagePayload.text(quoted, "clientMsgID"); guard !id.isEmpty else { return nil }; self.id = id
        sender = MessagePayload.text(quoted, "senderNickname")
        let quotedType = MessagePayload.number(quoted, "contentType")
        let content = MessagePayload.object(MessagePayload.value(quoted, "content")) ?? [:]
        let text = MessagePayload.object(MessagePayload.value(quoted, "textElem")) ?? content
        let rawText = MessagePayload.text(text, "content")
        let previews = [102: "[图片]", 103: "[语音]", 104: "[视频]", 105: "[文件]", 107: "[聊天记录]", 108: "[名片]"]
        summary = previews[quotedType] ?? (!rawText.isEmpty ? rawText : (quotedType == 101 ? MessagePayload.text(quoted, "content") : "[消息]"))
        let picture = MessagePayload.object(MessagePayload.value(quoted, "pictureElem")) ?? (quotedType == 102 ? content : [:])
        let source = MessagePayload.object(MessagePayload.value(picture, "sourcePicture")) ?? [:]
        let video = MessagePayload.object(MessagePayload.value(quoted, "videoElem")) ?? (quotedType == 104 ? content : [:])
        image = quotedType == 102 ? MessagePayload.text(source, "url") : MessagePayload.text(video, "snapshotUrl")
    }
}

private enum MessagePayload {
    static func object(_ raw: Any?) -> [String: Any]? { if let value = raw as? [String: Any] { return value }; guard let text = raw as? String, let data = text.data(using: .utf8) else { return nil }; return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] }
    static func value(_ data: [String: Any], _ key: String) -> Any? { let aliases = ["clientMsgID": ["ClientMsgID", "clientMsgId"], "groupId": ["GroupID", "groupID"], "requestId": ["RequestID"], "url": ["URL", "Url"], "snapshotUrl": ["SnapshotURL", "snapshotURL"]]; for candidate in [key, key.prefix(1).uppercased() + key.dropFirst()] + (aliases[key] ?? []) { if let value = data[candidate] { return value } }; return nil }
    static func text(_ data: [String: Any], _ key: String) -> String { (value(data, key) as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines) }
    static func number(_ data: [String: Any], _ key: String) -> Int { (value(data, key) as? NSNumber)?.intValue ?? (value(data, key) as? String).flatMap(Int.init) ?? 0 }
}

/// 菜单按消息真实类型选择能力，图片不会复制“[图片]”占位文字。
public struct MessageMenuCapabilities: Equatable, Sendable {
    public let copyText: Bool
    public let saveImage: Bool
    public let saveVideo: Bool
    public let addSticker: Bool
    public let forward: Bool
    public let quote: Bool
    public let favorite: Bool
    public let pin: Bool
    public let multiSelect: Bool
    private let recallable: Bool
    public init(contentType: Int, status: Int) {
        let available = status != 4 && contentType < 1000
        copyText = available && [101, 106, 114, 117].contains(contentType)
        saveImage = available && contentType == 102
        saveVideo = available && contentType == 104
        addSticker = saveImage
        forward = available && status == 2 && [101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 114, 115, 117].contains(contentType)
        quote = available; favorite = available; pin = available && status == 2; multiSelect = available
        recallable = available && status == 2
    }
    public func canRecall(isMine: Bool, canManageSender: Bool) -> Bool { recallable && (isMine || canManageSender) }
}
