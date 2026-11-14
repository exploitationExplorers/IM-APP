import UIKit

final class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let scene = scene as? UIWindowScene else { return }
        let window = UIWindow(windowScene: scene)
        window.rootViewController = NativeNavigationController(rootViewController: LoginViewController())
        self.window = window
        window.makeKeyAndVisible()
    }
}

/// 子页沿用原 ImNavBar 的居中加粗标题、原 SVG 返回图与白底。
final class NativeNavigationController: UINavigationController {
    private var appearanceWidth: CGFloat = 0
    override var childForStatusBarStyle: UIViewController? { topViewController }
    override func viewDidLoad() { super.viewDidLoad(); navigationBar.prefersLargeTitles = false; applyOriginalAppearance() }
    override func viewDidLayoutSubviews() { super.viewDidLayoutSubviews(); applyOriginalAppearance() }
    override func pushViewController(_ viewController: UIViewController, animated: Bool) {
        topViewController?.navigationItem.backButtonDisplayMode = .minimal
        viewController.navigationItem.largeTitleDisplayMode = .never
        super.pushViewController(viewController, animated: animated)
    }
    private func applyOriginalAppearance() {
        let width = view.bounds.width
        guard width > 0, abs(width - appearanceWidth) > 0.5 else { return }
        appearanceWidth = width
        let r = width / 750
        let appearance = UINavigationBarAppearance(); appearance.configureWithOpaqueBackground()
        appearance.backgroundColor = .white; appearance.shadowColor = .clear
        appearance.titleTextAttributes = [.font: UIFont.boldSystemFont(ofSize: 40 * r), .foregroundColor: UIColor(hex: 0x212121)]
        if let original = NativeUITheme.image("uni_icon_back") {
            let size = CGSize(width: 44 * r, height: 44 * r)
            let image = UIGraphicsImageRenderer(size: size).image { _ in original.draw(in: CGRect(origin: .zero, size: size)) }.withRenderingMode(.alwaysOriginal)
            appearance.setBackIndicatorImage(image, transitionMaskImage: image)
        }
        navigationBar.standardAppearance = appearance; navigationBar.scrollEdgeAppearance = appearance
        navigationBar.compactAppearance = appearance; navigationBar.tintColor = UIColor(hex: 0x212121)
    }
}
