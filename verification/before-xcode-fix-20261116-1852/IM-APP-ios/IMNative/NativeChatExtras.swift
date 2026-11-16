import UIKit
import IMCore

struct NativeMessagePin {
    let id: String; let preview: String; let sender: String; let type: String; let shared: Bool; let timestamp: Int64; let action: String
    init?(_ raw: [String: Any]) {
        id = raw["clientMsgID"] as? String ?? raw["ClientMsgID"] as? String ?? ""
        action = raw["action"] as? String ?? raw["Action"] as? String ?? "pin"
        guard !id.isEmpty || action == "unpin" else { return nil }
        preview = raw["preview"] as? String ?? raw["Preview"] as? String ?? ""; sender = raw["senderNickname"] as? String ?? ""; type = raw["messageType"] as? String ?? "text"
        shared = (raw["scope"] as? String ?? "shared") == "shared"; timestamp = (raw["pinnedAt"] as? NSNumber)?.int64Value ?? 0
    }
    static func control(_ item: ChatTextItem) -> NativeMessagePin? {
        guard item.contentType == 110, let data = item.serialized.data(using: .utf8), let root = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any], let custom = root["customElem"] as? [String: Any] ?? root["CustomElem"] as? [String: Any], let text = custom["data"] as? String ?? custom["Data"] as? String, let bytes = text.data(using: .utf8), let body = (try? JSONSerialization.jsonObject(with: bytes)) as? [String: Any], (body["businessKey"] as? String ?? body["BusinessKey"] as? String) == "message_pin" else { return nil }
        return NativeMessagePin(body)
    }
}

