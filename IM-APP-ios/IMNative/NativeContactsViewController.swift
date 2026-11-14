import UIKit
import IMCore

@MainActor
final class NativeContactsViewController: NativeBusinessListController {
    private let service: NativeIMService
    private var contacts: [NativeContact] = []
    private var cursor: String?
    private var sort = "recent"
    private let search = UITextField()
    private let searchHolder = UIView()
    private var headerWidth: CGFloat = 0
    private var groups: [NativeGroup] = []
    private var searchTask: Task<Void, Never>?
    private var requestID = UUID()
    init(service: NativeIMService) { self.service = service; super.init(title: "通讯录", context: service.business, style: .plain) }
    required init?(coder: NSCoder) { fatalError("不使用 Storyboard") }
    override func viewDidLoad() {
        super.viewDidLoad(); tableView.backgroundColor = .white; tableView.separatorStyle = .none; tableView.sectionHeaderTopPadding = 0
        search.placeholder = "搜索"; search.backgroundColor = UIColor(hex: 0xf3f4f7); search.layer.cornerRadius = 4; search.clearButtonMode = .whileEditing
        search.addTarget(self, action: #selector(searchChanged), for: .editingChanged)
        let searchIcon = UIImageView(image: UIImage(systemName: "magnifyingglass")); searchIcon.tintColor = UIColor(hex: 0x8a8f9c); searchIcon.contentMode = .center; searchIcon.frame = CGRect(x: 0, y: 0, width: 40, height: 34); search.leftView = searchIcon; search.leftViewMode = .always
        tableView.register(NativeDirectoryCell.self, forCellReuseIdentifier: "directory")
        // 搜索固定，快捷入口、群聊与联系人共用唯一的 UITableView 滚动区域。
        searchHolder.backgroundColor = .white; searchHolder.addSubview(search); tableView.addSubview(searchHolder)
        tableView.keyboardDismissMode = .onDrag; tableView.accessibilityIdentifier = "contactsWholePageScroll"
        buildHeader()
        navigationItem.rightBarButtonItem = UIBarButtonItem(barButtonSystemItem: .add, target: self, action: #selector(addFriend))
    }
    override func reloadContent() { load(reset: true) }
    @objc private func searchChanged() {
        searchTask?.cancel(); searchTask = Task { do { try await Task.sleep(nanoseconds: 300_000_000) } catch { return }; load(reset: true) }
    }
    private func showSort(_ anchor: UIView) {
        showAnchoredNativeMenu(anchor: anchor, items: [("最近加入（默认）", "recent"), ("名字", "name"), ("最近聊天", "chat")].map { label, value in NativeMenuItem(title: label, action: { [weak self] in self?.sort = value; self?.load(reset: true) }) }, width: 280)
    }
    private func load(reset: Bool) {
        let id = UUID(); requestID = id
        let keyword = search.text ?? "", order = sort == "name" ? "name" : "recent", next = reset ? nil : cursor
        Task { [weak self] in
            guard let self = self else { return }
            defer { if self.requestID == id { self.refreshControl?.endRefreshing() } }
            do {
                let page = try await self.context.contacts(keyword: keyword, sort: order, cursor: next)
                guard self.requestID == id else { return }
                if reset { self.contacts = [] }; self.contacts += page.items; self.cursor = page.nextCursor
                if reset {
                    do {
                        var values: [NativeGroup] = []; var cursor: String?; var seen = Set<String>()
                        repeat { var query = [URLQueryItem(name: "limit", value: "100")]; if let cursor = cursor { query.append(URLQueryItem(name: "cursor", value: cursor)) }; let page: NativePage<NativeGroup> = try await self.context.request("groups", query: query); guard self.requestID == id else { return }; values += page.items.filter { $0.status != "dismissed" }; if !page.hasMore { break }; guard let next = page.nextCursor, seen.insert(next).inserted else { throw APIError.invalidResponse }; cursor = next } while true
                        self.groups = values
                    }
                    catch { guard self.requestID == id else { return }; self.showNativeNotice("群聊列表读取失败：" + error.localizedDescription) }
                    guard self.requestID == id else { return }; self.buildHeader()
                }
                if self.sort == "chat" {
                    let time = Dictionary(self.service.conversations.filter { $0.type == 1 }.map { (GroupVisibility.businessUserID($0.target), $0.timestamp) }, uniquingKeysWith: max)
                    self.contacts.sort { (time[$0.id] ?? 0) > (time[$1.id] ?? 0) }
                }
                var rows = self.contacts.map { contact in NativeBusinessRow(title: contact.displayName, detail: contact.publicId ?? "", avatar: contact.avatar, action: { [weak self] in guard let self = self else { return }; self.push(NativeContactController(service: self.service, userID: contact.id, isFriend: true)) }) }
                if page.hasMore, page.nextCursor != nil { rows.append(NativeBusinessRow(title: "加载更多", action: { [weak self] in self?.load(reset: false) })) }
                self.setRows([rows]); self.tableView.rowHeight = NativeUITheme.rpx(144, width: self.view.bounds.width)
                let footer = UILabel(frame: CGRect(x: 0, y: 0, width: self.view.bounds.width, height: 60)); footer.text = page.hasMore ? "" : "没有更多了"; footer.textAlignment = .center; footer.font = .systemFont(ofSize: 12); footer.textColor = UIColor(hex: 0x8a8f9c); self.tableView.tableFooterView = footer
            } catch { guard self.requestID == id else { return }; self.showNativeNotice(error.localizedDescription) }
        }
    }
    @objc private func addFriend() { push(NativeAddFriendController(service: service)) }
    private func buildHeader() {
        let width = view.bounds.width, r: (CGFloat) -> CGFloat = { NativeUITheme.rpx($0, width: width) }
        let header = UIView(); header.backgroundColor = .white
        headerWidth = width
        var y = r(112)
        let shortcuts = [("新的朋友", "uni_menu_new_friend"), ("标签", "uni_menu_tag"), ("群聊天", "uni_menu_group")]
        for (index, item) in shortcuts.enumerated() {
            let button = UIButton(type: .custom); button.frame = CGRect(x: 0, y: y, width: width, height: r(96))
            let icon = UIImageView(image: NativeUITheme.image(item.1)); icon.frame = CGRect(x: r(40), y: r(28), width: r(40), height: r(40)); icon.contentMode = .scaleAspectFit
            let title = NativeUITheme.label(item.0, size: r(32)); title.frame = CGRect(x: r(96), y: 0, width: width - r(176), height: r(96))
            let chevron = UIImageView(image: UIImage(systemName: "chevron.right")); chevron.tintColor = NativeUITheme.body; chevron.contentMode = .scaleAspectFit; chevron.frame = CGRect(x: width - r(72), y: r(32), width: r(24), height: r(32))
            [icon, title, chevron].forEach { button.addSubview($0) }; button.addAction(UIAction { [weak self] _ in guard let self = self else { return }; if index == 0 { self.push(NativeFriendRequestsController(service: self.service)) } else if index == 1 { self.push(NativeTagsController(service: self.service)) } else { self.push(NativeGroupsController(service: self.service)) } }, for: .touchUpInside)
            header.addSubview(button); y += r(96)
        }
        let groupBackground = UIView(); groupBackground.backgroundColor = UIColor(hex: 0xf3f4f7); groupBackground.frame = CGRect(x: 0, y: y, width: width, height: groups.isEmpty ? 0 : r(32) + CGFloat(min(groups.count, 3)) * r(144) + (groups.count > 3 ? r(80) : 0)); header.addSubview(groupBackground)
        for (index, group) in groups.prefix(3).enumerated() {
            let button = UIButton(type: .custom); button.backgroundColor = .white; button.layer.cornerRadius = r(8); button.frame = CGRect(x: r(40), y: r(16) + CGFloat(index) * r(144), width: width - r(80), height: r(128))
            let avatar = NativeRemoteImageView(frame: CGRect(x: r(16), y: r(16), width: r(96), height: r(96))); avatar.contentMode = .scaleAspectFill; avatar.clipsToBounds = true; avatar.layer.cornerRadius = r(48); avatar.load(group.avatar, policy: context.media, placeholder: "uni_group_default")
            let name = NativeUITheme.label(group.name, size: r(34)); name.frame = CGRect(x: r(144), y: 0, width: button.bounds.width - r(160), height: r(128))
            button.addSubview(avatar); button.addSubview(name); button.addAction(UIAction { [weak self] _ in guard let self = self else { return }; Task { do { let peer: NativeGroupPeer = try await self.context.request("im/groups/\(group.id)"); let chat = try await self.service.openConversation(target: peer.imGroupId, type: 3); self.push(NativeConversationViewController(service: self.service, conversation: chat)) } catch { self.showNativeNotice(error.localizedDescription) } } }, for: .touchUpInside); groupBackground.addSubview(button)
        }
        if groups.count > 3 { let expand = UIButton(type: .system); expand.frame = CGRect(x: r(40), y: r(16) + 3 * r(144), width: width - r(80), height: r(80)); expand.setTitle("展开所有群聊 (\(groups.count))", for: .normal); expand.setTitleColor(NativeUITheme.secondary, for: .normal); expand.titleLabel?.font = .systemFont(ofSize: r(26)); expand.addAction(UIAction { [weak self] _ in guard let self = self else { return }; self.push(NativeGroupsController(service: self.service)) }, for: .touchUpInside); groupBackground.addSubview(expand) }
        y = groupBackground.frame.maxY + r(64); header.frame = CGRect(x: 0, y: 0, width: width, height: y); tableView.tableHeaderView = header
        layoutSearch()
    }
    private func layoutSearch() {
        let width = tableView.bounds.width, r = width / 750
        searchHolder.frame = CGRect(x: 0, y: tableView.contentOffset.y + tableView.adjustedContentInset.top, width: width, height: 112 * r)
        search.frame = CGRect(x: 40 * r, y: 16 * r, width: width - 80 * r, height: 72 * r); search.font = .systemFont(ofSize: 28 * r)
        tableView.bringSubviewToFront(searchHolder)
        tableView.verticalScrollIndicatorInsets.top = 112 * r
    }
    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        if abs(headerWidth - view.bounds.width) > 0.5 { buildHeader() }; layoutSearch()
    }
    override func scrollViewDidScroll(_ scrollView: UIScrollView) { layoutSearch() }
    override func tableView(_ tableView: UITableView, viewForHeaderInSection section: Int) -> UIView? {
        let width = view.bounds.width, r: (CGFloat) -> CGFloat = { NativeUITheme.rpx($0, width: width) }
        let header = UIView(frame: CGRect(x: 0, y: 0, width: width, height: r(64))); header.backgroundColor = .white
        let title = NativeUITheme.label("联络人 (\(contacts.count))", size: r(28), weight: .bold); title.frame = CGRect(x: r(40), y: 0, width: width / 2, height: r(48)); header.addSubview(title)
        let button = UIButton(type: .system); button.setTitle(sort == "name" ? "名字 ▾" : sort == "chat" ? "最近聊天 ▾" : "最近加入（默认） ▾", for: .normal); button.setTitleColor(NativeUITheme.secondary, for: .normal); button.titleLabel?.font = .systemFont(ofSize: r(24)); button.frame = CGRect(x: width / 2, y: 0, width: width / 2 - r(32), height: r(48)); button.addAction(UIAction { [weak self, weak button] _ in if let button = button { self?.showSort(button) } }, for: .touchUpInside); header.addSubview(button); return header
    }
    override func tableView(_ tableView: UITableView, heightForHeaderInSection section: Int) -> CGFloat { NativeUITheme.rpx(64, width: view.bounds.width) }
    override func tableView(_ tableView: UITableView, heightForRowAt indexPath: IndexPath) -> CGFloat { NativeUITheme.rpx(144, width: view.bounds.width) }
    override func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        if indexPath.row >= contacts.count { return super.tableView(tableView, cellForRowAt: indexPath) }
        let contact = contacts[indexPath.row]; let cell = tableView.dequeueReusableCell(withIdentifier: "directory", for: indexPath) as! NativeDirectoryCell
        cell.name.text = contact.displayName; cell.avatar.load(contact.avatar, policy: context.media); return cell
    }
}

