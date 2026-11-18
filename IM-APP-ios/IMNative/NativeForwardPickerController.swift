import UIKit
import IMCore

@MainActor
final class NativeForwardPickerController: NativeBusinessListController {
    private let service: NativeIMService; private let messages: [ChatTextItem]; private let source: NativeConversation
    private var selected: [NativeMassRecord.Target] = []; private let idempotencyKey = UUID().uuidString
    private var accepted: NativeForwardAccepted?; private var submissions: [NativeForwardSubmission] = []; private var draft: NativeForwardSubmission?; private var storageReadable = false
    init(service: NativeIMService, message: ChatTextItem, sourceConversation: NativeConversation) { self.service = service; messages = [message]; source = sourceConversation; super.init(title: "转发给", context: service.business) }
    init(service: NativeIMService, messages: [ChatTextItem], sourceConversation: NativeConversation) { self.service = service; self.messages = messages; source = sourceConversation; super.init(title: "转发给", context: service.business) }
    required init?(coder: NSCoder) { fatalError("不使用 Storyboard") }
    override func viewDidLoad() {
        super.viewDidLoad(); navigationItem.rightBarButtonItem = UIBarButtonItem(title: "传送", style: .done, target: self, action: #selector(send))
        perform { [self] in
            submissions = try await service.forwardSubmissions()
            try Task.checkCancellation()
            draft = submissions.last(where: { $0.sourceConversationID == source.id && $0.messageIDs == messages.map(\.id) && $0.accepted == nil })
            storageReadable = true
            reloadContent()
        }
    }
    override func reloadContent() {
        var sections = [[NativeBusinessRow(title: "选择接收对象", detail: "已选 \(selected.count)", action: { [weak self] in self?.pick() })], selected.map { NativeBusinessRow(title: $0.name) }]
        if draft != nil { sections.insert([NativeBusinessRow(title: "上次转发尚未确认", detail: "点击重试", action: { [weak self] in self?.send() })], at: 0) }
        setRows(sections); navigationItem.rightBarButtonItem?.isEnabled = storageReadable && accepted == nil && (!selected.isEmpty || draft != nil)
    }
    private func pick() { guard accepted == nil, draft == nil else { return }; push(NativeMassTargetPicker(service: service, initial: selected) { [weak self] values in self?.selected = values; self?.reloadContent() }) }
    @objc private func send() {
        guard storageReadable, (!selected.isEmpty || draft != nil), accepted == nil else { return }
        if draft != nil { confirm("确认重试上次转发？", destructiveTitle: "重试") { [weak self] in self?.submit() }; return }
        confirm("将 \(messages.count) 条消息转发给所选 \(selected.count) 个对象？", destructiveTitle: "传送") { [weak self] in self?.submit() }
    }
    private func submit() {
        perform { [self] in
            if let pending = draft { returnToChatAndDispatch(pending); return }
            var userIDs = Set<String>(), groupIDs = Set<String>()
            for target in selected {
                if target.kind == "recent" {
                    guard let conversation = service.conversations.first(where: { $0.id == target.id }) else { throw APIError.invalidResponse }
                    let id = try await service.businessPeerID(conversation)
                    if conversation.type == 3 { groupIDs.insert(id) } else { userIDs.insert(id) }
                } else if target.kind == "group" { groupIDs.insert(target.id) } else { userIDs.insert(target.id) }
            }
            var sources: [JSONValue] = []
            for message in messages {
                guard message.status == 2 else { throw APIError.business(code: -1, message: "请先核对消息发送状态。") }
                let snapshot = try ForwardMessageSnapshot.make(serialized: message.serialized, mediaPolicy: context.media)
                // 批量接口与原 uni-app 相同，由服务端保存独立媒体副本；不再额外重复 preserve。
                sources.append(.object(["sourceConversationId": .string(source.id), "sourceClientMsgId": .string(message.id), "sourceSnapshot": snapshot.body]))
            }
            // 单次用户操作固定幂等键。请求超时后再次确认仍提交同一批次，不创建重复任务。
            let body: [String: JSONValue] = ["messages": .array(sources), "targetUserIds": .array(userIDs.sorted().map(JSONValue.string)), "targetGroupIds": .array(groupIDs.sorted().map(JSONValue.string)), "idempotencyKey": .string(idempotencyKey)]
            let pending = NativeForwardSubmission(key: idempotencyKey, sourceConversationID: source.id, messageIDs: messages.map(\.id), body: body, createdAt: Date(), accepted: nil)
            guard submissions.filter({ $0.accepted == nil }).count < 200 else { throw APIError.business(code: -1, message: "未确认的转发较多，请稍后重试。") }
            try await service.saveForwardSubmission(pending)
            submissions.append(pending)
            draft = pending
            returnToChatAndDispatch(pending)
        }
    }
    private func returnToChatAndDispatch(_ pending: NativeForwardSubmission) {
        service.dispatchForwardInBackground(pending)
        navigationController?.popViewController(animated: true)
    }

}
