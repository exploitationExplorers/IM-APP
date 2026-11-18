import Foundation

/// 已持久化的引用消息在真正发送前保护媒体；不创建新消息、不改变发送 ID。
public enum QuoteMessagePreparation {
    public static func prepare(
        serialized: String,
        mediaPolicy: MediaURLPolicy,
        preserve: @MainActor @Sendable (ForwardMessageSnapshot) async throws -> ForwardMessageSnapshot
    ) async throws -> String {
        guard let root = MessagePayload.object(serialized) else { throw APIError.invalidResponse }
        let type = MessagePayload.number(root, "contentType")
        guard [106, 114].contains(type) else { return serialized }
        guard MessageQuoteReference(serialized: serialized) != nil else {
            if type == 106 { return serialized } // 无引用的普通 @ 消息。
            throw APIError.invalidResponse
        }
        try Task.checkCancellation()
        let snapshot = try ForwardMessageSnapshot.make(serialized: serialized, mediaPolicy: mediaPolicy)
        let protected = try await preserve(snapshot)
        try Task.checkCancellation()
        return try protected.applying(to: serialized)
    }
}
