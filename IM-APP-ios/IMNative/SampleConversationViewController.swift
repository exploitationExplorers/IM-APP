import UIKit
import IMCore

final class NativeMessageCell: UICollectionViewCell {
    private let avatar = NativeRemoteImageView()
    private let mediaView = NativeRemoteImageView()
    private let mediaSpinner = UIActivityIndicatorView(style: .medium)
    private let videoPlay = UIImageView(image: UIImage(systemName: "play.fill"))
    private let videoDuration = UILabel()
    private var videoMetadata: VideoMessageMetadata?
    private var hasMedia = false
    private let bubble = UIView()
    private let label = UILabel()
    private let bubbleMask = CAShapeLayer()
    private var messageText = ""
    private var isMine = false
    private var statusText = ""
    private let dateLabel = UILabel(); private var dateText: String?
    private let quoteView = UIView(); private let quoteLabel = UILabel(); private let quoteImage = NativeRemoteImageView(); private var quoted: MessageQuoteReference?
    private let cardImage = NativeRemoteImageView(); private let cardAction = UILabel(); private var card: BusinessMessageCard?
    var onAvatarTap: (() -> Void)?; var onQuoteTap: (() -> Void)?
    func avatarContains(_ point: CGPoint) -> Bool { avatar.frame.contains(point) }


