import Foundation

/// 仅保留桥接层白名单分类，不携带 SDK 原始正文、账号或请求地址。
public struct OpenIMReadFailure: Equatable, Sendable {
    public enum Reason: String, Sendable {
        case resourceNotReady, notLoggedIn, notInitialized, authentication, kicked
        case storageBusy, storageSchema, storageCorrupt, storageAccess, storageFull
        case timeout, network, unknown
    }
    public let code: Int
    public let reason: Reason
    public let operation: String
    public init?(error: Error) {
        let native = error as NSError
        guard native.domain == "NativeOpenIM" else { return nil }
        code = native.code
        reason = Reason(rawValue: native.userInfo["NativeIMReason"] as? String ?? "") ?? (code == 10004 ? .resourceNotReady : .unknown)
        let candidate = native.userInfo["NativeIMOperation"] as? String ?? ""
        operation = ["login", "connection", "conversationSnapshot", "conversationPage"].contains(candidate) ? candidate : "unknown"
    }
    public var canTryPagedSnapshot: Bool { code == 10005 && reason == .unknown && operation == "conversationSnapshot" }
    public var canRetryRead: Bool { reason == .resourceNotReady || reason == .storageBusy }
    public var message: String {
        let description: String
        switch reason {
        case .resourceNotReady: description = "聊天资源正在准备，稍后自动重试"
        case .notLoggedIn: description = "聊天连接尚未登录，点击状态重试连接"
        case .notInitialized: description = "聊天 SDK 未完成初始化，请返回登录页重试"
        case .authentication: description = "聊天凭据失效，请重新登录"
        case .kicked: description = "账号已在其他设备登录，请重新登录"
        case .storageBusy: description = "聊天存储暂忙，稍后自动重试"
        case .storageSchema: description = "聊天存储结构异常，数据已保留，请复制调试资讯"
        case .storageCorrupt: description = "聊天存储读取异常，数据已保留，请复制调试资讯"
        case .storageAccess: description = "聊天存储暂不可访问，请解锁设备后重试"
        case .storageFull: description = "设备存储空间不足，请释放空间后重试"
        case .timeout: description = "聊天读取超时，点击状态重试"
        case .network: description = "聊天网络暂不可用，点击状态重试"
        case .unknown: description = operation == "login" ? "聊天登录失败，点击状态重试连接" : "会话读取失败，点击状态重试"
        }
        return description + "（SDK \(code)）"
    }
}

public struct ConversationReadRetryBudget: Sendable {
    private var startedAt: TimeInterval?
    public private(set) var attempts = 0
    public init() {}
    public mutating func reset() { startedAt = nil; attempts = 0 }
    public mutating func reserve(failure: OpenIMReadFailure, now: TimeInterval) -> TimeInterval? {
        guard failure.canRetryRead else { return nil }
        if startedAt == nil { startedAt = now }
        guard let start = startedAt, now >= start, now - start < 30, attempts < 4 else { return nil }
        let delay = [0.5, 1.0, 2.0, 4.0][attempts]
        attempts += 1
        return delay
    }
}

public enum ConversationSnapshotRead {
    public enum ReadError: LocalizedError {
        case noProgress
        public var errorDescription: String? { "会话分页没有推进，数据已保留，请点击状态重试。" }
    }
    /// 全量调用的未归类错误只尝试一次分页读取；完整结束前不发布部分列表。
    @MainActor
    public static func read<Row>(pageSize: Int, all: () async throws -> [Row], page: (Int, Int) async throws -> [Row], identity: (Row) -> String, onFallback: (OpenIMReadFailure) -> Void = { _ in }) async throws -> [Row] {
        precondition(pageSize > 0)
        do { return try await all() }
        catch {
            guard let failure = OpenIMReadFailure(error: error), failure.canTryPagedSnapshot else { throw error }
            onFallback(failure)
        }
        var rows: [Row] = [], seen = Set<String>(), offset = 0
        while true {
            try Task.checkCancellation()
            let next = try await page(offset, pageSize)
            try Task.checkCancellation()
            let fresh = next.filter { seen.insert(identity($0)).inserted }
            guard next.isEmpty || !fresh.isEmpty else { throw ReadError.noProgress }
            rows.append(contentsOf: fresh)
            if next.count < pageSize { return rows }
            offset += next.count
        }
    }
}
