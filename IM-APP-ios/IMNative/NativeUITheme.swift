import UIKit

enum NativeUITheme {
    static let primary = UIColor(hex: 0x0a2fc2)
    static let mineBubble = UIColor(hex: 0x2b5cff)
    static let body = UIColor(hex: 0x212121)
    static let secondary = UIColor(hex: 0x636e86)
    static let sampleNotice = "本地样例 · 不联网 · 不送达"

    /// Vue 的 rpx 按实际窗口逻辑宽度换算，px 保持逻辑尺寸。
    static func rpx(_ value: CGFloat, width: CGFloat) -> CGFloat { value * width / 750 }

    static func label(_ text: String, size: CGFloat, weight: UIFont.Weight = .regular, color: UIColor = body) -> UILabel {
        let label = UILabel()
        label.text = text
        label.font = .systemFont(ofSize: size, weight: weight)
        label.textColor = color
        return label
    }

    static func image(_ name: String) -> UIImage? { UIImage(named: name)?.withRenderingMode(.alwaysOriginal) }

    static func imageButton(_ name: String, accessibility: String) -> UIButton {
        let button = UIButton(type: .custom)
        button.setImage(image(name), for: .normal)
        button.imageView?.contentMode = .scaleAspectFit
        button.accessibilityLabel = accessibility
        return button
    }
}

extension UIColor {
    convenience init(hex: UInt32) {
        self.init(red: CGFloat((hex >> 16) & 255) / 255, green: CGFloat((hex >> 8) & 255) / 255,
                  blue: CGFloat(hex & 255) / 255, alpha: 1)
    }
}

extension UIViewController {
    func showNativeNotice(_ message: String, title: String = "提示") {
        let alert = UIAlertController(title: title, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "知道了", style: .default))
        present(alert, animated: true)
    }

    /// 映射旧页的按钮锚定白浮层，不使用平台 Action Sheet 改变普通菜单外观。
    func showAnchoredNativeMenu(anchor: UIView, items: [NativeMenuItem], width: CGFloat = 288) {
        view.viewWithTag(7824)?.removeFromSuperview()
        let r: (CGFloat) -> CGFloat = { NativeUITheme.rpx($0, width: self.view.bounds.width) }
        let overlay = NativeMenuOverlay(frame: view.bounds)
        overlay.tag = 7824
        let source = anchor.convert(anchor.bounds, to: view)
        let panelWidth = r(width)
        let panelHeight = r(32) + CGFloat(items.count) * r(72)
        let panel = UIView(frame: CGRect(x: max(r(12), min(source.maxX - panelWidth, view.bounds.width - panelWidth - r(12))),
                                        y: min(source.maxY + r(8), view.bounds.height - view.safeAreaInsets.bottom - panelHeight),
                                        width: panelWidth, height: panelHeight))
        panel.backgroundColor = .white
        panel.layer.cornerRadius = r(16)
        panel.layer.shadowColor = UIColor.black.cgColor
        panel.layer.shadowOpacity = 0.1
        panel.layer.shadowRadius = r(15)
        panel.layer.shadowOffset = CGSize(width: 0, height: r(10))
        overlay.addSubview(panel)
        for (index, item) in items.enumerated() {
            let button = NativeMenuButton(frame: .zero)
            button.frame = CGRect(x: r(16), y: r(16) + CGFloat(index) * r(72), width: panelWidth - r(32), height: r(72))
            button.onTap = { [weak overlay] in overlay?.removeFromSuperview(); item.action() }
            let iconWidth: CGFloat = item.icon == nil ? 0 : r(56)
            if let name = item.icon {
                let image = UIImageView(image: NativeUITheme.image(name))
                image.contentMode = .scaleAspectFit
                image.frame = CGRect(x: r(16), y: r(16), width: r(40), height: r(40))
                button.addSubview(image)
            }
            let label = NativeUITheme.label(item.title, size: r(28), color: item.destructive ? UIColor(hex: 0xe54d42) : NativeUITheme.body)
            label.frame = CGRect(x: r(16) + iconWidth, y: 0, width: button.bounds.width - r(24) - iconWidth, height: r(72))
            button.addSubview(label)
            button.accessibilityLabel = item.title
            panel.addSubview(button)
        }
        view.addSubview(overlay)
    }
}

struct NativeMenuItem {
    let title: String
    var icon: String? = nil
    var destructive = false
    let action: () -> Void
}

private final class NativeMenuOverlay: UIControl {
    override init(frame: CGRect) {
        super.init(frame: frame)
        addTarget(self, action: #selector(dismiss), for: .touchUpInside)
    }
    required init?(coder: NSCoder) { fatalError("不使用 Storyboard") }
    @objc private func dismiss() { removeFromSuperview() }
}

private final class NativeMenuButton: UIButton {
    var onTap: (() -> Void)?
    override init(frame: CGRect) {
        super.init(frame: frame)
        addTarget(self, action: #selector(performAction), for: .touchUpInside)
    }
    required init?(coder: NSCoder) { fatalError("不使用 Storyboard") }
    @objc private func performAction() { onTap?() }
}
