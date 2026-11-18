import UIKit
import IMCore

@MainActor
final class NativeTextSelectionController: UIViewController {
    private let textView = UITextView()
    init(text: String) { super.init(nibName: nil, bundle: nil); title = "选择文字"; textView.text = text }
    required init?(coder: NSCoder) { fatalError("不使用 Storyboard") }
    override func viewDidLoad() { super.viewDidLoad(); view.backgroundColor = .white; textView.isEditable = false; textView.isSelectable = true; textView.font = .systemFont(ofSize: 18); textView.textContainerInset = UIEdgeInsets(top: 24, left: 20, bottom: 24, right: 20); view.addSubview(textView); textView.becomeFirstResponder() }
    override func viewWillAppear(_ animated: Bool) { super.viewWillAppear(animated); navigationController?.setNavigationBarHidden(false, animated: animated) }
    override func viewDidLayoutSubviews() { super.viewDidLayoutSubviews(); textView.frame = view.bounds.inset(by: view.safeAreaInsets) }
}


/// 对齐旧端消息菜单：两列、奇数留空、管理员操作在底部通栏，外点关闭。
@MainActor
final class NativeMessageActionOverlay: UIViewController {
    private let grid: [NativeMenuItem]
    private let wide: [NativeMenuItem]
    private let anchorInWindow: CGPoint
    private let panel = UIView()
    private let scroll = UIScrollView()
    private let content = UIView()
    private var cells: [UIView] = []
    private var choosing = false

    init(grid: [NativeMenuItem], wide: [NativeMenuItem], anchorInWindow: CGPoint) {
        self.grid = grid; self.wide = wide; self.anchorInWindow = anchorInWindow
        super.init(nibName: nil, bundle: nil)
        modalPresentationStyle = .overFullScreen; modalTransitionStyle = .crossDissolve
    }
    required init?(coder: NSCoder) { fatalError("不使用 Storyboard") }
    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor.black.withAlphaComponent(0.45)
        view.accessibilityViewIsModal = true
        let outside = UIButton(type: .custom); outside.frame = view.bounds; outside.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        outside.accessibilityLabel = "关闭消息菜单"
        outside.addAction(UIAction { [weak self] _ in self?.dismiss(animated: true) }, for: .touchUpInside)
        view.addSubview(outside); view.addSubview(panel)
        panel.backgroundColor = .white; panel.layer.cornerRadius = 12
        panel.layer.shadowColor = UIColor(hex: 0x0f172a).cgColor; panel.layer.shadowOpacity = 0.14; panel.layer.shadowRadius = 16; panel.layer.shadowOffset = CGSize(width: 0, height: 8)
        panel.addSubview(scroll); scroll.backgroundColor = .white; scroll.layer.cornerRadius = 12; scroll.clipsToBounds = true
        scroll.addSubview(content); scroll.alwaysBounceVertical = false
        let paddedCount = grid.count + grid.count % 2
        for index in 0..<paddedCount {
            if index < grid.count { cells.append(makeButton(grid[index], wide: false)) }
            else { let spacer = UIView(); spacer.isAccessibilityElement = false; content.addSubview(spacer); cells.append(spacer) }
        }
        for item in wide { cells.append(makeButton(item, wide: true)) }
    }
    private func makeButton(_ item: NativeMenuItem, wide: Bool) -> UIButton {
        let button = NativeMessageActionButton(type: .custom)
        button.setTitle(item.title, for: .normal); button.setTitleColor(UIColor(hex: 0x1a1a1a), for: .normal)
        button.titleLabel?.font = .systemFont(ofSize: 14, weight: wide ? .semibold : .regular)
        button.titleLabel?.numberOfLines = 2; button.titleLabel?.textAlignment = .center
        button.contentEdgeInsets = UIEdgeInsets(top: 8, left: 6, bottom: 8, right: 6)
        button.addAction(UIAction { [weak self] _ in
            guard let self = self, !self.choosing else { return }; self.choosing = true
            // 新页面或权限确认框只能在浮层关闭后打开，不依赖 UIAlertAction 私有接口。
            self.dismiss(animated: true, completion: item.action)
        }, for: .touchUpInside)
        content.addSubview(button); return button
    }
    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        let safe = view.bounds.inset(by: view.safeAreaInsets).insetBy(dx: 8, dy: 8)
        let keyboardTop = view.keyboardLayoutGuide.layoutFrame.minY
        let available = CGRect(x: safe.minX, y: safe.minY, width: safe.width, height: max(44, min(safe.maxY, keyboardTop - 8) - safe.minY))
        let width = min(available.width, min(320, max(view.bounds.width * 0.5, view.bounds.width * 240 / 750)))
        let paddedCount = grid.count + grid.count % 2, rows = paddedCount / 2
        let total = CGFloat(rows) * 44 + CGFloat(wide.count) * 48
        let height = min(total, available.height)
        let anchor = view.convert(anchorInWindow, from: view.window)
        let x = min(max(anchor.x - width / 2, available.minX), available.maxX - width)
        var y = anchor.y + 12
        if y + height > available.maxY { y = anchor.y - height - 12 }
        y = min(max(y, available.minY), available.maxY - height)
        panel.frame = CGRect(x: x, y: y, width: width, height: height)
        scroll.frame = panel.bounds; scroll.contentSize = CGSize(width: width, height: total)
        content.frame = CGRect(x: 0, y: 0, width: width, height: total)
        // 细分隔线包含空位；底部通栏项不进入两列网格。
        content.layer.sublayers?.filter { $0.name == "menuSeparator" }.forEach { $0.removeFromSuperlayer() }
        for (index, cell) in cells.enumerated() {
            if index < paddedCount { cell.frame = CGRect(x: CGFloat(index % 2) * width / 2, y: CGFloat(index / 2) * 44, width: width / 2, height: 44) }
            else { cell.frame = CGRect(x: 0, y: CGFloat(rows) * 44 + CGFloat(index - paddedCount) * 48, width: width, height: 48) }
        }
        let pixel = 1 / (view.window?.screen.scale ?? UIScreen.main.scale)
        func line(_ rect: CGRect) { let layer = CALayer(); layer.name = "menuSeparator"; layer.backgroundColor = UIColor(hex: 0xececec).cgColor; layer.frame = rect; content.layer.addSublayer(layer) }
        if rows > 0 { line(CGRect(x: width / 2, y: 0, width: pixel, height: CGFloat(rows) * 44)) }
        if rows > 1 { for row in 1..<rows { line(CGRect(x: 0, y: CGFloat(row) * 44, width: width, height: pixel)) } }
        for index in wide.indices { line(CGRect(x: 0, y: CGFloat(rows) * 44 + CGFloat(index) * 48, width: width, height: pixel)) }
    }
    override func accessibilityPerformEscape() -> Bool { dismiss(animated: true); return true }
}

@MainActor
private final class NativeMessageActionButton: UIButton {
    override var isHighlighted: Bool { didSet { backgroundColor = isHighlighted ? UIColor(hex: 0xf0f1f4) : .white } }
}
