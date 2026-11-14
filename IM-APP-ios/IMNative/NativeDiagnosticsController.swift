import UIKit
import IMCore

@MainActor
final class NativeDiagnosticsController: NativeBusinessListController {
    private let service: NativeIMService
    init(service: NativeIMService) { self.service = service; super.init(title: "调试资讯", context: service.business) }
    required init?(coder: NSCoder) { fatalError("不使用 Storyboard") }
    override func reloadContent() {
        let groups = Dictionary(grouping: service.outboxEntries, by: { $0.state.rawValue })
        var status = [NativeBusinessRow(title: "客户端", detail: "iOS 原生 0.3.0"), NativeBusinessRow(title: "聊天 SDK", detail: "3.8.3-hotfix.15"), NativeBusinessRow(title: "当前状态", detail: service.statusText), NativeBusinessRow(title: "已载入会话", detail: "\(service.conversations.count)")]
        if let code = service.lastSendErrorCode { status.append(NativeBusinessRow(title: "最近发送错误码", detail: "SDK \(code)")) }
        let labels = ["prepared": "已保存待发", "sending": "发送中", "accepted": "已受理", "uncertain": "结果待核对", "failed": "明确未发送"]
        status += groups.keys.sorted().map { NativeBusinessRow(title: labels[$0] ?? $0, detail: "\(groups[$0]?.count ?? 0)") }
        setRows([status, [NativeBusinessRow(title: "复制诊断摘要", action: { [weak self] in
            guard let self = self else { return }
            let summary = "iOS native 0.3.0\nSDK 3.8.3-hotfix.15\n" + self.service.statusText + "\nconversations=\(self.service.conversations.count)\noutbox=\(self.service.outboxEntries.count)\nlastSendSDKCode=\(self.service.lastSendErrorCode.map(String.init) ?? "none")"
            Task { @MainActor [weak self] in
                let media = await NativeImageCache.shared.diagnosticLines()
                UIPasteboard.general.string = summary + "\n" + media.joined(separator: "\n")
                self?.showNativeNotice("已复制，不包含账号密码、Token 或聊天内容。")
            }
        }), NativeBusinessRow(title: "核对待发结果", action: { [weak self] in guard let self = self else { return }; self.perform { for id in Set(self.service.outboxEntries.map(\.conversationID)) { await self.service.reconcile(conversationID: id) }; self.scheduleReload() } }), NativeBusinessRow(title: "转发任务", action: { [weak self] in guard let self = self else { return }; self.push(NativeForwardTasksController(context: self.context, service: self.service)) })]])
    }
}
