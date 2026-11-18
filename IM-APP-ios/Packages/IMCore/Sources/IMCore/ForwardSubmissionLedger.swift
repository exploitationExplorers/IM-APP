import Foundation

public struct ForwardAccepted: Codable, Equatable, Sendable {
    public let batchId: String
    public let taskIds: [String]
    public let status: String

    public init(batchId: String, taskIds: [String], status: String) {
        self.batchId = batchId
        self.taskIds = taskIds
        self.status = status
    }
}

public struct ForwardSubmission: Codable, Equatable, Sendable {
    public let key: String
    public let sourceConversationID: String
    public let messageIDs: [String]
    public let body: [String: JSONValue]
    public let createdAt: Date
    public var accepted: ForwardAccepted?

    public init(key: String, sourceConversationID: String, messageIDs: [String], body: [String: JSONValue],
                createdAt: Date, accepted: ForwardAccepted? = nil) {
        self.key = key
        self.sourceConversationID = sourceConversationID
        self.messageIDs = messageIDs
        self.body = body
        self.createdAt = createdAt
        self.accepted = accepted
    }
}

/// 自有转发日志的独立串行 IO 边界；延续旧 JSON 格式，不读写 SDK 历史库。
public actor ForwardSubmissionLedger {
    private let file: URL
    private var stopped = false

    public init(file: URL) { self.file = file }

    public func submissions() throws -> [ForwardSubmission] {
        try requireActive()
        guard FileManager.default.fileExists(atPath: file.path) else { return [] }
        return try JSONDecoder().decode([ForwardSubmission].self, from: Data(contentsOf: file))
    }

    public func save(_ submission: ForwardSubmission) throws {
        var rows = try submissions()
        if let previous = rows.first(where: { $0.key == submission.key }) {
            guard previous.body == submission.body else { throw APIError.invalidResponse }
            return
        }
        guard rows.filter({ $0.accepted == nil }).count < 200 else {
            throw APIError.business(code: -1, message: "未确认的转发较多，请稍后重试。")
        }
        rows = rows.filter { $0.accepted == nil } + rows.filter { $0.accepted != nil }.suffix(100)
        rows.append(submission)
        try write(rows)
    }

    public func record(_ accepted: ForwardAccepted, for submission: ForwardSubmission) throws {
        var rows = try submissions()
        guard let index = rows.firstIndex(where: { $0.key == submission.key && $0.body == submission.body }) else {
            throw APIError.invalidResponse
        }
        rows[index].accepted = accepted
        try write(rows)
    }

    /// 由账号退出流程等待；返回后该实例不再接受旧任务的迟到写入。
    public func stop() { stopped = true }

    private func write(_ rows: [ForwardSubmission]) throws {
        try requireActive()
        try JSONEncoder().encode(rows).write(to: file, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }

    private func requireActive() throws {
        try Task.checkCancellation()
        guard !stopped else { throw APIError.cancelled }
    }
}
