import UIKit
import IMCore
import PhotosUI

@MainActor
final class NativeGroupsController: NativeBusinessListController {
    private let service: NativeIMService; private var groups: [NativeGroup] = []; private var cursor: String?; private var role = "owner"; private let tabs = UIView(); private var tabButtons: [UIButton] = []; private let fab = UIButton(type: .system)
    init(service: NativeIMService) { self.service = service; super.init(title: "群聊", context: service.business) }
    required init?(coder: NSCoder) { fatalError("不使用 Storyboard") }
    override func viewDidLoad() { super.viewDidLoad(); tableView.backgroundColor = .white
        for (index, title) in ["我建立的", "我加入的"].enumerated() { let button = UIButton(type: .system); button.setTitle(title, for: .normal); button.addAction(UIAction { [weak self] _ in guard let self = self else { return }; let next = index == 0 ? "owner" : "member"; guard next != self.role else { return }; self.role = next; self.buildTabs(); self.reloadContent() }, for: .touchUpInside); tabs.addSubview(button); tabButtons.append(button) }; buildTabs()
        fab.setTitle("＋", for: .normal); fab.backgroundColor = NativeUITheme.primary; fab.setTitleColor(.white, for: .normal); fab.layer.shadowOpacity = 0.15; fab.layer.shadowRadius = 8; fab.addTarget(self, action: #selector(createFromFAB), for: .touchUpInside); tableView.addSubview(fab)
    }
    @objc private func createFromFAB() { createGroup() }
    private func buildTabs() { let w = view.bounds.width, r = w / 750; tabs.frame = CGRect(x: 0, y: 0, width: w, height: 100 * r); for (index, button) in tabButtons.enumerated() { button.frame = CGRect(x: CGFloat(index) * w / 2, y: 0, width: w / 2, height: 96 * r); button.titleLabel?.font = .systemFont(ofSize: 30 * r, weight: (role == "owner") == (index == 0) ? .semibold : .regular); button.setTitleColor((role == "owner") == (index == 0) ? NativeUITheme.primary : NativeUITheme.body, for: .normal); button.layer.sublayers?.filter { $0.name == "tab-line" }.forEach { $0.removeFromSuperlayer() }; if (role == "owner") == (index == 0) { let line = CALayer(); line.name = "tab-line"; line.backgroundColor = NativeUITheme.primary.cgColor; line.frame = CGRect(x: (button.bounds.width - 110 * r) / 2, y: 92 * r, width: 110 * r, height: 4 * r); button.layer.addSublayer(line) } }; tableView.tableHeaderView = tabs }
    private func layoutFAB() { let r = view.bounds.width / 750; fab.frame = CGRect(x: view.bounds.width - 144 * r, y: tableView.contentOffset.y + tableView.bounds.height - tableView.adjustedContentInset.bottom - 154 * r, width: 104 * r, height: 104 * r); fab.layer.cornerRadius = 52 * r; fab.titleLabel?.font = .systemFont(ofSize: 60 * r); tableView.bringSubviewToFront(fab) }
    override func viewDidLayoutSubviews() { super.viewDidLayoutSubviews(); if abs(tabs.bounds.width - view.bounds.width) > 0.5 { buildTabs() }; layoutFAB() }
    override func scrollViewDidScroll(_ scrollView: UIScrollView) { layoutFAB() }
    override func reloadContent() { load(reset: true) }
    private func load(reset: Bool) {
        perform { [self] in
            let requestedRole = role
            var query = [URLQueryItem(name: "limit", value: "100"), URLQueryItem(name: "role", value: requestedRole)]; if !reset, let cursor = cursor { query.append(URLQueryItem(name: "cursor", value: cursor)) }
            let result: NativePage<NativeGroup> = try await context.request("groups", query: query)
            try Task.checkCancellation(); guard requestedRole == role else { scheduleReload(); return }
            if reset { groups = [] }; groups += result.items.filter { $0.status != "dismissed" }; cursor = result.nextCursor
            var rows = groups.map { group in NativeBusinessRow(title: group.name, detail: group.memberCount.map { "\($0) 人" } ?? "", avatar: group.avatar, action: { [weak self] in guard let self = self else { return }; self.perform { let peer: NativeGroupPeer = try await self.context.request("im/groups/\(group.id)"); let chat = try await self.service.openConversation(target: peer.imGroupId, type: 3); try Task.checkCancellation(); self.push(NativeConversationViewController(service: self.service, conversation: chat)) } }) }
            if result.hasMore { rows.append(NativeBusinessRow(title: "加载更多", action: { [weak self] in self?.load(reset: false) })) }; setRows([rows])
        }
    }
    @objc private func add() {
        let sheet = UIAlertController(title: "群聊", message: nil, preferredStyle: .actionSheet)
        sheet.addAction(UIAlertAction(title: "创建群聊", style: .default) { [weak self] _ in self?.createGroup() })
        sheet.addAction(UIAlertAction(title: "添加群聊", style: .default) { [weak self] _ in self?.joinGroup() })
        sheet.addAction(UIAlertAction(title: "取消", style: .cancel)); sheet.popoverPresentationController?.barButtonItem = navigationItem.rightBarButtonItem; present(sheet, animated: true)
    }
    func createGroup() {
        push(NativeContactPickerController(service: service, title: "选择群成员") { [weak self] selected in
            guard let self = self else { return }
            self.edit(title: "创建群聊", value: selected.prefix(3).map(\.displayName).joined(separator: "、")) { [weak self] name in
                guard let self = self else { return }; let group: NativeGroup = try await self.context.request("groups", method: "POST", body: ["name": .string(name), "memberIds": .array(selected.map { .string($0.id) })]); self.push(NativeGroupController(service: self.service, groupID: group.id))
            }
        })
    }
    func joinGroup() {
        edit(title: "添加群聊", placeholder: "输入群号，如 qun_xxxxxx") { [weak self] id in
            guard let self = self else { return }
            guard id.range(of: "^(qun_[A-Za-z0-9]{6,20}|[0-9]+)$", options: .regularExpression) != nil else { throw APIError.business(code: -1, message: "请输入正确的群号。") }
            do { let group: NativeGroup = try await self.context.request("groups/\(id)/join", method: "POST", body: [:]); self.push(NativeGroupController(service: self.service, groupID: group.id)) }
            catch APIError.business(let code, let message) {
                guard message.contains("审核") else { throw APIError.business(code: code, message: message) }
                try await self.context.change("groups/\(id)/join-requests", body: ["remark": .string("")]); self.showNativeNotice("已提交入群申请。")
            }
        }
    }
}

@MainActor
final class NativeContactPickerController: NativeBusinessListController, UISearchResultsUpdating {
    private let service: NativeIMService; private let done: ([NativeContact]) -> Void; private let selectionLimit: Int
    private var contacts: [NativeContact] = []; private var selected = Set<String>(); private let search = UISearchController(searchResultsController: nil)
    init(service: NativeIMService, title: String, selectionLimit: Int = Int.max, done: @escaping ([NativeContact]) -> Void) { self.service = service; self.done = done; self.selectionLimit = selectionLimit; super.init(title: title, context: service.business) }
    required init?(coder: NSCoder) { fatalError("不使用 Storyboard") }
    override func viewDidLoad() {
        super.viewDidLoad(); search.searchResultsUpdater = self; search.obscuresBackgroundDuringPresentation = false; navigationItem.searchController = search
        navigationItem.rightBarButtonItem = UIBarButtonItem(title: "完成", style: .done, target: self, action: #selector(finish))
    }
    override func reloadContent() {
        perform { [self] in
            var all: [NativeContact] = []; var cursor: String?; var seen = Set<String>()
            repeat { let page = try await context.contacts(sort: "name", cursor: cursor); all += page.items; guard page.hasMore, let next = page.nextCursor, seen.insert(next).inserted else { break }; cursor = next } while true
            contacts = all; render()
        }
    }
    func updateSearchResults(for searchController: UISearchController) { render() }
    private func render() {
        let key = search.searchBar.text ?? ""
        setRows([contacts.filter { key.isEmpty || $0.displayName.localizedCaseInsensitiveContains(key) }.map { c in NativeBusinessRow(title: c.displayName, avatar: c.avatar, checked: selected.contains(c.id), action: { [weak self] in guard let self = self else { return }; if self.selected.contains(c.id) { self.selected.remove(c.id) } else { if self.selectionLimit == 1 { self.selected = [] }; guard self.selected.count < self.selectionLimit else { self.showNativeNotice("已达到选择人数上限。"); return }; self.selected.insert(c.id) }; self.render() }) }])
        navigationItem.rightBarButtonItem?.title = selected.isEmpty ? "完成" : "完成（\(selected.count)）"
    }
    @objc private func finish() { guard !selected.isEmpty else { showNativeNotice("请选择联系人。"); return }; let result = contacts.filter { selected.contains($0.id) }; navigationController?.popViewController(animated: false); done(result) }
}

@MainActor
final class NativeGroupController: NativeBusinessListController, PHPickerViewControllerDelegate {
    private let service: NativeIMService; private let groupID: String; private var group: NativeGroup?
    private var conversation: NativeConversation?; private var previewMembers: [NativeGroupMember] = []; private var memberError: String?
    private struct Dissolved: Decodable { let id: String; let name: String; let avatar: String; let status: String }
    init(service: NativeIMService, groupID: String) { self.service = service; self.groupID = groupID; super.init(title: "群组详情", context: service.business) }
    required init?(coder: NSCoder) { fatalError("不使用 Storyboard") }
    override func reloadContent() {
        perform { [self] in
            let g: NativeGroup
            do { g = try await context.request("groups/detail", query: [URLQueryItem(name: "groupId", value: groupID)]) }
            catch APIError.httpStatus(404) { try await loadDissolved(); return }
            catch APIError.business(let code, let message) { guard code == 404 else { throw APIError.business(code: code, message: message) }; try await loadDissolved(); return }
            group = g; previewMembers = []; memberError = nil; conversation = nil
            do { let result: NativePage<NativeGroupMember> = try await context.request("group-members", query: [URLQueryItem(name: "groupId", value: groupID), URLQueryItem(name: "limit", value: "40")]); previewMembers = Array(result.items.prefix(4)) }
            catch { if Task.isCancelled { throw error }; memberError = error.localizedDescription }
            var requestCount: Int?; var requestError = false
            if g.canManage { do { let values: [NativeJoinRequest] = try await context.request("groups/\(groupID)/join-requests"); requestCount = values.filter { $0.status == "pending" }.count } catch { if Task.isCancelled { throw error }; requestError = true } }
            var conversationError: String?
            do { let peer: NativeGroupPeer = try await context.request("im/groups/\(groupID)"); conversation = try await service.openConversation(target: peer.imGroupId, type: 3) }
            catch { if Task.isCancelled { throw error }; conversationError = error.localizedDescription }
            try Task.checkCancellation(); buildMembers(g)
            var sections: [[NativeBusinessRow]] = [[NativeBusinessRow(title: "群组成员", detail: "共\(g.memberCount ?? previewMembers.count)人", action: { [weak self] in self?.openMembers() })]]
            if g.canManage { sections.append([
                NativeBusinessRow(title: "群组管理", action: { [weak self] in guard let self = self else { return }; self.push(NativeGroupAdministrationController(service: self.service, groupID: self.groupID)) }),
                NativeBusinessRow(title: "入群申请", detail: requestError ? "读取失败" : requestCount.map(String.init) ?? "", action: { [weak self] in guard let self = self else { return }; self.push(NativeGroupRequestsController(service: self.service, groupID: self.groupID)) }),
                NativeBusinessRow(title: "入群方式", detail: g.joinMode == "approval" ? "私密群" : "公开群", action: { [weak self] in self?.changeJoinMode() })
            ]) }
            let canEdit = g.permissions?.canEditProfile ?? g.canManage
            var info = [NativeBusinessRow(title: "群组名称", detail: g.name, action: canEdit ? { [weak self] in self?.editName() } : nil), NativeBusinessRow(title: "群头像", avatar: g.avatar, action: canEdit ? { [weak self] in self?.chooseAvatar() } : nil), NativeBusinessRow(title: "群号", detail: g.publicId ?? g.id, action: isOwner(g) && g.publicIdChangeUsed != true ? { [weak self] in self?.editPublicID() } : nil), NativeBusinessRow(title: "群公告", detail: g.announcement ?? "", action: { [weak self] in guard let self = self else { return }; self.push(NativeAnnouncementsController(service: self.service, group: g)) })]
            if g.permissions?.canViewQRCode ?? true { info.append(NativeBusinessRow(title: "群二维码", action: { [weak self] in guard let self = self else { return }; self.push(NativeQRCodeController(context: self.context, groupID: self.groupID, service: self.service)) })) }
            if g.permissions?.canEditMyNickname ?? true { info.append(NativeBusinessRow(title: "我在本群的昵称", detail: g.myNickname ?? "", action: { [weak self] in self?.editMyNickname() })) }
            sections.append(info)
            sections.append([NativeBusinessRow(title: "图片与视频", action: { [weak self] in self?.openMedia() }), NativeBusinessRow(title: "搜索聊天记录", action: { [weak self] in self?.searchHistory() }), NativeBusinessRow(title: "清除聊天记录", action: { [weak self] in self?.clearHistory() })])
            if let chat = conversation { sections.append([NativeBusinessRow(title: "消息免打扰", checked: chat.muted, toggle: { [weak self] value in self?.changeConversation(value, pinned: false) }), NativeBusinessRow(title: "置顶聊天", checked: chat.pinned, toggle: { [weak self] value in self?.changeConversation(value, pinned: true) })]) }
            else if let error = conversationError { sections.append([NativeBusinessRow(title: "会话设置加载失败，点此重试", detail: error, action: { [weak self] in self?.reloadContent() })]) }
            if g.permissions?.canReport ?? true { sections.append([NativeBusinessRow(title: "检举", action: { [weak self] in guard let self = self else { return }; self.push(NativeReportController(context: self.context, targetID: self.groupID, group: true)) })]) }
            sections.append([NativeBusinessRow(title: isOwner(g) ? "解散群" : "退出群并删除对话", destructive: true, action: { [weak self] in self?.leave() })]); setRows(sections)
        }
    }
    private func isOwner(_ group: NativeGroup) -> Bool { group.isOwner || group.ownerId == context.userID }
    private func openMembers() { guard let group = group else { return }; push(NativeGroupMembersController(service: service, group: group)) }
    private func buildMembers(_ g: NativeGroup) {
        let w = view.bounds.width, r: (CGFloat) -> CGFloat = { $0 * w / 750 }
        let header = UIView(frame: CGRect(x: 0, y: 0, width: w, height: r(memberError == nil ? 182 : 230))); header.backgroundColor = .white
        for index in 0..<5 {
            let button = UIButton(type: .custom); button.frame = CGRect(x: r(24) + CGFloat(index) * r(140), y: r(24), width: r(128), height: r(138)); button.addAction(UIAction { [weak self] _ in self?.openMembers() }, for: .touchUpInside)
            if index < previewMembers.count { let member = previewMembers[index]; let avatar = NativeRemoteImageView(frame: CGRect(x: r(16), y: 0, width: r(96), height: r(96))); avatar.layer.cornerRadius = r(48); avatar.clipsToBounds = true; avatar.contentMode = .scaleAspectFill; avatar.load(member.avatar, policy: context.media); button.addSubview(avatar); let name = NativeUITheme.label(member.name, size: r(22)); name.textAlignment = .center; name.frame = CGRect(x: 0, y: r(108), width: r(128), height: r(30)); button.addSubview(name); button.accessibilityLabel = member.name }
            else if index == min(previewMembers.count, 4) { let add = UIImageView(image: NativeUITheme.image("uni_icon_add_member")); add.frame = CGRect(x: r(16), y: 0, width: r(96), height: r(96)); add.contentMode = .scaleAspectFit; button.addSubview(add); button.accessibilityLabel = "查看群成员" }
            else { continue }; header.addSubview(button)
        }
        if let error = memberError { let label = NativeUITheme.label("成员预览加载失败：" + error, size: r(22), color: .systemRed); label.frame = CGRect(x: r(24), y: r(184), width: w - r(48), height: r(40)); header.addSubview(label) }; tableView.tableHeaderView = header
    }
    override func viewDidLayoutSubviews() { super.viewDidLayoutSubviews(); if let g = group, abs((tableView.tableHeaderView?.bounds.width ?? 0) - view.bounds.width) > 0.5 { buildMembers(g) } }
    override func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell { let cell = super.tableView(tableView, cellForRowAt: indexPath); if sections[indexPath.section][indexPath.row].title == "群号" { let copy = UIButton(type: .system); copy.setImage(UIImage(systemName: "doc.on.doc"), for: .normal); copy.frame = CGRect(x: 0, y: 0, width: 38, height: 38); copy.accessibilityLabel = "复制群号"; copy.addAction(UIAction { [weak self] _ in guard let self = self else { return }; UIPasteboard.general.string = self.group?.publicId ?? self.groupID }, for: .touchUpInside); cell.accessoryView = copy } else { cell.accessoryView = nil }; return cell }
    private func changeConversation(_ value: Bool, pinned: Bool) { guard let chat = conversation else { return }; perform { [self] in defer { scheduleReload() }; if pinned { try await service.setPinned(value, conversation: chat) } else { try await service.setMuted(value, conversation: chat) } } }
    private func searchHistory() { guard let chat = conversation else { showNativeNotice("请先重试读取会话设置。"); return }; push(NativeSearchController(service: service, conversation: chat)) }
    private func clearHistory() { guard let chat = conversation else { showNativeNotice("请先重试读取会话设置。"); return }; confirm("清除后聊天记录无法恢复，是否继续？", destructiveTitle: "清除") { [weak self] in guard let self = self else { return }; self.perform { try await self.service.clearHistory(chat); self.scheduleReload() } } }
    private func changeJoinMode() { let dialog = UIAlertController(title: "入群方式", message: nil, preferredStyle: .actionSheet); for (label, mode) in [("公开群", "open"), ("私密群（需要审核）", "approval")] { dialog.addAction(UIAlertAction(title: label, style: .default) { [weak self] _ in self?.updateSetting("joinMode", .string(mode)) }) }; dialog.addAction(UIAlertAction(title: "取消", style: .cancel)); dialog.popoverPresentationController?.sourceView = tableView; present(dialog, animated: true) }
    private func loadDissolved() async throws { let value: Dissolved = try await context.request("groups/\(groupID)/dissolved"); try Task.checkCancellation(); group = nil; conversation = nil; tableView.tableHeaderView = nil; setRows([[NativeBusinessRow(title: value.name, detail: "该群已解散", avatar: value.avatar)], [NativeBusinessRow(title: "删除该群", destructive: true, action: { [weak self] in guard let self = self else { return }; self.confirm("确定删除该群聊吗？", destructiveTitle: "删除") { self.perform { try await self.context.change("groups/\(self.groupID)/dissolved/remove"); try Task.checkCancellation(); self.navigationController?.popToRootViewController(animated: true) } } })]]) }
    private func editPublicID() { confirm("群号只能修改一次，确认继续？", destructiveTitle: "继续") { [weak self] in self?.edit(title: "修改群号", value: self?.group?.publicId ?? self?.group?.id ?? "qun_") { [weak self] value in guard let self = self else { return }; try await self.context.change("groups/public-id/update", body: ["groupId": .string(self.groupID), "publicId": .string(value)]) } } }
    private func chooseAvatar() { var config = PHPickerConfiguration(); config.filter = .images; config.selectionLimit = 1; let picker = PHPickerViewController(configuration: config); picker.delegate = self; present(picker, animated: true) }
    func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
        picker.dismiss(animated: true)
        results.first?.itemProvider.loadObject(ofClass: UIImage.self) { [weak self] value, error in
            guard let image = value as? UIImage else { Task { @MainActor in self?.showNativeNotice(error?.localizedDescription ?? "无法读取头像。") }; return }
            let ratio = min(1, 720 / max(image.size.width, image.size.height)); let format = UIGraphicsImageRendererFormat(); format.scale = 1; let size = CGSize(width: image.size.width * ratio, height: image.size.height * ratio)
            let rendered = UIGraphicsImageRenderer(size: size, format: format).image { _ in image.draw(in: CGRect(origin: .zero, size: size)) }; guard let data = rendered.jpegData(compressionQuality: 0.88) else { return }
            Task { @MainActor in guard let self = self else { return }; self.perform { let file = try await self.context.upload(data: data, filename: "group-avatar.jpg", contentType: "image/jpeg", purpose: "avatar"); try await self.saveSetting("avatarFileId", .string(file.id)); self.scheduleReload() } }
        }
    }
    private func openMedia() { perform { [self] in let peer: NativeGroupPeer = try await context.request("im/groups/\(groupID)"); let conversation = try await service.openConversation(target: peer.imGroupId, type: 3); push(NativeGroupMediaController(service: service, conversation: conversation)) } }
    private func editName() { edit(title: "群聊名称", value: group?.name ?? "") { [weak self] name in try await self?.saveSetting("name", .string(name)) } }
    private func saveSetting(_ key: String, _ value: JSONValue) async throws { try await context.change("groups/settings/update", body: ["groupId": .string(groupID), key: value]) }
    private func updateSetting(_ key: String, _ value: JSONValue) { perform { [self] in do { try await saveSetting(key, value); scheduleReload() } catch { scheduleReload(); throw error } } }
    private func editMyNickname() { edit(title: "我在本群的昵称", value: group?.myNickname ?? "") { [weak self] name in guard let self = self else { return }; try await self.context.change("groups/\(self.groupID)/me/nickname", method: "PUT", body: ["nickname": .string(name)]) } }
    private func editRemark() { edit(title: "群备注", value: group?.remark ?? "") { [weak self] remark in guard let self = self else { return }; try await self.context.change("groups/\(self.groupID)/remark", method: "PUT", body: ["remark": .string(remark)]) } }
    private func invite() { push(NativeContactPickerController(service: service, title: "邀请好友") { [weak self] contacts in guard let self = self else { return }; self.perform { try await self.context.change("groups/\(self.groupID)/invitations", body: ["userIds": .array(contacts.map { .string($0.id) })]); self.scheduleReload() } }) }
    private func openChat() { perform { [self] in let target: NativeGroupPeer = try await context.request("im/groups/\(groupID)"); let conversation = try await service.openConversation(target: target.imGroupId, type: 3); push(NativeConversationViewController(service: service, conversation: conversation)) } }
    private func leave() {
        guard let group = group else { return }; let action = isOwner(group) ? "dismiss" : "leave"
        confirm(action == "dismiss" ? "解散后群聊将不可恢复，确定继续吗？" : "退出后将不再接收此群消息，并删除本群对话。确定退出吗？", destructiveTitle: action == "dismiss" ? "解散" : "退出") { [weak self] in guard let self = self else { return }; self.perform {
            var chat = self.conversation
            if chat == nil { do { let peer: NativeGroupPeer = try await self.context.request("im/groups/\(self.groupID)"); chat = try await self.service.openConversation(target: peer.imGroupId, type: 3) } catch { if Task.isCancelled { throw error } } }
            try await self.context.change("groups/\(self.groupID)/\(action)")
            var hideError: String?
            if let chat = chat { do { try await self.service.hide(chat) } catch { hideError = error.localizedDescription } } else { await self.service.loadConversations(reset: true) }
            try Task.checkCancellation(); let home = self.navigationController?.viewControllers.first; self.navigationController?.popToRootViewController(animated: true)
            if let error = hideError { home?.showNativeNotice("群成员状态已更新，本机对话隐藏失败，请刷新：" + error) }
        } }
    }
}

@MainActor
final class NativeGroupMembersController: NativeBusinessListController {
    private let service: NativeIMService; private let group: NativeGroup; private var members: [NativeGroupMember] = []; private var cursor: String?
    private var returningFromInvite = false
    init(service: NativeIMService, group: NativeGroup) { self.service = service; self.group = group; super.init(title: "群成员", context: service.business) }
    required init?(coder: NSCoder) { fatalError("不使用 Storyboard") }
    override func viewDidLoad() { super.viewDidLoad(); if group.canManage { navigationItem.rightBarButtonItem = UIBarButtonItem(title: "新增", style: .plain, target: self, action: #selector(inviteMembers)) } }
    @objc private func inviteMembers() { returningFromInvite = true; push(NativeContactPickerController(service: service, title: "邀请好友") { [weak self] contacts in guard let self = self else { return }; self.perform { try await self.context.change("groups/\(self.group.id)/invitations", body: ["userIds": .array(contacts.map { .string($0.id) })]); self.scheduleReload() } }) }
    override func reloadContent() { if returningFromInvite { returningFromInvite = false; refreshControl?.endRefreshing(); return }; load(reset: true) }
    private func load(reset: Bool) {
        perform { [self] in
            var query = [URLQueryItem(name: "groupId", value: group.id), URLQueryItem(name: "limit", value: "40")]; if !reset, let cursor = cursor { query.append(URLQueryItem(name: "cursor", value: cursor)) }
            let result: NativePage<NativeGroupMember> = try await context.request("group-members", query: query)
            if reset { members = [] }; members += result.items; cursor = result.nextCursor
            var rows = members.map { member in NativeBusinessRow(title: member.name, detail: member.role == "owner" ? "群主" : member.role == "admin" ? "管理员" : "", avatar: member.avatar, action: { [weak self] in self?.actions(member) }) }
            if result.hasMore { rows.append(NativeBusinessRow(title: "加载更多", action: { [weak self] in self?.load(reset: false) })) }; setRows([rows])
        }
    }
    private func actions(_ member: NativeGroupMember) {
        let sheet = UIAlertController(title: member.name, message: nil, preferredStyle: .actionSheet)
        sheet.addAction(UIAlertAction(title: "查看资料", style: .default) { [weak self] _ in guard let self = self else { return }; self.push(NativeContactController(service: self.service, userID: member.id, isFriend: false, groupID: self.group.id)) })
        sheet.addAction(UIAlertAction(title: "成员备注", style: .default) { [weak self] _ in self?.edit(title: "成员备注", value: member.memberRemark ?? "") { [weak self] value in guard let self = self else { return }; try await self.context.change("groups/\(self.group.id)/members/\(member.id)/remark", method: "PUT", body: ["remark": .string(value)]) } })
        if group.canManage, member.id != context.userID, member.role != "owner" {
            sheet.addAction(UIAlertAction(title: member.isMuted == true ? "解除禁言" : "禁言", style: .default) { [weak self] _ in self?.chooseMute(member) })
            if group.isOwner { sheet.addAction(UIAlertAction(title: member.role == "admin" ? "取消管理员" : "设为管理员", style: .default) { [weak self] _ in guard let self = self else { return }; self.perform { try await self.context.change("groups/\(self.group.id)/members/\(member.id)/role", method: "PUT", body: ["role": .string(member.role == "admin" ? "member" : "admin")]); self.scheduleReload() } }) }
            for deleteMessages in [false, true] { sheet.addAction(UIAlertAction(title: deleteMessages ? "移除并删除其消息" : "移除群成员", style: .destructive) { [weak self] _ in guard let self = self else { return }; self.confirm("确认移除 \(member.name)？", destructiveTitle: "移除") { self.perform { try await self.context.change("groups/\(self.group.id)/members/\(member.id)", method: "DELETE", body: ["deleteMessages": .bool(deleteMessages)]); self.scheduleReload() } } }) }
        }
        sheet.addAction(UIAlertAction(title: "取消", style: .cancel)); sheet.popoverPresentationController?.sourceView = tableView; present(sheet, animated: true)
    }
    private func chooseMute(_ member: NativeGroupMember) {
        func apply(_ seconds: Int?) { perform { [self] in var body: [String: JSONValue] = ["groupId": .string(group.id), "memberUserId": .string(member.id)]; if let seconds = seconds { body["mutedSeconds"] = .number(Double(seconds)) }; try await context.change(seconds == nil ? "group-members/unmute" : "group-members/mute", body: body); scheduleReload() } }
        if member.isMuted == true { apply(nil); return }
        let sheet = UIAlertController(title: "禁言时长", message: nil, preferredStyle: .actionSheet)
        for (title, seconds) in [("10分钟", 600), ("1小时", 3600), ("12小时", 43200), ("1天", 86400), ("7天", 604800), ("30天", 2592000)] { sheet.addAction(UIAlertAction(title: title, style: .default) { _ in apply(seconds) }) }; sheet.addAction(UIAlertAction(title: "取消", style: .cancel)); sheet.popoverPresentationController?.sourceView = tableView; present(sheet, animated: true)
    }
}

@MainActor
final class NativeGroupRequestsController: NativeBusinessListController {
    private let service: NativeIMService; private let groupID: String
    init(service: NativeIMService, groupID: String) { self.service = service; self.groupID = groupID; super.init(title: "入群申请", context: service.business) }
    required init?(coder: NSCoder) { fatalError("不使用 Storyboard") }
    override func reloadContent() { perform { [self] in let items: [NativeJoinRequest] = try await context.request("groups/\(groupID)/join-requests"); setRows([items.map { item in NativeBusinessRow(title: item.applicant.displayName, detail: item.remark + " · " + item.status, avatar: item.applicant.avatar, action: { [weak self] in self?.actions(item) }) }]) } }
    private func actions(_ item: NativeJoinRequest) { guard item.status == "pending" else { return }; let alert = UIAlertController(title: item.applicant.nickname, message: item.remark, preferredStyle: .alert); for (label, action) in [("通过", "approve"), ("拒绝", "reject")] { alert.addAction(UIAlertAction(title: label, style: action == "reject" ? .destructive : .default) { [weak self] _ in guard let self = self else { return }; self.perform { try await self.context.change("groups/\(self.groupID)/join-requests/\(item.id)/\(action)"); self.scheduleReload() } }) }; alert.addAction(UIAlertAction(title: "取消", style: .cancel)); present(alert, animated: true) }
}

@MainActor
final class NativeAnnouncementsController: NativeBusinessListController {
    private let service: NativeIMService; private let group: NativeGroup
    init(service: NativeIMService, group: NativeGroup) { self.service = service; self.group = group; super.init(title: "群公告", context: service.business) }
    required init?(coder: NSCoder) { fatalError("不使用 Storyboard") }
    override func viewDidLoad() { super.viewDidLoad(); if group.permissions?.canEditAnnouncement ?? group.canManage { navigationItem.rightBarButtonItem = UIBarButtonItem(barButtonSystemItem: .add, target: self, action: #selector(create)) } }
    override func reloadContent() { perform { [self] in struct Result: Decodable { let items: [NativeAnnouncement] }; let result: Result = try await context.request("group-announcements", query: [URLQueryItem(name: "groupId", value: group.id)]); setRows([result.items.map { item in NativeBusinessRow(title: item.content, detail: (item.publisherName ?? "") + " " + item.createdAt, action: { [weak self] in self?.open(item) }) }]) } }
    @objc private func create() { push(NativeAnnouncementEditor(context: context, groupID: group.id)) }
    private func open(_ item: NativeAnnouncement) {
        let list = NativeBusinessListController(title: "群公告", context: context); list.loadViewIfNeeded()
        var rows = [NativeBusinessRow(title: item.content, detail: item.createdAt)]
        rows += (item.images ?? []).map { url in NativeBusinessRow(title: "查看公告图片", avatar: url, action: { [weak list, weak self] in guard let self = self else { return }; list?.push(NativeImagePreviewController(url: url, policy: self.context.media)) }) }
        if group.permissions?.canEditAnnouncement ?? group.canManage {
            rows.append(NativeBusinessRow(title: "编辑公告", action: { [weak list, weak self] in guard let self = self else { return }; list?.push(NativeAnnouncementEditor(context: self.context, groupID: self.group.id, item: item)) }))
            rows.append(NativeBusinessRow(title: "删除公告", destructive: true, action: { [weak self, weak list] in list?.confirm("确认删除此条群公告？", destructiveTitle: "删除") { guard let self = self else { return }; list?.perform { try await self.context.change("group-announcements/delete", body: ["groupId": .string(self.group.id), "announcementId": .string(item.id)]); list?.navigationController?.popViewController(animated: true) } } }))
        }; list.setRows([rows]); push(list)
    }
}
