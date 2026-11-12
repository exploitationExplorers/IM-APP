import Foundation

public struct SampleMessage: Identifiable, Equatable, Sendable {
    public let id: UUID
    public let text: String
    public let isMine: Bool
}

/// 内存样例只供 UI 验证，无网络、无 SDK、无“已送达”状态。
public actor LocalSampleConversation {
    private var messages: [SampleMessage] = [
        SampleMessage(id: UUID(), text: "这是本机样例会话，不会发送到服务器。", isMine: false)
    ]

    public init() {}

    public func snapshot() -> [SampleMessage] { messages }

    @discardableResult
    public func append(_ text: String) -> [SampleMessage] {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return messages }
        messages.append(SampleMessage(id: UUID(), text: trimmed, isMine: true))
        return messages
    }

    public func clear() { messages.removeAll() }
}
