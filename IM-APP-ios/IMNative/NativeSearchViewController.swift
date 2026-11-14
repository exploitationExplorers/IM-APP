import UIKit
import AVKit
import IMCore

@MainActor
final class NativeSearchController: NativeBusinessListController, UISearchResultsUpdating {
    private let service: NativeIMService; private let conversation: NativeConversation?; private let initialQuery: String
    private let search = UISearchController(searchResultsController: nil); private var types: [Int] = []; private var page = 1
    private var hits: [NativeSearchHit] = []; private var task: Task<Void, Never>?; private var operation = UUID()
    init(service: NativeIMService, conversation: NativeConversation? = nil, initialTypes: [Int] = [], initialQuery: String = "") { self.service = service; self.conversation = conversation; self.types = initialTypes; self.initialQuery = initialQuery; super.init(title: "查找聊天记录", context: service.business) }
    required init?(coder: NSCoder) { fatalError("不使用 Storyboard") }
    override func viewDidLoad() {
        super.viewDidLoad(); search.searchBar.text = initialQuery; search.searchResultsUpdater = self; search.obscuresBackgroundDuringPresentation = false; search.searchBar.placeholder = "搜索聊天记录"; navigationItem.searchController = search
        let filter = UISegmentedControl(items: ["全部", "图片", "视频", "文件", "语音"]); filter.selectedSegmentIndex = [[], [102], [104], [105], [103]].firstIndex(of: types) ?? UISegmentedControl.noSegment; filter.addTarget(self, action: #selector(filterChanged(_:)), for: .valueChanged); filter.frame = CGRect(x: 16, y: 8, width: view.bounds.width - 32, height: 36)
        let header = UIView(frame: CGRect(x: 0, y: 0, width: view.bounds.width, height: 52)); header.addSubview(filter); tableView.tableHeaderView = header
    }
    override func reloadContent() { page = 1; load(reset: true) }
    func updateSearchResults(for searchController: UISearchController) { task?.cancel(); task = Task { do { try await Task.sleep(nanoseconds: 300_000_000) } catch { return }; page = 1; load(reset: true) } }
    @objc private func filterChanged(_ sender: UISegmentedControl) { types = sender.selectedSegmentIndex == 0 ? [] : [[102], [104], [105], [103]][sender.selectedSegmentIndex - 1]; reloadContent() }
    private func load(reset: Bool) {
        task?.cancel(); let id = UUID(); operation = id
        let query = search.searchBar.text ?? ""; guard !query.isEmpty || !types.isEmpty else { hits = []; setRows([]); refreshControl?.endRefreshing(); return }
        let requestedPage = reset ? 1 : page
        task = Task { do {
            let result = try await service.searchPage(query, conversation: conversation, types: types, page: requestedPage)
            guard operation == id, !Task.isCancelled else { return }; if reset { hits = [] }; var seen = Set(hits.map { $0.message.id }); hits += result.items.filter { seen.insert($0.message.id).inserted }; page = requestedPage + 1
            var rows = hits.map { hit in NativeBusinessRow(title: hit.message.text, detail: hit.title + " · " + Date(timeIntervalSince1970: Double(hit.message.timestamp) / 1000).formatted(), avatar: hit.message.avatar, action: { [weak self] in self?.open(hit) }) }
            if result.hasMore { rows.append(NativeBusinessRow(title: "加载更多", action: { [weak self] in self?.load(reset: false) })) }; setRows([rows])
        } catch { if operation == id && !Task.isCancelled { showNativeNotice(error.localizedDescription) } }; refreshControl?.endRefreshing() }
    }
    private func open(_ hit: NativeSearchHit) {
        if let media = hit.message.media {
            if media.kind == 102 { push(NativeImagePreviewController(url: media.url, policy: context.media, allImages: hits.compactMap { $0.message.media?.kind == 102 ? $0.message.media?.url : nil })); return }
            if let url = context.media.absolute(media.kind == 104 ? context.media.playback(media.url) : media.url), url.scheme == "https" {
                if media.kind == 105 { push(NativeFilePreviewController(url: url, filename: media.filename)) }
                else { push(NativeVideoPreviewController(url: url, allowSave: media.kind == 104)) }; return
            }
        }
        perform { [self] in let conversation = try await service.conversationForSearch(hit); push(NativeConversationViewController(service: service, conversation: conversation, focusID: hit.message.id)) }
    }
    override func viewDidDisappear(_ animated: Bool) { super.viewDidDisappear(animated); if navigationController?.viewControllers.contains(where: { $0 === self }) != true { task?.cancel(); operation = UUID() } }
}

@MainActor
final class NativeGroupMediaController: UIViewController, UICollectionViewDataSource, UICollectionViewDelegateFlowLayout {
    private let service: NativeIMService; private let conversation: NativeConversation
    private let tabs = UIStackView(); private var buttons: [UIButton] = []; private let collection: UICollectionView; private let footer = UIButton(type: .system); private let status = UILabel()
    private var selected = 0; private var page = 1; private var items: [NativeSearchHit] = []; private var hasMore = true; private var task: Task<Void, Never>?; private var operation = UUID()
    init(service: NativeIMService, conversation: NativeConversation) { self.service = service; self.conversation = conversation; let layout = UICollectionViewFlowLayout(); layout.minimumLineSpacing = 2; layout.minimumInteritemSpacing = 2; layout.sectionInset = UIEdgeInsets(top: 0, left: 4, bottom: 8, right: 4); collection = UICollectionView(frame: .zero, collectionViewLayout: layout); super.init(nibName: nil, bundle: nil); title = "图片与视频" }
    required init?(coder: NSCoder) { fatalError("不使用 Storyboard") }
    override func viewDidLoad() {
        super.viewDidLoad(); view.backgroundColor = .white; [tabs, collection, footer, status].forEach { view.addSubview($0) }; tabs.axis = .horizontal; tabs.distribution = .fillEqually; tabs.spacing = 4
        for (index, title) in ["全部", "图片", "视频", "档案"].enumerated() { let button = UIButton(type: .system); button.setTitle(title, for: .normal); button.tag = index; button.addTarget(self, action: #selector(change(_:)), for: .touchUpInside); tabs.addArrangedSubview(button); buttons.append(button) }
        collection.backgroundColor = .white; collection.dataSource = self; collection.delegate = self; collection.register(NativeGroupMediaCell.self, forCellWithReuseIdentifier: "group-media"); collection.refreshControl = UIRefreshControl(); collection.refreshControl?.addTarget(self, action: #selector(refresh), for: .valueChanged)
        footer.setTitle("加载更多", for: .normal); footer.addTarget(self, action: #selector(more), for: .touchUpInside); status.font = .systemFont(ofSize: 14); status.textAlignment = .center; status.textColor = NativeUITheme.secondary; refresh()
    }
    override func viewWillAppear(_ animated: Bool) { super.viewWillAppear(animated); navigationController?.setNavigationBarHidden(false, animated: animated) }
    override func viewDidLayoutSubviews() { super.viewDidLayoutSubviews(); let r = view.bounds.width / 750, top = view.safeAreaInsets.top; tabs.frame = CGRect(x: 16 * r, y: top + 8 * r, width: view.bounds.width - 32 * r, height: 64 * r); for button in buttons { button.titleLabel?.font = .systemFont(ofSize: 28 * r, weight: button.tag == selected ? .semibold : .regular); button.setTitleColor(UIColor(hex: button.tag == selected ? 0x0a2fc2 : 0x666666), for: .normal); button.backgroundColor = button.tag == selected ? UIColor(hex: 0xeef2ff) : .clear; button.layer.cornerRadius = 8 * r }; footer.frame = CGRect(x: 16, y: view.bounds.height - view.safeAreaInsets.bottom - 44, width: view.bounds.width - 32, height: 44); collection.frame = CGRect(x: 0, y: tabs.frame.maxY + 16 * r, width: view.bounds.width, height: max(0, footer.frame.minY - tabs.frame.maxY - 16 * r)); status.frame = collection.frame; status.isHidden = !items.isEmpty; collection.collectionViewLayout.invalidateLayout() }
    @objc private func change(_ sender: UIButton) { guard selected != sender.tag else { return }; selected = sender.tag; refresh() }
    @objc private func refresh() { task?.cancel(); page = 1; items = []; hasMore = true; collection.reloadData(); load() }
    @objc private func more() { guard task == nil, hasMore else { return }; load() }
    private func load() {
        let id = UUID(); operation = id; let types = selected == 0 ? [102, 104, 105] : [[102], [104], [105]][selected - 1]; footer.isEnabled = false; status.text = "加载中..."
        task = Task { defer { if operation == id { task = nil; footer.isEnabled = hasMore; footer.setTitle(hasMore ? "加载更多" : "已加载全部", for: .normal); collection.refreshControl?.endRefreshing(); view.setNeedsLayout() } }; do { let result = try await service.searchPage("", conversation: conversation, types: types, page: page); try Task.checkCancellation(); guard operation == id else { return }; var seen = Set(items.map { $0.message.id }); items += result.items.filter { seen.insert($0.message.id).inserted }; page += 1; hasMore = result.hasMore; collection.reloadData(); status.text = "暂无图片和视频" } catch { if !Task.isCancelled, operation == id { status.text = "加载失败，请下拉重试"; showNativeNotice(error.localizedDescription) } } }
    }
    func collectionView(_ collectionView: UICollectionView, numberOfItemsInSection section: Int) -> Int { items.count }
    func collectionView(_ collectionView: UICollectionView, layout collectionViewLayout: UICollectionViewLayout, sizeForItemAt indexPath: IndexPath) -> CGSize { if selected == 3 { return CGSize(width: collection.bounds.width - 8, height: NativeUITheme.rpx(96, width: view.bounds.width)) }; let edge = floor((collection.bounds.width - 12) / 3); return CGSize(width: edge, height: edge) }
    func collectionView(_ collectionView: UICollectionView, cellForItemAt indexPath: IndexPath) -> UICollectionViewCell { let cell = collection.dequeueReusableCell(withReuseIdentifier: "group-media", for: indexPath) as! NativeGroupMediaCell; cell.configure(items[indexPath.item].message, policy: service.business.media); return cell }
    func collectionView(_ collectionView: UICollectionView, didSelectItemAt indexPath: IndexPath) { guard let media = items[indexPath.item].message.media else { return }; let page: UIViewController; if media.kind == 102 { page = NativeImagePreviewController(url: media.url, policy: service.business.media, allImages: items.compactMap { $0.message.media?.kind == 102 ? $0.message.media?.url : nil }) } else { guard let url = service.business.media.absolute(media.kind == 104 ? service.business.media.playback(media.url) : media.url), url.scheme == "https" else { showNativeNotice("媒体地址尚未就绪。"); return }; page = media.kind == 105 ? NativeFilePreviewController(url: url, filename: media.filename) : NativeVideoPreviewController(url: url, allowSave: true) }; navigationController?.pushViewController(page, animated: true) }
    override func viewDidDisappear(_ animated: Bool) { super.viewDidDisappear(animated); if isMovingFromParent || navigationController?.viewControllers.contains(where: { $0 === self }) != true { task?.cancel(); operation = UUID() } }
}

@MainActor
private final class NativeGroupMediaCell: UICollectionViewCell {
    private let image = NativeRemoteImageView(); private let text = UILabel(); private let play = UILabel()
    override init(frame: CGRect) { super.init(frame: frame); [image, text, play].forEach { contentView.addSubview($0) }; image.contentMode = .scaleAspectFill; image.clipsToBounds = true; text.numberOfLines = 2; text.font = .systemFont(ofSize: 14); play.text = "▶"; play.textColor = .white; play.textAlignment = .center; play.backgroundColor = UIColor.black.withAlphaComponent(0.4); play.layer.cornerRadius = 14; play.clipsToBounds = true; contentView.backgroundColor = UIColor(hex: 0xf3f4f7) }
    required init?(coder: NSCoder) { fatalError("不使用 Storyboard") }
    func configure(_ item: ChatTextItem, policy: MediaURLPolicy) { guard let media = item.media else { image.cancel(); return }; image.isHidden = media.kind == 105; text.isHidden = media.kind != 105; play.isHidden = media.kind != 104; text.text = media.filename.isEmpty ? "文件" : media.filename; if media.kind == 105 { image.cancel() } else { image.load(media.kind == 104 ? media.thumbnail : media.url, policy: policy, variant: .list) } }
    override func layoutSubviews() { super.layoutSubviews(); image.frame = contentView.bounds; text.frame = contentView.bounds.insetBy(dx: 12, dy: 8); play.frame = CGRect(x: (bounds.width - 28) / 2, y: (bounds.height - 28) / 2, width: 28, height: 28) }
    override func prepareForReuse() { super.prepareForReuse(); image.cancel() }
}