    override init(frame: CGRect) {
        super.init(frame: frame)
        avatar.contentMode = .scaleAspectFill
        avatar.clipsToBounds = true
        label.numberOfLines = 0
        [avatar, bubble].forEach { contentView.addSubview($0) }
        bubble.addSubview(label)
        bubble.addSubview(mediaView); mediaView.contentMode = .scaleAspectFill; mediaView.clipsToBounds = true
        bubble.addSubview(videoPlay); videoPlay.tintColor = .white; videoPlay.contentMode = .scaleAspectFit; videoPlay.layer.shadowColor = UIColor.black.cgColor; videoPlay.layer.shadowOpacity = 0.35; videoPlay.layer.shadowRadius = 2
        bubble.addSubview(videoDuration); videoDuration.textAlignment = .center; videoDuration.textColor = .white; videoDuration.backgroundColor = UIColor.black.withAlphaComponent(0.45); videoDuration.layer.cornerRadius = 3; videoDuration.clipsToBounds = true
        mediaView.onImageLoaded = { [weak self] in
            guard let self = self, self.videoMetadata?.hasDimensions == false else { return }
            DispatchQueue.main.async { [weak self] in
                guard let self = self, self.videoMetadata?.hasDimensions == false else { return }; self.setNeedsLayout()
                var parent = self.superview
                while let view = parent { if let collection = view as? UICollectionView { collection.collectionViewLayout.invalidateLayout(); break }; parent = view.superview }
            }
        }
        bubble.addSubview(mediaSpinner); mediaSpinner.color = .white; mediaSpinner.backgroundColor = UIColor.black.withAlphaComponent(0.35); mediaSpinner.layer.cornerRadius = 18; mediaSpinner.hidesWhenStopped = true
        bubble.layer.mask = bubbleMask
        contentView.addSubview(dateLabel); dateLabel.textAlignment = .center; dateLabel.textColor = NativeUITheme.secondary
        avatar.isUserInteractionEnabled = true; avatar.addGestureRecognizer(UITapGestureRecognizer(target: self, action: #selector(avatarTapped)))
        bubble.addSubview(quoteView); quoteView.addSubview(quoteImage); quoteView.addSubview(quoteLabel); quoteView.addGestureRecognizer(UITapGestureRecognizer(target: self, action: #selector(quoteTapped))); quoteView.backgroundColor = UIColor.black.withAlphaComponent(0.06); quoteLabel.numberOfLines = 2; quoteImage.contentMode = .scaleAspectFill; quoteImage.clipsToBounds = true
        bubble.addSubview(cardImage); bubble.addSubview(cardAction); cardImage.contentMode = .scaleAspectFill; cardImage.clipsToBounds = true; cardAction.textAlignment = .center

    }

    required init?(coder: NSCoder) { fatalError("不使用 Storyboard") }

    @objc private func avatarTapped() { onAvatarTap?() }
    @objc private func quoteTapped() { onQuoteTap?() }
    func configure(_ message: SampleMessage) {
        configure(text: message.text, isMine: message.isMine)
    }

    func configure(text: String, isMine: Bool, status: String = "", resetResources: Bool = true) {
        mediaSpinner.stopAnimating()
        videoMetadata = nil; videoPlay.isHidden = true; videoDuration.isHidden = true; videoDuration.text = nil
        hasMedia = false; mediaView.isHidden = true; card = nil; quoted = nil; dateText = nil; quoteView.isHidden = true; cardImage.isHidden = true; cardAction.isHidden = true; onAvatarTap = nil; onQuoteTap = nil
        if resetResources { mediaView.cancel(); cardImage.cancel(); quoteImage.cancel(); avatar.image = NativeUITheme.image(isMine ? "uni_avatar_me" : "uni_avatar_1") }
        messageText = text; self.isMine = isMine; statusText = status
        bubble.backgroundColor = isMine ? NativeUITheme.mineBubble : .white
        label.textColor = isMine ? .white : UIColor(hex: 0x222222)
        setNeedsLayout()
    }

    func configure(message: ChatTextItem, service: NativeIMService, date: String? = nil, preparing: Bool = false) {
        let mine = message.senderID == service.imUserID
        var text = message.text
        if let media = message.media { if media.kind == 103 { text = "▶  \(media.duration)″" }; if media.kind == 105 { text = "📄 " + media.filename } }
        // 同消息重配仅更新文本/状态，不取消仍在取图的任务或覆盖已经命中的头像。
        configure(text: text, isMine: mine, status: service.sendingLabel(message), resetResources: false)
        dateText = date; dateLabel.text = date
        avatar.load(message.avatar, policy: service.business.media, placeholder: "uni_avatar_default")
        if message.status != 4, let card = BusinessMessageCard(serialized: message.serialized) { self.card = card; messageText = card.title + "\n" + card.summary; bubble.backgroundColor = .white; cardImage.isHidden = false; cardAction.isHidden = false; cardAction.text = card.actionTitle; cardImage.load(card.avatar, policy: service.business.media, placeholder: "uni_group_default"); mediaView.cancel(); quoteImage.cancel(); setNeedsLayout(); return }
        cardImage.cancel()
        if message.status != 4, let quote = MessageQuoteReference(serialized: message.serialized) { quoted = quote; quoteView.isHidden = false; quoteLabel.text = (quote.sender.isEmpty ? "" : quote.sender + "：") + quote.summary; quoteImage.isHidden = quote.image.isEmpty; if !quote.image.isEmpty { quoteImage.load(quote.image, policy: service.business.media, variant: .list) } }

        if quoted == nil { quoteImage.cancel() }
        guard message.status != 4, let media = message.media, [102, 104].contains(media.kind) else { mediaView.cancel(); return }
        hasMedia = true; mediaView.isHidden = false
        if media.kind == 104 { let metadata = VideoMessageMetadata(serialized: message.serialized, duration: media.duration); videoMetadata = metadata; videoPlay.isHidden = false; videoDuration.isHidden = false; videoDuration.text = metadata.durationLabel; mediaView.contentMode = .scaleAspectFit; mediaView.backgroundColor = UIColor(hex: 0x151515) }
        else { mediaView.contentMode = .scaleAspectFill; mediaView.backgroundColor = .clear }
        if preparing || service.mediaIsSending(message) { statusText = ""; mediaSpinner.startAnimating() }
        let raw = media.thumbnail.isEmpty ? (videoMetadata?.thumbnail ?? media.url) : media.thumbnail
        let local = videoMetadata.flatMap { mine ? service.ownedMediaURL($0.localThumbnail) : nil } ?? service.ownedImageURL(for: message)
        if let url = local { mediaView.loadOwnedLocal(url, remote: [raw] + (media.kind == 102 ? [media.url] : []), policy: service.business.media) }
        else { mediaView.load(raw, policy: service.business.media, variant: .list, placeholder: "", fallbacks: media.kind == 102 ? [media.url] : []) }
        messageText = ""
        setNeedsLayout()
    }

    private func dimensions(width: CGFloat) -> (CGFloat, CGFloat, CGFloat, NSAttributedString) {
        let r: (CGFloat) -> CGFloat = { NativeUITheme.rpx($0, width: width) }
        let font = UIFont.systemFont(ofSize: r(30))
        let dateHeight: CGFloat = dateText == nil ? 0 : r(68)

        let paragraph = NSMutableParagraphStyle()
        paragraph.minimumLineHeight = r(45)
        paragraph.maximumLineHeight = r(45)
        paragraph.lineBreakMode = .byCharWrapping
        let text = NSMutableAttributedString(string: messageText, attributes: [.font: font, .paragraphStyle: paragraph, .foregroundColor: isMine ? UIColor.white : UIColor(hex: 0x222222)])
        if !statusText.isEmpty {
            text.append(NSAttributedString(string: "\n" + statusText, attributes: [.font: UIFont.systemFont(ofSize: r(20)), .foregroundColor: isMine ? UIColor.white.withAlphaComponent(0.8) : NativeUITheme.secondary]))
        }
        let maximum = max(r(80), (width - r(48)) * 0.70 - r(44))
        let rect = text.boundingRect(with: CGSize(width: maximum, height: .greatestFiniteMagnitude), options: [.usesLineFragmentOrigin, .usesFontLeading], context: nil)
        let bubbleWidth = max(ceil(rect.width) + r(44), quoted == nil ? 0 : r(360))
        let bubbleHeight = max(r(45), ceil(rect.height)) + r(36) + (quoted == nil ? 0 : r(96))
        if card != nil { return (r(460), r(248), r(280) + dateHeight, text) }

        if let video = videoMetadata {
            var size = video.fitted(maxWidth: Double(r(280)), maxHeight: Double(r(360)))
            if !video.hasDimensions, let actual = mediaView.loadedImageSize, actual.width > 0, actual.height > 0 {
                let scale = min(r(280) / actual.width, r(360) / actual.height); size = (Double(actual.width * scale), Double(actual.height * scale))
            }
            let statusHeight = statusText.isEmpty ? 0 : r(60)
            return (CGFloat(size.width), CGFloat(size.height) + statusHeight, CGFloat(size.height) + statusHeight + r(32) + dateHeight, text)
        }
        if hasMedia { let edge = min(width * 0.5, 220); let height = edge + (statusText.isEmpty && messageText.isEmpty ? 0 : r(60)); return (edge, height, height + r(32) + dateHeight, text) }
        return (bubbleWidth, bubbleHeight, max(r(72), bubbleHeight) + r(32) + dateHeight, text)
    }

    override func preferredLayoutAttributesFitting(_ layoutAttributes: UICollectionViewLayoutAttributes) -> UICollectionViewLayoutAttributes {
        let attributes = layoutAttributes.copy() as! UICollectionViewLayoutAttributes
        attributes.size.height = dimensions(width: layoutAttributes.size.width).2
        return attributes
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        let width = contentView.bounds.width
        let r: (CGFloat) -> CGFloat = { NativeUITheme.rpx($0, width: width) }
        let (bubbleWidth, bubbleHeight, _, text) = dimensions(width: width)
        let mine = isMine
        let avatarX = mine ? width - r(24) - r(72) : r(24)
        let dateHeight: CGFloat = dateText == nil ? 0 : r(68); dateLabel.isHidden = dateText == nil; dateLabel.frame = CGRect(x: r(32), y: r(12), width: width - r(64), height: r(44)); dateLabel.font = .systemFont(ofSize: r(24))
        avatar.frame = CGRect(x: avatarX, y: r(16) + dateHeight, width: r(72), height: r(72))
        avatar.layer.cornerRadius = r(36)
        let x = mine ? avatarX - r(16) - bubbleWidth : avatar.frame.maxX + r(16)
        bubble.frame = CGRect(x: x, y: r(16) + dateHeight, width: bubbleWidth, height: bubbleHeight)
        label.attributedText = text
        label.frame = CGRect(x: r(22), y: r(18), width: bubbleWidth - r(44), height: bubbleHeight - r(36) - (quoted == nil ? 0 : r(96)))
        let mediaHeight = videoMetadata == nil ? bubbleWidth : bubbleHeight - (statusText.isEmpty ? 0 : r(60))
        if hasMedia { mediaView.frame = CGRect(x: 0, y: 0, width: bubbleWidth, height: mediaHeight); label.frame = CGRect(x: r(12), y: mediaHeight, width: bubbleWidth - r(24), height: max(0, bubbleHeight - mediaHeight)) }
        videoPlay.frame = CGRect(x: (bubbleWidth - r(64)) / 2, y: (mediaHeight - r(64)) / 2, width: r(64), height: r(64))
        videoDuration.font = .systemFont(ofSize: r(16)); let durationWidth = max(r(54), min(bubbleWidth, (videoDuration.text ?? "").size(withAttributes: [.font: UIFont.systemFont(ofSize: r(16))]).width + r(12)))
        videoDuration.frame = CGRect(x: (bubbleWidth - durationWidth) / 2, y: mediaHeight - r(32), width: durationWidth, height: r(24))
        mediaSpinner.frame = CGRect(x: (bubbleWidth - 36) / 2, y: (mediaHeight - 36) / 2, width: 36, height: 36)
        videoPlay.isHidden = videoMetadata == nil || mediaSpinner.isAnimating
        if let quote = quoted { quoteView.frame = CGRect(x: r(16), y: bubbleHeight - r(100), width: bubbleWidth - r(32), height: r(84)); quoteImage.frame = CGRect(x: r(8), y: r(10), width: r(64), height: r(64)); quoteLabel.frame = CGRect(x: quote.image.isEmpty ? r(12) : r(84), y: r(8), width: quoteView.bounds.width - (quote.image.isEmpty ? r(24) : r(96)), height: r(68)); quoteLabel.font = .systemFont(ofSize: r(24)); quoteLabel.textColor = isMine ? UIColor.white.withAlphaComponent(0.9) : NativeUITheme.secondary }
        if card != nil { cardImage.frame = CGRect(x: r(24), y: r(24), width: r(96), height: r(96)); cardImage.layer.cornerRadius = r(12); label.frame = CGRect(x: r(140), y: r(18), width: bubbleWidth - r(164), height: r(130)); label.text = messageText; label.font = .systemFont(ofSize: r(28)); label.textColor = NativeUITheme.body; cardAction.frame = CGRect(x: r(24), y: r(164), width: bubbleWidth - r(48), height: r(64)); cardAction.font = .systemFont(ofSize: r(28), weight: .medium); cardAction.textColor = NativeUITheme.primary; cardAction.backgroundColor = UIColor(hex: 0xf3f4f7); cardAction.layer.cornerRadius = r(10); cardAction.clipsToBounds = true }
        let radius = r(16)
        let sharp = r(4)
        let topLeft = mine ? radius : sharp
        let topRight = mine ? sharp : radius
        let path = UIBezierPath()
        path.move(to: CGPoint(x: topLeft, y: 0))
        path.addLine(to: CGPoint(x: bubbleWidth - topRight, y: 0))
        path.addQuadCurve(to: CGPoint(x: bubbleWidth, y: topRight), controlPoint: CGPoint(x: bubbleWidth, y: 0))
        path.addLine(to: CGPoint(x: bubbleWidth, y: bubbleHeight - radius))
        path.addQuadCurve(to: CGPoint(x: bubbleWidth - radius, y: bubbleHeight), controlPoint: CGPoint(x: bubbleWidth, y: bubbleHeight))
        path.addLine(to: CGPoint(x: radius, y: bubbleHeight))
        path.addQuadCurve(to: CGPoint(x: 0, y: bubbleHeight - radius), controlPoint: CGPoint(x: 0, y: bubbleHeight))
        path.addLine(to: CGPoint(x: 0, y: topLeft))
        path.addQuadCurve(to: CGPoint(x: topLeft, y: 0), controlPoint: .zero)
        path.close()
        bubbleMask.path = path.cgPath
    }

    override func prepareForReuse() {
        super.prepareForReuse()
        messageText = ""; statusText = ""; isMine = false
        videoMetadata = nil; videoPlay.isHidden = true; videoDuration.isHidden = true; mediaSpinner.stopAnimating()
        label.attributedText = nil
        avatar.image = nil
        avatar.cancel(); mediaView.cancel(); quoteImage.cancel(); cardImage.cancel(); hasMedia = false; card = nil; quoted = nil; dateText = nil; onAvatarTap = nil; onQuoteTap = nil
    }
}

@MainActor
final class SampleConversationViewController: UIViewController {
    private let sample: LocalSampleConversation
    private let input = UITextField()
    private let header = UIView()
    private let back = UIButton(type: .system)
    private let heading = UILabel()
    private let more = UIButton(type: .system)
    private let notice = UILabel()
    private let composer = UIView()
    private let mic = NativeUITheme.imageButton("uni_icon_mic", accessibility: "语音")
    private let inputBox = UIView()
    private let emoji = UIButton(type: .system)
    private let plus = UIButton(type: .system)
    private let send = UIButton(type: .system)
    private var collection: UICollectionView!
    private var dataSource: UICollectionViewDiffableDataSource<Int, UUID>!
    private var messages: [UUID: SampleMessage] = [:]
    private var headerHeight: NSLayoutConstraint!
    private var composerHeight: NSLayoutConstraint!

    init(sample: LocalSampleConversation = LocalSampleConversation()) {
        self.sample = sample
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) { fatalError("不使用 Storyboard") }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        navigationController?.setNavigationBarHidden(true, animated: animated)
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(hex: 0xe6e8ee)
        let item = NSCollectionLayoutItem(layoutSize: NSCollectionLayoutSize(widthDimension: .fractionalWidth(1), heightDimension: .estimated(72)))
        let group = NSCollectionLayoutGroup.vertical(layoutSize: NSCollectionLayoutSize(widthDimension: .fractionalWidth(1), heightDimension: .estimated(72)), subitems: [item])
        collection = UICollectionView(frame: .zero, collectionViewLayout: UICollectionViewCompositionalLayout(section: NSCollectionLayoutSection(group: group)))
        collection.backgroundColor = UIColor(hex: 0xe6e8ee)
        collection.keyboardDismissMode = .interactive
        collection.register(NativeMessageCell.self, forCellWithReuseIdentifier: "message")
        collection.accessibilityIdentifier = "sampleMessageList"
        let contentViews: [UIView] = [header, collection, composer]
        contentViews.forEach { $0.translatesAutoresizingMaskIntoConstraints = false; view.addSubview($0) }
        header.backgroundColor = .white
        [back, heading, more, notice].forEach { header.addSubview($0) }
        back.setTitle("‹", for: .normal)
        back.setTitleColor(UIColor(hex: 0x1a1a1a), for: .normal)
        back.accessibilityLabel = "返回"
        back.addTarget(self, action: #selector(goBack), for: .touchUpInside)
        heading.text = "样例会话"
        heading.textColor = UIColor(hex: 0x111111)
        more.setTitle("⋯", for: .normal)
        more.setTitleColor(UIColor(hex: 0x444444), for: .normal)
        more.addTarget(self, action: #selector(showConversationMenu), for: .touchUpInside)
        notice.text = NativeUITheme.sampleNotice
        notice.font = .systemFont(ofSize: 11)
        notice.textColor = NativeUITheme.secondary
        notice.textAlignment = .center
        notice.backgroundColor = UIColor(hex: 0xf6f7fb)
        composer.backgroundColor = UIColor(hex: 0xf7f7f7)
        [mic, inputBox, plus, send].forEach { composer.addSubview($0) }
        mic.addTarget(self, action: #selector(unsupportedVoice), for: .touchUpInside)
        inputBox.backgroundColor = .white
        inputBox.addSubview(input)
        inputBox.addSubview(emoji)
        input.attributedPlaceholder = NSAttributedString(string: "输入消息", attributes: [.foregroundColor: UIColor(hex: 0xb0b0b0)])
        input.textColor = NativeUITheme.body
        input.returnKeyType = .done
        input.accessibilityIdentifier = "sampleMessageInput"
        input.addTarget(self, action: #selector(inputChanged), for: .editingChanged)
        emoji.setTitle("☺", for: .normal)
        emoji.setTitleColor(UIColor(hex: 0x666666), for: .normal)
        emoji.addTarget(self, action: #selector(unsupportedEmoji), for: .touchUpInside)
        plus.setTitle("＋", for: .normal)
        plus.setTitleColor(UIColor(hex: 0x333333), for: .normal)
        plus.addTarget(self, action: #selector(showAttachments), for: .touchUpInside)
        send.setTitle("传送", for: .normal)
        send.setTitleColor(.white, for: .normal)
        send.backgroundColor = NativeUITheme.primary
        send.accessibilityIdentifier = "appendSampleMessage"
        send.addTarget(self, action: #selector(appendMessage), for: .touchUpInside)
        send.isHidden = true
        headerHeight = header.heightAnchor.constraint(equalToConstant: 110)
        composerHeight = composer.heightAnchor.constraint(equalToConstant: 54)
        NSLayoutConstraint.activate([
            header.topAnchor.constraint(equalTo: view.topAnchor),
            header.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            header.trailingAnchor.constraint(equalTo: view.trailingAnchor), headerHeight,
            collection.topAnchor.constraint(equalTo: header.bottomAnchor),
            collection.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            collection.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            collection.bottomAnchor.constraint(equalTo: composer.topAnchor),
            composer.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            composer.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            composer.bottomAnchor.constraint(equalTo: view.keyboardLayoutGuide.topAnchor), composerHeight
        ])
        dataSource = UICollectionViewDiffableDataSource<Int, UUID>(collectionView: collection) { [weak self] collection, index, id in
            guard let self = self, let message = self.messages[id],
                  let cell = collection.dequeueReusableCell(withReuseIdentifier: "message", for: index) as? NativeMessageCell else { return nil }
            cell.configure(message)
            return cell
        }
        Task { [weak self] in
            guard let self = self else { return }
            self.show(await self.sample.snapshot())
        }
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        let width = view.bounds.width
        let r: (CGFloat) -> CGFloat = { NativeUITheme.rpx($0, width: width) }
        let top = view.safeAreaInsets.top
        headerHeight.constant = top + r(110) + 24
        composerHeight.constant = r(108)
        back.frame = CGRect(x: r(26), y: top + r(29), width: r(52), height: r(52))
        back.titleLabel?.font = .systemFont(ofSize: r(52), weight: .regular)
        heading.frame = CGRect(x: r(78), y: top + r(28), width: width - r(156), height: r(54))
        heading.font = .systemFont(ofSize: r(34), weight: .bold)
        more.frame = CGRect(x: width - r(78), y: top + r(29), width: r(52), height: r(52))
        more.titleLabel?.font = .systemFont(ofSize: r(42))
        notice.frame = CGRect(x: 0, y: top + r(110), width: width, height: 24)
        mic.frame = CGRect(x: r(20), y: r(22), width: r(64), height: r(64))
        mic.imageEdgeInsets = UIEdgeInsets(top: r(10), left: r(10), bottom: r(10), right: r(10))
        let sendWidth = send.isHidden ? 0 : r(116)
        let inputX = r(96)
        let inputWidth = width - inputX - r(20 + 64 + 12) - sendWidth
        inputBox.frame = CGRect(x: inputX, y: r(18), width: inputWidth, height: r(72))
        inputBox.layer.cornerRadius = r(12)
        input.frame = CGRect(x: r(18), y: 0, width: max(r(24), inputWidth - r(96)), height: r(72))
        input.font = .systemFont(ofSize: r(28))
        emoji.frame = CGRect(x: inputWidth - r(78), y: r(6), width: r(60), height: r(60))
        emoji.titleLabel?.font = .systemFont(ofSize: r(36))
        plus.frame = CGRect(x: inputBox.frame.maxX + r(12), y: r(22), width: r(64), height: r(64))
        plus.titleLabel?.font = .systemFont(ofSize: r(40))
        send.frame = CGRect(x: plus.frame.maxX + r(12), y: r(22), width: r(104), height: r(64))
        send.layer.cornerRadius = r(10)
        send.titleLabel?.font = .systemFont(ofSize: r(28))
    }

    private func show(_ list: [SampleMessage]) {
        messages = Dictionary(uniqueKeysWithValues: list.map { ($0.id, $0) })
        var snapshot = NSDiffableDataSourceSnapshot<Int, UUID>()
        snapshot.appendSections([0])
        snapshot.appendItems(list.map(\.id))
        let lastIndex = list.count - 1
        dataSource.apply(snapshot, animatingDifferences: false) { [weak self] in
            guard let self = self, lastIndex >= 0, self.collection.numberOfItems(inSection: 0) > lastIndex else { return }
            self.collection.layoutIfNeeded()
            self.collection.scrollToItem(at: IndexPath(item: lastIndex, section: 0), at: .bottom, animated: false)
        }
    }

    @objc private func inputChanged() {
        send.isHidden = (input.text ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        view.setNeedsLayout()
    }

    @objc private func appendMessage() {
        let text = input.text ?? ""
        input.text = ""
        inputChanged()
        Task { [weak self] in
            guard let self = self else { return }
            self.show(await self.sample.append(text))
        }
    }

    @objc private func goBack() { navigationController?.popViewController(animated: true) }
    @objc private func unsupportedVoice() { showNativeNotice("语音功能尚未接入；本地样例不会录音或发送。") }
    @objc private func unsupportedEmoji() { showNativeNotice("表情面板尚未接入，可使用系统键盘输入表情文字。") }
    @objc private func showAttachments() {
        let menu = UIAlertController(title: nil, message: NativeUITheme.sampleNotice, preferredStyle: .actionSheet)
        for title in ["照片", "文件", "收藏"] {
            menu.addAction(UIAlertAction(title: title, style: .default) { [weak self] _ in self?.showNativeNotice("\(title)功能尚未接入，当前仅支持本地样例文字。") })
        }
        menu.addAction(UIAlertAction(title: "取消", style: .cancel))
        menu.popoverPresentationController?.sourceView = plus
        menu.popoverPresentationController?.sourceRect = plus.bounds
        present(menu, animated: true)
    }
    @objc private func showConversationMenu() {
        let menu = UIAlertController(title: "样例会话", message: NativeUITheme.sampleNotice, preferredStyle: .actionSheet)
        menu.addAction(UIAlertAction(title: "清空本地样例", style: .destructive) { [weak self] _ in
            guard let self = self else { return }
            Task { await self.sample.clear(); self.show([]) }
        })
        menu.addAction(UIAlertAction(title: "会话设置", style: .default) { [weak self] _ in self?.showNativeNotice("会话设置尚未接入，不会修改线上会话。") })
        menu.addAction(UIAlertAction(title: "取消", style: .cancel))
        menu.popoverPresentationController?.sourceView = more
        menu.popoverPresentationController?.sourceRect = more.bounds
        present(menu, animated: true)
    }
}
