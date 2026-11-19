import UIKit
import IMCore

@MainActor
final class NativeForwardPickerController: UIViewController, UITableViewDataSource, UITableViewDelegate {
    private enum Category: Int, CaseIterable {
        case recent, contacts, groups, tags
        var title: String { ["最近聊天", "联络人", "群组", "标签"][rawValue] }
    }

    private enum TargetKind: Hashable { case recent, contact, group, tag }
    private struct Target: Hashable {
        let id: String
        let name: String
        let avatar: String
        let kind: TargetKind
        let groupAvatar: Bool

        static func == (lhs: Self, rhs: Self) -> Bool { lhs.kind == rhs.kind && lhs.id == rhs.id }
        func hash(into hasher: inout Hasher) { hasher.combine(kind); hasher.combine(id) }
    }

    private struct Page {
        var items: [Target] = []
        var cursor: String?
        var hasMore = true
        var total: Int?
    }

    private let service: NativeIMService
    private var context: NativeBusinessContext { service.business }
    private let messages: [ChatTextItem]
    private let source: NativeConversation
    private let onSubmitted: (() -> Void)?
    private let idempotencyKey = UUID().uuidString
    private var submissions: [NativeForwardSubmission] = []
    private var draft: NativeForwardSubmission?
    private var storageReadable = false
    private var selected = Set<Target>()
    private var allFriends = false
    private var friendTotal: Int?
    private var excludedFriends = Set<String>()
    private var category: Category = .recent
    private var page = Page()
    private var loadTask: Task<Void, Never>?
    private var loadID = UUID()
    private var workTask: Task<Void, Never>?
    private var loadError: String?

    private let search = UITextField()
    private let table = UITableView(frame: .zero, style: .plain)
    private let countLabel = UILabel()
    private let selectPage = UIButton(type: .system)
    private let sendButton = UIButton(type: .system)
    private let backButton = UIButton(type: .system)
    private let sendSpinner = UIActivityIndicatorView(style: .medium)
    private let statusButton = UIButton(type: .system)
    private let draftButton = UIButton(type: .system)
    private var tabs: [UIButton] = []
    private let blue = NativeUITheme.mineBubble
    private let hint = UIColor(hex: 0x929bad)

    convenience init(service: NativeIMService, message: ChatTextItem, sourceConversation: NativeConversation) {
        self.init(service: service, messages: [message], sourceConversation: sourceConversation)
    }

    init(service: NativeIMService, messages: [ChatTextItem], sourceConversation: NativeConversation,
         onSubmitted: (() -> Void)? = nil) {
        self.service = service
        self.messages = messages
        source = sourceConversation
        self.onSubmitted = onSubmitted
        super.init(nibName: nil, bundle: nil)
        title = "转发给"
    }

    required init?(coder: NSCoder) { fatalError("不使用 Storyboard") }

    override func viewDidLoad() {
        super.viewDidLoad()
        configureLayout()
        render()
        readDrafts()
        reloadTargets()
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        navigationController?.setNavigationBarHidden(true, animated: animated)
    }

    override func viewDidDisappear(_ animated: Bool) {
        super.viewDidDisappear(animated)
        if isMovingFromParent || isBeingDismissed || navigationController?.isBeingDismissed == true {
            loadTask?.cancel()
            workTask?.cancel()
        }
    }