@MainActor
final class NativeMentionPicker: NativeBusinessListController, UISearchResultsUpdating {
    private let group: NativeGroup; private let done: ([NativeGroupMember], Bool) -> Void
    private var members: [NativeGroupMember] = []; private var selected = Set<String>(); private let search = UISearchController(searchResultsController: nil)
    init(context: NativeBusinessContext, group: NativeGroup, done: @escaping ([NativeGroupMember], Bool) -> Void) { self.group = group; self.done = done; super.init(title: "选择提醒的人", context: context) }
    required init?(coder: NSCoder) { fatalError("不使用 Storyboard") }
    override func viewDidLoad() { super.viewDidLoad(); search.searchResultsUpdater = self; search.obscuresBackgroundDuringPresentation = false; navigationItem.searchController = search; navigationItem.rightBarButtonItem = UIBarButtonItem(title: "完成", style: .done, target: self, action: #selector(finish)) }
    override func reloadContent() {
        perform { [self] in
            var all: [NativeGroupMember] = []; var cursor: String?; var seen = Set<String>()
            repeat { var query = [URLQueryItem(name: "groupId", value: group.id), URLQueryItem(name: "limit", value: "40")]; if let cursor = cursor { query.append(URLQueryItem(name: "cursor", value: cursor)) }; let page: NativePage<NativeGroupMember> = try await context.request("group-members", query: query); all += page.items; guard page.hasMore else { break }; guard let next = page.nextCursor, seen.insert(next).inserted else { throw APIError.invalidResponse }; cursor = next } while true
            members = all.filter { $0.id != context.userID }; render()
        }
    }
    func updateSearchResults(for searchController: UISearchController) { render() }
    private func render() {
        let text = search.searchBar.text ?? ""
        var rows = members.filter { text.isEmpty || $0.name.localizedCaseInsensitiveContains(text) }.map { member in NativeBusinessRow(title: member.name, avatar: member.avatar, checked: selected.contains(member.id), action: { [weak self] in guard let self = self else { return }; if self.selected.contains(member.id) { self.selected.remove(member.id) } else { self.selected.insert(member.id) }; self.render() }) }
        if group.canManage, text.isEmpty { rows.insert(NativeBusinessRow(title: "所有人", action: { [weak self] in guard let self = self else { return }; self.navigationController?.popViewController(animated: true); self.done([], true) }), at: 0) }; setRows([rows])
    }
    @objc private func finish() { guard !selected.isEmpty else { return }; navigationController?.popViewController(animated: true); done(members.filter { selected.contains($0.id) }, false) }
}

@MainActor
final class NativeMergedMessagesController: NativeBusinessListController {
    private let service: NativeIMService; private let source: ChatTextItem; private let depth: Int
    private var children: [[String: Any]]?; private var loaded: [ChatTextItem] = []
    init(service: NativeIMService, source: ChatTextItem, depth: Int = 0) { self.service = service; self.source = source; self.depth = depth; super.init(title: "聊天记录", context: service.business) }
    required init?(coder: NSCoder) { fatalError("不使用 Storyboard") }
    override func reloadContent() {
        do {
            guard depth < 6, let data = source.serialized.data(using: .utf8), let root = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any], let merge = root["mergeElem"] as? [String: Any] ?? root["MergeElem"] as? [String: Any] else { throw APIError.invalidResponse }
            if let title = merge["title"] as? String, !title.isEmpty { self.title = title }
            var raw = merge["multiMessage"] ?? merge["MultiMessage"]
            if let text = raw as? String, let data = text.data(using: .utf8) { raw = try JSONSerialization.jsonObject(with: data) }
            guard let children = raw as? [[String: Any]] else { throw APIError.invalidResponse }
            if self.children == nil { self.children = children; try loadMore() } else { render() }
        } catch { showNativeNotice(error.localizedDescription) }
    }
    private func loadMore() throws {
        guard let children = children else { return }
        let next = try children.dropFirst(loaded.count).prefix(40).map { value -> ChatTextItem in let data = try JSONSerialization.data(withJSONObject: value); guard let item = service.unpackMessage(String(decoding: data, as: UTF8.self)) else { throw APIError.invalidResponse }; return item }
        loaded += next; render()
    }
    private func render() {
        var rows = loaded.map { item in NativeBusinessRow(title: item.senderName + "：" + item.text, detail: Date(timeIntervalSince1970: Double(item.timestamp) / 1000).formatted(), avatar: item.avatar, action: { [weak self] in self?.open(item) }) }
        if loaded.count < (children?.count ?? 0) { rows.append(NativeBusinessRow(title: "加载更多", detail: "\(loaded.count)/\(children?.count ?? 0)", action: { [weak self] in do { try self?.loadMore() } catch { self?.showNativeNotice(error.localizedDescription) } })) }; setRows([rows])
    }
    private func open(_ item: ChatTextItem) {
        if item.contentType == 107 { push(NativeMergedMessagesController(service: service, source: item, depth: depth + 1)); return }
        if item.contentType == 108, let data = item.serialized.data(using: .utf8), let root = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any], let card = root["cardElem"] as? [String: Any] ?? root["CardElem"] as? [String: Any], let id = (card["userID"] ?? card["UserID"]) as? String { push(NativeContactController(service: service, userID: GroupVisibility.businessUserID(id), isFriend: false)); return }
        guard let media = item.media else { UIPasteboard.general.string = item.text; return }
        if media.kind == 102 { push(NativeImagePreviewController(url: media.url, policy: context.media, allImages: loaded.compactMap { $0.media?.kind == 102 ? $0.media?.url : nil })) }
        else if let url = context.media.absolute(media.kind == 104 ? context.media.playback(media.url) : media.url), url.scheme == "https" { if media.kind == 105 { push(NativeFilePreviewController(url: url, filename: media.filename)) } else { push(NativeVideoPreviewController(url: url, allowSave: media.kind == 104)) } }
    }
}