private final class NativeDirectoryCell: UITableViewCell {
    let avatar = NativeRemoteImageView(); let name = UILabel()
    override init(style: UITableViewCell.CellStyle, reuseIdentifier: String?) { super.init(style: style, reuseIdentifier: reuseIdentifier); [avatar, name].forEach { contentView.addSubview($0) }; avatar.contentMode = .scaleAspectFill; avatar.clipsToBounds = true; name.textColor = NativeUITheme.body; selectionStyle = .none }
    required init?(coder: NSCoder) { fatalError("不使用 Storyboard") }
    override func layoutSubviews() { super.layoutSubviews(); let width = bounds.width, r: (CGFloat) -> CGFloat = { NativeUITheme.rpx($0, width: width) }; avatar.frame = CGRect(x: r(40), y: r(24), width: r(96), height: r(96)); avatar.layer.cornerRadius = r(48); name.frame = CGRect(x: r(168), y: 0, width: width - r(208), height: bounds.height); name.font = .systemFont(ofSize: r(34)) }
    override func prepareForReuse() { super.prepareForReuse(); avatar.cancel(); name.text = nil }
}

@MainActor
final class NativeAddFriendController: NativeBusinessListController, UISearchBarDelegate {
    private let service: NativeIMService; private let search = UISearchBar()
    init(service: NativeIMService) { self.service = service; super.init(title: "添加朋友", context: service.business) }
    required init?(coder: NSCoder) { fatalError("不使用 Storyboard") }
    override func viewDidLoad() {
        super.viewDidLoad(); navigationItem.rightBarButtonItem = UIBarButtonItem(title: "扫一扫", style: .plain, target: self, action: #selector(scan)); search.placeholder = "输入对方的易可聊号"; search.delegate = self; search.frame.size.height = 56; search.returnKeyType = .search; tableView.tableHeaderView = search
    }
    @objc private func scan() { push(NativeQRScannerController(service: service)) }
    func searchBarSearchButtonClicked(_ searchBar: UISearchBar) {
        searchBar.resignFirstResponder(); let keyword = (searchBar.text ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard !keyword.isEmpty else { return }
        perform { [self] in
            do {
                let user: UserProfile = try await context.request("users/search", query: [URLQueryItem(name: "publicId", value: keyword)])
                setRows([[NativeBusinessRow(title: user.nickname, detail: user.publicId, avatar: user.avatar, action: { [weak self] in guard let self = self else { return }; self.push(NativeContactController(service: self.service, userID: user.id, isFriend: false)) })]])
            } catch APIError.emptyPayload { setRows([[NativeBusinessRow(title: "未找到该用户")]]) }
        }
    }
}

@MainActor
final class NativeContactController: NativeBusinessListController {
    private let service: NativeIMService; private let userID: String; private var isFriend: Bool; private let groupID: String?
    private var contact: NativeContact?; private var conversation: NativeConversation?; private var conversationError: String?
    private let more = NativeUITheme.imageButton("uni_icon_more", accessibility: "更多")
    private let verification = UITextField()
    init(service: NativeIMService, userID: String, isFriend: Bool, groupID: String? = nil) { self.service = service; self.userID = userID; self.isFriend = isFriend; self.groupID = groupID; super.init(title: "详细资料", context: service.business, style: .plain) }
    required init?(coder: NSCoder) { fatalError("不使用 Storyboard") }
    override func viewDidLoad() {
        super.viewDidLoad(); tableView.backgroundColor = .white; tableView.separatorStyle = .none
        more.frame = CGRect(x: 0, y: 0, width: 36, height: 36); more.transform = CGAffineTransform(rotationAngle: .pi / 2)
        more.addTarget(self, action: #selector(showMore), for: .touchUpInside)
        verification.text = "我是\(context.profile.nickname)"; verification.placeholder = "填写验证消息"; verification.clearButtonMode = .whileEditing
    }
    override func viewWillAppear(_ animated: Bool) { super.viewWillAppear(animated); updateNavigation() }
    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        navigationItem.standardAppearance = nil; navigationItem.scrollEdgeAppearance = nil; navigationItem.compactAppearance = nil
        navigationController?.navigationBar.tintColor = NativeUITheme.body
    }
    private func updateNavigation() {
        title = isFriend ? "好友详情" : "详细资料"; navigationItem.rightBarButtonItem = isFriend ? UIBarButtonItem(customView: more) : nil
        let appearance = UINavigationBarAppearance(); appearance.configureWithOpaqueBackground(); appearance.backgroundColor = isFriend ? NativeUITheme.primary : .white
        appearance.shadowColor = .clear; appearance.titleTextAttributes = [.foregroundColor: isFriend ? UIColor.white : NativeUITheme.body]
        navigationItem.standardAppearance = appearance; navigationItem.scrollEdgeAppearance = appearance; navigationItem.compactAppearance = appearance
        navigationController?.navigationBar.tintColor = isFriend ? .white : NativeUITheme.body
        more.setImage(NativeUITheme.image("uni_icon_more")?.withRenderingMode(.alwaysTemplate), for: .normal); more.tintColor = .white
    }
    override func reloadContent() {
        perform { [self] in
            if userID != context.userID {
                do { contact = try await context.request("contacts/\(userID)"); isFriend = true }
                catch APIError.httpStatus(404) { isFriend = false }
                catch APIError.business(let code, let message) { guard code == 404 else { throw APIError.business(code: code, message: message) }; isFriend = false }
            } else { isFriend = false }
            if !isFriend { contact = try await context.request("users/\(userID)", query: groupID.map { [URLQueryItem(name: "groupId", value: $0)] } ?? []) }
            try Task.checkCancellation(); guard let c = contact else { return }
            conversation = nil; conversationError = nil
            if isFriend {
                do { let peer: NativePeer = try await context.request("im/peers/\(userID)"); conversation = try await service.openConversation(target: peer.imUserId, type: 1) }
                catch { if Task.isCancelled { throw error }; conversationError = error.localizedDescription }
            }
            try Task.checkCancellation(); updateNavigation(); render(c)
        }
    }
    private func render(_ c: NativeContact) {
        buildHeader(c); buildFooter()
        guard isFriend else { setRows([]); return }
        var info = [NativeBusinessRow(title: "备注", detail: c.remark ?? "", action: { [weak self] in self?.editRemark() })]
        if let value = c.friendSince, !value.isEmpty { info.append(NativeBusinessRow(title: "添加时间", detail: Self.date(value))) }
        if let value = c.lastSeenAt, !value.isEmpty { info.append(NativeBusinessRow(title: "最近上线", detail: Self.date(value))) }
        info.append(NativeBusinessRow(title: "聊天号", detail: c.publicId ?? c.id))
        info.append(NativeBusinessRow(title: "标签", detail: c.tags?.map(\.name).joined(separator: "、") ?? "", action: { [weak self] in guard let self = self else { return }; self.push(NativeFriendTagsController(service: self.service, userID: self.userID)) }))
        var groups = (c.commonGroups ?? []).prefix(3).map { group in NativeBusinessRow(title: group.name, avatar: group.avatar, action: { [weak self] in guard let self = self else { return }; self.push(NativeGroupController(service: self.service, groupID: group.id)) }) }
        if (c.commonGroups?.count ?? 0) > 3 { groups.append(NativeBusinessRow(title: "查看全部共同群组", action: { [weak self] in guard let self = self else { return }; self.push(NativeCommonGroupsController(service: self.service, userID: self.userID)) })) }
        var sections = [info]; var titles = [""]
        if !groups.isEmpty { sections.append(groups); titles.append("共同群组（\(c.commonGroups?.count ?? 0)）") }
        if let chat = conversation {
            sections.append([NativeBusinessRow(title: "消息免打扰", checked: chat.muted, toggle: { [weak self] value in self?.setConversation(value, pinned: false) }), NativeBusinessRow(title: "置顶聊天", checked: chat.pinned, toggle: { [weak self] value in self?.setConversation(value, pinned: true) })]); titles.append("")
        } else if let error = conversationError { sections.append([NativeBusinessRow(title: "会话设置加载失败，点此重试", detail: error, action: { [weak self] in self?.reloadContent() })]); titles.append("") }
        setRows(sections, titles: titles)
    }
    private func buildHeader(_ c: NativeContact) {
        let w = view.bounds.width, r: (CGFloat) -> CGFloat = { $0 * w / 750 }
        let header = UIView(frame: CGRect(x: 0, y: 0, width: w, height: isFriend ? r(484) : r(c.bio?.isEmpty == false ? 430 : 360))); header.backgroundColor = .white
        if isFriend {
            let hero = UIImageView(image: NativeUITheme.image("uni_friend_info_bg")); hero.backgroundColor = NativeUITheme.primary; hero.contentMode = .scaleAspectFill; hero.clipsToBounds = true; hero.frame = CGRect(x: 0, y: 0, width: w, height: r(350)); header.addSubview(hero)
            let sheet = UIView(frame: CGRect(x: 0, y: r(310), width: w, height: r(174))); sheet.backgroundColor = .white; sheet.layer.cornerRadius = r(32); sheet.layer.maskedCorners = [.layerMinXMinYCorner, .layerMaxXMinYCorner]; header.addSubview(sheet)
        }
        let avatar = NativeRemoteImageView(frame: CGRect(x: isFriend ? r(48) : (w - r(140)) / 2, y: isFriend ? r(270) : r(32), width: r(isFriend ? 144 : 140), height: r(isFriend ? 144 : 140))); avatar.contentMode = .scaleAspectFill; avatar.clipsToBounds = true; avatar.layer.cornerRadius = avatar.bounds.width / 2; avatar.layer.borderColor = UIColor.white.cgColor; avatar.layer.borderWidth = isFriend ? r(4) : 0; avatar.load(c.avatar, policy: context.media); header.addSubview(avatar)
        let name = NativeUITheme.label(c.displayName, size: r(isFriend ? 34 : 36), weight: .bold); name.frame = CGRect(x: isFriend ? r(216) : r(40), y: isFriend ? r(340) : r(196), width: isFriend ? w - r(256) : w - r(80), height: r(48)); name.textAlignment = isFriend ? .left : .center; header.addSubview(name)
        let subtitle = NativeUITheme.label(isFriend ? (c.remark?.isEmpty == false && c.remark != c.nickname ? "昵称：\(c.nickname)" : "") : "聊天号：\(c.publicId ?? c.id)", size: r(24), color: NativeUITheme.secondary); subtitle.frame = CGRect(x: name.frame.minX, y: name.frame.maxY + r(6), width: name.frame.width, height: r(34)); subtitle.textAlignment = name.textAlignment; header.addSubview(subtitle)
        if isFriend, c.isBlocked == true { let tag = NativeUITheme.label("已拉黑", size: r(22), color: UIColor(hex: 0xe54d42)); tag.backgroundColor = UIColor(hex: 0xffe5e5); tag.textAlignment = .center; tag.layer.cornerRadius = r(8); tag.clipsToBounds = true; tag.frame = CGRect(x: name.frame.minX, y: subtitle.frame.maxY + r(8), width: r(100), height: r(32)); header.addSubview(tag) }
        if !isFriend, let bio = c.bio, !bio.isEmpty { let label = NativeUITheme.label(bio, size: r(28), color: NativeUITheme.secondary); label.numberOfLines = 3; label.textAlignment = .center; label.frame = CGRect(x: r(48), y: r(292), width: w - r(96), height: r(116)); header.addSubview(label) }
        let line = UIView(frame: CGRect(x: r(40), y: header.bounds.height - 1, width: w - r(80), height: 0.5)); line.backgroundColor = UIColor(hex: 0xe1e3ea); header.addSubview(line); tableView.tableHeaderView = header
    }
    private func buildFooter() {
        let w = view.bounds.width, r: (CGFloat) -> CGFloat = { $0 * w / 750 }
        let hasVerification = !isFriend && userID != context.userID
        let footer = UIView(frame: CGRect(x: 0, y: 0, width: w, height: r(hasVerification ? 310 : 180))); footer.backgroundColor = .white
        if hasVerification { verification.removeFromSuperview(); verification.frame = CGRect(x: r(40), y: r(24), width: w - r(80), height: r(88)); verification.backgroundColor = UIColor(hex: 0xf3f4f7); verification.layer.cornerRadius = r(10); verification.font = .systemFont(ofSize: r(28)); footer.addSubview(verification) }
        let button = UIButton(type: .system); button.frame = CGRect(x: r(40), y: r(hasVerification ? 150 : 40), width: w - r(80), height: r(96)); button.backgroundColor = NativeUITheme.primary; button.layer.cornerRadius = r(16); button.setTitle(userID == context.userID ? "个人资料" : isFriend ? "发消息" : "添加到通讯录", for: .normal); button.setTitleColor(.white, for: .normal); button.titleLabel?.font = .systemFont(ofSize: r(32))
        if isFriend { button.setImage(NativeUITheme.image("uni_icon_chat_white"), for: .normal); button.imageView?.contentMode = .scaleAspectFit }
        button.addAction(UIAction { [weak self] _ in guard let self = self else { return }; if self.userID == self.context.userID { self.push(NativeProfileController(context: self.context, service: self.service)) } else if self.isFriend { self.openChat() } else { self.sendRequest() } }, for: .touchUpInside); footer.addSubview(button); tableView.tableFooterView = footer
    }
    override func viewDidLayoutSubviews() { super.viewDidLayoutSubviews(); if let c = contact, abs((tableView.tableHeaderView?.bounds.width ?? 0) - view.bounds.width) > 0.5 { buildHeader(c); buildFooter() } }
    override func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        let cell = super.tableView(tableView, cellForRowAt: indexPath)
        if sections[indexPath.section][indexPath.row].title == "聊天号" { let copy = UIButton(type: .system); copy.setImage(UIImage(systemName: "doc.on.doc"), for: .normal); copy.frame = CGRect(x: 0, y: 0, width: 38, height: 38); copy.accessibilityLabel = "复制聊天号"; copy.addAction(UIAction { [weak self] _ in guard let self = self else { return }; UIPasteboard.general.string = self.contact?.publicId ?? self.userID }, for: .touchUpInside); cell.accessoryView = copy } else { cell.accessoryView = nil }
        return cell
    }
    private static func date(_ raw: String) -> String { let formatter = ISO8601DateFormatter(); formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]; guard let date = formatter.date(from: raw) ?? ISO8601DateFormatter().date(from: raw) else { return raw }; let display = DateFormatter(); display.dateFormat = "yyyy-MM-dd HH:mm"; return display.string(from: date) }
    @objc private func showMore() { showAnchoredNativeMenu(anchor: more, items: [NativeMenuItem(title: contact?.isBlocked == true ? "解除黑名单" : "加入黑名单", action: { [weak self] in self?.setBlocked(self?.contact?.isBlocked != true) }), NativeMenuItem(title: "删除好友", destructive: true, action: { [weak self] in self?.deleteFriend() })], width: 320) }
    private func setConversation(_ value: Bool, pinned: Bool) { guard let chat = conversation else { return }; perform { [self] in do { if pinned { try await service.setPinned(value, conversation: chat) } else { try await service.setMuted(value, conversation: chat) }; scheduleReload() } catch { scheduleReload(); throw error } } }
    private func editRemark() { edit(title: "设置备注", value: contact?.remark ?? "") { [weak self] value in guard let self = self else { return }; try await self.context.change("contacts/\(self.userID)", method: "PATCH", body: ["remark": .string(value)]) } }
    private func setBlocked(_ value: Bool) { confirm(value ? "加入黑名单后将隐藏与他的对话，确认继续？" : "确认解除黑名单？", destructiveTitle: value ? "加入" : "解除") { [weak self] in guard let self = self else { return }; self.perform { let chat = self.conversation; try await self.context.change("contacts/\(self.userID)/block", method: value ? "POST" : "DELETE", body: value ? [:] : nil); if value, let chat = chat { do { try await self.service.hide(chat) } catch { self.showNativeNotice("黑名单已更新，本机对话隐藏失败：" + error.localizedDescription) } } else { await self.service.loadConversations(reset: true) }; self.scheduleReload() } } }
    private func deleteFriend() { confirm("删除后将不再显示该联系人，并删除与他的对话。", destructiveTitle: "删除好友") { [weak self] in guard let self = self else { return }; self.perform { let chat = self.conversation; try await self.context.change("contacts/\(self.userID)", method: "DELETE", body: nil); if let chat = chat { do { try await self.service.hide(chat) } catch { self.showNativeNotice("好友已删除，本机对话隐藏失败：" + error.localizedDescription); self.isFriend = false; self.scheduleReload(); return } }; try Task.checkCancellation(); self.navigationController?.popToRootViewController(animated: true) } } }
    private func sendRequest() { let message = (verification.text ?? "").trimmingCharacters(in: .whitespacesAndNewlines); guard !message.isEmpty else { showNativeNotice("请填写验证消息。"); return }; perform { [self] in var body: [String: JSONValue] = ["toUserId": .string(userID), "message": .string(message)]; let path: String; if let groupID = groupID { path = "group-friend-requests"; body["groupId"] = .string(groupID) } else { path = "friend-requests" }; try await context.change(path, body: body); try Task.checkCancellation(); showNativeNotice("好友申请已提交。") } }
    private func openChat() { perform { [self] in let peer: NativePeer = try await context.request("im/peers/\(userID)"); guard peer.canChat else { throw APIError.business(code: -1, message: peer.denyReason ?? "当前不能发起聊天。") }; let chat = try await service.openConversation(target: peer.imUserId, type: 1); try Task.checkCancellation(); push(NativeConversationViewController(service: service, conversation: chat)) } }
}

