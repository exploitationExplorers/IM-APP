import UIKit
import IMCore
import PhotosUI
import UniformTypeIdentifiers
import AVKit
import AudioToolbox
import ImageIO

private final class NativeComposerActionButton: UIButton {
    private let iconBox = UIView()
    private let iconView = UIImageView()
    private let caption = UILabel()
    init(title: String, icon: String) {
        super.init(frame: .zero)
        accessibilityLabel = title; isAccessibilityElement = true
        iconBox.backgroundColor = .white; iconBox.isUserInteractionEnabled = false
        iconView.image = NativeUITheme.image(icon); iconView.contentMode = .scaleAspectFit
        caption.text = title; caption.textColor = UIColor(hex: 0x666666); caption.textAlignment = .center
        addSubview(iconBox); iconBox.addSubview(iconView); addSubview(caption)
    }
    required init?(coder: NSCoder) { fatalError("不使用 Storyboard") }
    override func layoutSubviews() {
        super.layoutSubviews()
        let scale = bounds.width / 140
        iconBox.frame = CGRect(x: (bounds.width - 100 * scale) / 2, y: 0, width: 100 * scale, height: 100 * scale)
        iconBox.layer.cornerRadius = 20 * scale
        iconView.frame = iconBox.bounds.insetBy(dx: 22 * scale, dy: 22 * scale)
        caption.frame = CGRect(x: 0, y: 112 * scale, width: bounds.width, height: 32 * scale)
        caption.font = .systemFont(ofSize: 24 * scale)
    }
    override var isHighlighted: Bool { didSet { iconBox.alpha = isHighlighted ? 0.55 : 1 } }
}

@MainActor
final class NativeConversationViewController: UIViewController, UICollectionViewDelegateFlowLayout, PHPickerViewControllerDelegate, UIDocumentPickerDelegate, UITextFieldDelegate, UIImagePickerControllerDelegate, UINavigationControllerDelegate, AVAudioPlayerDelegate {
    private let service: NativeIMService
    private let conversation: NativeConversation
    private let header = UIView()
    private let back = UIButton(type: .system)
    private let heading = UILabel()
    private let more = UIButton(type: .system)
    private let notice = UILabel()
    private let pinTitle = UILabel()
    private let pinLine = UIView()
    private let dismissPin = UIButton(type: .system)
    private var dismissedPinID: String?
    private var showingPin = false
    private let composer = UIView()
    private let mic = NativeUITheme.imageButton("uni_icon_mic", accessibility: "语音")
    private let inputBox = UIView()
    private let input = UITextField()
    private let emoji = UIButton(type: .system)
    private let plus = UIButton(type: .system)
    private let send = UIButton(type: .system)
    private let refresh = UIRefreshControl()
    private var collection: UICollectionView!
    private var dataSource: UICollectionViewDiffableDataSource<Int, String>!
    private var displayed: [String: ChatTextItem] = [:]
    private struct RenderedRow: Equatable {
        let message: ChatTextItem
        let date: String?
        let status: String
        let sending: Bool
        let preparing: Bool
        let selected: Bool
    }
    private var renderedRows: [String: RenderedRow] = [:]
    private struct MeasuredRow {
        let row: RenderedRow; let width: CGFloat; let mediaSize: CGSize?; let height: CGFloat
    }
    private let sizingCell = NativeMessageCell(frame: .zero)
    private var measuredRows: [String: MeasuredRow] = [:]
    private var mediaSizes: [String: CGSize] = [:]
    private var pendingMediaSizes: [String: CGSize] = [:]
    private var applyingSnapshot = false
    private var renderPending = false
    private var bottomPending = false
    private var positionedInitialMessages = false
    private var userInteracted = false
    private var scrollGestureRevision: UInt64 = 0
    private var historyReloadRevision: UInt64 = 0
    private var observer: UUID?
    private var cursor = ""
    private var isEnd = false
    private var loading = false
    private var awaitingHistoryCursor: String?
    private var hasLocalHistoryPreview = false
    private var composerSubmission = ComposerSubmissionGate()
    private var submitting: Bool { composerSubmission.isSubmitting }
    private var loadOperation: UUID?
    private var headerHeight: NSLayoutConstraint!
    private var composerHeight: NSLayoutConstraint!
    private var quoteDraft: ChatTextItem? { didSet { if isViewLoaded { updateQuoteBar() } } }
    private let quoteBar = NativeComposerQuoteView()
    private var recorder: AVAudioRecorder?
    private var recordingURL: URL?
    private let audioSession = NativeAudioSessionLease()
    private var audioTask: Task<Void, Never>?
    private var recordPermissionID = UUID()
    private var voiceDraft: (url: URL, duration: Int)?; private var voiceTimer: Task<Void, Never>?; private var voicePlayer: AVAudioPlayer?
    private let voicePanel = UIView(); private let voiceLabel = UILabel(); private let voiceCancel = UIButton(type: .system); private let voiceAction = UIButton(type: .system); private let voicePlay = UIButton(type: .system)
    private let attachmentPanel = UIView(); private var attachmentButtons: [NativeComposerActionButton] = []; private var attachmentsVisible = false
    private var emojiPanel: NativeEmojiPanel!; private var emojiVisible = false
    private var readTask: Task<Void, Never>?
    private let focusID: String?; private var focusPending: Bool; private var focusedInitially = false
    private var mentionDraft: [NativeGroupMember] = []; private var mentionAll = false
    private var multiSelecting = false; private var selectedIDs = Set<String>()
    private var dateSeparators: [String: String] = [:]; private let latest = UIButton(type: .system)
    private var historyTask: Task<Void, Never>?
    private var actionTask: Task<Void, Never>? {
        didSet {
            if actionTask == nil { actionProgress.hide() }
            else { actionProgress.show(in: self) }
        }
    }
    private var roleTask: Task<Void, Never>?
    private let actionProgress = NativeActionProgress()
    private let detailsProgress = NativeActionProgress()
    private var detailsTask: Task<Void, Never>?
    private var canManageGroup = false; private var autoHistoryAllowed = true; private var processingCards = Set<String>()
    private var lastHistoryOffset = CGFloat.zero
    private var lastAutomaticHistoryRequest: String?
    private struct PendingAttachment {
        let id: UUID; let file: URL; let kind: Int; let filename: String
        init(id: UUID = UUID(), file: URL, kind: Int, filename: String) { self.id = id; self.file = file; self.kind = kind; self.filename = filename }
    }
    private var attachmentPreviews: [UUID: ChatTextItem] = [:]
    private var pendingAttachments: [PendingAttachment] = []; private var pendingMediaIDs = Set<UUID>(); private let pendingMediaButton = UIButton(type: .system)