@MainActor
final class NativeEmojiPanel: UIView, UICollectionViewDataSource, UICollectionViewDelegateFlowLayout {
    private let context: NativeBusinessContext
    private let onEmoji: (String) -> Void; private let onSticker: (NativeSticker) -> Void; private let onAdd: () -> Void; private let onDelete: (NativeSticker) -> Void
    private let emoji = UIButton(type: .system); private let favorite = UIButton(type: .system); private let close = UIButton(type: .system); private let errorLabel = UILabel()
    private let collection: UICollectionView; private var tab = 0; private var stickers: [NativeSticker] = []; private var task: Task<Void, Never>?; private var operation = UUID()
    private let emojis: [String] = ["😀", "😁", "😂", "🤣", "😃", "😄", "😅", "😆", "😉", "😊", "😋", "😎", "😍", "😘", "🥰", "😗", "😙", "😚", "🙂", "🤗", "🤩", "🤔", "🤨", "😐", "😑", "😶", "🙄", "😏", "😣", "😥", "😮", "🤐", "😯", "😪", "😫", "🥱", "😴", "😌", "😛", "😜", "😝", "🤤", "😒", "😓", "😔", "😕", "🙃", "😲", "😖", "😞", "😟", "😤", "😢", "😭", "😦", "😧", "😨", "😩", "🤯", "😬", "😱", "🥵", "🥶", "😳", "🤪", "😵", "🤠", "🥳", "😡", "😠", "🤬", "😷", "👍", "👎", "👌", "🤌", "✌️", "🤞", "🤟", "🤘", "🤙", "👈", "👉", "👆", "👇", "☝️", "👏", "🙌", "👐", "🤝", "🙏", "💪", "🫶", "❤️", "💔", "💖", "💗", "💘", "💝", "💞", "💓", "✨", "🌟", "🔥", "💥", "✅", "❌", "⚠️", "⭐", "🌈", "☀️", "🌙", "☁️", "❄️", "🎉", "🎊", "🎵", "🎶", "📌", "📎", "🐶", "🐱", "🐭", "🐹", "🐰", "🦊", "🐻", "🐼", "🐨", "🐯", "🦁", "🐮", "🐷", "🐵", "🐔", "🐧", "🐦", "🐤", "🦄", "🐝", "🦋", "🐌", "🐞", "🐜", "🍉", "🍊", "🍋", "🍌", "🍇", "🍓", "🍒", "🍑", "🥭", "🍍", "🥝", "🍅", "🍔", "🍟", "🍕", "🍜", "🍲", "🍣", "🍱", "🍡", "🍰", "🎂", "🧁", "🍪", "☕", "🍵", "🥤", "🍺", "🍻", "⚽", "🏀", "🎮", "🎯", "🎲"]
    init(context: NativeBusinessContext, onEmoji: @escaping (String) -> Void, onSticker: @escaping (NativeSticker) -> Void, onAdd: @escaping () -> Void, onDelete: @escaping (NativeSticker) -> Void, onClose: @escaping () -> Void) {
        self.context = context; self.onEmoji = onEmoji; self.onSticker = onSticker; self.onAdd = onAdd; self.onDelete = onDelete
        let layout = UICollectionViewFlowLayout(); layout.minimumLineSpacing = 4; layout.minimumInteritemSpacing = 4; collection = UICollectionView(frame: .zero, collectionViewLayout: layout)
        super.init(frame: .zero); backgroundColor = .white; layer.cornerRadius = 10; clipsToBounds = true
        [emoji, favorite, close, collection, errorLabel].forEach { addSubview($0) }; emoji.setTitle("☺", for: .normal); favorite.setTitle("❤", for: .normal); close.setTitle("×", for: .normal)
        emoji.addAction(UIAction { [weak self] _ in self?.select(0) }, for: .touchUpInside); favorite.addAction(UIAction { [weak self] _ in self?.select(1) }, for: .touchUpInside); close.addAction(UIAction { _ in onClose() }, for: .touchUpInside)
        collection.backgroundColor = .white; collection.dataSource = self; collection.delegate = self; collection.register(NativeEmojiCell.self, forCellWithReuseIdentifier: "emoji-panel-cell")
        errorLabel.numberOfLines = 2; errorLabel.textAlignment = .center; errorLabel.font = .systemFont(ofSize: 12); errorLabel.textColor = .systemRed; select(0)
    }
    required init?(coder: NSCoder) { fatalError("不使用 Storyboard") }
    func setVisible(_ visible: Bool) {
        let wasHidden = isHidden; isHidden = !visible
        // 群发页面重排也会重复调用；可见性未变时不能取消正在进行的表情请求。
        if visible, tab == 1, (wasHidden || stickers.isEmpty), task == nil { reloadStickers() }
        else if !visible { operation = UUID(); task?.cancel(); task = nil }
    }
    func reloadStickers() {
        task?.cancel(); let id = UUID(); operation = id
        task = Task { [weak self] in guard let self = self else { return }; defer { if operation == id { task = nil } }; do { let values: [NativeSticker] = try await context.request("stickers", query: [URLQueryItem(name: "page", value: "1"), URLQueryItem(name: "size", value: "100")]); try Task.checkCancellation(); guard operation == id else { return }; stickers = values; errorLabel.text = nil; collection.reloadData() } catch { if !Task.isCancelled, operation == id { errorLabel.text = "表情加载失败，请重新切换标签重试。" } } }
    }
    private func select(_ index: Int) { tab = index; emoji.backgroundColor = index == 0 ? UIColor(hex: 0xf3f4f7) : .clear; favorite.backgroundColor = index == 1 ? UIColor(hex: 0xf3f4f7) : .clear; errorLabel.text = nil; collection.reloadData(); collection.collectionViewLayout.invalidateLayout(); if index == 1, !isHidden { reloadStickers() } }
    override func layoutSubviews() { super.layoutSubviews(); let r = bounds.width / 750; emoji.frame = CGRect(x: 20 * r, y: 18 * r, width: 52 * r, height: 52 * r); favorite.frame = CGRect(x: 88 * r, y: 18 * r, width: 52 * r, height: 52 * r); close.frame = CGRect(x: bounds.width - 62 * r, y: 23 * r, width: 42 * r, height: 42 * r); for button in [emoji, favorite, close] { button.titleLabel?.font = .systemFont(ofSize: 34 * r); button.setTitleColor(UIColor(hex: 0x666666), for: .normal); button.layer.cornerRadius = 14 * r }; collection.frame = CGRect(x: 12 * r, y: 94 * r, width: bounds.width - 24 * r, height: bounds.height - 106 * r); errorLabel.frame = CGRect(x: 20, y: bounds.height - 36, width: bounds.width - 40, height: 32) }
    func collectionView(_ collectionView: UICollectionView, numberOfItemsInSection section: Int) -> Int { tab == 0 ? emojis.count : stickers.count + 1 }
    func collectionView(_ collectionView: UICollectionView, layout collectionViewLayout: UICollectionViewLayout, sizeForItemAt indexPath: IndexPath) -> CGSize { let edge = tab == 0 ? (collection.bounds.width - 28) / 8 : (collection.bounds.width - 36) / 4; return CGSize(width: edge, height: edge) }
    func collectionView(_ collectionView: UICollectionView, cellForItemAt indexPath: IndexPath) -> UICollectionViewCell {
        let cell = collection.dequeueReusableCell(withReuseIdentifier: "emoji-panel-cell", for: indexPath) as! NativeEmojiCell
        if tab == 0 { cell.configure(text: emojis[indexPath.item], sticker: nil, policy: context.media, onDelete: nil) }
        else if indexPath.item == 0 { cell.configure(text: "+", sticker: nil, policy: context.media, onDelete: nil) }
        else { let item = stickers[indexPath.item - 1]; cell.configure(text: "", sticker: item, policy: context.media, onDelete: { [weak self] in self?.onDelete(item) }) }; return cell
    }
    func collectionView(_ collectionView: UICollectionView, didSelectItemAt indexPath: IndexPath) { if tab == 0 { onEmoji(emojis[indexPath.item]) } else if indexPath.item == 0 { onAdd() } else { onSticker(stickers[indexPath.item - 1]) } }
}