    private func configureLayout() {
        view.backgroundColor = .white
        let titleLabel = NativeUITheme.label("转发给", size: 17, color: .black)
        titleLabel.font = .systemFont(ofSize: 17, weight: .medium)
        titleLabel.accessibilityTraits.insert(.header)
        backButton.setImage(UIImage(systemName: "chevron.left"), for: .normal)
        backButton.tintColor = .black
        backButton.accessibilityLabel = "返回"
        backButton.addTarget(self, action: #selector(goBack), for: .touchUpInside)
        sendButton.setTitle("传送", for: .normal)
        sendButton.titleLabel?.font = .systemFont(ofSize: 16)
        sendButton.setTitleColor(blue, for: .normal)
        sendButton.setTitleColor(hint, for: .disabled)
        sendButton.addTarget(self, action: #selector(send), for: .touchUpInside)
        sendSpinner.color = blue
        sendSpinner.hidesWhenStopped = true
        sendSpinner.accessibilityLabel = "正在提交转发"
        let sendArea = UIView()
        for item in [sendButton, sendSpinner] { item.translatesAutoresizingMaskIntoConstraints = false; sendArea.addSubview(item) }
        NSLayoutConstraint.activate([
            sendButton.leadingAnchor.constraint(equalTo: sendArea.leadingAnchor),
            sendButton.trailingAnchor.constraint(equalTo: sendArea.trailingAnchor),
            sendButton.topAnchor.constraint(equalTo: sendArea.topAnchor),
            sendButton.bottomAnchor.constraint(equalTo: sendArea.bottomAnchor),
            sendSpinner.centerXAnchor.constraint(equalTo: sendArea.centerXAnchor),
            sendSpinner.centerYAnchor.constraint(equalTo: sendArea.centerYAnchor)
        ])
        let toolbar = UIStackView(arrangedSubviews: [backButton, titleLabel, sendArea])
        toolbar.alignment = .center
        toolbar.spacing = 8
        toolbar.isLayoutMarginsRelativeArrangement = true
        toolbar.layoutMargins = UIEdgeInsets(top: 0, left: 6, bottom: 0, right: 16)

        search.attributedPlaceholder = NSAttributedString(string: "搜索", attributes: [.foregroundColor: hint])
        search.accessibilityLabel = "搜索"
        search.font = .systemFont(ofSize: 16)
        search.textColor = .black
        search.backgroundColor = UIColor(hex: 0xf1f3f7)
        search.layer.cornerRadius = 7
        search.clearButtonMode = .whileEditing
        search.leftView = UIView(frame: CGRect(x: 0, y: 0, width: 12, height: 1))
        search.leftViewMode = .always
        search.addTarget(self, action: #selector(searchChanged), for: .editingChanged)
        let searchBox = UIView()
        search.translatesAutoresizingMaskIntoConstraints = false
        searchBox.addSubview(search)
        NSLayoutConstraint.activate([
            search.leadingAnchor.constraint(equalTo: searchBox.leadingAnchor, constant: 16),
            search.trailingAnchor.constraint(equalTo: searchBox.trailingAnchor, constant: -16),
            search.topAnchor.constraint(equalTo: searchBox.topAnchor, constant: 10),
            search.bottomAnchor.constraint(equalTo: searchBox.bottomAnchor, constant: -10),
            search.heightAnchor.constraint(equalToConstant: 48)
        ])

        tabs = Category.allCases.map { category in
            let tab = UIButton(type: .system)
            tab.setTitle(category.title, for: .normal)
            tab.titleLabel?.font = .systemFont(ofSize: 14)
            tab.tag = category.rawValue
            tab.addTarget(self, action: #selector(changeTab(_:)), for: .touchUpInside)
            return tab
        }
        let tabBar = UIStackView(arrangedSubviews: tabs)
        tabBar.distribution = .fillEqually
        countLabel.font = .systemFont(ofSize: 12)
        countLabel.textColor = hint
        selectPage.titleLabel?.font = .systemFont(ofSize: 12)
        selectPage.setTitleColor(blue, for: .normal)
        selectPage.addTarget(self, action: #selector(togglePage), for: .touchUpInside)
        selectPage.setContentHuggingPriority(.required, for: .horizontal)
        let summary = UIStackView(arrangedSubviews: [countLabel, selectPage])
        summary.alignment = .center
        summary.isLayoutMarginsRelativeArrangement = true
        summary.layoutMargins = UIEdgeInsets(top: 0, left: 18, bottom: 0, right: 18)

        draftButton.setTitle("上次转发尚未确认，点击重试", for: .normal)
        draftButton.addTarget(self, action: #selector(send), for: .touchUpInside)
        table.backgroundColor = .white
        table.separatorStyle = .none
        table.keyboardDismissMode = .onDrag
        table.dataSource = self
        table.delegate = self
        table.rowHeight = 66
        table.accessibilityIdentifier = "forwardTargets"
        table.register(NativeForwardTargetCell.self, forCellReuseIdentifier: NativeForwardTargetCell.reuseID)
        statusButton.titleLabel?.font = .systemFont(ofSize: 14)
        statusButton.addTarget(self, action: #selector(loadNextPage), for: .touchUpInside)
        statusButton.frame.size.height = 48
        table.tableFooterView = statusButton
        let stack = UIStackView(arrangedSubviews: [toolbar, searchBox, tabBar, summary, draftButton, table])
        stack.axis = .vertical
        stack.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            stack.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor),
            stack.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor),
            stack.bottomAnchor.constraint(equalTo: view.keyboardLayoutGuide.topAnchor),
            toolbar.heightAnchor.constraint(equalToConstant: 52),
            backButton.widthAnchor.constraint(equalToConstant: 44), backButton.heightAnchor.constraint(equalToConstant: 44),
            sendArea.widthAnchor.constraint(equalToConstant: 54), sendArea.heightAnchor.constraint(equalToConstant: 44),
            tabBar.heightAnchor.constraint(equalToConstant: 50), summary.heightAnchor.constraint(equalToConstant: 42)
        ])
    }

    private var keyword: String { (search.text ?? "").trimmingCharacters(in: .whitespacesAndNewlines) }
    private var selectionCount: Int { selected.count + (allFriends ? max(0, (friendTotal ?? 0) - excludedFriends.count) : 0) }
    private var canSelect: Bool { workTask == nil && draft == nil }

    private func isSelected(_ target: Target) -> Bool {
        if allFriends, target.kind == .contact {
            return category == .contacts && !excludedFriends.contains(target.id)
        }
        return selected.contains(target)
    }

    private func canToggle(_ target: Target) -> Bool {
        !allFriends || target.groupAvatar || (category == .contacts && target.kind == .contact)
    }

    private func toggle(_ target: Target) {
        if allFriends, target.kind == .contact {
            if excludedFriends.remove(target.id) == nil { excludedFriends.insert(target.id) }
        } else if selected.remove(target) == nil { selected.insert(target) }
    }

    @objc private func togglePage() {
        guard canSelect else { return }
        if category == .contacts, keyword.isEmpty {
            guard friendTotal != nil else { return }
            allFriends.toggle()
            excludedFriends.removeAll()
            if allFriends { selected = Set(selected.filter { $0.groupAvatar }) }
        } else {
            let targets = page.items.filter(canToggle)
            let clear = targets.allSatisfy(isSelected)
            for target in targets where isSelected(target) == clear {
                toggle(target)
            }
        }
        render()
    }

    @objc private func goBack() {
        guard workTask == nil else { return }
        navigationController?.popViewController(animated: true)
    }
    @objc private func changeTab(_ sender: UIButton) {
        guard canSelect, let next = Category(rawValue: sender.tag), category != next else { return }
        category = next
        reloadTargets()
    }
    @objc private func searchChanged() {
        search.text = String((search.text ?? "").prefix(200))
        reloadTargets(debounce: category == .contacts && !keyword.isEmpty)
    }

    private func reloadTargets(debounce: Bool = false) {
        loadTask?.cancel()
        loadTask = nil
        page = Page()
        if category == .recent {
            page.items = recentTargets(matching: keyword)
            page.hasMore = !keyword.isEmpty || page.items.isEmpty || !service.conversationsEnd
        }
        table.setContentOffset(.zero, animated: false)
        loadError = nil
        if category == .recent, keyword.isEmpty, !page.items.isEmpty { render() }
        else { loadMore(debounce: debounce) }
    }

    @objc private func loadNextPage() { loadMore(debounce: false) }
    private func loadMore(debounce: Bool) {
        guard loadTask == nil, page.hasMore else { return }
        let current = category
        let text = keyword
        let cursor = page.cursor
        let request = UUID()
        loadID = request
        loadError = nil
        loadTask = Task { [weak self] in
            guard let self else { return }
            defer { if loadID == request { loadTask = nil; render() } }
            do {
                if debounce { try await Task.sleep(nanoseconds: 250_000_000) }
                let result = try await fetch(current, keyword: text, cursor: cursor)
                try Task.checkCancellation()
                guard loadID == request, service.isActive else { return }
                if current == .recent { page = result }
                else {
                    var known = Set(page.items)
                    page.items += result.items.filter { known.insert($0).inserted }
                    page.cursor = result.cursor
                    page.hasMore = result.hasMore
                    if cursor == nil { page.total = result.total }
                    if current == .contacts, text.isEmpty {
                        friendTotal = page.total ?? (page.hasMore ? nil : page.items.count)
                    }
                }
            } catch {
                if !Task.isCancelled, loadID == request, service.isActive { loadError = error.localizedDescription }
            }
        }
        render()
    }

    private func fetch(_ category: Category, keyword: String, cursor: String?) async throws -> Page {
        switch category {
        case .recent:
            if service.conversationsEnd && !service.conversations.isEmpty {
                return Page(items: recentTargets(matching: keyword), hasMore: false)
            }
            if !keyword.isEmpty || service.conversations.isEmpty { _ = try await service.loadAllConversations() }
            else {
                await service.loadConversations()
                if let error = service.lastError { throw APIError.business(code: -1, message: error) }
            }
            return Page(items: recentTargets(matching: keyword), hasMore: !service.conversationsEnd)
        case .contacts:
            let result = try await context.contacts(keyword: keyword, cursor: cursor)
            return try paged(result, after: cursor) { .init(id: $0.id, name: $0.displayName, avatar: $0.avatar, kind: .contact, groupAvatar: false) }
        case .groups:
            var query = [URLQueryItem(name: "limit", value: "100")]
            if let cursor { query.append(URLQueryItem(name: "cursor", value: cursor)) }
            let result: NativePage<NativeGroup> = try await context.request("groups", query: query)
            return try paged(result, after: cursor) { group in
                let name = group.remark.flatMap { $0.isEmpty ? nil : $0 } ?? group.name
                guard group.status != "dismissed", keyword.isEmpty || name.localizedCaseInsensitiveContains(keyword) else { return nil }
                return .init(id: group.id, name: name, avatar: group.avatar, kind: .group, groupAvatar: true)
            }
        case .tags:
            let tags: [NativeTag] = try await context.request("contact-tags")
            return Page(items: tags.filter { keyword.isEmpty || $0.name.localizedCaseInsensitiveContains(keyword) }.map {
                .init(id: $0.id, name: $0.name, avatar: "", kind: .tag, groupAvatar: false)
            }, hasMore: false)
        }
    }

    private func paged<Item>(_ page: NativePage<Item>, after cursor: String?,
                             map: (Item) -> Target?) throws -> Page {
        if page.hasMore, page.nextCursor == nil || page.nextCursor == "" || page.nextCursor == cursor { throw APIError.invalidResponse }
        return Page(items: page.items.compactMap(map), cursor: page.nextCursor, hasMore: page.hasMore, total: page.total)
    }

    private func recentTargets(matching keyword: String) -> [Target] {
        service.conversations.filter { $0.canOpen && (keyword.isEmpty || $0.title.localizedCaseInsensitiveContains(keyword)) }.compactMap {
            if $0.type == 3 {
                return Target(id: $0.id, name: $0.title, avatar: $0.avatar, kind: .recent, groupAvatar: true)
            }
            let id = GroupVisibility.businessUserID($0.target)
            guard UUID(uuidString: id) != nil else { return nil }
            return Target(id: id, name: $0.title, avatar: $0.avatar, kind: .contact, groupAvatar: false)
        }
    }

    private func render() {
        let busy = workTask != nil
        let canSend = storageReadable && !busy && (selectionCount > 0 || draft != nil)
        sendButton.isEnabled = canSend
        sendButton.isHidden = busy
        if busy { sendSpinner.startAnimating() } else { sendSpinner.stopAnimating() }
        backButton.isEnabled = !busy
        draftButton.isHidden = draft == nil
        draftButton.isEnabled = canSend
        search.isEnabled = canSelect
        for tab in tabs {
            let active = tab.tag == category.rawValue
            tab.setTitleColor(active ? blue : UIColor(hex: 0x555f71), for: .normal)
            tab.accessibilityTraits = active ? [.button, .selected] : .button
            tab.isEnabled = canSelect
        }
        countLabel.text = "已选 \(selectionCount) 个目标 · \(messages.count) 条消息"
        let contactPage = category == .contacts && keyword.isEmpty
        selectPage.setTitle(contactPage ? (allFriends ? "取消全选" : "全部好友") : "全选本页", for: .normal)
        selectPage.isEnabled = canSelect && (contactPage ? (friendTotal ?? 0) > 0 : page.items.contains(where: canToggle))
        if let loadError { statusButton.setTitle("读取失败，点击重试", for: .normal); statusButton.accessibilityHint = loadError }
        else {
            statusButton.accessibilityHint = nil
            statusButton.setTitle(loadTask != nil ? "正在读取转发目标…" : (page.hasMore ? "加载更多" : (page.items.isEmpty ? "暂无目标" : "没有更多")), for: .normal)
        }
        statusButton.isEnabled = canSelect && loadTask == nil && page.hasMore
        table.reloadData()
    }

    func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int { page.items.count }
    func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        let target = page.items[indexPath.row]
        guard let cell = tableView.dequeueReusableCell(withIdentifier: NativeForwardTargetCell.reuseID, for: indexPath) as? NativeForwardTargetCell else { return UITableViewCell() }
        cell.configure(name: target.name, image: target.avatar, isGroup: target.groupAvatar, isTag: target.kind == .tag,
                       selected: isSelected(target), policy: context.media)
        return cell
    }
    func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
        tableView.deselectRow(at: indexPath, animated: false)
        let target = page.items[indexPath.row]
        guard canSelect, canToggle(target) else { return }
        toggle(target)
        render()
    }

    private func readDrafts() {
        workTask = Task { [weak self] in
            guard let self else { return }
            defer { workTask = nil; render() }
            do {
                submissions = try await service.forwardSubmissions()
                try Task.checkCancellation()
                guard service.isActive else { return }
                let ids = messages.map(\.id)
                draft = submissions.last { $0.sourceConversationID == source.id && $0.messageIDs == ids && $0.accepted == nil }
                storageReadable = true
            } catch {
                if !Task.isCancelled, view.window != nil { showNativeNotice(error.localizedDescription) }
            }
        }
    }

    @objc private func send() {
        guard workTask == nil, storageReadable, presentedViewController == nil, selectionCount > 0 || draft != nil else { return }
        view.endEditing(true)
        if draft != nil {
            let alert = UIAlertController(title: "确认重试上次转发？", message: nil, preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: "取消", style: .cancel))
            alert.addAction(UIAlertAction(title: "重试", style: .default) { [weak self] _ in self?.submit() })
            present(alert, animated: true)
        } else { submit() }
    }

