import Foundation

/// A display-only projection. SDK history owns message state, actions, and pagination.
public struct GroupHistoryPreviewReply: Decodable, Sendable {
    private let previewOnly: Bool?
    private let items: [Page]
    private struct Page: Decodable, Sendable {
        let conversationId: String
        let messages: [Message]
    }
    private struct Message: Decodable, Sendable {
        let clientMsgId: String
        let sendId: String
        let senderNickname: String
        let contentType: Int
        let sendTime: Int64
        let seq: Int
        let preview: String
    }

    public func pages(for requested: [String: Int], limit: Int) -> [String: [ChatTextItem]] {
        guard previewOnly == true, limit > 0 else { return [:] }
        var pages: [String: [ChatTextItem]] = [:]
        for page in items {
            guard let end = requested[page.conversationId], end > 0, pages[page.conversationId] == nil else { continue }
            var seen = Set<String>()
            pages[page.conversationId] = page.messages.suffix(limit).compactMap { message in
                guard message.contentType == 101, message.sendTime > 0, message.seq <= end,
                      message.seq >= max(1, end - (limit - 1)), !message.clientMsgId.isEmpty,
                      !message.sendId.isEmpty, !message.preview.isEmpty, seen.insert(message.clientMsgId).inserted else { return nil }
                return ChatTextItem(id: message.clientMsgId, senderID: message.sendId, text: message.preview,
                    timestamp: message.sendTime, status: 2, seq: message.seq, senderName: message.senderNickname)
            }
        }
        return pages
    }
}
