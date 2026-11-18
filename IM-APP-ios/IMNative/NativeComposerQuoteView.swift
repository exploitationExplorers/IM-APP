import UIKit
import IMCore

/// 编辑器引用预览只负责展示与关闭事件，不管理发送或 SDK 状态。
@MainActor
final class NativeComposerQuoteView: UIView {
    var onClose: (() -> Void)?
    private let thumbnail = NativeRemoteImageView()
    private let name = UILabel()
    private let summary = UILabel()
    private let close = UIButton(type: .system)
    private var showsThumbnail = false

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = .white
        thumbnail.contentMode = .scaleAspectFill
        thumbnail.clipsToBounds = true
        summary.textColor = NativeUITheme.secondary
        close.setTitle("×", for: .normal)
        close.setTitleColor(.gray, for: .normal)
        close.accessibilityLabel = "取消引用"
        close.addAction(UIAction { [weak self] _ in self?.onClose?() }, for: .touchUpInside)
        [thumbnail, name, summary, close].forEach { addSubview($0) }
    }

    required init?(coder: NSCoder) { fatalError("不使用 Storyboard") }

    func configure(message: ChatTextItem?, policy: MediaURLPolicy) {
        isHidden = message == nil
        guard let message = message else {
            thumbnail.cancel()
            return
        }
        name.text = message.senderName.isEmpty ? "我" : message.senderName
        summary.text = message.text
        let media = message.media
        let source = media?.kind == 102 ? (media?.thumbnail.isEmpty == false ? media?.thumbnail : media?.url)
            : (media?.kind == 104 ? media?.thumbnail : nil)
        showsThumbnail = source?.isEmpty == false
        thumbnail.isHidden = !showsThumbnail
        if let source = source, showsThumbnail { thumbnail.load(source, policy: policy, variant: .list) }
        else { thumbnail.cancel() }
        setNeedsLayout()
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        let r = bounds.width / 750
        let textX: CGFloat = showsThumbnail ? 104 : 24
        thumbnail.frame = CGRect(x: 24 * r, y: 16 * r, width: 64 * r, height: 64 * r)
        name.frame = CGRect(x: textX * r, y: 16 * r, width: bounds.width - (textX + 84) * r, height: 34 * r)
        summary.frame = CGRect(x: textX * r, y: 50 * r, width: name.bounds.width, height: 34 * r)
        name.font = .boldSystemFont(ofSize: 24 * r)
        summary.font = .systemFont(ofSize: 24 * r)
        close.frame = CGRect(x: bounds.width - 76 * r, y: 4 * r, width: 76 * r, height: bounds.height - 8 * r)
        close.titleLabel?.font = .systemFont(ofSize: 36 * r)
    }
}
