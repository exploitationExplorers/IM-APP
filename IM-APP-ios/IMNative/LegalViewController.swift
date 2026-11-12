import UIKit
import WebKit

@MainActor
final class LegalViewController: UIViewController, WKNavigationDelegate {
    private let document: String
    private var webView: WKWebView!

    init(document: String) {
        self.document = document
        super.init(nibName: nil, bundle: nil)
        title = document == "agreement" ? "用户协议" : "隐私政策"
    }

    required init?(coder: NSCoder) { fatalError("不使用 Storyboard") }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        navigationController?.setNavigationBarHidden(false, animated: animated)
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        configuration.defaultWebpagePreferences.allowsContentJavaScript = false
        webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = self
        view = webView
        guard let url = Bundle.main.url(forResource: document, withExtension: "html", subdirectory: "Legal") else {
            showNativeNotice("本地法律文档未随包提供，请检查资源。")
            return
        }
        webView.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url, url.isFileURL,
              let directory = Bundle.main.resourceURL?.appendingPathComponent("Legal").standardizedFileURL.path,
              url.standardizedFileURL.path.hasPrefix(directory + "/") else {
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }
}
