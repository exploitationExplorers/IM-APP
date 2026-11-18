import Foundation

/// 引用卡片的展示值。SDK 字段及旧端 content 在此边界统一解析。
public struct MessageQuoteReference: Equatable, Sendable {
    public let id: String
    public let sender: String
    public let summary: String
    public let image: String
    public let replyText: String

    public init?(serialized: String) {
        guard let root = MessagePayload.object(serialized) else { return nil }
        let type = MessagePayload.number(root, "contentType")
        guard [106, 114].contains(type) else { return nil }
        let key = type == 106 ? "atTextElem" : "quoteElem"
        let stored = MessagePayload.object(MessagePayload.value(root, "content")) ?? [:]
        let candidates = [MessagePayload.object(MessagePayload.value(root, key)),
                          MessagePayload.object(MessagePayload.value(stored, key)), stored].compactMap { $0 }
        guard let element = candidates.first(where: {
            MessagePayload.object(MessagePayload.value($0, "quoteMessage")) != nil
        }), let quoted = MessagePayload.object(MessagePayload.value(element, "quoteMessage")) else { return nil }
        let messageID = MessagePayload.text(quoted, "clientMsgID")
        guard !messageID.isEmpty else { return nil }
        id = messageID
        sender = MessagePayload.text(quoted, "senderNickname")
        replyText = MessagePayload.text(element, "text")
        let quotedType = MessagePayload.number(quoted, "contentType")
        let quotedContent = MessagePayload.object(MessagePayload.value(quoted, "content")) ?? [:]
        let text = MessagePayload.object(MessagePayload.value(quoted, "textElem"))
            ?? MessagePayload.object(MessagePayload.value(quotedContent, "textElem")) ?? quotedContent
        let rawText = MessagePayload.text(text, "content")
        let previews = [102: "[图片]", 103: "[语音]", 104: "[视频]", 105: "[文件]", 107: "[聊天记录]", 108: "[名片]"]
        summary = previews[quotedType] ?? (!rawText.isEmpty ? rawText
            : (quotedType == 101 ? MessagePayload.text(quoted, "content") : "[消息]"))
        image = Self.thumbnail(type: quotedType, root: quoted, stored: quotedContent)
    }

    private static func thumbnail(type: Int, root: [String: Any], stored: [String: Any]) -> String {
        let key = type == 102 ? "pictureElem" : "videoElem"
        let candidates = [MessagePayload.object(MessagePayload.value(root, key)),
                          MessagePayload.object(MessagePayload.value(stored, key)), stored].compactMap { $0 }
        if type == 102 {
            for value in candidates {
                for field in ["snapshotPicture", "bigPicture", "sourcePicture"] {
                    guard let picture = MessagePayload.object(MessagePayload.value(value, field)) else { continue }
                    if let url = remote(MessagePayload.text(picture, "url")) { return url }
                }
            }
        } else if type == 104 {
            for value in candidates {
                for field in ["snapshotUrl", "snapshotURL", "snapshot_url", "coverUrl", "thumbUrl", "snapshotPath"] {
                    if let url = remote(MessagePayload.text(value, field)) { return url }
                }
            }
        }
        return ""
    }

    /// 接收者绝不能加载发送者本机路径；签名查询参数保持原样。
    private static func remote(_ value: String) -> String? {
        guard let url = URLComponents(string: value), url.user == nil, url.password == nil else { return nil }
        if ["https", "http"].contains(url.scheme?.lowercased() ?? ""), url.host?.isEmpty == false { return value }
        if url.scheme == nil, value.hasPrefix("/object/") || value.hasPrefix("/api/") { return value }
        return nil
    }
}
