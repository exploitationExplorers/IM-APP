import Foundation
import IMCore

/// 账号级转发用例：持久化幂等批次、提交、核对结果与图片缓存重绑。
/// 不拥有 SDK；生命周期及账号代次由 NativeIMService 注入。
@MainActor
final class NativeForwardDeliveryCoordinator {
    private let context: NativeBusinessContext
    private let ledger: ForwardSubmissionLedger
    private let ownerIsActive: () -> Bool
    private let onChange: () -> Void
    private var tasks: [String: Task<Void, Never>] = [:]
    private var notices: [String: String] = [:]
    private var stopped = false

    init(context: NativeBusinessContext, accountDirectory: URL,
         ownerIsActive: @escaping () -> Bool, onChange: @escaping () -> Void) {
        self.context = context
        ledger = ForwardSubmissionLedger(file: accountDirectory.appendingPathComponent("outbox/forward-submissions.json"))
        self.ownerIsActive = ownerIsActive
        self.onChange = onChange
    }

    func submissions() async throws -> [NativeForwardSubmission] {
        try requireActive()
        let rows = try await ledger.submissions()
        try requireActive()
        return rows
    }

    func save(_ submission: NativeForwardSubmission) async throws {
        try requireActive()
        try await ledger.save(submission)
        try requireActive()
    }

    func isRunning(_ key: String) -> Bool { tasks[key] != nil }

    func takeNotice(in conversationID: String) -> String? {
        notices.removeValue(forKey: conversationID)
    }

    func stop() async {
        stopped = true
        tasks.values.forEach { $0.cancel() }
        tasks.removeAll()
        notices.removeAll()
        await ledger.stop()
    }

    func dispatch(_ submission: NativeForwardSubmission) {
        guard !stopped, ownerIsActive(), tasks[submission.key] == nil else { return }
        tasks[submission.key] = Task { [weak self] in
            guard let self = self else { return }
            defer { self.tasks[submission.key] = nil }
            do {
                try self.requireActive()
                guard try await self.submissions().contains(where: { $0.key == submission.key && $0.body == submission.body }) else {
                    throw APIError.invalidResponse
                }
                let cacheEpoch = await NativeImageCache.shared.mutationEpoch()
                try self.requireActive()
                let accepted: NativeForwardAccepted = try await self.context.request("forward-batches", method: "POST", body: submission.body)
                try self.requireActive()
                guard ForwardBatchReceiptPolicy.isAccepted(status: accepted.status, batchID: accepted.batchId, taskIDs: accepted.taskIds),
                      accepted.taskIds.count == Set(submission.messageIDs).count else { throw APIError.invalidResponse }
                try await self.ledger.record(accepted, for: submission)
                try self.requireActive()
                self.onChange()
                // 缓存仅是优化：失败不能推翻已经持久化的服务端受理结果。
                var initial: [String: NativeForwardProgress] = [:]
                do { initial = try await self.rebindImages(submission, accepted: accepted, cacheEpoch: cacheEpoch) }
                catch { try self.requireActive() }
                let outcome = try await self.confirmDelivery(submission, accepted: accepted, initial: initial)
                try self.requireActive()
                self.notices[submission.sourceConversationID] = Self.notice(for: outcome)
                self.onChange()
            } catch {
                guard !self.stopped, self.ownerIsActive(), !Task.isCancelled else { return }
                self.notices[submission.sourceConversationID] = "暂未确认转发结果，请稍后查看聊天记录。"
                self.onChange()
            }
        }
    }

    private func requireActive() throws {
        try Task.checkCancellation()
        guard !stopped, ownerIsActive() else { throw APIError.cancelled }
    }

    private func progress(_ id: String, submission: NativeForwardSubmission) async throws -> NativeForwardProgress {
        try requireActive()
        let result: NativeForwardProgress = try await context.request("forward-task-progress", query: [URLQueryItem(name: "taskId", value: id)])
        try requireActive()
        guard result.id == id, submission.messageIDs.contains(result.sourceClientMsgId) else { throw APIError.invalidResponse }
        return result
    }

    private func confirmDelivery(_ submission: NativeForwardSubmission, accepted: NativeForwardAccepted,
                                 initial: [String: NativeForwardProgress]) async throws -> ForwardBatchReceiptPolicy.DeliveryState {
        var remaining = Set(accepted.taskIds)
        var deliveredSources = Set<String>()
        let deadline = Date().addingTimeInterval(30)
        for attempt in 0..<30 {
            for id in remaining.sorted() {
                try requireActive()
                guard Date() < deadline else { return .unconfirmed }
                let result: NativeForwardProgress
                if attempt == 0, let cached = initial[id] { result = cached }
                else { result = try await progress(id, submission: submission) }
                switch result.deliveryState {
                case .success:
                    remaining.remove(id)
                    deliveredSources.insert(result.sourceClientMsgId)
                case .failure: return .failure
                case .unconfirmed: return .unconfirmed
                case .pending: break
                }
            }
            if remaining.isEmpty { return deliveredSources == Set(submission.messageIDs) ? .success : .unconfirmed }
            if attempt < 29 { try await Task.sleep(nanoseconds: 1_000_000_000) }
        }
        return .unconfirmed
    }

    private func rebindImages(_ submission: NativeForwardSubmission, accepted: NativeForwardAccepted,
                              cacheEpoch: UUID) async throws -> [String: NativeForwardProgress] {
        guard case .array(let sources)? = submission.body["messages"] else { return [:] }
        var originals: [String: ForwardMessageSnapshot] = [:]
        var initial: [String: NativeForwardProgress] = [:]
        for value in sources {
            guard case .object(let row) = value, case .string(let id)? = row["sourceClientMsgId"],
                  let snapshot = row["sourceSnapshot"], submission.messageIDs.contains(id) else { continue }
            originals[id] = try JSONDecoder().decode(ForwardMessageSnapshot.self, from: JSONEncoder().encode(snapshot))
        }
        let policy = context.media
        for id in accepted.taskIds {
            let result = try await progress(id, submission: submission)
            initial[id] = result
            guard let original = originals[result.sourceClientMsgId] else { continue }
            for (source, archived) in original.imageCopies(to: result.sourceSnapshot) {
                guard policy.absolute(source)?.scheme == "https", policy.absolute(archived)?.scheme == "https" else { continue }
                for variant in [MediaURLPolicy.Variant.list, .preview] {
                    try requireActive()
                    await NativeImageCache.shared.aliasCached(from: policy.cacheIdentity(policy.image(source, variant: variant)),
                        to: policy.cacheIdentity(policy.image(archived, variant: variant)), expectedEpoch: cacheEpoch)
                    try requireActive()
                }
            }
        }
        return initial
    }

    private static func notice(for state: ForwardBatchReceiptPolicy.DeliveryState) -> String {
        switch state {
        case .success: return "转发成功"
        case .failure: return "有消息转发失败，请重试。"
        case .pending, .unconfirmed: return "转发结果尚未确认，请稍后查看聊天记录。"
        }
    }
}