@MainActor
private final class NativeEmojiCell: UICollectionViewCell {
    private let label = UILabel(); private let image = NativeRemoteImageView(); private let remove = UIButton(type: .system); private var onDelete: (() -> Void)?
    override init(frame: CGRect) { super.init(frame: frame); [image, label, remove].forEach { contentView.addSubview($0) }; label.textAlignment = .center; image.contentMode = .scaleAspectFit; remove.setTitle("×", for: .normal); remove.setTitleColor(.white, for: .normal); remove.backgroundColor = UIColor.black.withAlphaComponent(0.5); remove.addTarget(self, action: #selector(deleteTapped), for: .touchUpInside); contentView.clipsToBounds = true }
    required init?(coder: NSCoder) { fatalError("不使用 Storyboard") }
    func configure(text: String, sticker: NativeSticker?, policy: MediaURLPolicy, onDelete: (() -> Void)?) { label.text = text; label.isHidden = sticker != nil; image.isHidden = sticker == nil; self.onDelete = onDelete; remove.isHidden = onDelete == nil; if let sticker = sticker { image.load(sticker.url, policy: policy, variant: .list, placeholder: "") } else { image.cancel() }; contentView.backgroundColor = sticker == nil ? .clear : UIColor(hex: 0xf5f6f8) }
    override func layoutSubviews() { super.layoutSubviews(); label.frame = contentView.bounds; label.font = .systemFont(ofSize: min(28, bounds.width * 0.58)); image.frame = contentView.bounds.insetBy(dx: 4, dy: 4); remove.frame = CGRect(x: bounds.width - 24, y: 2, width: 22, height: 22); remove.layer.cornerRadius = 11; contentView.layer.cornerRadius = 6 }
    @objc private func deleteTapped() { onDelete?() }
    override func prepareForReuse() { super.prepareForReuse(); image.cancel(); onDelete = nil }
}
