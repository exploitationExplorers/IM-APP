import UIKit
import IMCore

private final class SampleMessageCell: UICollectionViewCell {
    private let avatar = UIImageView()
    private let bubble = UIView()
    private let label = UILabel()
    private let bubbleMask = CAShapeLayer()
    private var message: SampleMessage?

    override init(frame: CGRect) {
        super.init(frame: frame)
        avatar.contentMode = .scaleAspectFill
        avatar.clipsToBounds = true
        label.numberOfLines = 0
        [avatar, bubble].forEach { contentView.addSubview($0) }
        bubble.addSubview(label)
        bubble.layer.mask = bubbleMask
    }

    required init?(coder: NSCoder) { fatalError("不使用 Storyboard") }

    func configure(_ message: SampleMessage) {
        self.message = message
        avatar.image = NativeUITheme.image(message.isMine ? "uni_avatar_me" : "uni_avatar_1")
        bubble.backgroundColor = message.isMine ? NativeUITheme.mineBubble : .white
        label.textColor = message.isMine ? .white : UIColor(hex: 0x222222)
        setNeedsLayout()
    }

    private func dimensions(width: CGFloat) -> (CGFloat, CGFloat, CGFloat, NSAttributedString) {
        let r: (CGFloat) -> CGFloat = { NativeUITheme.rpx($0, width: width) }
        let font = UIFont.systemFont(ofSize: r(30))
        let paragraph = NSMutableParagraphStyle()
        paragraph.minimumLineHeight = r(45)
        paragraph.maximumLineHeight = r(45)
        paragraph.lineBreakMode = .byCharWrapping
        let text = NSAttributedString(string: message?.text ?? "", attributes: [.font: font, .paragraphStyle: paragraph, .foregroundColor: message?.isMine == true ? UIColor.white : UIColor(hex: 0x222222)])
        let maximum = max(r(80), (width - r(48)) * 0.70 - r(44))
        let rect = text.boundingRect(with: CGSize(width: maximum, height: .greatestFiniteMagnitude), options: [.usesLineFragmentOrigin, .usesFontLeading], context: nil)
        let bubbleWidth = ceil(rect.width) + r(44)
        let bubbleHeight = max(r(45), ceil(rect.height)) + r(36)
        return (bubbleWidth, bubbleHeight, max(r(72), bubbleHeight) + r(32), text)
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
        let mine = message?.isMine == true
        let avatarX = mine ? width - r(24) - r(72) : r(24)
        avatar.frame = CGRect(x: avatarX, y: r(16), width: r(72), height: r(72))
        avatar.layer.cornerRadius = r(36)
        let x = mine ? avatarX - r(16) - bubbleWidth : avatar.frame.maxX + r(16)
        bubble.frame = CGRect(x: x, y: r(16), width: bubbleWidth, height: bubbleHeight)
        label.attributedText = text
        label.frame = CGRect(x: r(22), y: r(18), width: bubbleWidth - r(44), height: bubbleHeight - r(36))
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
        message = nil
        label.attributedText = nil
        avatar.image = nil
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
        collection.register(SampleMessageCell.self, forCellWithReuseIdentifier: "message")
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
                  let cell = collection.dequeueReusableCell(withReuseIdentifier: "message", for: index) as? SampleMessageCell else { return nil }
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