    private func submit() {
        guard workTask == nil else { return }
        workTask = Task { [weak self] in
            guard let self else { return }
            defer { workTask = nil; if view.window != nil { render() } }
            do { try await submitSelection() }
            catch { if !Task.isCancelled, view.window != nil { showNativeNotice(error.localizedDescription) } }
        }
        render()
    }

    private func submitSelection() async throws {
        if let pending = draft { returnToChatAndDispatch(pending); return }
        let tagIDs = selected.filter { $0.kind == .tag }.map(\.id).sorted()
        let includesFriends = allFriends && (friendTotal ?? 0) > excludedFriends.count
        let snapshots = try messages.map { message in
            guard message.status == 2 else { throw APIError.business(code: -1, message: "请先核对消息发送状态。") }
            return try ForwardMessageSnapshot.make(serialized: message.serialized, mediaPolicy: context.media)
        }
        let direct = !allFriends && tagIDs.isEmpty && (1...12).contains(selected.count)
            && snapshots.allSatisfy { [101, 102, 104].contains($0.contentType) }
        let (peers, skipped) = try await resolveRecipients(validateContacts: direct)
        let groupIDs = Set(peers.filter(\.isGroup).map(\.id))
        let userIDs = direct ? Set(peers.filter { !$0.isGroup }.map(\.id))
            : Set(selected.filter { $0.kind == .contact && UUID(uuidString: $0.id) != nil }.map(\.id))
        if userIDs.isEmpty, groupIDs.isEmpty, !includesFriends {
            // Check for members before saving an intent that the server cannot submit.
            var hasTaggedContacts = false
            for id in tagIDs {
                let members: [NativeContact] = try await context.request("contact-tags/\(id)/members")
                if !members.isEmpty { hasTaggedContacts = true; break }
            }
            guard hasTaggedContacts else {
                throw APIError.business(code: -1, message: "选中的对象均无法接收转发，请重新选择。")
            }
        }
        if direct {
            let destinations = peers.map { NativeForwardDestination(imID: $0.imID, type: $0.isGroup ? 3 : 1) }
            try await service.enqueueDirectForward(messages: messages, snapshots: snapshots, to: destinations,
                                                   from: source.id, skipped: skipped)
            returnToChat()
            return
        }
        let sources = zip(messages, snapshots).map { message, snapshot in
            JSONValue.object(["sourceConversationId": .string(source.id), "sourceClientMsgId": .string(message.id), "sourceSnapshot": snapshot.forMediaArchive(using: context.media).body])
        }
        // 单次用户操作固定幂等键。请求超时后再次确认仍提交同一批次，不创建重复任务。
        var body: [String: JSONValue] = ["messages": .array(sources), "targetUserIds": .array(userIDs.sorted().map(JSONValue.string)), "targetGroupIds": .array(groupIDs.sorted().map(JSONValue.string)), "idempotencyKey": .string(idempotencyKey)]
        if includesFriends {
            body["selector"] = .object(["mode": .string("all_friends")])
            body["excludeUserIds"] = .array(excludedFriends.sorted().map(JSONValue.string))
        } else if !tagIDs.isEmpty {
            body["selector"] = .object(["mode": .string("tags"), "tagIds": .array(tagIDs.map(JSONValue.string))])
        }
        let pending = NativeForwardSubmission(key: idempotencyKey, sourceConversationID: source.id, messageIDs: messages.map(\.id), body: body, createdAt: Date(), accepted: nil)
        guard submissions.filter({ $0.accepted == nil }).count < 200 else { throw APIError.business(code: -1, message: "未确认的转发较多，请稍后重试。") }
        try Task.checkCancellation()
        try await service.saveForwardSubmission(pending)
        submissions.append(pending)
        draft = pending
        returnToChatAndDispatch(pending)
    }

