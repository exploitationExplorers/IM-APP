import UIKit
import PhotosUI
import IMCore
import UniformTypeIdentifiers
import ImageIO
import AVFoundation

struct NativeMassAttachment: Codable {
    let kind: Int; let path: String; let filename: String; let duration: Int
}
struct NativeMassRecord: Codable {
    struct Target: Codable {
        let id: String; let name: String; let kind: String?
        init(id: String, name: String, kind: String? = nil) { self.id = id; self.name = name; self.kind = kind }
        var key: String { (kind ?? "contact") + ":" + id }
    }
    let id: String; let text: String; let targets: [Target]; let timestamp: Date
    var submitted: Int; var pendingResult: Bool; var attachments: [NativeMassAttachment]?; var failures: [String]?
}

@MainActor
final class NativeMassAssistantController: NativeBusinessListController {
    private let service: NativeIMService; private var records: [NativeMassRecord] = []; private var dispatching = false
    private var storageKey: String { "native.mass.\(context.configuration.baseURL.absoluteString).\(context.userID)" }
    init(service: NativeIMService) { self.service = service; super.init(title: "群发助手", context: service.business) }
    required init?(coder: NSCoder) { fatalError("不使用 Storyboard") }
    override func viewDidLoad() { super.viewDidLoad(); navigationItem.rightBarButtonItem = UIBarButtonItem(title: "新建群发", style: .plain, target: self, action: #selector(create)); navigationItem.leftBarButtonItem = editButtonItem }
    override func reloadContent() {
        do { if dispatching { return }; if let data = try service.massRecordsData() { records = try JSONDecoder().decode([NativeMassRecord].self, from: data) } else { records = [] } }
        catch { showNativeNotice("群发记录读取失败：" + error.localizedDescription); return }
        setRows([records.map { record in NativeBusinessRow(title: record.text.isEmpty ? "[附件群发]" : record.text, detail: record.targets.prefix(3).map(\.name).joined(separator: "、") + " · 已提交 \(record.submitted)/\(record.targets.count)" + (record.pendingResult ? " · 有结果待核对" : ""), action: { [weak self] in self?.resend(record) }) }])
        let empty = UILabel(frame: tableView.bounds); empty.text = records.isEmpty ? "暂无群发记录" : ""; empty.textAlignment = .center; empty.textColor = NativeUITheme.secondary; tableView.backgroundView = empty
    }
    @objc private func create() { push(NativeMassTargetPicker(service: service, initial: []) { [weak self] targets in self?.compose(targets, text: "", attachments: []) }) }
    private func resend(_ record: NativeMassRecord) { compose(record.targets, text: record.text, attachments: record.attachments ?? []) }
    private func compose(_ targets: [NativeMassRecord.Target], text: String, attachments: [NativeMassAttachment]) {
        push(NativeMassComposeController(service: service, targets: targets, text: text, attachments: attachments) { [weak self] targets, text, attachments in
            guard let self = self, !self.dispatching else { throw APIError.cancelled }; self.dispatching = true; defer { self.dispatching = false; self.scheduleReload() }
            var normalized: [(NativeMassRecord.Target, NativeConversation)] = [], rejected: [NativeMassRecord.Target] = [], failures: [String] = []
            var seen = Set<String>()
            for target in targets {
                try Task.checkCancellation(); guard self.service.isActive, !self.service.needsAuthentication else { throw APIError.cancelled }
                do {
                    let conversation: NativeConversation
                    if target.kind == "recent" { guard let existing = self.service.conversations.first(where: { $0.id == target.id }) else { throw APIError.invalidResponse }; conversation = existing }
                    else if target.kind == "group" { let peer: NativeGroupPeer = try await self.context.request("im/groups/\(target.id)"); guard peer.canChat else { throw APIError.business(code: -1, message: peer.denyReason ?? "当前群聊不能发言。") }; conversation = try await self.service.openConversation(target: peer.imGroupId, type: 3) }
                    else { let peer: NativePeer = try await self.context.request("im/peers/\(target.id)"); guard peer.canChat else { throw APIError.business(code: -1, message: peer.denyReason ?? "不能向该联系人发送消息。") }; conversation = try await self.service.openConversation(target: peer.imUserId, type: 1) }
                    if seen.insert(conversation.id).inserted { normalized.append((target, conversation)) }
                } catch { if Task.isCancelled || !self.service.isActive || self.service.needsAuthentication || error is CancellationError { throw error }; rejected.append(target); failures.append(target.name + "：" + error.localizedDescription) }
            }
            let effectiveTargets = normalized.map { $0.0 } + rejected
            var record = NativeMassRecord(id: UUID().uuidString, text: text, targets: effectiveTargets, timestamp: Date(), submitted: 0, pendingResult: true, attachments: attachments, failures: failures)
            self.records.insert(record, at: 0); try self.save()
            for (target, conversation) in normalized {
                do {
                    try Task.checkCancellation(); guard self.service.isActive, !self.service.needsAuthentication else { throw APIError.cancelled }
                    if !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { try await self.service.send(text, to: conversation) }
                    for attachment in attachments {
                        try Task.checkCancellation()
                        guard let file = self.service.ownedMediaURL(attachment.path) else { throw APIError.business(code: -1, message: "群发附件已不存在，请重新选择。") }
                        try await self.service.sendMedia(kind: attachment.kind, file: file, filename: attachment.filename, duration: attachment.duration, to: conversation)
                    }; record.submitted += 1
                } catch {
                    record.failures?.append(target.name + "：" + error.localizedDescription); self.records[0] = record
                    if Task.isCancelled || !self.service.isActive || self.service.needsAuthentication || error is CancellationError { try? self.save(); throw error }
                }
                self.records[0] = record; try self.save()
            }
            record.pendingResult = !(record.failures ?? []).isEmpty; self.records[0] = record; try self.save(); self.reloadContent()
            return record.pendingResult ? "已提交 \(record.submitted) 个对象。以下结果需在聊天中核对，未自动重发：\n" + (record.failures ?? []).joined(separator: "\n") : "群发已提交。"
        })
    }
    private func save() throws { records = Array(records.prefix(100)); let data = try JSONEncoder().encode(records); try service.saveMassRecordsData(data) }
    override func tableView(_ tableView: UITableView, canEditRowAt indexPath: IndexPath) -> Bool { !dispatching }
    override func tableView(_ tableView: UITableView, commit editingStyle: UITableViewCell.EditingStyle, forRowAt indexPath: IndexPath) {
        guard !dispatching, editingStyle == .delete, indexPath.row < records.count else { return }; records.remove(at: indexPath.row)
        do { try save(); reloadContent() } catch { showNativeNotice(error.localizedDescription) }
    }
}

@MainActor
final class NativeMassTargetPicker: NativeBusinessListController, UISearchResultsUpdating {
    private let service: NativeIMService; private let done: ([NativeMassRecord.Target]) -> Void
    private var contacts: [NativeContact] = []; private var groups: [NativeGroup] = []; private var tags: [NativeTag] = []; private var selected: [String: NativeMassRecord.Target]
    private var category = 0; private let search = UISearchController(searchResultsController: nil)
    init(service: NativeIMService, initial: [NativeMassRecord.Target], done: @escaping ([NativeMassRecord.Target]) -> Void) { self.service = service; self.done = done; selected = Dictionary(initial.map { ($0.key, $0) }, uniquingKeysWith: { _, b in b }); super.init(title: "选择群发对象", context: service.business) }
    required init?(coder: NSCoder) { fatalError("不使用 Storyboard") }
    override func viewDidLoad() {
        super.viewDidLoad(); search.searchResultsUpdater = self; search.obscuresBackgroundDuringPresentation = false; navigationItem.searchController = search
        navigationItem.rightBarButtonItem = UIBarButtonItem(title: "确认", style: .done, target: self, action: #selector(finish))
        let tabs = UISegmentedControl(items: ["最近", "联系人", "群组", "标签"]); tabs.selectedSegmentIndex = 0; tabs.addTarget(self, action: #selector(change(_:)), for: .valueChanged); tabs.frame = CGRect(x: 16, y: 8, width: view.bounds.width - 32, height: 36)
        let header = UIView(frame: CGRect(x: 0, y: 0, width: view.bounds.width, height: 52)); header.addSubview(tabs); tableView.tableHeaderView = header
    }
    override func reloadContent() {
        perform { [self] in
            _ = try await service.loadAllConversations()
            var all: [NativeContact] = []; var cursor: String?; var seen = Set<String>()
            repeat { let page = try await context.contacts(sort: "name", cursor: cursor); all += page.items; guard page.hasMore else { break }; guard let next = page.nextCursor, seen.insert(next).inserted else { throw APIError.invalidResponse }; cursor = next } while true
            contacts = all; var allGroups: [NativeGroup] = []; cursor = nil; seen = []
            repeat {
                var query = [URLQueryItem(name: "limit", value: "100")]; if let cursor = cursor { query.append(URLQueryItem(name: "cursor", value: cursor)) }
                let page: NativePage<NativeGroup> = try await context.request("groups", query: query); allGroups += page.items; guard page.hasMore else { break }; guard let next = page.nextCursor, seen.insert(next).inserted else { throw APIError.invalidResponse }; cursor = next
            } while true
            groups = allGroups; tags = try await context.request("contact-tags"); render()
        }
    }
    @objc private func change(_ sender: UISegmentedControl) { category = sender.selectedSegmentIndex; render() }
    func updateSearchResults(for searchController: UISearchController) { render() }
    private func render() {
        let targets: [NativeMassRecord.Target]
        if category == 0 { targets = service.conversations.filter(\.canOpen).map { .init(id: $0.id, name: $0.title, kind: "recent") } }
        else if category == 1 { targets = contacts.map { .init(id: $0.id, name: $0.displayName) } }
        else if category == 2 { targets = groups.map { .init(id: $0.id, name: $0.name, kind: "group") } }
        else { targets = tags.map { .init(id: $0.id, name: $0.name, kind: "tag") } }
        let text = search.searchBar.text ?? ""
        setRows([targets.filter { text.isEmpty || $0.name.localizedCaseInsensitiveContains(text) }.map { target in NativeBusinessRow(title: target.name, checked: selected[target.key] != nil, action: { [weak self] in guard let self = self else { return }; if self.selected[target.key] == nil { self.selected[target.key] = target } else { self.selected.removeValue(forKey: target.key) }; self.render() }) }])
        navigationItem.rightBarButtonItem?.title = "确认（\(selected.count)）"
    }
    @objc private func finish() {
        guard !selected.isEmpty else { showNativeNotice("请选择群发对象。"); return }
        perform { [self] in
            var output: [String: NativeMassRecord.Target] = [:]
            for item in selected.values.sorted(by: { $0.key < $1.key }) {
                if item.kind == "tag" { let members: [NativeContact] = try await context.request("contact-tags/\(item.id)/members"); for member in members { let target = NativeMassRecord.Target(id: member.id, name: member.displayName); output[target.key] = target } }
                else { output[item.key] = item }
            }
            guard !output.isEmpty else { throw APIError.business(code: -1, message: "选中的标签暂无联系人。") }
            navigationController?.popViewController(animated: false); done(output.values.sorted { $0.key < $1.key })
        }
    }
}

@MainActor
final class NativeMassComposeController: UIViewController, PHPickerViewControllerDelegate, UIDocumentPickerDelegate, UITextFieldDelegate, AVAudioRecorderDelegate {
    private let service: NativeIMService; private var targets: [NativeMassRecord.Target]; private var attachments: [NativeMassAttachment]
    private let onSend: ([NativeMassRecord.Target], String, [NativeMassAttachment]) async throws -> String
    private let text = UITextField(); private let recipient = UIButton(type: .system); private let recipientTitle = UILabel(); private let recipientNames = UILabel(); private let attachmentLabel = UILabel()
    private let composer = UIView(); private let inputBox = UIView(); private let mic = NativeUITheme.imageButton("uni_icon_mic", accessibility: "语音"); private let emoji = UIButton(type: .system); private let plus = UIButton(type: .system); private let sendButton = UIButton(type: .system); private let hold = UIButton(type: .system)
    private let tools = UIView(); private var toolButtons: [UIButton] = []; private var emojiPanel: NativeEmojiPanel!; private var panel = 0; private var voiceMode = false; private var holdActive = false; private var holdID = UUID()
    private var recorder: AVAudioRecorder?; private var recordingURL: URL?; private var recordingDuration = 0; private var sending = false; private var sendTask: Task<Void, Never>?; private var mediaTask: Task<Void, Never>?; private var mediaOperation = UUID(); private var composerHeight: NSLayoutConstraint!
    init(service: NativeIMService, targets: [NativeMassRecord.Target], text: String, attachments: [NativeMassAttachment], onSend: @escaping ([NativeMassRecord.Target], String, [NativeMassAttachment]) async throws -> String) { self.service = service; self.targets = targets; self.attachments = attachments; self.onSend = onSend; super.init(nibName: nil, bundle: nil); title = "群发"; self.text.text = text }
    required init?(coder: NSCoder) { fatalError("不使用 Storyboard") }
    override func viewDidLoad() {
        super.viewDidLoad(); view.backgroundColor = UIColor(hex: 0xf3f4f7)
        recipient.backgroundColor = .white; recipient.addTarget(self, action: #selector(editTargets), for: .touchUpInside); view.addSubview(recipient); recipient.addSubview(recipientTitle); recipient.addSubview(recipientNames); recipientTitle.text = "你将发送消息给"; recipientTitle.textColor = UIColor(hex: 0x8a8f9c); recipientNames.numberOfLines = 2
        attachmentLabel.numberOfLines = 3; attachmentLabel.textAlignment = .center; attachmentLabel.textColor = NativeUITheme.secondary; view.addSubview(attachmentLabel)
        composer.backgroundColor = UIColor(hex: 0xf7f7f7); composer.translatesAutoresizingMaskIntoConstraints = false; view.addSubview(composer)
        composerHeight = composer.heightAnchor.constraint(equalToConstant: 54); NSLayoutConstraint.activate([composer.leadingAnchor.constraint(equalTo: view.leadingAnchor), composer.trailingAnchor.constraint(equalTo: view.trailingAnchor), composer.bottomAnchor.constraint(equalTo: view.keyboardLayoutGuide.topAnchor), composerHeight])
        [mic, inputBox, plus, sendButton, tools].forEach { composer.addSubview($0) }; inputBox.backgroundColor = .white; [text, emoji, hold].forEach { inputBox.addSubview($0) }
        text.placeholder = "输入消息"; text.delegate = self; text.returnKeyType = .send; text.addTarget(self, action: #selector(changed), for: .editingChanged)
        mic.addAction(UIAction { [weak self] _ in guard let self = self, !self.sending else { return }; self.voiceMode.toggle(); self.panel = 0; self.text.resignFirstResponder(); self.render() }, for: .touchUpInside)
        hold.setTitle("按住说话", for: .normal); hold.setTitleColor(NativeUITheme.body, for: .normal); hold.addTarget(self, action: #selector(beginHold), for: .touchDown); hold.addTarget(self, action: #selector(endHold), for: [.touchUpInside, .touchUpOutside, .touchCancel])
        emoji.setTitle("☺", for: .normal); emoji.setTitleColor(.gray, for: .normal); emoji.addAction(UIAction { [weak self] _ in self?.togglePanel(2) }, for: .touchUpInside)
        plus.setTitle("＋", for: .normal); plus.setTitleColor(NativeUITheme.body, for: .normal); plus.addAction(UIAction { [weak self] _ in self?.togglePanel(1) }, for: .touchUpInside)
        sendButton.setTitle("传送", for: .normal); sendButton.setTitleColor(.white, for: .normal); sendButton.backgroundColor = NativeUITheme.primary; sendButton.addTarget(self, action: #selector(send), for: .touchUpInside)
        for (name, icon, action) in [("照片", "uni_icon_photo", #selector(images)), ("文件", "uni_icon_file", #selector(file))] { let button = UIButton(type: .custom); button.setTitle(name, for: .normal); button.setTitleColor(NativeUITheme.body, for: .normal); button.setImage(NativeUITheme.image(icon), for: .normal); button.addTarget(self, action: action, for: .touchUpInside); tools.addSubview(button); toolButtons.append(button) }
        emojiPanel = NativeEmojiPanel(context: service.business, onEmoji: { [weak self] value in self?.text.insertText(value); self?.render() }, onSticker: { [weak self] sticker in self?.selectSticker(sticker) }, onAdd: { [weak self] in guard let self = self else { return }; self.navigationController?.pushViewController(NativeEmotionsController(context: self.service.business, beginUpload: true), animated: true) }, onDelete: { [weak self] _ in guard let self = self else { return }; self.navigationController?.pushViewController(NativeEmotionsController(context: self.service.business), animated: true) }, onClose: { [weak self] in self?.panel = 0; self?.render() }); composer.addSubview(emojiPanel); render()
    }
    override func viewWillAppear(_ animated: Bool) { super.viewWillAppear(animated); navigationController?.setNavigationBarHidden(false, animated: animated); emojiPanel?.setVisible(panel == 2) }
    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews(); let w = view.bounds.width, r: (CGFloat) -> CGFloat = { $0 * w / 750 }
        recipient.frame = CGRect(x: 0, y: view.safeAreaInsets.top, width: w, height: r(146)); recipientTitle.frame = CGRect(x: r(40), y: r(24), width: w - r(80), height: r(38)); recipientTitle.font = .systemFont(ofSize: r(26)); recipientNames.frame = CGRect(x: r(40), y: r(66), width: w - r(80), height: r(62)); recipientNames.font = .systemFont(ofSize: r(28))
        attachmentLabel.frame = CGRect(x: r(40), y: recipient.frame.maxY + r(40), width: w - r(80), height: r(130)); attachmentLabel.font = .systemFont(ofSize: r(26))
        composerHeight.constant = r(panel == 2 ? 650 : panel == 1 ? 280 : 108)
        mic.frame = CGRect(x: r(20), y: r(22), width: r(64), height: r(64)); mic.imageEdgeInsets = UIEdgeInsets(top: r(10), left: r(10), bottom: r(10), right: r(10))
        let inputWidth = w - r(sendButton.isHidden ? 192 : 308); inputBox.frame = CGRect(x: r(96), y: r(18), width: inputWidth, height: r(72)); inputBox.layer.cornerRadius = r(36)
        text.frame = CGRect(x: r(18), y: 0, width: inputWidth - r(96), height: r(72)); text.font = .systemFont(ofSize: r(28)); hold.frame = CGRect(x: r(16), y: 0, width: inputWidth - r(94), height: r(72)); hold.titleLabel?.font = .systemFont(ofSize: r(28)); emoji.frame = CGRect(x: inputWidth - r(78), y: r(6), width: r(60), height: r(60)); emoji.titleLabel?.font = .systemFont(ofSize: r(36)); plus.frame = CGRect(x: inputBox.frame.maxX + r(12), y: r(22), width: r(64), height: r(64)); plus.titleLabel?.font = .systemFont(ofSize: r(40)); sendButton.frame = CGRect(x: plus.frame.maxX + r(12), y: r(22), width: r(104), height: r(64)); sendButton.layer.cornerRadius = r(10); sendButton.titleLabel?.font = .systemFont(ofSize: r(28))
        tools.frame = CGRect(x: 0, y: r(108), width: w, height: r(172)); for (i, button) in toolButtons.enumerated() { button.frame = CGRect(x: r(32) + CGFloat(i) * r(172), y: r(12), width: r(156), height: r(140)); button.titleLabel?.font = .systemFont(ofSize: r(26)); button.imageView?.contentMode = .scaleAspectFit; button.imageEdgeInsets = UIEdgeInsets(top: r(8), left: r(50), bottom: r(56), right: r(50)); button.titleEdgeInsets = UIEdgeInsets(top: r(88), left: -r(156), bottom: 0, right: 0) }; emojiPanel.frame = CGRect(x: 0, y: r(108), width: w, height: r(542))
    }
    @objc private func changed() { render() }
    private func render() { recipientNames.text = targets.prefix(4).map(\.name).joined(separator: "、") + "（\(targets.count)） ›"; attachmentLabel.text = attachments.map { $0.filename + ($0.kind == 103 ? " · \($0.duration) 秒" : "") }.joined(separator: "\n"); text.isHidden = voiceMode; hold.isHidden = !voiceMode; tools.isHidden = panel != 1; emojiPanel?.setVisible(panel == 2); sendButton.isHidden = (text.text ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && attachments.isEmpty; composer.isUserInteractionEnabled = !sending; recipient.isEnabled = !sending; view.setNeedsLayout() }
    private func togglePanel(_ value: Int) { guard !sending, recorder == nil else { return }; voiceMode = false; text.resignFirstResponder(); panel = panel == value ? 0 : value; render() }
    @objc private func editTargets() { guard !sending else { return }; navigationController?.pushViewController(NativeMassTargetPicker(service: service, initial: targets) { [weak self] items in self?.targets = items; self?.render() }, animated: true) }
    func textFieldDidBeginEditing(_ textField: UITextField) { panel = 0; render() }
    func textFieldShouldReturn(_ textField: UITextField) -> Bool { send(); return false }
    @objc private func images() { guard !sending else { return }; var config = PHPickerConfiguration(); config.filter = .images; config.selectionLimit = 9; let picker = PHPickerViewController(configuration: config); picker.delegate = self; present(picker, animated: true) }
    func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
        picker.dismiss(animated: true); guard !results.isEmpty else { return }
        let operation = UUID(); holdID = operation; let group = DispatchGroup(); let lock = NSLock(); var files: [(Int, URL)] = []; var failure: Error?
        for (index, result) in results.enumerated() { group.enter(); result.itemProvider.loadFileRepresentation(forTypeIdentifier: UTType.image.identifier) { source, error in
            defer { group.leave() }; do { guard let source = source else { throw error ?? APIError.invalidResponse }; let temporary = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString).appendingPathExtension(source.pathExtension); try FileManager.default.copyItem(at: source, to: temporary); lock.lock(); files.append((index, temporary)); lock.unlock() } catch { lock.lock(); failure = error; lock.unlock() }
        } }
        group.notify(queue: .main) { [weak self] in defer { for (_, file) in files { try? FileManager.default.removeItem(at: file) } }; guard let self = self, self.navigationController?.topViewController === self, self.holdID == operation, !self.sending else { return }; if let failure = failure { self.showNativeNotice(failure.localizedDescription); return }; do { self.attachments = try files.sorted { $0.0 < $1.0 }.map { .init(kind: 102, path: try self.service.importMediaFile($0.1).path, filename: "图片." + $0.1.pathExtension, duration: 0) }; self.text.text = ""; self.render(); self.confirmSend("确认发送选中的 \(self.attachments.count) 张照片吗？") } catch { self.showNativeNotice(error.localizedDescription) } }
    }
    private func selectSticker(_ sticker: NativeSticker) {
        guard !sending else { return }; mediaTask?.cancel(); let operation = UUID(); mediaOperation = operation; mediaTask = Task { [weak self] in guard let self = self else { return }; defer { if self.mediaOperation == operation { self.mediaTask = nil } }; do {
            guard let url = self.service.business.media.absolute(self.service.business.media.original(sticker.url)), url.scheme == "https" else { throw APIError.invalidResponse }
            let temporary = try await NativeBoundedDownload(limit: 20 * 1024 * 1024).download(url); defer { try? FileManager.default.removeItem(at: temporary) }; try Task.checkCancellation()
            guard self.navigationController?.topViewController === self, let image = CGImageSourceCreateWithURL(temporary as CFURL, nil), let rawType = CGImageSourceGetType(image) as String?, let type = UTType(rawType), type.conforms(to: .image) else { throw APIError.invalidResponse }
            let ext = type.preferredFilenameExtension ?? "png"; let file = try self.service.createMediaFile(data: Data(contentsOf: temporary, options: .mappedIfSafe), extension: ext)
            self.attachments = [.init(kind: 102, path: file.path, filename: "表情." + ext, duration: 0)]; self.text.text = ""; self.render(); self.confirmSend("确认发送这个图片表情吗？")
        } catch { if !Task.isCancelled, self.navigationController?.topViewController === self { self.showNativeNotice(error.localizedDescription) } } }
    }
    @objc private func file() { guard !sending else { return }; let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.item], asCopy: true); picker.delegate = self; present(picker, animated: true) }
    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) { guard !sending, let url = urls.first else { return }; let access = url.startAccessingSecurityScopedResource(); defer { if access { url.stopAccessingSecurityScopedResource() } }; do { attachments = [.init(kind: 105, path: try service.importMediaFile(url).path, filename: url.lastPathComponent, duration: 0)]; text.text = ""; render(); confirmSend("确认发送文件“\(url.lastPathComponent)”吗？") } catch { showNativeNotice(error.localizedDescription) } }
    @objc private func beginHold() {
        guard !sending, recorder == nil else { return }; holdActive = true; let id = UUID(); holdID = id
        AVAudioSession.sharedInstance().requestRecordPermission { [weak self] allowed in Task { @MainActor in
            guard let self = self, self.holdActive, self.holdID == id, self.navigationController?.topViewController === self else { return }; guard allowed else { self.showNativeNotice("请允许麦克风权限。"); return }
            do { let audio = AVAudioSession.sharedInstance(); try audio.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker]); try audio.setActive(true); let file = try self.service.createMediaFile(data: Data(), extension: "m4a"); let recorder = try AVAudioRecorder(url: file, settings: [AVFormatIDKey: kAudioFormatMPEG4AAC, AVSampleRateKey: 16000, AVNumberOfChannelsKey: 1]); recorder.delegate = self; guard recorder.record(forDuration: 60) else { throw APIError.invalidResponse }; self.recorder = recorder; self.recordingURL = file; self.hold.setTitle("松开发送（最长 60 秒）", for: .normal) } catch { self.showNativeNotice(error.localizedDescription) }
        } }
    }
    @objc private func endHold() { holdActive = false; guard let recorder = recorder else { return }; recordingDuration = max(1, Int(ceil(recorder.currentTime))); recorder.stop(); finishVoice(success: true) }
    func audioRecorderDidFinishRecording(_ recorder: AVAudioRecorder, successfully flag: Bool) { if self.recorder === recorder { if recordingDuration == 0 { recordingDuration = 60 }; finishVoice(success: flag) } }
    private func finishVoice(success: Bool) { guard let file = recordingURL else { return }; self.recorder = nil; recordingURL = nil; holdActive = false; hold.setTitle("按住说话", for: .normal); try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation); guard success, navigationController?.topViewController === self else { return }; attachments = [.init(kind: 103, path: file.path, filename: "语音.m4a", duration: max(1, recordingDuration))]; recordingDuration = 0; text.text = ""; render(); confirmSend("确认发送语音吗？") }
    private func confirmSend(_ message: String) {
        guard navigationController?.topViewController === self, !sending else { return }
        if let picker = presentedViewController as? PHPickerViewController { picker.dismiss(animated: true) { [weak self] in self?.confirmSend(message) }; return }
        if let picker = presentedViewController as? UIDocumentPickerViewController { picker.dismiss(animated: true) { [weak self] in self?.confirmSend(message) }; return }
        guard presentedViewController == nil else { return }
        let alert = UIAlertController(title: "请确认", message: message, preferredStyle: .alert); alert.addAction(UIAlertAction(title: "取消", style: .cancel) { [weak self] _ in self?.attachments = []; self?.render() }); alert.addAction(UIAlertAction(title: "发送", style: .default) { [weak self] _ in self?.send() }); present(alert, animated: true)
    }
    @objc private func send() {
        let value = (text.text ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard !sending, recorder == nil, !targets.isEmpty, !value.isEmpty || !attachments.isEmpty else { return }
        // 新输入文本时沿用原版一次单一内容类型，防止草稿附件被意外一起发送。
        let payload = value.isEmpty ? attachments : []; sending = true; render(); text.resignFirstResponder(); let targets = self.targets
        sendTask = Task { [weak self] in guard let self = self else { return }; defer { self.sendTask = nil }; do { let message = try await self.onSend(targets, value, payload); try Task.checkCancellation(); guard self.navigationController?.topViewController === self else { return }; let previous = self.navigationController?.viewControllers.dropLast().last; self.navigationController?.popViewController(animated: true); previous?.showNativeNotice(message) } catch { guard !Task.isCancelled, self.navigationController?.topViewController === self else { return }; self.showNativeNotice(error.localizedDescription + " 请返回群发记录核对结果；重新发送需要新建群发。"); self.attachmentLabel.text = "请返回群发记录核对结果" } }
    }
    override func viewWillDisappear(_ animated: Bool) { super.viewWillDisappear(animated); holdActive = false; holdID = UUID(); recordingURL = nil; recorder?.delegate = nil; recorder?.stop(); recorder = nil; emojiPanel?.setVisible(false); try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation); if isMovingFromParent || navigationController?.isBeingDismissed == true || isBeingDismissed { sendTask?.cancel(); mediaTask?.cancel() } }
}

struct NativeSticker: Decodable { let id: String; let fileId: String?; let url: String; let createdAt: String }

@MainActor
final class NativeEmotionsController: UICollectionViewController, PHPickerViewControllerDelegate {
    private let context: NativeBusinessContext; private var items: [NativeSticker] = []; private var selected = Set<String>(); private var editingItems = false; private var loading = false
    private let onSelected: ((NativeSticker) -> Void)?
    private var beginUpload: Bool
    init(context: NativeBusinessContext, beginUpload: Bool = false, onSelected: ((NativeSticker) -> Void)? = nil) {
        self.context = context; self.onSelected = onSelected; self.beginUpload = beginUpload
        let layout = UICollectionViewFlowLayout(); layout.minimumInteritemSpacing = 12; layout.minimumLineSpacing = 12; layout.sectionInset = UIEdgeInsets(top: 16, left: 16, bottom: 16, right: 16)
        super.init(collectionViewLayout: layout); title = "我的表情"
    }
    required init?(coder: NSCoder) { fatalError("不使用 Storyboard") }
    override func viewDidLoad() {
        super.viewDidLoad(); collectionView.backgroundColor = .white; collectionView.register(NativeStickerCell.self, forCellWithReuseIdentifier: "sticker")
        navigationItem.rightBarButtonItems = [UIBarButtonItem(title: "编辑", style: .plain, target: self, action: #selector(toggleEdit)), UIBarButtonItem(barButtonSystemItem: .add, target: self, action: #selector(upload))]
        collectionView.refreshControl = UIRefreshControl(); collectionView.refreshControl?.addTarget(self, action: #selector(reload), for: .valueChanged); reload()
    }
    override func viewWillAppear(_ animated: Bool) { super.viewWillAppear(animated); navigationController?.setNavigationBarHidden(false, animated: animated) }
    override func viewDidAppear(_ animated: Bool) { super.viewDidAppear(animated); if beginUpload { beginUpload = false; var config = PHPickerConfiguration(); config.filter = .images; config.selectionLimit = 9; let picker = PHPickerViewController(configuration: config); picker.delegate = self; present(picker, animated: true) } }
    override func viewDidLayoutSubviews() { super.viewDidLayoutSubviews(); let edge = max(50, (view.bounds.width - 68) / 4); (collectionViewLayout as? UICollectionViewFlowLayout)?.itemSize = CGSize(width: edge, height: edge) }
    @objc private func reload() { guard !loading else { return }; loading = true; Task { defer { loading = false; collectionView.refreshControl?.endRefreshing() }; do { items = try await context.request("stickers", query: [URLQueryItem(name: "page", value: "1"), URLQueryItem(name: "size", value: "100")]); collectionView.reloadData() } catch { showNativeNotice(error.localizedDescription) } } }
    @objc private func toggleEdit() {
        if editingItems, !selected.isEmpty {
            let alert = UIAlertController(title: "删除表情", message: "确认删除选中的 \(selected.count) 个表情？", preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: "取消", style: .cancel)); alert.addAction(UIAlertAction(title: "删除", style: .destructive) { [weak self] _ in guard let self = self else { return }; Task { do { try await self.context.change("stickers/delete", body: ["stickerIds": .array(self.selected.sorted().map(JSONValue.string))]); self.selected = []; self.editingItems = false; self.navigationItem.rightBarButtonItems?.first?.title = "编辑"; self.reload() } catch { self.showNativeNotice(error.localizedDescription) } } }); present(alert, animated: true); return
        }
        editingItems.toggle(); selected = []; navigationItem.rightBarButtonItems?.first?.title = editingItems ? "完成" : "编辑"; collectionView.reloadData()
    }
    @objc private func upload() { guard !loading, !editingItems else { return }; var config = PHPickerConfiguration(); config.filter = .images; config.selectionLimit = 9; let picker = PHPickerViewController(configuration: config); picker.delegate = self; present(picker, animated: true) }
    func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
        picker.dismiss(animated: true)
        for item in results {
            item.itemProvider.loadFileRepresentation(forTypeIdentifier: UTType.image.identifier) { [weak self] url, error in
                guard let url = url else { Task { @MainActor in self?.showNativeNotice(error?.localizedDescription ?? "无法读取图片。") }; return }
                do {
                    let size = (try FileManager.default.attributesOfItem(atPath: url.path)[.size] as? NSNumber)?.intValue ?? Int.max
                    guard size <= 20 * 1024 * 1024, let source = CGImageSourceCreateWithURL(url as CFURL, nil), let raw = CGImageSourceGetType(source) as String?, let type = UTType(raw), type.conforms(to: .image) else { throw APIError.business(code: -1, message: "请选择 20 MB 以内的图片。") }
                    let data = try Data(contentsOf: url, options: .mappedIfSafe), mime = type.preferredMIMEType ?? "image/png", ext = type.preferredFilenameExtension ?? "png"
                    Task { @MainActor [weak self] in guard let self = self else { return }; do { let file = try await self.context.upload(data: data, filename: "sticker." + ext, contentType: mime, purpose: "sticker"); try await self.context.change("stickers", body: ["fileId": .string(file.id)]); self.reload() } catch { self.showNativeNotice(error.localizedDescription) } }
                } catch { Task { @MainActor in self?.showNativeNotice(error.localizedDescription) } }
            }
        }
    }
    override func collectionView(_ collectionView: UICollectionView, numberOfItemsInSection section: Int) -> Int { items.count }
    override func collectionView(_ collectionView: UICollectionView, cellForItemAt indexPath: IndexPath) -> UICollectionViewCell {
        let cell = collectionView.dequeueReusableCell(withReuseIdentifier: "sticker", for: indexPath) as! NativeStickerCell; let item = items[indexPath.item]
        cell.image.load(item.url, policy: context.media, variant: .list); cell.layer.borderColor = NativeUITheme.primary.cgColor; cell.layer.borderWidth = selected.contains(item.id) ? 2 : 0; return cell
    }
    override func collectionView(_ collectionView: UICollectionView, didSelectItemAt indexPath: IndexPath) {
        let item = items[indexPath.item]
        if editingItems { if selected.contains(item.id) { selected.remove(item.id) } else { selected.insert(item.id) }; navigationItem.rightBarButtonItems?.first?.title = selected.isEmpty ? "完成" : "删除（\(selected.count)）"; collectionView.reloadItems(at: [indexPath]) }
        else if let selected = onSelected { navigationController?.popViewController(animated: true); selected(item) }
        else { navigationController?.pushViewController(NativeImagePreviewController(url: item.url, policy: context.media, allImages: items.map(\.url)), animated: true) }
    }
}

private final class NativeStickerCell: UICollectionViewCell {
    let image = NativeRemoteImageView()
    override init(frame: CGRect) { super.init(frame: frame); image.contentMode = .scaleAspectFit; contentView.addSubview(image) }
    required init?(coder: NSCoder) { fatalError("不使用 Storyboard") }
    override func layoutSubviews() { super.layoutSubviews(); image.frame = contentView.bounds.insetBy(dx: 4, dy: 4) }
    override func prepareForReuse() { super.prepareForReuse(); image.cancel() }
}
