import UIKit
import IMCore

@MainActor
final class NativeForwardPickerController: NativeBusinessListController {
    private let service: NativeIMService; private let messages: [ChatTextItem]; private let source: NativeConversation
    private var selected: [NativeMassRecord.Target] = []; private let idempotencyKey = UUID().uuidString
    private var submissions: [NativeForwardSubmission] = []; private var draft: NativeForwardSubmission?; private var storageReadable = false
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
        setRows(sections); navigationItem.rightBarButtonItem?.isEnabled = storageReadable && (!selected.isEmpty || draft != nil)
    }
    private func pick() {
        guard !working, storageReadable, draft == nil else { return }
        push(NativeMassTargetPicker(service: service, initial: selected) { [weak self] values in
            self?.selected = values
            self?.reloadContent()
        })
    }
    @objc private func send() {
        guard !working, storageReadable, presentedViewController == nil, !selected.isEmpty || draft != nil else { return }
        if draft != nil { confirm("确认重试上次转发？", destructiveTitle: "重试") { [weak self] in self?.submit() }; return }
        submit()
    }
    private func submit() {
        perform { [self] in
            if let pending = draft { returnToChatAndDispatch(pending); return }
            let (peers, skipped) = try await resolveRecipients()
            let userIDs = Set(peers.filter { !$0.isGroup }.map(\.id))
            let groupIDs = Set(peers.filter(\.isGroup).map(\.id))
            guard !userIDs.isEmpty || !groupIDs.isEmpty else {
                throw APIError.business(code: -1, message: "选中的对象均无法接收转发，请重新选择。")
            }
            let snapshots = try messages.map { message in
                guard message.status == 2 else { throw APIError.business(code: -1, message: "请先核对消息发送状态。") }
                return try ForwardMessageSnapshot.make(serialized: message.serialized, mediaPolicy: context.media)
            }
            if (1...12).contains(peers.count), snapshots.allSatisfy({ [101, 102, 104].contains($0.contentType) }) {
                let destinations = peers.map { NativeForwardDestination(imID: $0.imID, type: $0.isGroup ? 3 : 1) }
                try await service.enqueueDirectForward(messages: messages, snapshots: snapshots, to: destinations,
                                                       from: source.id, skipped: skipped)
                returnToChat()
                return
            }
            let sources = zip(messages, snapshots).map { message, snapshot in
                JSONValue.object(["sourceConversationId": .string(source.id), "sourceClientMsgId": .string(message.id), "sourceSnapshot": snapshot.body])
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
    private struct Recipient: Sendable {
        let id: String
        let isGroup: Bool
        let imID: String
    }

    private func resolveRecipients() async throws -> ([Recipient], skipped: Int) {
        let conversations = Dictionary(service.conversations.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        var routes: [String: Bool] = [:]
        for target in selected {
            switch target.kind {
            case "recent":
                guard let conversation = conversations[target.id], conversation.canOpen else { continue }
                if conversation.type == 3 {
                    routes["im/groups/by-im/\(conversation.target)"] = true
                } else {
                    let id = GroupVisibility.businessUserID(conversation.target)
                    if UUID(uuidString: id) != nil { routes["im/peers/\(id)"] = false }
                }
            case "group":
                if Self.isGroupID(target.id) { routes["im/groups/\(target.id)"] = true }
            case nil:
                if UUID(uuidString: target.id) != nil { routes["im/peers/\(target.id)"] = false }
            default:
                continue
            }
        }
        let requests = Array(routes)
        var recipients: [Recipient] = []
        let concurrency = 6
        for start in stride(from: 0, to: requests.count, by: concurrency) {
            try Task.checkCancellation()
            let batch = requests[start..<min(start + concurrency, requests.count)]
            let resolved = try await withThrowingTaskGroup(of: Recipient?.self) { group in
                for (path, isGroup) in batch {
                    group.addTask { try await self.resolveRecipient(path: path, isGroup: isGroup) }
                }
                var result: [Recipient] = []
                for try await recipient in group {
                    if let recipient { result.append(recipient) }
                }
                return result
            }
            recipients.append(contentsOf: resolved)
        }
        try Task.checkCancellation()
        var seen = Set<NativeForwardDestination>()
        let unique = recipients.filter { seen.insert(NativeForwardDestination(imID: $0.imID, type: $0.isGroup ? 3 : 1)).inserted }
        return (unique, requests.count - recipients.count)
    }

    private func resolveRecipient(path: String, isGroup: Bool) async throws -> Recipient? {
        do {
            if isGroup {
                let peer: NativeGroupPeer = try await context.request(path)
                guard peer.canChat, Self.isGroupID(peer.businessGroupId), !peer.imGroupId.isEmpty else { return nil }
                return Recipient(id: peer.businessGroupId, isGroup: true, imID: peer.imGroupId)
            }
            let peer: NativePeer = try await context.request(path)
            guard peer.canChat, UUID(uuidString: peer.businessUserId) != nil, !peer.imUserId.isEmpty else { return nil }
            return Recipient(id: peer.businessUserId, isGroup: false, imID: peer.imUserId)
        } catch APIError.httpStatus(404) {
            return nil
        } catch APIError.business(code: 1, message: let reason)
                    where reason == (isGroup ? "群聊不存在或无权访问" : "聊天用户不存在") {
            // 现有 peer 接口用通用业务码 1 包装这两个 HTTP 404。
            return nil
        }
    }

    private static func isGroupID(_ id: String) -> Bool {
        !id.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && id.utf8.count <= 64 && !id.contains("/")
    }

    private func returnToChatAndDispatch(_ pending: NativeForwardSubmission) {
        service.dispatchForwardInBackground(pending)
        returnToChat()
    }

    private func returnToChat() {
        guard let navigationController, navigationController.topViewController === self else { return }
        navigationController.popViewController(animated: true)
    }
}
