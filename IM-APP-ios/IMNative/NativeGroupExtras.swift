import UIKit
import PhotosUI
import IMCore

@MainActor
final class NativeCommonGroupsController: NativeBusinessListController {
    private let service: NativeIMService; private let userID: String
    init(service: NativeIMService, userID: String) { self.service = service; self.userID = userID; super.init(title: "共同群组", context: service.business) }
    required init?(coder: NSCoder) { fatalError("不使用 Storyboard") }
    override func reloadContent() { perform { [self] in let user: NativeContact = try await context.request("contacts/\(userID)"); setRows([(user.commonGroups ?? []).map { group in NativeBusinessRow(title: group.name, avatar: group.avatar, action: { [weak self] in guard let self = self else { return }; self.perform { let peer: NativeGroupPeer = try await self.context.request("im/groups/\(group.id)"); let conversation = try await self.service.openConversation(target: peer.imGroupId, type: 3); self.push(NativeConversationViewController(service: self.service, conversation: conversation)) } }) }]) } }
}

@MainActor
final class NativeGroupAdministrationController: NativeBusinessListController {
    private let service: NativeIMService; private let groupID: String
    init(service: NativeIMService, groupID: String) { self.service = service; self.groupID = groupID; super.init(title: "群管理", context: service.business) }
    required init?(coder: NSCoder) { fatalError("不使用 Storyboard") }
    override func reloadContent() {
        perform { [self] in
            let group: NativeGroup = try await context.request("groups/detail", query: [URLQueryItem(name: "groupId", value: groupID)])
            guard group.canManage else { throw APIError.business(code: -1, message: "当前没有群管理权限。") }
            setRows([[
                NativeBusinessRow(title: "群组管理员", action: { [weak self] in guard let self = self else { return }; self.push(NativeGroupAdministratorsController(service: self.service, group: group)) }),
                NativeBusinessRow(title: "入群申请", action: { [weak self] in guard let self = self else { return }; self.push(NativeGroupRequestsController(service: self.service, groupID: self.groupID)) })
            ], [
                NativeBusinessRow(title: "全员禁言", checked: group.allMuted ?? false, toggle: { [weak self] value in self?.save("allMuted", .bool(value)) }),
                NativeBusinessRow(title: "群成员可互加好友", checked: group.allowMemberAddFriend ?? true, toggle: { [weak self] value in self?.save("allowMemberAddFriend", .bool(value)) }),
                NativeBusinessRow(title: "入群需要审核", checked: group.joinMode == "approval", toggle: { [weak self] value in self?.save("joinMode", .string(value ? "approval" : "open")) })
            ]])
        }
    }
    private func save(_ key: String, _ value: JSONValue) { perform { [self] in defer { scheduleReload() }; try await context.change("groups/settings/update", body: ["groupId": .string(groupID), key: value]) } }
}