@MainActor
final class NativeFriendRequestsController: NativeBusinessListController {
    private let service: NativeIMService
    init(service: NativeIMService) { self.service = service; super.init(title: "新的朋友", context: service.business) }
    required init?(coder: NSCoder) { fatalError("不使用 Storyboard") }
    override func reloadContent() {
        perform { [self] in
            let result: NativeFriendRequests = try await context.request("friend-requests/sync", method: "POST", body: ["direction": .string("received")])
            setRows([result.pending.map(row), result.recent.map(row)], titles: ["待处理", "最近"])
        }
    }
    private func row(_ item: NativeFriendRequest) -> NativeBusinessRow { NativeBusinessRow(title: item.fromUser.displayName, detail: item.message + " · " + (item.status == "pending" ? "待验证" : item.status == "accepted" ? "已添加" : "已拒绝"), avatar: item.fromUser.avatar, action: { [weak self] in self?.actions(item) }) }
    private func actions(_ request: NativeFriendRequest) {
        if request.status != "pending" { push(NativeContactController(service: service, userID: request.fromUser.id, isFriend: request.status == "accepted")); return }
        let alert = UIAlertController(title: request.fromUser.displayName, message: request.message, preferredStyle: .alert)
        for (title, action) in [("接受", "accept"), ("拒绝", "reject")] {
            alert.addAction(UIAlertAction(title: title, style: action == "reject" ? .destructive : .default) { [weak self] _ in guard let self = self else { return }; self.perform { try await self.context.change("friend-requests/\(request.id)/\(action)"); self.scheduleReload() } })
        }; alert.addAction(UIAlertAction(title: "取消", style: .cancel)); present(alert, animated: true)
    }
}