    private struct Recipient: Sendable {
        let id: String
        let isGroup: Bool
        let imID: String
    }

    private func resolveRecipients(validateContacts: Bool) async throws -> ([Recipient], skipped: Int) {
        let conversations = Dictionary(service.conversations.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        var routes: [String: Bool] = [:]
        for target in selected {
            switch target.kind {
            case .recent:
                guard let conversation = conversations[target.id], conversation.canOpen else { continue }
                routes["im/groups/by-im/\(conversation.target)"] = true
            case .group:
                if Self.isGroupID(target.id) { routes["im/groups/\(target.id)"] = true }
            case .contact:
                if validateContacts, UUID(uuidString: target.id) != nil { routes["im/peers/\(target.id)"] = false }
            case .tag:
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
        onSubmitted?()
        navigationController.popViewController(animated: true)
    }
}

@MainActor
private final class NativeForwardTargetCell: UITableViewCell {
    static let reuseID = "forward-target"
    private let check = UIImageView()
    private let avatar = NativeRemoteImageView()
    private let tagIcon = UILabel()
    private let name = UILabel()

    override init(style: UITableViewCell.CellStyle, reuseIdentifier: String?) {
        super.init(style: style, reuseIdentifier: reuseIdentifier)
        backgroundColor = .white
        selectionStyle = .none
        name.font = .systemFont(ofSize: 15)
        name.textColor = .black
        name.lineBreakMode = .byTruncatingTail
        avatar.contentMode = .scaleAspectFill
        avatar.layer.cornerRadius = 21
        avatar.clipsToBounds = true
        tagIcon.text = "#"
        tagIcon.font = .systemFont(ofSize: 22)
        tagIcon.textColor = NativeUITheme.mineBubble
        tagIcon.textAlignment = .center
        tagIcon.backgroundColor = UIColor(hex: 0xeaf0ff)
        tagIcon.layer.cornerRadius = 21
        tagIcon.clipsToBounds = true
        let icon = UIView()
        for view in [avatar, tagIcon] {
            view.translatesAutoresizingMaskIntoConstraints = false
            icon.addSubview(view)
            NSLayoutConstraint.activate([
                view.leadingAnchor.constraint(equalTo: icon.leadingAnchor), view.trailingAnchor.constraint(equalTo: icon.trailingAnchor),
                view.topAnchor.constraint(equalTo: icon.topAnchor), view.bottomAnchor.constraint(equalTo: icon.bottomAnchor)
            ])
        }
        let row = UIStackView(arrangedSubviews: [check, icon, name])
        row.alignment = .center
        row.spacing = 12
        row.setCustomSpacing(17, after: check)
        row.translatesAutoresizingMaskIntoConstraints = false
        contentView.addSubview(row)
        NSLayoutConstraint.activate([
            row.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 20),
            row.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -18),
            row.centerYAnchor.constraint(equalTo: contentView.centerYAnchor),
            check.widthAnchor.constraint(equalToConstant: 18), check.heightAnchor.constraint(equalToConstant: 18),
            icon.widthAnchor.constraint(equalToConstant: 42), icon.heightAnchor.constraint(equalToConstant: 42)
        ])
    }

    required init?(coder: NSCoder) { fatalError("不使用 Storyboard") }

    override func prepareForReuse() {
        super.prepareForReuse()
        avatar.cancel()
    }

    func configure(name: String, image: String, isGroup: Bool, isTag: Bool, selected: Bool, policy: MediaURLPolicy) {
        self.name.text = name
        accessibilityTraits = selected ? [.button, .selected] : .button
        accessibilityValue = selected ? "已选" : nil
        check.image = UIImage(systemName: selected ? "checkmark.circle.fill" : "circle")
        check.tintColor = selected ? NativeUITheme.mineBubble : UIColor(hex: 0x929bad)
        tagIcon.isHidden = !isTag
        avatar.isHidden = isTag
        if isTag { avatar.cancel() }
        else { avatar.load(image, policy: policy, placeholder: isGroup ? "uni_group_default" : "uni_avatar_default") }
    }
}
