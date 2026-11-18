import UIKit
import IMCore

/// 会话、首页与群申请共用角标；调用方提供对应业务的辅助功能描述。
@MainActor
final class NativeCountBadge: UILabel {
    private(set) var displaysDot = false
    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = UIColor(hex: 0xef4444)
        textColor = .white
        textAlignment = .center
        clipsToBounds = true
        adjustsFontSizeToFitWidth = true
        minimumScaleFactor = 0.7
        isHidden = true
        isAccessibilityElement = true
    }

    required init?(coder: NSCoder) { fatalError("不使用 Storyboard") }

    func setCount(_ count: Int, muted: Bool = false) {
        displaysDot = muted && count > 0
        text = muted ? nil : ConversationUnreadBadge.text(count)
        isHidden = count <= 0
        accessibilityLabel = count > 0 ? "\(count) 条未读消息" : nil
        setNeedsLayout()
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        layer.cornerRadius = bounds.height / 2
        font = .systemFont(ofSize: bounds.height == 16 ? 10 : bounds.height * 0.62)
    }
}