    init(service: NativeIMService, conversation: NativeConversation, focusID: String? = nil) {
        self.service = service; self.conversation = conversation; self.focusID = focusID; focusPending = focusID != nil
        super.init(nibName: nil, bundle: nil)
    }
    required init?(coder: NSCoder) { fatalError("不使用 Storyboard") }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        navigationController?.setNavigationBarHidden(true, animated: animated)
        if observer == nil { observer = service.observe { [weak self] in self?.render() } }
        emojiPanel?.setVisible(emojiVisible)
        render()
        if conversation.type == 3 { roleTask?.cancel(); roleTask = Task { [weak self] in guard let self = self else { return }; do { let id = try await self.service.businessPeerID(self.conversation); let group: NativeGroup = try await self.service.business.request("groups/detail", query: [URLQueryItem(name: "groupId", value: id)]); try Task.checkCancellation(); self.canManageGroup = group.canManage || group.ownerId == self.service.business.userID } catch { if !Task.isCancelled { self.canManageGroup = false } } } }
        if let focusID = focusID, !focusedInitially {
            focusedInitially = true; cursor = focusID
            Task { do { try await service.focusMessage(focusID, in: conversation); await loadOlder(); render() } catch { showNativeNotice(error.localizedDescription) } }
        } else if cursor.isEmpty && !loading { Task { await loadOlder() } }
        readTask = Task { [weak self] in guard let self = self else { return }; do { try await self.service.markRead(self.conversation) } catch { if !Task.isCancelled { self.showNativeNotice(error.localizedDescription) } } }
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        if let observer = observer { service.removeObserver(observer) }
        observer = nil; loadOperation = nil; loading = false; refresh.endRefreshing()
        emojiPanel?.setVisible(false); historyTask?.cancel(); historyTask = nil; roleTask?.cancel(); actionTask?.cancel()
        stopVoiceAudio(); readTask?.cancel(); readTask = nil
        actionProgress.hide(); detailsProgress.hide()
        detailsTask?.cancel()
        detailsTask = nil
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(hex: 0xe6e8ee)
        let layout = UICollectionViewFlowLayout()
        layout.estimatedItemSize = .zero; layout.minimumLineSpacing = 0; layout.minimumInteritemSpacing = 0
        collection = UICollectionView(frame: .zero, collectionViewLayout: layout)
        collection.backgroundColor = view.backgroundColor
        NativeUITheme.useCustomScrollEdges(collection)
        collection.contentInsetAdjustmentBehavior = .never
        collection.delegate = self
        collection.keyboardDismissMode = .interactive
        collection.alwaysBounceVertical = true
        collection.accessibilityIdentifier = "realMessageList"
        collection.register(NativeMessageCell.self, forCellWithReuseIdentifier: "message")
        refresh.addTarget(self, action: #selector(pullHistory), for: .valueChanged)
        collection.refreshControl = refresh
        collection.addGestureRecognizer(UILongPressGestureRecognizer(target: self, action: #selector(messageActions(_:))))
        let contentViews: [UIView] = [header, collection, composer]
        contentViews.forEach { $0.translatesAutoresizingMaskIntoConstraints = false; view.addSubview($0) }
        latest.setTitle("↓ 最新", for: .normal); latest.backgroundColor = .white; latest.setTitleColor(NativeUITheme.primary, for: .normal); latest.layer.cornerRadius = 18; latest.layer.shadowOpacity = 0.1; latest.layer.shadowRadius = 6; latest.isHidden = true; latest.addTarget(self, action: #selector(returnLatest), for: .touchUpInside); view.addSubview(latest)
        header.backgroundColor = .white
        [back, heading, more, notice, pinTitle, pinLine, dismissPin].forEach { header.addSubview($0) }
        pinTitle.textColor = NativeUITheme.primary; pinLine.backgroundColor = NativeUITheme.primary
        dismissPin.setTitle("×", for: .normal); dismissPin.setTitleColor(NativeUITheme.secondary, for: .normal); dismissPin.accessibilityLabel = "隐藏置顶提示"
        dismissPin.addAction(UIAction { [weak self] _ in guard let self = self else { return }; self.dismissedPinID = self.service.pinnedMessage(in: self.conversation)?.id; self.render() }, for: .touchUpInside)
        back.setImage(NativeUITheme.image("uni_icon_back"), for: .normal); back.setTitleColor(NativeUITheme.body, for: .normal)
        back.accessibilityLabel = "返回"; back.addTarget(self, action: #selector(goBack), for: .touchUpInside)
        heading.text = conversation.title.isEmpty ? "聊天" : conversation.title
        heading.textColor = NativeUITheme.body
        heading.isUserInteractionEnabled = true
        heading.accessibilityTraits.insert(.button)
        heading.accessibilityHint = "查看聊天详情"
        heading.addGestureRecognizer(UITapGestureRecognizer(target: self, action: #selector(openDetails)))
        more.setTitle("⋯", for: .normal); more.setTitleColor(NativeUITheme.body, for: .normal)
        more.addTarget(self, action: #selector(showMenu), for: .touchUpInside)
        notice.textAlignment = .center; notice.font = .systemFont(ofSize: 10); notice.numberOfLines = 2
        notice.isUserInteractionEnabled = true; notice.addGestureRecognizer(UITapGestureRecognizer(target: self, action: #selector(openPinned))); notice.textColor = NativeUITheme.secondary; notice.backgroundColor = UIColor(hex: 0xf6f7fb)
        composer.backgroundColor = UIColor(hex: 0xf7f7f7)
        composer.addSubview(pendingMediaButton); pendingMediaButton.backgroundColor = .white; pendingMediaButton.setTitleColor(NativeUITheme.primary, for: .normal); pendingMediaButton.addTarget(self, action: #selector(showPendingAttachments), for: .touchUpInside)
        [mic, inputBox, plus, send].forEach { composer.addSubview($0) }
        composer.addSubview(quoteBar)
        quoteBar.onClose = { [weak self] in
            self?.quoteDraft = nil
            self?.input.placeholder = "输入消息"
        }
        updateQuoteBar()
        composer.addSubview(voicePanel); [voiceLabel, voiceCancel, voiceAction, voicePlay].forEach { voicePanel.addSubview($0) }; voicePanel.isHidden = true
        voiceLabel.textAlignment = .center; voiceCancel.setTitle("取消", for: .normal); voiceCancel.addTarget(self, action: #selector(cancelVoice), for: .touchUpInside); voiceAction.addTarget(self, action: #selector(voiceActionTapped), for: .touchUpInside); voicePlay.setTitle("▶ 试听", for: .normal); voicePlay.addTarget(self, action: #selector(previewVoice), for: .touchUpInside)
        composer.addSubview(attachmentPanel); attachmentPanel.backgroundColor = UIColor(hex: 0xf0f0f0); attachmentPanel.isHidden = true; configureAttachments()
        emojiPanel = NativeEmojiPanel(context: service.business, onEmoji: { [weak self] value in self?.input.insertText(value); self?.inputChanged() }, onSticker: { [weak self] sticker in self?.sendSticker(sticker) }, onAdd: { [weak self] in self?.openStickerUpload() }, onDelete: { [weak self] sticker in self?.deleteSticker(sticker) }, onClose: { [weak self] in self?.emojiVisible = false; self?.emojiPanel.setVisible(false); self?.view.setNeedsLayout() }); composer.addSubview(emojiPanel); emojiPanel.setVisible(false)
        mic.addTarget(self, action: #selector(toggleRecording), for: .touchUpInside)
        inputBox.backgroundColor = .white; inputBox.addSubview(input); inputBox.addSubview(emoji)
        input.placeholder = "输入消息"; input.textColor = NativeUITheme.body
        input.accessibilityIdentifier = "realMessageInput"
        input.delegate = self; input.returnKeyType = .send
        input.addTarget(self, action: #selector(inputChanged), for: .editingChanged)
        emoji.setImage(UIImage(systemName: "face.smiling"), for: .normal); emoji.tintColor = UIColor(hex: 0x666666)
        emoji.addTarget(self, action: #selector(showEmoji), for: .touchUpInside)
        plus.setTitle("＋", for: .normal); plus.setTitleColor(NativeUITheme.body, for: .normal)
        plus.addTarget(self, action: #selector(showAttachments), for: .touchUpInside)
        send.setTitle("传送", for: .normal); send.setTitleColor(.white, for: .normal); send.backgroundColor = NativeUITheme.primary
        send.accessibilityIdentifier = "sendRealMessage"
        send.addTarget(self, action: #selector(sendText), for: .touchUpInside)
        send.isHidden = true
        headerHeight = header.heightAnchor.constraint(equalToConstant: 125)
        composerHeight = composer.heightAnchor.constraint(equalToConstant: 54)
        NSLayoutConstraint.activate([
            header.topAnchor.constraint(equalTo: view.topAnchor), header.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            header.trailingAnchor.constraint(equalTo: view.trailingAnchor), headerHeight,
            collection.topAnchor.constraint(equalTo: header.bottomAnchor), collection.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            collection.trailingAnchor.constraint(equalTo: view.trailingAnchor), collection.bottomAnchor.constraint(equalTo: composer.topAnchor),
            composer.leadingAnchor.constraint(equalTo: view.leadingAnchor), composer.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            composer.bottomAnchor.constraint(equalTo: view.keyboardLayoutGuide.topAnchor), composerHeight
        ])
        dataSource = UICollectionViewDiffableDataSource<Int, String>(collectionView: collection) { [weak self] collection, index, id in
            guard let self = self, let message = self.displayed[id], let cell = collection.dequeueReusableCell(withReuseIdentifier: "message", for: index) as? NativeMessageCell else { return nil }
            cell.configure(message: message, service: self.service, date: self.dateSeparators[id], preparing: self.attachmentPreviews.values.contains { $0.id == id && $0.status != 3 }, group: self.conversation.type == 3, resolvedMediaSize: self.mediaSizes[id], onMediaSizeResolved: { [weak self] size in
                guard let self = self, self.mediaSizes[id] != size else { return }
                self.pendingMediaSizes[id] = size; self.applyPendingMediaSizes()
            })
            cell.onAvatarTap = { [weak self] in self?.openSender(message) }
            cell.onQuoteTap = { [weak self] in guard let self = self, let reference = MessageQuoteReference(serialized: message.serialized) else { return }; self.locate(reference.id) }
            cell.contentView.backgroundColor = self.selectedIDs.contains(id) ? NativeUITheme.primary.withAlphaComponent(0.12) : .clear
            return cell
        }
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        let width = view.bounds.width
        let r: (CGFloat) -> CGFloat = { NativeUITheme.rpx($0, width: width) }
        let top = view.safeAreaInsets.top
        let hasVoice = recorder != nil || voiceDraft != nil
        let quoteOffset = quoteDraft == nil ? CGFloat.zero : r(92)
        let failedDrafts = pendingAttachments.filter { !pendingMediaIDs.contains($0.id) }
        let draftOffset = failedDrafts.isEmpty ? CGFloat.zero : r(72)
        let attachmentRows = (attachmentButtons.count + 3) / 4
        let attachmentHeight = CGFloat(24 + attachmentRows * 144 + max(0, attachmentRows - 1) * 28 + 32)
        headerHeight.constant = top + r(110) + (notice.isHidden ? 0 : r(showingPin ? 100 : 72)); composerHeight.constant = r(hasVoice ? 180 : emojiVisible ? 650 : attachmentsVisible ? 108 + attachmentHeight : 108) + quoteOffset + draftOffset
        // keyboardLayoutGuide 停在安全区上缘，底部延续输入面板颜色。
        view.backgroundColor = attachmentsVisible && !hasVoice ? attachmentPanel.backgroundColor : composer.backgroundColor
        back.frame = CGRect(x: r(26), y: top + r(29), width: r(52), height: r(52)); back.titleLabel?.font = .systemFont(ofSize: r(52))
        heading.frame = CGRect(x: r(78), y: top + r(28), width: width - r(156), height: r(54)); heading.font = .systemFont(ofSize: r(34), weight: .bold)
        more.frame = CGRect(x: width - r(78), y: top + r(29), width: r(52), height: r(52)); more.titleLabel?.font = .systemFont(ofSize: r(42))
        if showingPin {
            pinLine.frame = CGRect(x: r(32), y: top + r(128), width: r(6), height: r(64))
            pinTitle.frame = CGRect(x: r(58), y: top + r(120), width: width - r(142), height: r(34)); pinTitle.font = .systemFont(ofSize: r(24))
            notice.frame = CGRect(x: r(58), y: top + r(154), width: width - r(142), height: r(40)); notice.font = .systemFont(ofSize: r(26)); notice.textAlignment = .left; notice.numberOfLines = 1; notice.backgroundColor = .white
            dismissPin.frame = CGRect(x: width - r(84), y: top + r(116), width: r(72), height: r(88)); dismissPin.titleLabel?.font = .systemFont(ofSize: r(36))
        } else {
            notice.frame = CGRect(x: r(12), y: top + r(110), width: width - r(24), height: r(72)); notice.font = .systemFont(ofSize: r(24)); notice.textAlignment = .center; notice.numberOfLines = 2; notice.backgroundColor = UIColor(hex: 0xf6f7fb)
        }
        mic.frame = CGRect(x: r(20), y: r(22), width: r(64), height: r(64)); mic.imageEdgeInsets = UIEdgeInsets(top: r(10), left: r(10), bottom: r(10), right: r(10))
        let sendWidth = send.isHidden ? 0 : r(116), inputX = r(96)
        let inputWidth = width - inputX - r(96) - sendWidth
        inputBox.frame = CGRect(x: inputX, y: r(18), width: inputWidth, height: r(72)); inputBox.layer.cornerRadius = r(36)
        input.frame = CGRect(x: r(18), y: 0, width: max(r(24), inputWidth - r(96)), height: r(72)); input.font = .systemFont(ofSize: r(28))
        emoji.frame = CGRect(x: inputWidth - r(78), y: r(6), width: r(60), height: r(60)); emoji.setPreferredSymbolConfiguration(UIImage.SymbolConfiguration(pointSize: r(36), weight: .regular), forImageIn: .normal)
        plus.frame = CGRect(x: inputBox.frame.maxX + r(12), y: r(22), width: r(64), height: r(64)); plus.titleLabel?.font = .systemFont(ofSize: r(40))
        send.frame = CGRect(x: plus.frame.maxX + r(12), y: r(22), width: r(104), height: r(64)); send.layer.cornerRadius = r(10); send.titleLabel?.font = .systemFont(ofSize: r(28))
        [mic, inputBox, plus].forEach { $0.isHidden = hasVoice }; if hasVoice { send.isHidden = true }
        voicePanel.isHidden = !hasVoice; voicePanel.frame = CGRect(x: 0, y: 0, width: width, height: composer.bounds.height - quoteOffset - draftOffset); voiceLabel.frame = CGRect(x: r(32), y: r(16), width: width - r(64), height: r(48)); voiceLabel.font = .systemFont(ofSize: r(30)); voiceCancel.frame = CGRect(x: r(32), y: r(88), width: r(140), height: r(64)); voiceAction.frame = CGRect(x: width - r(172), y: r(88), width: r(140), height: r(64)); voicePlay.frame = CGRect(x: (width - r(180)) / 2, y: r(88), width: r(180), height: r(64)); voicePlay.isHidden = voiceDraft == nil; voiceAction.setTitle(recorder == nil ? "发送" : "结束录音", for: .normal)
        attachmentPanel.isHidden = !attachmentsVisible || hasVoice; attachmentPanel.frame = CGRect(x: 0, y: r(108), width: width, height: r(attachmentHeight))
        emojiPanel.frame = CGRect(x: 0, y: r(108), width: width, height: r(542)); emojiPanel.isHidden = !emojiVisible || hasVoice
        for (index, button) in attachmentButtons.enumerated() { button.frame = CGRect(x: r(32) + CGFloat(index % 4) * r(164), y: r(24) + CGFloat(index / 4) * r(172), width: r(140), height: r(144)) }
        for child in [mic, inputBox, plus, send, voicePanel, attachmentPanel, emojiPanel!] { child.frame.origin.y += quoteOffset + draftOffset }
        pendingMediaButton.isHidden = failedDrafts.isEmpty; pendingMediaButton.frame = CGRect(x: 0, y: quoteOffset, width: width, height: draftOffset); pendingMediaButton.setTitle("附件未发送 · 点此重试（\(failedDrafts.count)）", for: .normal); pendingMediaButton.titleLabel?.font = .systemFont(ofSize: r(24))
        latest.frame = CGRect(x: width - r(164), y: composer.frame.minY - r(108), width: r(140), height: r(72)); latest.titleLabel?.font = .systemFont(ofSize: r(24)); view.bringSubviewToFront(latest)
        quoteBar.frame = CGRect(x: 0, y: 0, width: width, height: quoteOffset)
    }
    private func updateQuoteBar() {
        quoteBar.configure(message: quoteDraft, policy: service.business.media)
        view.setNeedsLayout()
    }

    private func showForwardResult(_ message: String) {
        showNativeNotice(message)
    }
    private func render(scrollToBottom: Bool = false) {
        guard isViewLoaded, dataSource != nil else { return }
        guard !applyingSnapshot else { renderPending = true; bottomPending = bottomPending || scrollToBottom; return }
        let revision = service.historyReloadRevisions[conversation.id, default: 0]
        if historyReloadRevision != revision {
            historyReloadRevision = revision
            loadOperation = nil; loading = false; historyTask?.cancel()
            cursor = ""; isEnd = false; awaitingHistoryCursor = ""
            hasLocalHistoryPreview = false; autoHistoryAllowed = true; lastAutomaticHistoryRequest = nil
            historyTask = Task { [weak self] in
                guard let self = self else { return }
                defer { self.historyTask = nil }
                await self.loadOlder()
            }
        }
        if let requested = awaitingHistoryCursor, requested == cursor,
           let page = service.completedHistoryPage(conversation, cursor: requested) {
            applyHistoryPage(page); awaitingHistoryCursor = nil
        }
        if navigationController?.topViewController === self, presentedViewController == nil, let result = service.takeForwardNotice(in: conversation.id) { showForwardResult(result) }
        let restriction = service.sendRestriction(conversation)
        let pin = service.pinnedMessage(in: conversation)
        showingPin = restriction == nil && pin != nil && pin?.id != dismissedPinID
        notice.text = restriction ?? (showingPin ? pin?.preview : ""); notice.isHidden = notice.text?.isEmpty != false
        pinTitle.text = pin?.shared == true ? "置顶消息" : "仅为我置顶"
        [pinTitle, pinLine, dismissPin].forEach { $0.isHidden = !showingPin }; view.setNeedsLayout()
        if multiSelecting { heading.text = "已选 \(selectedIDs.count) 条"; more.setTitle("转发", for: .normal) } else { heading.text = conversation.title; more.setTitle("⋯", for: .normal) }
        input.isEnabled = !submitting && service.canSend(to: conversation); send.isEnabled = !submitting && service.canSend(to: conversation)
        let stored = service.visibleMessages(conversation.id)
        let storedMedia = Set(stored.filter { $0.senderID == service.imUserID }.compactMap { $0.media?.localPath }.filter { !$0.isEmpty })
        let previews = attachmentPreviews.values.filter { $0.media?.localPath.isEmpty != false || !storedMedia.contains($0.media?.localPath ?? "") }
        let items = ChatTextItem.merge(stored, Array(previews))
        dateSeparators = [:]; var previousDay: Date?; let calendar = Calendar.current
        for item in items where item.timestamp > 0 {
            let date = Date(timeIntervalSince1970: Double(item.timestamp) / 1000), day = calendar.startOfDay(for: Date(timeIntervalSince1970: Double(item.timestamp) / 1000))
            defer { previousDay = day }; guard previousDay != day else { continue }
            let diff = calendar.dateComponents([.day], from: day, to: calendar.startOfDay(for: Date())).day ?? 0
            if diff == 0 { dateSeparators[item.id] = "今天" }
            else if diff == 1 { dateSeparators[item.id] = "昨天" }
            else if diff > 1 && diff < 7 { dateSeparators[item.id] = "星期" + ["日", "一", "二", "三", "四", "五", "六"][calendar.component(.weekday, from: date) - 1] }
            else { let formatter = DateFormatter(); formatter.dateFormat = calendar.component(.year, from: date) == calendar.component(.year, from: Date()) ? "M月d日" : "yyyy年M月d日"; dateSeparators[item.id] = formatter.string(from: date) }
        }
        let preparingIDs = Set(attachmentPreviews.values.filter { $0.status != 3 }.map(\.id))
        let rows = Dictionary(items.map { item in
            (item.id, RenderedRow(message: item, date: dateSeparators[item.id], status: service.sendingLabel(item), sending: service.mediaIsSending(item), preparing: preparingIDs.contains(item.id), selected: selectedIDs.contains(item.id)))
        }, uniquingKeysWith: { _, latest in latest })
        let changedIDs = items.map(\.id).filter { renderedRows[$0] != rows[$0] }
        let previousSnapshot = dataSource.snapshot()
        guard previousSnapshot.itemIdentifiers != items.map(\.id) || !changedIDs.isEmpty || scrollToBottom || focusPending else { return }
        let anchor = captureViewport()
        let snapshotGestureRevision = scrollGestureRevision
        renderedRows = rows
        measuredRows = measuredRows.filter { rows[$0.key] != nil }
        displayed = Dictionary(items.map { ($0.id, $0) }, uniquingKeysWith: { _, b in b })
        let nearBottom = collection.contentOffset.y + collection.bounds.height >= collection.contentSize.height - 80
        let followBottom = HistoryViewportPolicy.shouldFollowBottom(explicit: scrollToBottom, initial: !positionedInitialMessages, userInteracted: userInteracted, appended: !items.isEmpty && previousSnapshot.itemIdentifiers.last != items.last?.id, nearBottom: nearBottom, interacting: collection.isDragging || collection.isDecelerating)
        let previous = Set(previousSnapshot.itemIdentifiers)
        var snapshot = NSDiffableDataSourceSnapshot<Int, String>(); snapshot.appendSections([0]); snapshot.appendItems(items.map(\.id))
        snapshot.reconfigureItems(changedIDs.filter(previous.contains))
        applyingSnapshot = true
        dataSource.apply(snapshot, animatingDifferences: false) { [weak self] in
            guard let self = self else { return }
            self.collection.collectionViewLayout.invalidateLayout(); self.collection.layoutIfNeeded()
            if self.focusPending, let focus = self.focusID, let index = self.dataSource.indexPath(for: focus) {
                self.focusPending = false; self.collection.scrollToItem(at: index, at: .centeredVertically, animated: false)
            } else if followBottom && !items.isEmpty && (scrollToBottom || self.scrollGestureRevision == snapshotGestureRevision) {
                self.collection.scrollToItem(at: IndexPath(item: items.count - 1, section: 0), at: .bottom, animated: false)
            } else {
                self.restoreViewport(anchor)
            }
            if !items.isEmpty { self.positionedInitialMessages = true }
            self.applyingSnapshot = false; self.updateLatestButton(); self.applyPendingMediaSizes()
            if self.renderPending {
                let bottom = self.bottomPending; self.renderPending = false; self.bottomPending = false
                self.render(scrollToBottom: bottom)
            }
        }
    }

    func collectionView(_ collectionView: UICollectionView, layout collectionViewLayout: UICollectionViewLayout, sizeForItemAt indexPath: IndexPath) -> CGSize {
        let width = collectionView.bounds.width
        guard let id = dataSource.itemIdentifier(for: indexPath), let row = renderedRows[id] else { return CGSize(width: width, height: 1) }
        let size = mediaSizes[id]
        if let cached = measuredRows[id], cached.width == width, cached.row == row, cached.mediaSize == size { return CGSize(width: width, height: cached.height) }
        sizingCell.configure(message: row.message, service: service, date: row.date, preparing: row.preparing, group: conversation.type == 3, loadResources: false, resolvedMediaSize: size)
        let height = sizingCell.measuredHeight(width: width)
        measuredRows[id] = MeasuredRow(row: row, width: width, mediaSize: size, height: height)
        return CGSize(width: width, height: height)
    }

    private struct ViewportAnchor {
        let id: String; let distance: CGFloat; let gestureRevision: UInt64; let translation: CGFloat
    }
    private func captureViewport() -> ViewportAnchor? {
        guard let index = collection.indexPathsForVisibleItems.sorted().first,
              let id = dataSource.itemIdentifier(for: index), let frame = collection.layoutAttributesForItem(at: index)?.frame else { return nil }
        return ViewportAnchor(id: id, distance: frame.minY - collection.contentOffset.y, gestureRevision: scrollGestureRevision, translation: collection.panGestureRecognizer.translation(in: collection).y)
    }
    private func restoreViewport(_ anchor: ViewportAnchor?) {
        guard let anchor = anchor, anchor.gestureRevision == scrollGestureRevision,
              let index = dataSource.indexPath(for: anchor.id), let frame = collection.layoutAttributesForItem(at: index)?.frame else { return }
        let delta = collection.isDragging ? anchor.translation - collection.panGestureRecognizer.translation(in: collection).y : 0
        let minimum = -collection.adjustedContentInset.top
        let maximum = max(minimum, collection.contentSize.height - collection.bounds.height + collection.adjustedContentInset.bottom)
        collection.contentOffset.y = CGFloat(HistoryViewportPolicy.restoredOffset(anchorMinY: Double(frame.minY), distanceFromTop: Double(anchor.distance), gestureDelta: Double(delta), minimum: Double(minimum), maximum: Double(maximum)))
        lastHistoryOffset = collection.contentOffset.y
    }
    private func applyPendingMediaSizes() {
        guard !pendingMediaSizes.isEmpty, !applyingSnapshot, !collection.isDragging, !collection.isDecelerating else { return }
        let anchor = captureViewport()
        let updates = pendingMediaSizes; pendingMediaSizes = [:]
        for (id, size) in updates { mediaSizes[id] = size; measuredRows[id] = nil }
        for case let cell as NativeMessageCell in collection.visibleCells {
            guard let index = collection.indexPath(for: cell), let id = dataSource.itemIdentifier(for: index), let size = updates[id] else { continue }
            cell.updateResolvedMediaSize(size)
        }
        UIView.performWithoutAnimation {
            collection.collectionViewLayout.invalidateLayout(); collection.layoutIfNeeded(); restoreViewport(anchor)
        }
        updateLatestButton()
    }

    private func loadOlder() async {
        guard !loading, !isEnd, service.isActive else { refresh.endRefreshing(); return }
        let operation = UUID(); loadOperation = operation; loading = true
        let requested = cursor
        awaitingHistoryCursor = requested
        defer { if loadOperation == operation { loading = false; refresh.endRefreshing() } }
        do {
            let page = try await service.history(conversation, cursor: requested)
            guard loadOperation == operation, service.isActive else { return }
            if page.isLocalPreview {
                hasLocalHistoryPreview = hasLocalHistoryPreview || !page.messages.isEmpty
                if page.localExhausted { autoHistoryAllowed = false }
            } else if cursor == requested { applyHistoryPage(page); awaitingHistoryCursor = nil }
            render()
        } catch {
            guard loadOperation == operation, service.isActive else { return }
            autoHistoryAllowed = false
            showNativeNotice(error.localizedDescription)
        }
    }

    private func applyHistoryPage(_ page: NativeHistoryPage) {
        guard !page.isLocalPreview else { return }
        if let oldest = page.messages.min(by: { $0.timestamp == $1.timestamp ? $0.id < $1.id : $0.timestamp < $1.timestamp }) { cursor = oldest.id }
        isEnd = page.isEnd
        autoHistoryAllowed = true
        refresh.attributedTitle = nil
    }

    func scrollViewWillBeginDragging(_ scrollView: UIScrollView) {
        userInteracted = true; scrollGestureRevision &+= 1
        autoHistoryAllowed = true; lastAutomaticHistoryRequest = nil; lastHistoryOffset = scrollView.contentOffset.y
    }
    func scrollViewDidEndDragging(_ scrollView: UIScrollView, willDecelerate decelerate: Bool) { if !decelerate { applyPendingMediaSizes() } }
    func scrollViewDidEndDecelerating(_ scrollView: UIScrollView) { applyPendingMediaSizes() }
    func scrollViewDidScroll(_ scrollView: UIScrollView) {
        updateLatestButton()
        let towardHistory = scrollView.contentOffset.y < lastHistoryOffset
        lastHistoryOffset = scrollView.contentOffset.y
        guard scrollView === collection, historyTask == nil,
              HistoryViewportPolicy.shouldPrefetch(distanceFromTop: Double(scrollView.contentOffset.y + scrollView.adjustedContentInset.top), viewportHeight: Double(scrollView.bounds.height), movingTowardHistory: towardHistory, interacting: scrollView.isDragging || scrollView.isDecelerating, canLoad: autoHistoryAllowed && !loading && !isEnd && (!cursor.isEmpty || hasLocalHistoryPreview)) else { return }
        // 同一次手势中，游标和已显示的最早消息都没有推进时不重复请求；新手势可重试。
        let fingerprint = cursor + "|" + (dataSource.snapshot().itemIdentifiers.first ?? "")
        guard fingerprint != lastAutomaticHistoryRequest else { return }
        lastAutomaticHistoryRequest = fingerprint
        historyTask = Task { [weak self] in
            guard let self = self else { return }
            defer { self.historyTask = nil }
            await self.loadOlder()
        }
    }
    private func updateLatestButton() { guard isViewLoaded, collection != nil else { return }; latest.isHidden = collection.contentSize.height - collection.contentOffset.y - collection.bounds.height < 140 }
    @objc private func returnLatest() { guard let id = dataSource.snapshot().itemIdentifiers.last, let index = dataSource.indexPath(for: id) else { return }; collection.scrollToItem(at: index, at: .bottom, animated: true) }
    private func locate(_ id: String) {
        guard actionTask == nil else { return }
        actionTask = Task { [weak self] in guard let self = self else { return }; defer { self.actionTask = nil }; do {
            try await self.service.focusMessage(id, in: self.conversation); try Task.checkCancellation(); self.render()
            guard self.navigationController?.topViewController === self else { return }
            DispatchQueue.main.async { [weak self] in guard let self = self, self.navigationController?.topViewController === self, let index = self.dataSource.indexPath(for: id) else { return }; self.collection.scrollToItem(at: index, at: .centeredVertically, animated: true) }
        } catch { if !Task.isCancelled, self.navigationController?.topViewController === self { self.showNativeNotice(error.localizedDescription) } } }
    }
    private func openSender(_ message: ChatTextItem) { let id = GroupVisibility.businessUserID(message.senderID); guard !multiSelecting, !id.isEmpty else { return }; if id == service.business.userID { navigationController?.pushViewController(NativeProfileController(context: service.business, service: service), animated: true) } else { navigationController?.pushViewController(NativeContactController(service: service, userID: id, isFriend: false), animated: true) } }
    private func mentionSender(_ message: ChatTextItem) {
        guard actionTask == nil, conversation.type == 3, !multiSelecting else { return }; let user = GroupVisibility.businessUserID(message.senderID); guard !user.isEmpty else { return }
        actionTask = Task { [weak self] in guard let self = self else { return }; defer { self.actionTask = nil }; do {
            let groupID = try await self.service.businessPeerID(self.conversation); var cursor: String?; var seen = Set<String>(); var member: NativeGroupMember?
            repeat { try Task.checkCancellation(); var query = [URLQueryItem(name: "groupId", value: groupID), URLQueryItem(name: "limit", value: "40")]; if let cursor = cursor { query.append(URLQueryItem(name: "cursor", value: cursor)) }; let page: NativePage<NativeGroupMember> = try await self.service.business.request("group-members", query: query); member = page.items.first { $0.id == user }; if member != nil || !page.hasMore { break }; guard let next = page.nextCursor, seen.insert(next).inserted else { throw APIError.invalidResponse }; cursor = next } while true
            try Task.checkCancellation(); guard self.navigationController?.topViewController === self else { return }; guard let member = member else { self.showNativeNotice("该成员已不在群中。"); return }
            if !self.mentionDraft.contains(where: { $0.id == member.id }) { self.mentionDraft.append(member) }; self.input.insertText("@" + member.name + " "); self.inputChanged(); self.input.becomeFirstResponder()
        } catch { if !Task.isCancelled, self.navigationController?.topViewController === self { self.showNativeNotice(error.localizedDescription) } } }
    }
    private func recallMessages(_ messages: [ChatTextItem], canManageSender: Bool = false) {
        let targets = messages.filter { MessageMenuCapabilities(contentType: $0.contentType, status: $0.status).canRecall(isMine: $0.senderID == service.imUserID, canManageSender: canManageSender || canManageGroup) }
        guard actionTask == nil else { return }
        guard !targets.isEmpty else { showNativeNotice("没有可撤回的消息。"); return }
        let others = targets.contains { $0.senderID != service.imUserID }
        let alert = UIAlertController(title: "撤回消息", message: others ? "请输入撤回原因" : "确定撤回这 \(targets.count) 条消息？", preferredStyle: .alert)
        if others { alert.addTextField { $0.placeholder = "请输入撤回原因"; $0.text = "管理员撤回" } }
        alert.addAction(UIAlertAction(title: "取消", style: .cancel)); alert.addAction(UIAlertAction(title: "撤回", style: .destructive) { [weak self, weak alert] _ in guard let self = self else { return }; let reason = others ? (alert?.textFields?.first?.text ?? "").trimmingCharacters(in: .whitespacesAndNewlines) : ""; guard !others || !reason.isEmpty else { self.showNativeNotice("请输入撤回原因。"); return }; self.actionTask = Task { defer { self.actionTask = nil }; var failures: [String] = []; for item in targets { guard !Task.isCancelled, self.service.isActive else { break }; do { try await self.service.recall(item, in: self.conversation, reason: item.senderID == self.service.imUserID ? nil : reason) } catch { if Task.isCancelled { return }; failures.append(error.localizedDescription) } }; guard !Task.isCancelled, self.navigationController?.topViewController === self else { return }; self.multiSelecting = false; self.selectedIDs = []; self.render(); if !failures.isEmpty { self.showNativeNotice("已撤回 \(targets.count - failures.count) 条，\(failures.count) 条失败：\n" + failures.joined(separator: "\n")) } } }); present(alert, animated: true)
    }
    private func deleteSelected(_ messages: [ChatTextItem]) {
        guard actionTask == nil else { return }; let alert = UIAlertController(title: "删除消息", message: "确定删除选中的 \(messages.count) 条消息？", preferredStyle: .alert); alert.addAction(UIAlertAction(title: "取消", style: .cancel)); alert.addAction(UIAlertAction(title: "删除", style: .destructive) { [weak self] _ in guard let self = self else { return }; self.actionTask = Task { defer { self.actionTask = nil }; var failures: [String] = []; for item in messages { guard !Task.isCancelled, self.service.isActive else { break }; do { try await self.service.delete(item, in: self.conversation) } catch { if Task.isCancelled { return }; failures.append(error.localizedDescription) } }; guard !Task.isCancelled, self.navigationController?.topViewController === self else { return }; self.multiSelecting = false; self.selectedIDs = []; self.render(); if !failures.isEmpty { self.showNativeNotice("有 \(failures.count) 条消息删除失败：\n" + failures.joined(separator: "\n")) } } }); present(alert, animated: true)
    }
    private func openBusinessCard(_ card: BusinessMessageCard, messageID: String) {
        if card.kind == .joinRequest { navigationController?.pushViewController(NativeGroupRequestsController(service: service, groupID: card.groupID), animated: true); return }
        guard !processingCards.contains(messageID), actionTask == nil else { return }
        let alert = UIAlertController(title: "加入群聊", message: "确认加入“\(card.groupName)”？", preferredStyle: .alert); alert.addAction(UIAlertAction(title: "取消", style: .cancel)); alert.addAction(UIAlertAction(title: "申请加入", style: .default) { [weak self] _ in guard let self = self else { return }; self.processingCards.insert(messageID); self.actionTask = Task { defer { self.processingCards.remove(messageID); self.actionTask = nil }; do {
            struct Result: Decodable { let nextAction: String; let group: NativeGroup? }
            guard let token = card.token.addingPercentEncoding(withAllowedCharacters: CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~")) else { throw APIError.invalidResponse }
            let result: Result = try await self.service.business.request("group-invitations/\(token)/accept", method: "POST", body: [:]); try Task.checkCancellation(); guard self.navigationController?.topViewController === self else { return }
            if result.nextAction == "pending_approval" { self.showNativeNotice("已提交入群申请，等待管理员审核。"); return }
            guard ["joined", "already_member"].contains(result.nextAction) else { throw APIError.invalidResponse }
            let peer: NativeGroupPeer = try await self.service.business.request("im/groups/\(result.group?.id ?? card.groupID)"); let chat = try await self.service.openConversation(target: peer.imGroupId, type: 3); try Task.checkCancellation(); self.navigationController?.pushViewController(NativeConversationViewController(service: self.service, conversation: chat), animated: true)
        } catch { if !Task.isCancelled, self.navigationController?.topViewController === self { self.showNativeNotice(error.localizedDescription) } } } }); present(alert, animated: true)
    }

    @objc private func inputChanged() {
        if conversation.type == 3, (input.text ?? "").hasSuffix("@"), !multiSelecting { chooseMention() }
        send.isHidden = (input.text ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        view.setNeedsLayout()
    }
    @objc private func sendText() {
        let draft = input.text ?? ""
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, !submitting, service.canSend(to: conversation) else { return }
        let mentions = mentionDraft
        let all = mentionAll
        let quote = quoteDraft
        guard let submission = composerSubmission.begin() else { return }
        render()
        let persisted: () -> Void = { [weak self] in
            guard let self = self, self.composerSubmission.finish(submission) else { return }
            if self.input.text == draft {
                self.input.text = ""
                self.mentionDraft = []
                self.mentionAll = false
                if self.quoteDraft?.id == quote?.id { self.quoteDraft = nil }
                self.input.placeholder = "输入消息"
                self.inputChanged()
            }
            self.render(scrollToBottom: true)
        }
        Task { [weak self] in
            guard let self = self else { return }
            defer {
                self.composerSubmission.finish(submission)
                self.render()
            }
            do {
                if all || !mentions.isEmpty {
                    try await self.service.sendAt(text, users: mentions, all: all, quoted: quote,
                                                  to: self.conversation, onPersisted: persisted)
                } else if let quote = quote {
                    try await self.service.sendQuote(text, original: quote, to: self.conversation, onPersisted: persisted)
                } else {
                    try await self.service.send(text, to: self.conversation, onPersisted: persisted)
                }
                self.render(scrollToBottom: true)
            } catch {
                if self.service.isActive, self.view.window != nil { self.showNativeNotice(error.localizedDescription) }
            }
        }
    }
    @objc private func pullHistory() { Task { await loadOlder() } }
    @objc private func goBack() { if multiSelecting { multiSelecting = false; selectedIDs = []; render(); return }; navigationController?.popViewController(animated: true) }
    @objc private func showMenu() {
        if multiSelecting {
            let messages = service.visibleMessages(conversation.id).filter { selectedIDs.contains($0.id) }; guard !messages.isEmpty else { return }
            var actions = [NativeMenuItem(title: "转发", action: { [weak self] in guard let self = self else { return }; self.navigationController?.pushViewController(NativeForwardPickerController(service: self.service, messages: messages, sourceConversation: self.conversation), animated: true) }), NativeMenuItem(title: "删除", destructive: true, action: { [weak self] in self?.deleteSelected(messages) })]
            if messages.contains(where: { MessageMenuCapabilities(contentType: $0.contentType, status: $0.status).canRecall(isMine: $0.senderID == service.imUserID, canManageSender: canManageGroup) }) { actions.append(NativeMenuItem(title: "撤回", destructive: true, action: { [weak self] in self?.recallMessages(messages) })) }
            showAnchoredNativeMenu(anchor: more, items: actions); return
        }
        let current = service.conversations.first { $0.id == conversation.id } ?? conversation
        showAnchoredNativeMenu(anchor: more, items: [
            NativeMenuItem(title: "核对待发消息", action: { [weak self] in
                guard let self = self else { return }
                Task { await self.service.reconcile(conversationID: self.conversation.id) }
            }),
            NativeMenuItem(title: "加载更早消息", action: { [weak self] in Task { await self?.loadOlder() } })
            ,NativeMenuItem(title: "聊天资料", action: { [weak self] in self?.openDetails() })
            ,NativeMenuItem(title: "查找聊天记录", action: { [weak self] in guard let self = self else { return }; self.navigationController?.pushViewController(NativeSearchController(service: self.service, conversation: self.conversation), animated: true) })
            ,NativeMenuItem(title: current.pinned ? "取消置顶" : "置顶聊天", action: { [weak self] in guard let self = self else { return }; self.runAction { try await self.service.setPinned(!current.pinned, conversation: current) } })
            ,NativeMenuItem(title: current.muted ? "取消免打扰" : "消息免打扰", action: { [weak self] in guard let self = self else { return }; self.runAction { try await self.service.setMuted(!current.muted, conversation: current) } })
            ,NativeMenuItem(title: "清空聊天记录", destructive: true, action: { [weak self] in self?.confirmClear() })
        ])
    }
    private struct MessageMenuAuthority {
        let groupID: String
        let user: String
        let member: NativeGroupMember?
        let canManage: Bool
    }

    @objc private func messageActions(_ recognizer: UILongPressGestureRecognizer) {
        guard recognizer.state == .began, actionTask == nil, presentedViewController == nil,
              let index = collection.indexPathForItem(at: recognizer.location(in: collection)),
              let id = dataSource.itemIdentifier(for: index), let message = displayed[id] else { return }
        if let preview = attachmentPreviews.first(where: { $0.value.id == id }) {
            guard !pendingMediaIDs.contains(preview.key), let draft = pendingAttachments.first(where: { $0.id == preview.key }) else { showNativeNotice("媒体正在准备，请稍候。"); return }
            let retry = NativeMenuItem(title: "重新发送", action: { [weak self] in Task { await self?.sendPendingAttachment(draft) } })
            let remove = NativeMenuItem(title: "删除", destructive: true, action: { [weak self] in self?.pendingAttachments.removeAll { $0.id == draft.id }; self?.attachmentPreviews[draft.id] = nil; self?.render() })
            present(NativeMessageActionOverlay(grid: [retry, remove], wide: [], anchorInWindow: recognizer.location(in: view.window)), animated: true)
            return
        }
        if let cell = collection.cellForItem(at: index) as? NativeMessageCell, cell.avatarContains(recognizer.location(in: cell.contentView)), conversation.type == 3, message.senderID != service.imUserID { mentionSender(message); return }
        let anchor = recognizer.location(in: view.window)
        if conversation.type != 3 || message.senderID == service.imUserID {
            presentMessageActions(message, anchor: anchor, authority: nil)
            return
        }
        // 先读取真实角色，避免管理员操作管理员、群主或把请求失败误判成已离群。
        actionTask = Task { [weak self] in
            guard let self = self else { return }; defer { self.actionTask = nil }
            var authority: MessageMenuAuthority?
            do { authority = try await self.loadMessageMenuAuthority(message) }
            catch { if Task.isCancelled { return }; self.showNativeNotice("成员权限读取失败，暂不显示管理操作。") }
            guard !Task.isCancelled, self.service.isActive, self.navigationController?.topViewController === self,
                  self.presentedViewController == nil, let current = self.displayed[id] else { return }
            self.presentMessageActions(current, anchor: anchor, authority: authority)
        }
    }

    private func loadMessageMenuAuthority(_ message: ChatTextItem) async throws -> MessageMenuAuthority? {
        let groupID = try await service.businessPeerID(conversation), user = GroupVisibility.businessUserID(message.senderID)
        guard !user.isEmpty else { return nil }
        let group: NativeGroup = try await service.business.request("groups/detail", query: [URLQueryItem(name: "groupId", value: groupID)])
        let owner = group.ownerId == service.business.userID || group.isOwner
        let admin = ["admin", "60"].contains((group.myRole ?? group.role ?? "").lowercased())
        guard group.canManage, owner || admin, user != group.ownerId else { return nil }
        var cursor: String?, member: NativeGroupMember?, seen = Set<String>()
        repeat {
            try Task.checkCancellation()
            var query = [URLQueryItem(name: "groupId", value: groupID), URLQueryItem(name: "limit", value: "100")]
            if let cursor = cursor { query.append(URLQueryItem(name: "cursor", value: cursor)) }
            let page: NativePage<NativeGroupMember> = try await service.business.request("group-members", query: query)
            member = page.items.first { $0.id == user }
            if member != nil || !page.hasMore { break }
            guard let next = page.nextCursor, seen.insert(next).inserted else { throw APIError.invalidResponse }; cursor = next
        } while true
        let targetOwner = member.map { ["owner", "100"].contains($0.role) } ?? false
        let targetAdmin = member.map { ["admin", "60"].contains($0.role) } ?? false
        let manageable = !targetOwner && (owner || !targetAdmin)
        return MessageMenuAuthority(groupID: groupID, user: user, member: member, canManage: manageable)
    }

    private func presentMessageActions(_ message: ChatTextItem, anchor: CGPoint, authority: MessageMenuAuthority?) {
        let entry = service.outboxEntries.first { $0.clientMsgID == message.id }
        let capabilities = MessageMenuCapabilities(contentType: message.contentType, status: message.status)
        var grid: [NativeMenuItem] = [], wide: [NativeMenuItem] = []
        if let entry = entry, entry.state == .failed {
            grid.append(NativeMenuItem(title: "重新发送", action: { [weak self] in guard let self = self else { return }; Task { do { try await self.service.retry(entry) } catch { self.showNativeNotice(error.localizedDescription) } } }))
        }
        if capabilities.canRecall(isMine: message.senderID == service.imUserID, canManageSender: authority?.canManage == true) {
            grid.append(NativeMenuItem(title: "撤回", action: { [weak self] in self?.recallMessages([message], canManageSender: authority?.canManage == true) }))
        }
        if capabilities.forward { grid.append(NativeMenuItem(title: "转发", action: { [weak self] in guard let self = self else { return }; self.navigationController?.pushViewController(NativeForwardPickerController(service: self.service, message: message, sourceConversation: self.conversation), animated: true) })) }
        if capabilities.quote { grid.append(NativeMenuItem(title: "引用", action: { [weak self] in self?.quoteDraft = message; self?.input.placeholder = "回复：" + message.text; self?.input.becomeFirstResponder() })) }
        if capabilities.copyText {
            grid.append(NativeMenuItem(title: "复制", action: { [weak self] in UIPasteboard.general.string = message.text; self?.showNativeNotice("已复制。") }))
            grid.append(NativeMenuItem(title: "选择文字", action: { [weak self] in self?.navigationController?.pushViewController(NativeTextSelectionController(text: message.text), animated: true) }))
        }
        if capabilities.saveImage || capabilities.saveVideo { grid.append(NativeMenuItem(title: capabilities.saveImage ? "保存图片" : "保存视频", action: { [weak self] in self?.saveMessageMedia(message) })) }
        if capabilities.addSticker { grid.append(NativeMenuItem(title: "加入表情包", action: { [weak self] in self?.addMessageSticker(message) })) }
        if capabilities.favorite {
            grid.append(NativeMenuItem(title: "收藏", action: { [weak self] in self?.favorite(message) }))
            if capabilities.pin { grid.append(NativeMenuItem(title: service.pinnedMessage(in: conversation)?.id == message.id ? "取消置顶" : "置顶", action: { [weak self] in self?.choosePin(message) })) }
            if conversation.type == 3, message.senderID != service.imUserID {
                grid.append(NativeMenuItem(title: "检举", action: { [weak self] in guard let self = self else { return }; let id = GroupVisibility.businessUserID(message.senderID); guard !id.isEmpty else { return }; self.navigationController?.pushViewController(NativeReportController(context: self.service.business, targetID: id, group: false), animated: true) }))
                grid.append(NativeMenuItem(title: "@TA", action: { [weak self] in self?.mentionSender(message) }))
            }
            if let authority = authority, authority.canManage {
                if let member = authority.member {
                    grid.append(NativeMenuItem(title: member.isMuted == true ? "解除禁言" : "禁言", action: { [weak self] in self?.chooseSenderMute(groupID: authority.groupID, user: authority.user, muted: member.isMuted == true) }))
                    for deleteMessages in [true, false] { wide.append(NativeMenuItem(title: deleteMessages ? "移除并删除其消息" : "仅移除该成员", action: { [weak self] in self?.confirmSenderChange(groupID: authority.groupID, user: authority.user, remove: true, deleteMessages: deleteMessages) })) }
                } else { wide.append(NativeMenuItem(title: "删除其全部消息", action: { [weak self] in self?.confirmSenderChange(groupID: authority.groupID, user: authority.user, remove: false, deleteMessages: true) })) }
            }
        }
        // 未确认消息保留核对入口；不会因 UI 对齐而绕过发送结果安全门。
        if let entry = entry, entry.state != .failed { grid.append(NativeMenuItem(title: "核对发送结果", action: { [weak self] in guard let self = self else { return }; Task { await self.service.reconcile(conversationID: self.conversation.id) } })) }
        grid.append(NativeMenuItem(title: "删除", action: { [weak self] in self?.deleteSelected([message]) }))
        if capabilities.multiSelect { grid.append(NativeMenuItem(title: "多选", action: { [weak self] in self?.multiSelecting = true; self?.selectedIDs = [message.id]; self?.render() })) }
        present(NativeMessageActionOverlay(grid: grid, wide: wide, anchorInWindow: anchor), animated: true)
    }

    private func saveMessageMedia(_ message: ChatTextItem) {
        guard actionTask == nil, let media = message.media else { return }
        let local = service.ownedMediaURL(for: message)
        actionTask = Task { [weak self] in
            guard let self = self else { return }; defer { self.actionTask = nil }
            do { try await NativeMediaExport.save(media: media, policy: self.service.business.media, ownedLocal: local); try Task.checkCancellation(); if self.service.isActive { self.showNativeNotice("已保存到相册。") } }
            catch { if !Task.isCancelled, self.service.isActive { self.showNativeNotice(error.localizedDescription) } }
        }
    }
    private func addMessageSticker(_ message: ChatTextItem) {
        runAction { [self] in
            try await NativeStickerAddition.add(message, service: service) { actionProgress.update($0) }
            emojiPanel.reloadStickers(); showNativeNotice("已加入表情包。")
        }
    }

    private func runAction(_ work: @escaping () async throws -> Void) {
        guard actionTask == nil else { return }
        actionTask = Task { [weak self] in
            guard let self = self else { return }
            defer { self.actionTask = nil }
            do { try Task.checkCancellation(); try await work() }
            catch { if !Task.isCancelled, self.service.isActive, self.view.window != nil { self.showNativeNotice(error.localizedDescription) } }
        }
    }

    private func chooseSenderMute(groupID: String, user: String, muted: Bool) {
        func apply(_ seconds: Int?) {
            guard actionTask == nil else { return }
            actionTask = Task { [weak self] in guard let self = self else { return }; defer { self.actionTask = nil }; do {
                var body: [String: JSONValue] = ["groupId": .string(groupID), "memberUserId": .string(user)]; if let seconds = seconds { body["mutedSeconds"] = .number(Double(seconds)) }
                try await self.service.business.change(seconds == nil ? "group-members/unmute" : "group-members/mute", body: body); self.showNativeNotice(seconds == nil ? "已解除禁言。" : "已禁言。")
            } catch { if !Task.isCancelled { self.showNativeNotice(error.localizedDescription) } } }
        }
        if muted { apply(nil); return }
        let sheet = UIAlertController(title: "禁言时长", message: nil, preferredStyle: .actionSheet)
        for (title, seconds) in [("10 分钟", 600), ("1 小时", 3600), ("12 小时", 43200), ("1 天", 86400), ("7 天", 604800), ("30 天", 2592000)] { sheet.addAction(UIAlertAction(title: title, style: .default) { _ in apply(seconds) }) }
        sheet.addAction(UIAlertAction(title: "取消", style: .cancel)); sheet.popoverPresentationController?.sourceView = collection; present(sheet, animated: true)
    }
    private func confirmSenderChange(groupID: String, user: String, remove: Bool, deleteMessages: Bool) {
        let title = remove ? (deleteMessages ? "移除并删除其消息" : "仅移除该成员") : "删除其全部消息"
        let alert = UIAlertController(title: title, message: deleteMessages ? "确认操作？消息将对所有群成员隐藏，此操作不可恢复。" : "确定从群聊中移除该成员？", preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "取消", style: .cancel)); alert.addAction(UIAlertAction(title: "确认", style: .destructive) { [weak self] _ in
            guard let self = self, self.actionTask == nil else { return }
            self.actionTask = Task { defer { self.actionTask = nil }; do {
                if remove { try await self.service.business.change("groups/\(groupID)/members/\(user)", method: "DELETE", body: ["deleteMessages": .bool(deleteMessages)]) }
                else { try await self.service.business.change("group-members/purge-messages", body: ["groupId": .string(groupID), "memberUserId": .string(user)]) }
                try Task.checkCancellation(); if deleteMessages { try await self.service.refreshGroupVisibility(self.conversation) }; self.render(); self.showNativeNotice("操作已完成。")
            } catch { if !Task.isCancelled { self.showNativeNotice(error.localizedDescription) } } }
        }); present(alert, animated: true)
    }

    func textFieldShouldReturn(_ textField: UITextField) -> Bool {
        let key = "native.\(service.business.configuration.baseURL.host ?? "").\(service.business.userID).enterToSend"
        if UserDefaults.standard.object(forKey: key) == nil || UserDefaults.standard.bool(forKey: key) { sendText(); return false }; textField.resignFirstResponder(); return true
    }
    func textFieldDidBeginEditing(_ textField: UITextField) { attachmentsVisible = false; emojiVisible = false; emojiPanel.setVisible(false); view.setNeedsLayout() }
    @objc private func showEmoji() {
        guard service.canSend(to: conversation) else { return }; emojiVisible.toggle(); attachmentsVisible = false; input.resignFirstResponder(); emojiPanel.setVisible(emojiVisible); view.setNeedsLayout()
    }
    private func openStickerUpload() { navigationController?.pushViewController(NativeEmotionsController(context: service.business, beginUpload: true, onSelected: { [weak self] sticker in self?.sendSticker(sticker) }), animated: true) }
    private func deleteSticker(_ sticker: NativeSticker) { let alert = UIAlertController(title: "删除表情", message: "确定删除这个表情吗？", preferredStyle: .alert); alert.addAction(UIAlertAction(title: "取消", style: .cancel)); alert.addAction(UIAlertAction(title: "删除", style: .destructive) { [weak self] _ in guard let self = self else { return }; Task { do { try await self.service.business.change("stickers/delete", body: ["stickerIds": .array([.string(sticker.id)])]); self.emojiPanel.reloadStickers() } catch { self.showNativeNotice(error.localizedDescription) } } }); present(alert, animated: true) }
    @objc private func showAttachments() {
        guard service.canSend(to: conversation) else { return }; attachmentsVisible.toggle(); emojiVisible = false; emojiPanel.setVisible(false); input.resignFirstResponder(); view.setNeedsLayout()
    }
    private func configureAttachments() {
        var items: [(String, String, () -> Void)] = [("相机", "uni_icon_camera", { [weak self] in self?.pickCamera() }), ("照片", "uni_icon_photo", { [weak self] in self?.pickMedia(videos: false) }), ("视频", "uni_attachment_video", { [weak self] in self?.pickMedia(videos: true) })]
        if conversation.type != 3 { items.append(("名片", "uni_icon_card", { [weak self] in self?.pickCard() })) }; items += [("文件", "uni_icon_file", { [weak self] in self?.pickFile() }), ("收藏", "uni_icon_favorite", { [weak self] in self?.pickFavorite() })]
        for (title, icon, action) in items { let button = NativeComposerActionButton(title: title, icon: icon); button.addAction(UIAction { [weak self] _ in self?.attachmentsVisible = false; self?.view.setNeedsLayout(); action() }, for: .touchUpInside); attachmentPanel.addSubview(button); attachmentButtons.append(button) }
    }
    private func chooseMention() {
        guard navigationController?.topViewController === self else { return }
        Task { do {
            let id = try await service.businessPeerID(conversation); let group: NativeGroup = try await service.business.request("groups/detail", query: [URLQueryItem(name: "groupId", value: id)])
            guard navigationController?.topViewController === self else { return }
            navigationController?.pushViewController(NativeMentionPicker(context: service.business, group: group) { [weak self] users, all in
                guard let self = self else { return }; if (self.input.text ?? "").hasSuffix("@") { self.input.text = String((self.input.text ?? "").dropLast()) }
                self.mentionAll = self.mentionAll || all; for user in users where !self.mentionDraft.contains(where: { $0.id == user.id }) { self.mentionDraft.append(user) }; self.input.insertText(all ? "@所有人 " : users.map { "@" + $0.name + " " }.joined()); self.inputChanged(); self.input.becomeFirstResponder()
            }, animated: true)
        } catch { showNativeNotice(error.localizedDescription) } }
    }
    @objc private func openPinned() { guard showingPin, let pin = service.pinnedMessage(in: conversation) else { return }; Task { do { try await service.focusMessage(pin.id, in: conversation); if let index = dataSource.indexPath(for: pin.id) { collection.scrollToItem(at: index, at: .centeredVertically, animated: true) } } catch { showNativeNotice(error.localizedDescription) } } }
    private func choosePin(_ message: ChatTextItem) {
        if let old = service.pinnedMessage(in: conversation), old.id == message.id { Task { do { try await service.pinMessage(message, in: conversation, shared: old.shared, remove: true); showNativeNotice("已取消置顶。") } catch { showNativeNotice(error.localizedDescription) } }; return }
        Task { do {
            var canShare = true
            if conversation.type == 3 { let id = try await service.businessPeerID(conversation); let group: NativeGroup = try await service.business.request("groups/detail", query: [URLQueryItem(name: "groupId", value: id)]); canShare = group.canManage }
            guard navigationController?.topViewController === self else { return }
            let sheet = UIAlertController(title: "置顶消息", message: nil, preferredStyle: .actionSheet)
            for (title, shared) in (canShare ? [(conversation.type == 3 ? "为全员置顶" : "为我和对方置顶", true), ("仅为我置顶", false)] : [("仅为我置顶", false)]) { sheet.addAction(UIAlertAction(title: title, style: .default) { [weak self] _ in guard let self = self else { return }; Task { do { try await self.service.pinMessage(message, in: self.conversation, shared: shared); self.showNativeNotice("已置顶。") } catch { self.showNativeNotice(error.localizedDescription) } } }) }
            sheet.addAction(UIAlertAction(title: "取消", style: .cancel)); sheet.popoverPresentationController?.sourceView = more; present(sheet, animated: true)
        } catch { showNativeNotice(error.localizedDescription) } }
    }
    private func pickCard() {
        navigationController?.pushViewController(NativeContactPickerController(service: service, title: "选择名片", selectionLimit: 1) { [weak self] contacts in
            guard let self = self, let contact = contacts.first else { return }; Task { do { try await self.service.sendCard(contact, to: self.conversation) } catch { self.showNativeNotice(error.localizedDescription) } }
        }, animated: true)
    }
    private func pickFavorite() {
        navigationController?.pushViewController(NativeFavoritesController(context: service.business, onSelected: { [weak self] item in
            guard let self = self else { return }; Task { do { try await self.service.sendFavorite(type: item.type, content: item.content, to: self.conversation) } catch { self.showNativeNotice(error.localizedDescription) } }
        }), animated: true)
    }
    private func sendSticker(_ sticker: NativeSticker) {
        Task { do {
            guard let url = service.business.media.absolute(service.business.media.original(sticker.url)), url.scheme == "https" else { throw APIError.invalidResponse }
            let temporary = try await NativeBoundedDownload(limit: 20 * 1024 * 1024).download(url); defer { try? FileManager.default.removeItem(at: temporary) }
            guard let image = CGImageSourceCreateWithURL(temporary as CFURL, nil), let imageType = CGImageSourceGetType(image) as String?, let type = UTType(imageType), type.conforms(to: .image) else { throw APIError.invalidResponse }
            let file = try service.createMediaFile(data: Data(contentsOf: temporary, options: .mappedIfSafe), extension: type.preferredFilenameExtension ?? "png")
            try await service.sendMedia(kind: 102, file: file, filename: "表情." + (type.preferredFilenameExtension ?? "png"), to: conversation)
        } catch { showNativeNotice(error.localizedDescription) } }
    }
    private func pickMedia(videos: Bool) { var config = PHPickerConfiguration(); config.filter = videos ? .videos : .images; config.selectionLimit = videos ? 1 : 9; let picker = PHPickerViewController(configuration: config); picker.delegate = self; present(picker, animated: true) }
    private func pickCamera() {
        guard UIImagePickerController.isSourceTypeAvailable(.camera) else { showNativeNotice("此设备没有可用相机。"); return }
        let open: () -> Void = { [weak self] in guard let self = self, self.navigationController?.topViewController === self else { return }; let camera = UIImagePickerController(); camera.sourceType = .camera; camera.mediaTypes = (UIImagePickerController.availableMediaTypes(for: .camera) ?? [UTType.image.identifier]).filter { [UTType.image.identifier, UTType.movie.identifier].contains($0) }; camera.videoMaximumDuration = 60; camera.videoQuality = .typeMedium; camera.delegate = self; self.present(camera, animated: true) }
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized: open()
        case .notDetermined: AVCaptureDevice.requestAccess(for: .video) { [weak self] allowed in Task { @MainActor in if allowed { open() } else { self?.showNativeNotice("请在系统设置中允许使用相机。") } } }
        default: showNativeNotice("请在系统设置中允许使用相机。")
        }
    }
    func imagePickerControllerDidCancel(_ picker: UIImagePickerController) { picker.dismiss(animated: true) }
    func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
        picker.dismiss(animated: true)
        guard navigationController?.topViewController === self else { return }
        if let video = info[.mediaURL] as? URL { Task { await sendAttachment(video, kind: 104) }; return }
        if let photo = info[.imageURL] as? URL { Task { await sendAttachment(photo, kind: 102) }; return }
        guard let image = info[.originalImage] as? UIImage else { return }
        Task { do { guard let data = await Task.detached(priority: .userInitiated, operation: { image.jpegData(compressionQuality: 0.88) }).value else { throw APIError.invalidResponse }; guard navigationController?.topViewController === self else { return }; let file = try service.createMediaFile(data: data, extension: "jpg"); await sendAttachment(file, kind: 102) } catch { if navigationController?.topViewController === self { showNativeNotice(error.localizedDescription) } } }
    }
    private func pickFile() { let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.item], asCopy: true); picker.delegate = self; present(picker, animated: true) }
    func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
        picker.dismiss(animated: true)
        for result in results {
            let provider = result.itemProvider, isVideo = provider.hasItemConformingToTypeIdentifier(UTType.movie.identifier)
            let previewID = UUID(), kind = isVideo ? 104 : 102
            updateAttachmentPreview(id: previewID, kind: kind, filename: provider.suggestedName ?? (isVideo ? "视频.mov" : "图片.jpg")); render(scrollToBottom: true)
            provider.loadFileRepresentation(forTypeIdentifier: isVideo ? UTType.movie.identifier : UTType.image.identifier) { [weak self] url, error in
                guard let url = url else { Task { @MainActor in self?.attachmentPreviews[previewID] = nil; self?.render(); self?.showNativeNotice(error?.localizedDescription ?? "无法读取所选媒体。") }; return }
                // Picker临时URL仅在回调期间可用，先复制到本机临时目录再交账号媒体目录接管。
                let temporary = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString).appendingPathExtension(url.pathExtension)
                do { try FileManager.default.copyItem(at: url, to: temporary) } catch { Task { @MainActor in self?.attachmentPreviews[previewID] = nil; self?.render(); self?.showNativeNotice(error.localizedDescription) }; return }
                Task { @MainActor [weak self] in guard let self = self else { return }; defer { try? FileManager.default.removeItem(at: temporary) }; await self.sendAttachment(temporary, kind: kind, previewID: previewID) }
            }
        }
    }
    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) { for url in urls { Task { await sendAttachment(url, kind: 105) } } }
    private func sendAttachment(_ source: URL, kind: Int, previewID: UUID? = nil) async {
        guard service.isActive, navigationController?.topViewController === self || previewID.flatMap({ attachmentPreviews[$0] }) != nil else { return }
        let accessed = source.startAccessingSecurityScopedResource(); defer { if accessed { source.stopAccessingSecurityScopedResource() } }
        let draftID = previewID ?? UUID(), filename = source.lastPathComponent
        if [102, 104].contains(kind) { updateAttachmentPreview(id: draftID, kind: kind, filename: filename); render(scrollToBottom: true) }
        do {
            let file = try await service.importMediaFileInBackground(source)
            let draft = PendingAttachment(id: draftID, file: file, kind: kind, filename: filename)
            pendingAttachments.append(draft)
            updateAttachmentPreview(id: draftID, kind: kind, filename: filename, file: file)
            render(scrollToBottom: true); await sendPendingAttachment(draft)
        } catch {
            attachmentPreviews[draftID] = nil; render()
            if service.isActive, navigationController?.topViewController === self { showNativeNotice(error.localizedDescription) }
        }
    }
    /// 只展示本机准备过程；这里的 draft ID 永远不会提交 SDK、收藏或转发接口。
    private func updateAttachmentPreview(id: UUID, kind: Int, filename: String, file: URL? = nil, snapshot: URL? = nil, duration: Int = 0, width: Int = 0, height: Int = 0, failed: Bool = false) {
        guard [102, 104].contains(kind) else { return }
        let timestamp = attachmentPreviews[id]?.timestamp ?? Int64(Date().timeIntervalSince1970 * 1000)
        let element: [String: Any] = kind == 104 ? ["videoPath": file?.path ?? "", "snapshotPath": snapshot?.path ?? "", "snapshotWidth": width, "snapshotHeight": height, "duration": duration] : ["sourcePath": file?.path ?? ""]
        let body: [String: Any] = ["contentType": kind, kind == 104 ? "videoElem" : "pictureElem": element]
        let serialized = (try? JSONSerialization.data(withJSONObject: body)).map { String(decoding: $0, as: UTF8.self) } ?? ""
        attachmentPreviews[id] = ChatTextItem(id: "local-preparation-" + id.uuidString, senderID: service.imUserID, text: kind == 104 ? "[视频]" : "[图片]", timestamp: timestamp, status: failed ? 3 : 1, contentType: kind, serialized: serialized, media: ChatMedia(kind: kind, localPath: file?.path ?? "", filename: filename, duration: duration))
    }
    @objc private func showPendingAttachments() {
        let menu = UIAlertController(title: "待发送附件", message: "未发送的附件可继续发送或移除。", preferredStyle: .actionSheet)
        for draft in pendingAttachments {
            if pendingMediaIDs.contains(draft.id) { continue }
            menu.addAction(UIAlertAction(title: "继续发送：" + draft.filename, style: .default) { [weak self] _ in Task { await self?.sendPendingAttachment(draft) } })
            menu.addAction(UIAlertAction(title: "移除：" + draft.filename, style: .destructive) { [weak self] _ in self?.pendingAttachments.removeAll { $0.id == draft.id }; self?.attachmentPreviews[draft.id] = nil; self?.render() })
        }; menu.addAction(UIAlertAction(title: "取消", style: .cancel)); menu.popoverPresentationController?.sourceView = pendingMediaButton; present(menu, animated: true)
    }
    private func sendPendingAttachment(_ draft: PendingAttachment) async {
        guard service.isActive, pendingAttachments.contains(where: { $0.id == draft.id }), pendingMediaIDs.insert(draft.id).inserted else { return }
        defer { pendingMediaIDs.remove(draft.id); view.setNeedsLayout() }
        do {
            let file = draft.file; var snapshot: URL?; var duration = 0
            updateAttachmentPreview(id: draft.id, kind: draft.kind, filename: draft.filename, file: file); render(scrollToBottom: true)
            if draft.kind == 104 {
                let asset = AVURLAsset(url: file); let time = try await asset.load(.duration); duration = try VideoMessageMetadata.preparedDuration(seconds: CMTimeGetSeconds(time))
                let poster = try await Task.detached(priority: .userInitiated) { () -> (data: Data, width: Int, height: Int) in
                    let generator = AVAssetImageGenerator(asset: AVURLAsset(url: file)); generator.appliesPreferredTrackTransform = true; generator.maximumSize = CGSize(width: 720, height: 720)
                    let bitmap = try generator.copyCGImage(at: .zero, actualTime: nil)
                    guard let data = UIImage(cgImage: bitmap).jpegData(compressionQuality: 0.8) else { throw APIError.invalidResponse }
                    return (data, bitmap.width, bitmap.height)
                }.value
                try Task.checkCancellation(); guard service.isActive else { throw APIError.cancelled }
                snapshot = try service.createMediaFile(data: poster.data, extension: "jpg")
                updateAttachmentPreview(id: draft.id, kind: draft.kind, filename: draft.filename, file: file, snapshot: snapshot, duration: duration, width: poster.width, height: poster.height); render(scrollToBottom: true)
            }
            try Task.checkCancellation(); guard service.isActive else { throw APIError.cancelled }
            try await service.sendMedia(kind: draft.kind, file: file, filename: draft.filename, duration: duration, snapshot: snapshot, to: conversation) { [weak self] in self?.pendingAttachments.removeAll { $0.id == draft.id }; self?.attachmentPreviews[draft.id] = nil; self?.view.setNeedsLayout(); self?.render(scrollToBottom: true) }; render(scrollToBottom: true)
        } catch {
            if pendingAttachments.contains(where: { $0.id == draft.id }) { updateAttachmentPreview(id: draft.id, kind: draft.kind, filename: draft.filename, file: draft.file, failed: true); render() }
            if service.isActive, navigationController?.topViewController === self { showNativeNotice(error.localizedDescription) }
        }
    }
    @objc private func toggleRecording() {
        guard audioTask == nil else { return }
        if let recorder = recorder, let url = recordingURL {
            let duration = max(1, Int(ceil(recorder.currentTime))); recorder.stop(); self.recorder = nil; recordingURL = nil; mic.tintColor = nil
            audioSession.deactivate()
            voiceTimer?.cancel(); voiceTimer = nil; voiceDraft = (url, duration); voiceLabel.text = "语音草稿 \(duration) 秒"; view.setNeedsLayout(); return
        }
        let request = UUID(); recordPermissionID = request
        AVAudioSession.sharedInstance().requestRecordPermission { [weak self] granted in Task { @MainActor in
            guard let self = self, self.recordPermissionID == request, self.navigationController?.topViewController === self else { return }
            guard granted else { self.showNativeNotice("请在系统设置中允许使用麦克风。"); return }
            self.beginRecording()
        } }
    }
    private func beginRecording() {
        guard audioTask == nil, service.canSend, view.window != nil else { return }
        voicePlayer?.stop(); voicePlayer = nil
        audioTask = Task { [weak self] in
            guard let self = self else { return }; defer { self.audioTask = nil }
            do {
                try await self.audioSession.activate(.recording)
                try Task.checkCancellation()
                guard self.service.canSend, self.navigationController?.topViewController === self else { throw CancellationError() }
                let url = try self.service.createMediaFile(data: Data(), extension: "m4a")
                let recorder = try AVAudioRecorder(url: url, settings: [AVFormatIDKey: kAudioFormatMPEG4AAC, AVSampleRateKey: 16000, AVNumberOfChannelsKey: 1, AVEncoderAudioQualityKey: AVAudioQuality.medium.rawValue])
                guard recorder.record(forDuration: 60) else { throw APIError.invalidResponse }
                self.recorder = recorder; self.recordingURL = url; self.voiceDraft = nil; self.attachmentsVisible = false; self.voiceLabel.text = "录音中 0 秒"; self.view.setNeedsLayout()
                self.voiceTimer?.cancel(); self.voiceTimer = Task { [weak self] in for seconds in 1...60 { do { try await Task.sleep(nanoseconds: 1_000_000_000) } catch { return }; guard let self = self, self.recorder != nil else { return }; self.voiceLabel.text = "录音中 \(seconds) 秒"; if seconds == 60 { self.toggleRecording() } } }
            } catch {
                self.audioSession.deactivate()
                if !(error is CancellationError), !Task.isCancelled, self.navigationController?.topViewController === self { self.showNativeNotice(error.localizedDescription) }
            }
        }
    }
    private func stopVoiceAudio() {
        recordPermissionID = UUID(); audioTask?.cancel()
        recorder?.stop(); recorder = nil; recordingURL = nil; voiceTimer?.cancel(); voiceTimer = nil
        voicePlayer?.delegate = nil; voicePlayer?.stop(); voicePlayer = nil; audioSession.deactivate()
    }
    @objc private func cancelVoice() { stopVoiceAudio(); voiceDraft = nil; inputChanged(); view.setNeedsLayout() }
    @objc private func previewVoice() {
        guard let draft = voiceDraft, audioTask == nil else { return }
        voicePlayer?.stop(); voicePlayer = nil
        audioTask = Task { [weak self] in
            guard let self = self else { return }; defer { self.audioTask = nil }
            do {
                try await self.audioSession.activate(.playback)
                try Task.checkCancellation()
                guard self.voiceDraft?.url == draft.url, self.navigationController?.topViewController === self else { throw CancellationError() }
                let player = try AVAudioPlayer(contentsOf: draft.url); player.delegate = self
                guard player.play() else { throw APIError.invalidResponse }; self.voicePlayer = player
            } catch {
                self.audioSession.deactivate()
                if !(error is CancellationError), !Task.isCancelled, self.navigationController?.topViewController === self { self.showNativeNotice(error.localizedDescription) }
            }
        }
    }
    func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        guard voicePlayer === player else { return }; voicePlayer = nil; audioSession.deactivate()
    }
    func audioPlayerDecodeErrorDidOccur(_ player: AVAudioPlayer, error: Error?) {
        guard voicePlayer === player else { return }; voicePlayer = nil; audioSession.deactivate()
        if navigationController?.topViewController === self { showNativeNotice("语音暂时无法播放，请重新打开后再试。") }
    }
    @objc private func voiceActionTapped() {
        if recorder != nil { toggleRecording(); return }
        guard let draft = voiceDraft, let submission = composerSubmission.begin() else { return }; voiceAction.isEnabled = false; voiceCancel.isEnabled = false; voicePlay.isEnabled = false
        stopVoiceAudio()
        Task { defer { composerSubmission.finish(submission); voiceAction.isEnabled = true; voiceCancel.isEnabled = true; voicePlay.isEnabled = true }; do { try await service.sendMedia(kind: 103, file: draft.url, filename: "语音.m4a", duration: draft.duration, to: conversation) { [weak self] in self?.voiceDraft = nil; self?.inputChanged(); self?.view.setNeedsLayout() } } catch { showNativeNotice(error.localizedDescription) } }
    }
    func collectionView(_ collectionView: UICollectionView, didSelectItemAt indexPath: IndexPath) {
        guard let id = dataSource.itemIdentifier(for: indexPath), let item = displayed[id], item.status != 4 else { return }
        if multiSelecting {
            guard !attachmentPreviews.values.contains(where: { $0.id == id }) else { showNativeNotice("媒体准备完成后才可选择。"); return }
            if selectedIDs.contains(id) { selectedIDs.remove(id) } else { selectedIDs.insert(id) }; render(); return
        }
        if attachmentPreviews.values.contains(where: { $0.id == id }), service.ownedMediaURL(for: item) == nil { showNativeNotice("媒体正在准备，请稍候。"); return }
        if let card = BusinessMessageCard(serialized: item.serialized) { openBusinessCard(card, messageID: item.id); return }
        if item.contentType == 107 { navigationController?.pushViewController(NativeMergedMessagesController(service: service, source: item), animated: true); return }
        if item.contentType == 108, let data = item.serialized.data(using: .utf8), let root = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any], let card = root["cardElem"] as? [String: Any] ?? root["CardElem"] as? [String: Any], let user = (card["userID"] ?? card["UserID"]) as? String {
            navigationController?.pushViewController(NativeContactController(service: service, userID: GroupVisibility.businessUserID(user), isFriend: false), animated: true); return
        }
        guard let media = item.media else { return }
        if media.kind == 102 {
            if let local = service.ownedImageURL(for: item) { navigationController?.pushViewController(NativeImagePreviewController(ownedLocal: local, policy: service.business.media, remote: media.url), animated: true) }
            else { navigationController?.pushViewController(NativeImagePreviewController(url: media.url, policy: service.business.media, allImages: service.visibleMessages(conversation.id).compactMap { $0.media?.kind == 102 && $0.status != 4 ? $0.media?.url : nil }.filter { !$0.isEmpty }), animated: true) }; return
        }
        let local = service.ownedMediaURL(for: item)
        let remote = service.business.media.absolute(media.kind == 104 ? service.business.media.playback(media.url) : service.business.media.original(media.url))
        let url = local ?? (remote?.scheme?.lowercased() == "https" ? remote : nil)
        guard let url = url else { showNativeNotice("媒体地址尚未就绪，请核对发送状态后重试。"); return }
        if [103, 104].contains(media.kind) { navigationController?.pushViewController(NativeVideoPreviewController(url: url, allowSave: media.kind == 104), animated: true) }
        else { navigationController?.pushViewController(NativeFilePreviewController(url: url, filename: media.filename), animated: true) }
    }
    private func favorite(_ item: ChatTextItem) {
        let alert = UIAlertController(title: "加入收藏", message: "确定加入收藏吗？", preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "取消", style: .cancel))
        alert.addAction(UIAlertAction(title: "收藏", style: .default) { [weak self] _ in
            guard let self = self else { return }
            self.runAction {
                let type = [102: "image", 103: "voice", 104: "video", 105: "file"][item.contentType] ?? "text"
                let content = try FavoriteContent.snapshot(type: type, media: item.media, text: item.text)
                try await self.service.business.change("favorites", body: ["messageId": .string(item.id), "type": .string(type), "content": .string(content), "senderId": .string(GroupVisibility.businessUserID(item.senderID)), "conversationId": .string(self.conversation.id)])
                self.showNativeNotice("已收藏。")
            }
        })
        present(alert, animated: true)
    }
    @objc private func openDetails() {
        guard !multiSelecting, detailsTask == nil, actionTask == nil else { return }
        detailsProgress.show(in: self, text: "正在读取聊天详情…")
        detailsTask = Task { [weak self] in
            guard let self = self else { return }
            defer { self.detailsTask = nil; self.detailsProgress.hide() }
            do {
                let id = try await self.service.businessPeerID(self.conversation)
                try Task.checkCancellation()
                guard self.service.isActive, self.navigationController?.topViewController === self else { return }
                let page: UIViewController = self.conversation.type == 3
                    ? NativeGroupController(service: self.service, groupID: id)
                    : NativeContactController(service: self.service, userID: id, isFriend: true)
                self.navigationController?.pushViewController(page, animated: true)
            } catch {
                if !Task.isCancelled { self.showNativeNotice(error.localizedDescription) }
            }
        }
    }
    private func confirmClear() { let alert = UIAlertController(title: "清除聊天记录", message: "聊天记录将从你的所有设备中删除，不影响其他人。", preferredStyle: .alert); alert.addAction(UIAlertAction(title: "取消", style: .cancel)); alert.addAction(UIAlertAction(title: "清除", style: .destructive) { [weak self] _ in guard let self = self else { return }; Task { do { try await self.service.clearHistory(self.conversation); self.cursor = ""; self.isEnd = true; self.render() } catch { self.showNativeNotice(error.localizedDescription) } } }); present(alert, animated: true) }
}