@MainActor
final class NativeGroupAdministratorsController: NativeBusinessListController, UISearchResultsUpdating {
    private let service: NativeIMService; private let group: NativeGroup; private let adding: Bool
    private var members: [NativeGroupMember] = []; private var selected = Set<String>(); private let search = UISearchController(searchResultsController: nil)
    init(service: NativeIMService, group: NativeGroup, adding: Bool = false) { self.service = service; self.group = group; self.adding = adding; super.init(title: adding ? "新增管理员" : "群组管理员", context: service.business) }
    required init?(coder: NSCoder) { fatalError("不使用 Storyboard") }
    override func viewDidLoad() { super.viewDidLoad(); search.searchResultsUpdater = self; search.obscuresBackgroundDuringPresentation = false; navigationItem.searchController = search; if group.isOwner { navigationItem.rightBarButtonItem = UIBarButtonItem(title: adding ? "保存" : "新增", style: .plain, target: self, action: #selector(right)) } }
    override func reloadContent() {
        perform { [self] in
            var all: [NativeGroupMember] = []; var cursor: String?; var seen = Set<String>()
            repeat {
                var query = [URLQueryItem(name: "groupId", value: group.id), URLQueryItem(name: "limit", value: "40")]; if let cursor = cursor { query.append(URLQueryItem(name: "cursor", value: cursor)) }
                let page: NativePage<NativeGroupMember> = try await context.request("group-members", query: query); all += page.items
                guard page.hasMore else { break }; guard let next = page.nextCursor, seen.insert(next).inserted else { throw APIError.invalidResponse }; cursor = next
            } while true
            members = all; render()
        }
    }
    func updateSearchResults(for searchController: UISearchController) { render() }
    private func render() {
        let text = search.searchBar.text ?? ""
        let filtered = members.filter { (adding ? $0.role == "member" : $0.role == "owner" || $0.role == "admin") && (text.isEmpty || $0.name.localizedCaseInsensitiveContains(text)) }
        setRows([filtered.map { member in NativeBusinessRow(title: member.name, detail: member.role == "owner" ? "群主" : member.role == "admin" ? "管理员" : "", avatar: member.avatar, checked: adding ? selected.contains(member.id) : nil, action: { [weak self] in
            guard let self = self, self.group.isOwner else { return }
            if self.adding { if self.selected.contains(member.id) { self.selected.remove(member.id) } else { self.selected.insert(member.id) }; self.render() }
            else if member.role == "admin" { self.confirm("确定取消「\(member.name)」的管理员身份吗？", destructiveTitle: "取消管理员") { self.perform { try await self.context.change("groups/\(self.group.id)/members/\(member.id)/role", method: "PUT", body: ["role": .string("member")]); self.scheduleReload() } } }
        }) }])
    }
    @objc private func right() {
        if !adding { push(NativeGroupAdministratorsController(service: service, group: group, adding: true)); return }
        guard !selected.isEmpty else { return }
        perform { [self] in for id in selected.sorted() { try await context.change("groups/\(group.id)/members/\(id)/role", method: "PUT", body: ["role": .string("admin")]); selected.remove(id) }; navigationController?.popViewController(animated: true) }
    }
}

@MainActor
final class NativeAnnouncementEditor: UIViewController, PHPickerViewControllerDelegate {
    private let context: NativeBusinessContext; private let groupID: String; private let item: NativeAnnouncement?
    private let text = UITextView(); private let imageStack = UIStackView(); private var kept: [String]; private var added: [Data] = []; private var working = false
    init(context: NativeBusinessContext, groupID: String, item: NativeAnnouncement? = nil) { self.context = context; self.groupID = groupID; self.item = item; kept = item?.images ?? []; super.init(nibName: nil, bundle: nil); title = item == nil ? "发布群公告" : "编辑群公告"; text.text = item?.content ?? "" }
    required init?(coder: NSCoder) { fatalError("不使用 Storyboard") }
    override func viewDidLoad() {
        super.viewDidLoad(); view.backgroundColor = UIColor(hex: 0xf5f6f8)
        navigationItem.rightBarButtonItem = UIBarButtonItem(title: "发布", style: .done, target: self, action: #selector(save))
        let scroll = UIScrollView(); scroll.translatesAutoresizingMaskIntoConstraints = false; view.addSubview(scroll)
        let stack = UIStackView(); stack.axis = .vertical; stack.spacing = 16; stack.translatesAutoresizingMaskIntoConstraints = false; scroll.addSubview(stack)
        NSLayoutConstraint.activate([scroll.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor), scroll.leadingAnchor.constraint(equalTo: view.leadingAnchor), scroll.trailingAnchor.constraint(equalTo: view.trailingAnchor), scroll.bottomAnchor.constraint(equalTo: view.keyboardLayoutGuide.topAnchor), stack.topAnchor.constraint(equalTo: scroll.contentLayoutGuide.topAnchor, constant: 20), stack.leadingAnchor.constraint(equalTo: scroll.contentLayoutGuide.leadingAnchor, constant: 20), stack.trailingAnchor.constraint(equalTo: scroll.contentLayoutGuide.trailingAnchor, constant: -20), stack.bottomAnchor.constraint(equalTo: scroll.contentLayoutGuide.bottomAnchor, constant: -12), stack.widthAnchor.constraint(equalTo: scroll.frameLayoutGuide.widthAnchor, constant: -40)])
        text.font = .systemFont(ofSize: 16); text.backgroundColor = .white; text.heightAnchor.constraint(equalToConstant: 210).isActive = true; stack.addArrangedSubview(text)
        imageStack.axis = .vertical; imageStack.spacing = 8; stack.addArrangedSubview(imageStack)
        let add = UIButton(type: .system); add.setTitle("＋ 添加公告图片", for: .normal); add.addTarget(self, action: #selector(images), for: .touchUpInside); stack.addArrangedSubview(add); render()
    }
    private func render() {
        imageStack.arrangedSubviews.forEach { imageStack.removeArrangedSubview($0); $0.removeFromSuperview() }
        for index in kept.indices {
            let row = UIStackView(); row.axis = .horizontal; row.spacing = 16
            let image = NativeRemoteImageView(); image.contentMode = .scaleAspectFit; image.load(kept[index], policy: context.media, variant: .list); image.widthAnchor.constraint(equalToConstant: 80).isActive = true; image.heightAnchor.constraint(equalToConstant: 80).isActive = true
            let view = UIButton(type: .system); view.setTitle("查看", for: .normal); view.addAction(UIAction { [weak self] _ in guard let self = self, index < self.kept.count else { return }; self.navigationController?.pushViewController(NativeImagePreviewController(url: self.kept[index], policy: self.context.media), animated: true) }, for: .touchUpInside)
            let remove = UIButton(type: .system); remove.setTitle("删除", for: .normal); remove.setTitleColor(.systemRed, for: .normal); remove.addAction(UIAction { [weak self] _ in guard let self = self, !self.working, index < self.kept.count else { return }; self.kept.remove(at: index); self.render() }, for: .touchUpInside)
            [image, view, remove].forEach { row.addArrangedSubview($0) }; imageStack.addArrangedSubview(row)
        }
        for index in added.indices {
            let row = UIStackView(); row.axis = .horizontal; row.spacing = 16
            let image = UIImageView(); image.contentMode = .scaleAspectFit; image.widthAnchor.constraint(equalToConstant: 80).isActive = true; image.heightAnchor.constraint(equalToConstant: 80).isActive = true
            let data = added[index]; Task { [weak image] in image?.image = try? await NativeImageCache.shared.dataImage(data, edge: 240) }
            let remove = UIButton(type: .system); remove.setTitle("删除新图片", for: .normal); remove.setTitleColor(.systemRed, for: .normal); remove.addAction(UIAction { [weak self] _ in guard let self = self, !self.working, index < self.added.count else { return }; self.added.remove(at: index); self.render() }, for: .touchUpInside)
            row.addArrangedSubview(image); row.addArrangedSubview(remove); imageStack.addArrangedSubview(row)
        }
    }
    @objc private func images() { guard !working, kept.count + added.count < 9 else { return }; var config = PHPickerConfiguration(); config.filter = .images; config.selectionLimit = 9 - kept.count - added.count; let picker = PHPickerViewController(configuration: config); picker.delegate = self; present(picker, animated: true) }
    func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
        picker.dismiss(animated: true)
        for result in results { result.itemProvider.loadObject(ofClass: UIImage.self) { [weak self] value, _ in guard let image = value as? UIImage else { return }; let ratio = min(1, 1920 / max(image.size.width, image.size.height)); let format = UIGraphicsImageRendererFormat(); format.scale = 1; let size = CGSize(width: image.size.width * ratio, height: image.size.height * ratio); let resized = UIGraphicsImageRenderer(size: size, format: format).image { _ in image.draw(in: CGRect(origin: .zero, size: size)) }; guard let data = resized.jpegData(compressionQuality: 0.85) else { return }; Task { @MainActor in guard let self = self, !self.working, self.kept.count + self.added.count < 9 else { return }; self.added.append(data); self.render() } } }
    }
    @objc private func save() {
        guard !working else { return }; let value = (text.text ?? "").trimmingCharacters(in: .whitespacesAndNewlines); guard !value.isEmpty else { showNativeNotice("请填写公告内容。"); return }
        working = true; navigationItem.rightBarButtonItem?.isEnabled = false
        Task { defer { working = false; navigationItem.rightBarButtonItem?.isEnabled = true }; do {
            var ids: [JSONValue] = []; for data in added { let file = try await context.upload(data: data, filename: "announcement.jpg", contentType: "image/jpeg", purpose: "image"); ids.append(.string(file.id)) }
            var body: [String: JSONValue] = ["groupId": .string(groupID), "content": .string(value), "announcementImageFileIds": .array(ids)]
            if let item = item { body["announcementId"] = .string(item.id); body["keepAnnouncementImages"] = .array(kept.map(JSONValue.string)) }
            try await context.change(item == nil ? "group-announcements/create" : "group-announcements/update", body: body); navigationController?.popViewController(animated: true)
        } catch { showNativeNotice(error.localizedDescription) } }
    }
}
