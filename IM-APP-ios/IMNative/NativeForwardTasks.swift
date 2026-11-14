import UIKit
import IMCore

private struct NativeForwardTask: Decodable {
    let id: String; let status: String; let targetCount: Int; let successCount: Int; let failedCount: Int
    let skippedCount: Int; let pendingCount: Int; let processingCount: Int; let createdAt: String
}
private struct NativeForwardTarget: Decodable { let id: String; let targetUserId: String; let status: String; let failureMessage: String? }
struct NativeForwardAccepted: Codable { let batchId: String; let taskIds: [String]; let status: String }
struct NativeForwardProgress: Decodable {
    let id: String; let status: String; let sourceClientMsgId: String; let sourceSnapshot: ForwardMessageSnapshot
    let targetCount: Int; let successCount: Int; let failedCount: Int; let skippedCount: Int; let cancelledCount: Int; let pendingCount: Int; let processingCount: Int
    var deliveryState: ForwardBatchReceiptPolicy.DeliveryState {
        ForwardBatchReceiptPolicy.deliveryState(status: status, targetCount: targetCount, successCount: successCount, failedCount: failedCount, skippedCount: skippedCount, cancelledCount: cancelledCount, pendingCount: pendingCount, processingCount: processingCount)
    }
}
struct NativeForwardSubmission: Codable {
    let key: String; let sourceConversationID: String; let messageIDs: [String]; let body: [String: JSONValue]; let createdAt: Date
    var accepted: NativeForwardAccepted?
}
private func nativeForwardStatus(_ status: String) -> String { ["draft": "草稿", "expanding": "生成接收对象", "pending": "等待发送", "processing": "发送中", "completed": "已完成", "partially_completed": "部分完成", "failed": "失败", "paused": "已暂停", "cancelled": "已取消", "retrying": "等待重试", "success": "成功", "skipped": "已跳过"][status] ?? "状态待核对" }

@MainActor
final class NativeForwardTasksController: NativeBusinessListController {
    private let taskIDs: [String]?
    private let service: NativeIMService?
    private var localPending: [NativeForwardSubmission] = []
    private var tasks: [NativeForwardTask] = []; private var cursor: String?
    init(context: NativeBusinessContext, taskIDs: [String]? = nil, service: NativeIMService? = nil) { self.taskIDs = taskIDs; self.service = service; super.init(title: "转发任务", context: context) }
    required init?(coder: NSCoder) { fatalError("不使用 Storyboard") }
    override func reloadContent() { load(reset: true) }
    private func load(reset: Bool) {
        perform { [self] in
            if reset, let service = service {
                localPending = try service.forwardSubmissionsData().map { try JSONDecoder().decode([NativeForwardSubmission].self, from: $0) }?.filter { $0.accepted == nil } ?? []
                render(hasMore: false)
            }
            if let ids = taskIDs { var results: [NativeForwardTask] = []; for id in ids { results.append(try await context.request("forward-task-progress", query: [URLQueryItem(name: "taskId", value: id)])) }; tasks = results; render(hasMore: false) }
            else {
                var query = [URLQueryItem(name: "limit", value: "40")]; if !reset, let cursor = cursor { query.append(URLQueryItem(name: "cursor", value: cursor)) }
                let page: NativePage<NativeForwardTask> = try await context.request("forward-tasks", query: query); if reset { tasks = [] }; tasks += page.items; cursor = page.nextCursor; render(hasMore: page.hasMore)
            }
        }
    }
    private func render(hasMore: Bool) {
        var rows = localPending.map { pending in NativeBusinessRow(title: "本机转发 · \(pending.messageIDs.count) 条消息", detail: service?.forwardIsRunning(pending.key) == true ? "发送中" : "结果待核对 · 点此继续核对", action: { [weak self] in guard let self = self, let service = self.service, !service.forwardIsRunning(pending.key) else { return }; self.confirm("使用已保存的同一批次号核对提交，不新建重复任务。", destructiveTitle: "核对") { service.dispatchForwardInBackground(pending); self.reloadContent() } }) }
        rows += tasks.map { item in NativeBusinessRow(title: nativeForwardStatus(item.status), detail: "成功 \(item.successCount)/\(item.targetCount) · 待处理 \(item.pendingCount + item.processingCount) · 失败 \(item.failedCount)", action: { [weak self] in self?.actions(item) }) }
        if hasMore { rows.append(NativeBusinessRow(title: "加载更多", action: { [weak self] in self?.load(reset: false) })) }; setRows([rows])
    }
    private func actions(_ task: NativeForwardTask) {
        let sheet = UIAlertController(title: "转发任务", message: "\(nativeForwardStatus(task.status)) · \(task.createdAt)", preferredStyle: .actionSheet)
        sheet.addAction(UIAlertAction(title: "查看接收状态", style: .default) { [weak self] _ in guard let self = self else { return }; self.push(NativeForwardTargetsController(context: self.context, taskID: task.id)) })
        let actions: [(String, String)] = task.status == "paused" ? [("继续", "resume"), ("取消任务", "cancel")] : ["draft", "expanding", "pending", "processing"].contains(task.status) ? [("暂停", "pause"), ("取消任务", "cancel")] : task.failedCount > 0 ? [("仅重试失败对象", "retry")] : []
        for (title, action) in actions {
            sheet.addAction(UIAlertAction(title: title, style: action == "cancel" ? .destructive : .default) { [weak self] _ in guard let self = self else { return }; self.confirm("确认\(title)？", destructiveTitle: "确认") { self.perform { var body: [String: JSONValue] = ["taskId": .string(task.id)]; if action == "retry" { body["onlyFailed"] = .bool(true) }; try await self.context.change("forward-tasks/\(action)", body: body); self.scheduleReload() } } })
        }
        sheet.addAction(UIAlertAction(title: "关闭", style: .cancel)); sheet.popoverPresentationController?.sourceView = tableView; present(sheet, animated: true)
    }
}

@MainActor
private final class NativeForwardTargetsController: NativeBusinessListController {
    private let taskID: String; private var items: [NativeForwardTarget] = []; private var cursor: String?
    init(context: NativeBusinessContext, taskID: String) { self.taskID = taskID; super.init(title: "接收状态", context: context) }
    required init?(coder: NSCoder) { fatalError("不使用 Storyboard") }
    override func reloadContent() { load(reset: true) }
    private func load(reset: Bool) {
        perform { [self] in
            var query = [URLQueryItem(name: "taskId", value: taskID), URLQueryItem(name: "limit", value: "40")]; if !reset, let cursor = cursor { query.append(URLQueryItem(name: "cursor", value: cursor)) }
            let page: NativePage<NativeForwardTarget> = try await context.request("forward-task-targets", query: query); if reset { items = [] }; items += page.items; cursor = page.nextCursor
            var rows = items.map { NativeBusinessRow(title: $0.targetUserId, detail: nativeForwardStatus($0.status) + ($0.failureMessage.map { " · " + $0 } ?? "")) }
            if page.hasMore { rows.append(NativeBusinessRow(title: "加载更多", action: { [weak self] in self?.load(reset: false) })) }; setRows([rows])
        }
    }
}
