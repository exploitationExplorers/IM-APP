import UIKit

/// 由发起操作的页面持有；返回、取消和完成时均移除，不占用导航栏返回入口。
@MainActor
final class NativeActionProgress {
    private var panel: UIVisualEffectView?
    private weak var label: UILabel?

    func show(in controller: UIViewController, text: String = "处理中…") {
        if panel != nil { update(text); return }
        guard let host = controller.viewIfLoaded?.window ?? controller.viewIfLoaded else { return }
        let panel = UIVisualEffectView(effect: UIBlurEffect(style: .systemMaterial))
        panel.translatesAutoresizingMaskIntoConstraints = false
        panel.layer.cornerRadius = 14; panel.clipsToBounds = true
        panel.isUserInteractionEnabled = false
        let spinner = UIActivityIndicatorView(style: .medium)
        let label = UILabel(); label.text = text; label.font = .systemFont(ofSize: 14)
        label.numberOfLines = 2; label.textAlignment = .center
        let stack = UIStackView(arrangedSubviews: [spinner, label]); stack.axis = .vertical; stack.spacing = 12
        stack.translatesAutoresizingMaskIntoConstraints = false; panel.contentView.addSubview(stack)
        host.addSubview(panel)
        NSLayoutConstraint.activate([
            panel.centerXAnchor.constraint(equalTo: host.centerXAnchor),
            panel.centerYAnchor.constraint(equalTo: host.safeAreaLayoutGuide.centerYAnchor),
            panel.widthAnchor.constraint(equalToConstant: 200),
            stack.leadingAnchor.constraint(equalTo: panel.contentView.leadingAnchor, constant: 20),
            stack.trailingAnchor.constraint(equalTo: panel.contentView.trailingAnchor, constant: -20),
            stack.topAnchor.constraint(equalTo: panel.contentView.topAnchor, constant: 20),
            stack.bottomAnchor.constraint(equalTo: panel.contentView.bottomAnchor, constant: -20)
        ])
        self.panel = panel; self.label = label; spinner.startAnimating()
        UIAccessibility.post(notification: .announcement, argument: text)
    }

    func update(_ text: String) { label?.text = text }
    func hide() { panel?.removeFromSuperview(); panel = nil; label = nil }
}