@MainActor
final class NativeFriendTagsController: UIViewController {
    private let service: NativeIMService; private let userID: String
    private let scroll = UIScrollView(); private let assigned = NativeTagChipFlow(); private let all = NativeTagChipFlow()
    private let assignedTitle = UILabel(); private let allTitle = UILabel(); private let confirm = UIButton(type: .system); private let edit = UIButton(type: .system); private let empty = UILabel()
    private var tags: [NativeTag] = []; private var selected = Set<String>(); private var initial = Set<String>(); private var task: Task<Void, Never>?; private var operation = UUID(); private var saving = false
    init(service: NativeIMService, userID: String) { self.service = service; self.userID = userID; super.init(nibName: nil, bundle: nil); title = "新增标签" }
    required init?(coder: NSCoder) { fatalError("不使用 Storyboard") }
    override func viewDidLoad() { super.viewDidLoad(); view.backgroundColor = .white; view.addSubview(scroll); [assignedTitle, assigned, allTitle, all, confirm, edit, empty].forEach { scroll.addSubview($0) }; assignedTitle.text = "已有标签"; allTitle.text = "全部标签"; empty.text = "暂无标签"; empty.textColor = NativeUITheme.secondary; confirm.setTitle("确认", for: .normal); confirm.addTarget(self, action: #selector(save), for: .touchUpInside); edit.setTitle("编辑 ›", for: .normal); edit.setTitleColor(NativeUITheme.secondary, for: .normal); edit.addAction(UIAction { [weak self] _ in guard let self = self else { return }; self.navigationController?.pushViewController(NativeTagsController(service: self.service), animated: true) }, for: .touchUpInside) }
    override func viewWillAppear(_ animated: Bool) { super.viewWillAppear(animated); navigationController?.setNavigationBarHidden(false, animated: animated); let id = UUID(); operation = id; task?.cancel(); task = Task { [weak self] in guard let self = self else { return }; do { let tags: [NativeTag] = try await self.service.business.request("contact-tags"); let contact: NativeContact = try await self.service.business.request("contacts/\(self.userID)"); try Task.checkCancellation(); guard self.operation == id else { return }; self.tags = tags; self.selected = Set(contact.tags?.map(\.id) ?? []); self.initial = self.selected; self.render() } catch { if !Task.isCancelled, self.operation == id { self.showNativeNotice(error.localizedDescription) } } } }
    override func viewWillDisappear(_ animated: Bool) { super.viewWillDisappear(animated); if isMovingFromParent || isBeingDismissed { operation = UUID(); task?.cancel() } }
    private func toggle(_ id: String) { guard !saving else { return }; if selected.contains(id) { selected.remove(id) } else { selected.insert(id) }; render() }
    private func render() { assigned.set(tags.filter { selected.contains($0.id) }.map { tag in .init(title: "× " + tag.name, selected: true, add: false, action: { [weak self] in self?.toggle(tag.id) }) }); all.set(tags.map { tag in .init(title: (selected.contains(tag.id) ? "× " : "+ ") + tag.name, selected: selected.contains(tag.id), add: false, action: { [weak self] in self?.toggle(tag.id) }) } + [.init(title: "+ 新增", selected: false, add: true, action: { [weak self] in self?.create() })]); confirm.isEnabled = !saving && selected != initial; confirm.setTitleColor(confirm.isEnabled ? NativeUITheme.primary : UIColor(hex: 0x848ea9), for: .normal); empty.isHidden = !selected.isEmpty; view.setNeedsLayout() }
    override func viewDidLayoutSubviews() { super.viewDidLayoutSubviews(); let w = view.bounds.width, r = w / 750; scroll.frame = view.bounds; scroll.contentInset = UIEdgeInsets(top: view.safeAreaInsets.top, left: 0, bottom: view.safeAreaInsets.bottom, right: 0); assignedTitle.frame = CGRect(x: 40*r, y: 16*r, width: w-200*r, height: 80*r); confirm.frame = CGRect(x: w-144*r, y: 16*r, width: 104*r, height: 80*r); for label in [assignedTitle, allTitle] { label.font = .boldSystemFont(ofSize: 28*r); label.textColor = NativeUITheme.body }; for button in [confirm, edit] { button.titleLabel?.font = .systemFont(ofSize: 28*r, weight: .semibold) }; assigned.frame = CGRect(x: 40*r, y: 112*r, width: w-80*r, height: assigned.height(for: w-80*r)); empty.frame = CGRect(x: 40*r, y: 112*r, width: w-80*r, height: 64*r); empty.font = .systemFont(ofSize: 26*r); let y = max(assigned.frame.maxY, 176*r) + 16*r; allTitle.frame = CGRect(x: 40*r, y: y, width: w-200*r, height: 80*r); edit.frame = CGRect(x: w-160*r, y: y, width: 120*r, height: 80*r); all.frame = CGRect(x: 40*r, y: y+96*r, width: w-80*r, height: all.height(for: w-80*r)); scroll.contentSize = CGSize(width: w, height: all.frame.maxY+40*r) }
    @objc private func save() { guard !saving, selected != initial else { return }; saving = true; render(); let values = selected; task = Task { [weak self] in guard let self = self else { return }; defer { self.saving = false; self.render() }; do { try await self.service.business.change("contacts/\(self.userID)", method: "PATCH", body: ["tagIds": .array(values.sorted().map(JSONValue.string))]); try Task.checkCancellation(); self.navigationController?.popViewController(animated: true) } catch { if !Task.isCancelled { self.showNativeNotice(error.localizedDescription) } } } }
    private func create() { let dialog = NativeTagNameDialog(context: service.business) { [weak self] tag in guard let self = self else { return }; self.navigationController?.pushViewController(NativeTagMembersController(service: self.service, tag: tag), animated: true) }; present(dialog, animated: true) }
}

@MainActor
private final class NativeTagChipFlow: UIView {
    struct Item { let title: String; let selected: Bool; let add: Bool; let action: () -> Void }
    private var buttons: [UIButton] = []
    func set(_ items: [Item]) { buttons.forEach { $0.removeFromSuperview() }; buttons = items.map { item in let button = UIButton(type: .system); button.setTitle(item.title, for: .normal); button.backgroundColor = item.selected ? NativeUITheme.primary : .white; button.setTitleColor(item.selected ? .white : item.add ? NativeUITheme.primary : NativeUITheme.secondary, for: .normal); button.layer.borderColor = (item.selected || item.add ? NativeUITheme.primary : NativeUITheme.secondary).cgColor; button.layer.borderWidth = item.selected ? 0 : 1; button.addAction(UIAction { _ in item.action() }, for: .touchUpInside); addSubview(button); return button }; setNeedsLayout() }
    func height(for width: CGFloat) -> CGFloat { arrange(width: width, apply: false) }
    private func arrange(width: CGFloat, apply: Bool) -> CGFloat { let r = max(0.1, (window?.bounds.width ?? UIScreen.main.bounds.width)/750); var x: CGFloat = 0, y: CGFloat = 0; for button in buttons { button.titleLabel?.font = .systemFont(ofSize: 28*r); let w = min(width, button.sizeThatFits(CGSize(width: width, height: 64*r)).width+48*r); if x > 0, x+w > width { x = 0; y += 80*r }; if apply { button.frame = CGRect(x: x, y: y, width: w, height: 64*r); button.layer.cornerRadius = 16*r }; x += w+16*r }; return buttons.isEmpty ? 0 : y+64*r }
    override func layoutSubviews() { super.layoutSubviews(); _ = arrange(width: bounds.width, apply: true) }
}

@MainActor
private final class NativeTagNameDialog: UIViewController, UITextFieldDelegate {
    private let context: NativeBusinessContext; private let onCreated: (NativeTag) -> Void
    private let panel = UIView(); private let heading = UILabel(); private let input = UITextField(); private let count = UILabel(); private let hint = UILabel(); private let cancel = UIButton(type: .system); private let confirm = UIButton(type: .system); private var task: Task<Void, Never>?; private var saving = false
    init(context: NativeBusinessContext, onCreated: @escaping (NativeTag) -> Void) { self.context = context; self.onCreated = onCreated; super.init(nibName: nil, bundle: nil); modalPresentationStyle = .overFullScreen; modalTransitionStyle = .crossDissolve }
    required init?(coder: NSCoder) { fatalError("不使用 Storyboard") }
    override func viewDidLoad() { super.viewDidLoad(); view.backgroundColor = UIColor.black.withAlphaComponent(0.4); panel.backgroundColor = .white; view.addSubview(panel); [heading, input, count, hint, cancel, confirm].forEach { panel.addSubview($0) }; heading.text = "新增标签"; input.backgroundColor = UIColor(hex: 0xf3f4f7); input.delegate = self; input.addTarget(self, action: #selector(changed), for: .editingChanged); hint.text = "标签名称最多 12 个字"; hint.textColor = NativeUITheme.secondary; count.textColor = NativeUITheme.secondary; cancel.setTitle("取消", for: .normal); cancel.setTitleColor(NativeUITheme.body, for: .normal); cancel.addAction(UIAction { [weak self] _ in guard let self = self, !self.saving else { return }; self.dismiss(animated: true) }, for: .touchUpInside); confirm.setTitle("确认", for: .normal); confirm.backgroundColor = NativeUITheme.primary; confirm.setTitleColor(.white, for: .normal); confirm.addTarget(self, action: #selector(create), for: .touchUpInside); changed() }
    override func viewDidLayoutSubviews() { super.viewDidLayoutSubviews(); let r = view.bounds.width/750, w = min(view.bounds.width-80*r, 640*r); panel.frame = CGRect(x: (view.bounds.width-w)/2, y: max(view.safeAreaInsets.top+20, min((view.bounds.height-400*r)/2, view.keyboardLayoutGuide.layoutFrame.minY-420*r)), width: w, height: 400*r); panel.layer.cornerRadius = 24*r; heading.frame = CGRect(x: 32*r, y: 24*r, width: w-64*r, height: 48*r); heading.font = .boldSystemFont(ofSize: 32*r); input.frame = CGRect(x: 32*r, y: 96*r, width: w-64*r, height: 80*r); input.font = .systemFont(ofSize: 30*r); input.layer.cornerRadius = 8*r; hint.frame = CGRect(x: 32*r, y: 188*r, width: w-160*r, height: 36*r); count.frame = CGRect(x: w-128*r, y: 188*r, width: 96*r, height: 36*r); count.textAlignment = .right; hint.font = .systemFont(ofSize: 22*r); count.font = .systemFont(ofSize: 22*r); cancel.frame = CGRect(x: w-320*r, y: 288*r, width: 128*r, height: 80*r); confirm.frame = CGRect(x: w-176*r, y: 288*r, width: 144*r, height: 80*r); confirm.layer.cornerRadius = 8*r }
    @objc private func changed() { if input.markedTextRange == nil { let value = input.text ?? ""; var result = ""; for character in value { if (result+String(character)).utf16.count > 12 { break }; result.append(character) }; input.text = result }; count.text = "\((input.text ?? "").utf16.count)/12"; confirm.isEnabled = !saving && !(input.text ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty; confirm.alpha = confirm.isEnabled ? 1 : 0.4 }
    @objc private func create() { let name = (input.text ?? "").trimmingCharacters(in: .whitespacesAndNewlines); guard !saving, !name.isEmpty, name.utf16.count <= 12 else { return }; saving = true; input.resignFirstResponder(); changed(); task = Task { [weak self] in guard let self = self else { return }; defer { self.saving = false; self.changed() }; do { let tag: NativeTag = try await self.context.request("contact-tags", method: "POST", body: ["name": .string(name)]); try Task.checkCancellation(); self.dismiss(animated: true) { self.onCreated(tag) } } catch { if !Task.isCancelled { self.showNativeNotice(error.localizedDescription) } } } }
    override func viewWillDisappear(_ animated: Bool) { super.viewWillDisappear(animated); if isBeingDismissed { task?.cancel() } }
}

@MainActor
final class NativeTagsController: NativeBusinessListController {
    private let service: NativeIMService; private let contactID: String?; private var tags: [NativeTag] = []; private var selected = Set<String>()
    init(service: NativeIMService, contactID: String? = nil) { self.service = service; self.contactID = contactID; super.init(title: "标签", context: service.business) }
    required init?(coder: NSCoder) { fatalError("不使用 Storyboard") }
    override func viewDidLoad() { super.viewDidLoad(); navigationItem.rightBarButtonItem = UIBarButtonItem(barButtonSystemItem: .add, target: self, action: #selector(addTag)); if contactID != nil { navigationItem.leftBarButtonItem = UIBarButtonItem(title: "保存", style: .done, target: self, action: #selector(saveTags)) } }
    override func reloadContent() {
        perform { [self] in tags = try await context.request("contact-tags"); if let id = contactID { let c: NativeContact = try await context.request("contacts/\(id)"); selected = Set(c.tags?.map(\.id) ?? []) }; render() }
    }
    private func render() { setRows([tags.map { tag in NativeBusinessRow(title: tag.name, detail: tag.memberCount.map { "\($0) 人" } ?? "", checked: contactID == nil ? nil : selected.contains(tag.id), action: { [weak self] in guard let self = self else { return }; if self.contactID != nil { if self.selected.contains(tag.id) { self.selected.remove(tag.id) } else { self.selected.insert(tag.id) }; self.render() } else { self.openTag(tag) } }) }]) }
    @objc private func addTag() { edit(title: "新建标签", placeholder: "标签名称") { [weak self] name in try await self?.context.change("contact-tags", body: ["name": .string(name)]) } }
    @objc private func saveTags() { guard let id = contactID else { return }; perform { [self] in try await context.change("contacts/\(id)", method: "PATCH", body: ["tagIds": .array(selected.sorted().map(JSONValue.string))]); navigationController?.popViewController(animated: true) } }
    private func openTag(_ tag: NativeTag) {
        let sheet = UIAlertController(title: tag.name, message: nil, preferredStyle: .actionSheet)
        sheet.addAction(UIAlertAction(title: "查看成员", style: .default) { [weak self] _ in guard let self = self else { return }; self.perform { let contacts: [NativeContact] = try await self.context.request("contact-tags/\(tag.id)/members"); let list = NativeBusinessListController(title: tag.name, context: self.context); list.loadViewIfNeeded(); list.setRows([contacts.map { c in NativeBusinessRow(title: c.displayName, avatar: c.avatar, action: { [weak list, weak self] in guard let self = self else { return }; list?.push(NativeContactController(service: self.service, userID: c.id, isFriend: true)) }) }]); self.push(list) } })
        sheet.addAction(UIAlertAction(title: "管理成员", style: .default) { [weak self] _ in guard let self = self else { return }; self.push(NativeTagMembersController(service: self.service, tag: tag)) })
        sheet.addAction(UIAlertAction(title: "重命名", style: .default) { [weak self] _ in self?.edit(title: "标签名称", value: tag.name) { [weak self] name in try await self?.context.change("contact-tags/\(tag.id)", method: "PATCH", body: ["name": .string(name)]) } })
        sheet.addAction(UIAlertAction(title: "删除标签", style: .destructive) { [weak self] _ in self?.perform { try await self?.context.change("contact-tags/\(tag.id)", method: "DELETE", body: nil); self?.scheduleReload() } })
        sheet.addAction(UIAlertAction(title: "取消", style: .cancel)); sheet.popoverPresentationController?.sourceView = tableView; present(sheet, animated: true)
    }
}

@MainActor
final class NativeTagMembersController: NativeBusinessListController, UISearchResultsUpdating {
    private let service: NativeIMService; private let tag: NativeTag
    private var contacts: [NativeContact] = []; private var selected = Set<String>(); private let search = UISearchController(searchResultsController: nil)
    init(service: NativeIMService, tag: NativeTag) { self.service = service; self.tag = tag; super.init(title: "编辑标签成员", context: service.business) }
    required init?(coder: NSCoder) { fatalError("不使用 Storyboard") }
    override func viewDidLoad() { super.viewDidLoad(); search.searchResultsUpdater = self; search.obscuresBackgroundDuringPresentation = false; navigationItem.searchController = search; navigationItem.rightBarButtonItem = UIBarButtonItem(title: "保存", style: .done, target: self, action: #selector(save)) }
    override func reloadContent() {
        perform { [self] in
            let members: [NativeContact] = try await context.request("contact-tags/\(tag.id)/members")
            var all: [NativeContact] = []; var cursor: String?; var seen = Set<String>()
            repeat {
                let page = try await context.contacts(sort: "name", cursor: cursor); all += page.items
                guard page.hasMore else { break }; guard let next = page.nextCursor, !next.isEmpty, seen.insert(next).inserted else { throw APIError.invalidResponse }; cursor = next
            } while true
            contacts = all; selected = Set(members.map(\.id)); render()
        }
    }
    func updateSearchResults(for searchController: UISearchController) { render() }
    private func render() {
        let text = search.searchBar.text ?? ""
        setRows([contacts.filter { text.isEmpty || $0.displayName.localizedCaseInsensitiveContains(text) }.map { item in NativeBusinessRow(title: item.displayName, avatar: item.avatar, checked: selected.contains(item.id), action: { [weak self] in guard let self = self else { return }; if self.selected.contains(item.id) { self.selected.remove(item.id) } else { self.selected.insert(item.id) }; self.render() }) }])
        navigationItem.rightBarButtonItem?.title = "保存（\(selected.count)）"
    }
    @objc private func save() { perform { [self] in try await context.change("contact-tags/\(tag.id)/members", method: "PUT", body: ["userIds": .array(selected.sorted().map(JSONValue.string))]); navigationController?.popViewController(animated: true) } }
}
