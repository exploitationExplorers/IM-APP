import UIKit
import IMCore

@MainActor
final class LoginViewController: UIViewController, UITextViewDelegate {
    private let gradient = CAGradientLayer()
    private let scroll = UIScrollView()
    private let logo = UIImageView(image: NativeUITheme.image("uni_logo"))
    private let heading = NativeUITheme.label("登录易可聊", size: 26, weight: .semibold, color: .white)
    private let descriptionLabel = NativeUITheme.label("使用手机号和密码登录", size: 14, color: UIColor(hex: 0xe2e8f0))
    private let countryButton = UIButton(type: .custom)
    private let phone = UITextField()
    private let passwordBox = UIView()
    private let credential = UITextField()
    private let eye = NativeUITheme.imageButton("uni_auth_eye_off", accessibility: "显示密码")
    private let forgot = UIButton(type: .system)
    private let consent = UIButton(type: .custom)
    private let legal = UITextView()
    private let loginButton = UIButton(type: .system)
    private let register = UIButton(type: .system)
    private let smsLogin = UIButton(type: .system)
    private let deviceID = UIDevice.current.identifierForVendor?.uuidString ?? UUID().uuidString
    private var selectedCountry = 0
    private var agreed = false
    private var serverAddress = "https://www.xn--jprz53bj9s.com/api/v1"
    private var loginTask: Task<Void, Never>?
    private var activeOperationID: UUID?
    private var startingChat: NativeIMService?
    private var countryOverlay: UIControl?
    private var attemptedRestore = false
    private let countries = [("中国", "+86", "请输入手机号码", "^1\\d{10}$"), ("中国香港", "+852", "请输入 8 位手机号码", "^\\d{8}$"), ("美国", "+1", "请输入 10 位手机号码", "^\\d{10}$"), ("新加坡", "+65", "请输入 8 位手机号码", "^\\d{8}$"), ("马来西亚", "+60", "请输入手机号码", "^\\d{9,10}$")]

    override var preferredStatusBarStyle: UIStatusBarStyle { .lightContent }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        navigationController?.setNavigationBarHidden(true, animated: animated)
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        if !attemptedRestore { attemptedRestore = true; restoreSession() }
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        gradient.colors = [UIColor(hex: 0x2f9de2).cgColor, UIColor(hex: 0x1c41c7).cgColor, UIColor(hex: 0x0c1b54).cgColor]
        gradient.locations = [0.0661, 0.3526, 0.9313]
        // CSS linear-gradient(326deg)：从右下到左上，保留原色标。
        gradient.startPoint = CGPoint(x: 0.78, y: 0.915)
        gradient.endPoint = CGPoint(x: 0.22, y: 0.085)
        view.layer.insertSublayer(gradient, at: 0)
        scroll.keyboardDismissMode = .interactive
        scroll.contentInsetAdjustmentBehavior = .never
        view.addSubview(scroll)
        logo.contentMode = .scaleAspectFit
        logo.layer.cornerRadius = 15
        logo.clipsToBounds = true
        logo.isUserInteractionEnabled = true
        logo.accessibilityLabel = "易可聊"
        logo.addGestureRecognizer(UILongPressGestureRecognizer(target: self, action: #selector(openDebugPanel(_:))))
        heading.textAlignment = .center
        descriptionLabel.textAlignment = .center
        [logo, heading, descriptionLabel, countryButton, phone, passwordBox, forgot, consent, legal, loginButton, register, smsLogin].forEach { scroll.addSubview($0) }
        countryButton.setTitleColor(NativeUITheme.body, for: .normal)
        countryButton.titleLabel?.font = .systemFont(ofSize: 15, weight: .medium)
        countryButton.addTarget(self, action: #selector(selectCountry), for: .touchUpInside)
        styleInput(countryButton)
        phone.keyboardType = .numberPad
        phone.textContentType = .telephoneNumber
        phone.font = .systemFont(ofSize: 15)
        phone.textColor = NativeUITheme.body
        phone.leftView = UIView(frame: CGRect(x: 0, y: 0, width: 16, height: 1))
        phone.leftViewMode = .always
        styleInput(phone)
        styleInput(passwordBox)
        credential.attributedPlaceholder = NSAttributedString(string: "请输入密码", attributes: [.foregroundColor: NativeUITheme.secondary])
        credential.font = .systemFont(ofSize: 15)
        credential.textColor = NativeUITheme.body
        credential.isSecureTextEntry = true
        credential.textContentType = .password
        passwordBox.addSubview(credential)
        passwordBox.addSubview(eye)
        eye.addTarget(self, action: #selector(togglePassword), for: .touchUpInside)
        forgot.setTitle("忘记密码", for: .normal)
        forgot.setTitleColor(.white, for: .normal)
        forgot.titleLabel?.font = .systemFont(ofSize: 13)
        forgot.addTarget(self, action: #selector(forgotPassword), for: .touchUpInside)
        consent.layer.cornerRadius = 8
        consent.layer.borderWidth = 1
        consent.layer.borderColor = UIColor(hex: 0xd1d9ec).cgColor
        consent.accessibilityLabel = "同意用户协议和隐私政策"
        consent.addTarget(self, action: #selector(toggleConsent), for: .touchUpInside)
        legal.backgroundColor = .clear
        legal.isEditable = false
        legal.isScrollEnabled = false
        legal.textContainerInset = .zero
        legal.textContainer.lineFragmentPadding = 0
        legal.delegate = self
        let legalText = NSMutableAttributedString(string: "我已阅读并同意《用户协议》和《隐私政策》", attributes: [.font: UIFont.systemFont(ofSize: 12), .foregroundColor: UIColor(hex: 0xe2e8f0)])
        for (title, url) in [("《用户协议》", "imlegal://agreement"), ("《隐私政策》", "imlegal://privacy")] {
            legalText.addAttribute(.link, value: url, range: (legalText.string as NSString).range(of: title))
        }
        legal.attributedText = legalText
        legal.linkTextAttributes = [.foregroundColor: UIColor.white]
        loginButton.backgroundColor = .white
        loginButton.layer.cornerRadius = 12
        loginButton.setTitle("登录", for: .normal)
        loginButton.setTitleColor(NativeUITheme.primary, for: .normal)
        loginButton.titleLabel?.font = .systemFont(ofSize: 16, weight: .medium)
        loginButton.addTarget(self, action: #selector(login), for: .touchUpInside)
        register.setTitle("立即注册", for: .normal)
        register.setTitleColor(.white, for: .normal)
        register.titleLabel?.font = .systemFont(ofSize: 14)
        register.addTarget(self, action: #selector(registerAccount), for: .touchUpInside)
        smsLogin.setTitle("验证码登录", for: .normal)
        smsLogin.setTitleColor(.white, for: .normal)
        smsLogin.titleLabel?.font = .systemFont(ofSize: 14)
        smsLogin.addTarget(self, action: #selector(openSMSLogin), for: .touchUpInside)
        // 原版当前只展示密码登录；注册和找回密码仍使用验证码。
        smsLogin.isHidden = true
        updateCountry()
    }

    private func styleInput(_ view: UIView) {
        view.backgroundColor = UIColor(hex: 0xf8fafc)
        view.layer.borderColor = UIColor(hex: 0xe4e7ec).cgColor
        view.layer.borderWidth = 1
        view.layer.cornerRadius = 12
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        gradient.frame = view.bounds
        let angle = CGFloat(326) * .pi / 180
        let dx = sin(angle)
        let dy = -cos(angle)
        let length = abs(view.bounds.width * dx) + abs(view.bounds.height * dy)
        gradient.startPoint = CGPoint(x: 0.5 - dx * length / (2 * view.bounds.width), y: 0.5 - dy * length / (2 * view.bounds.height))
        gradient.endPoint = CGPoint(x: 0.5 + dx * length / (2 * view.bounds.width), y: 0.5 + dy * length / (2 * view.bounds.height))
        scroll.frame = view.bounds
        let compact = view.bounds.height <= 650
        let width = min(view.bounds.width - 48, 400)
        let x = (view.bounds.width - width) / 2
        let logoSize: CGFloat = compact ? 44 : 56
        var y = view.safeAreaInsets.top + (compact ? 28 : 64)
        logo.frame = CGRect(x: (view.bounds.width - logoSize) / 2, y: y, width: logoSize, height: logoSize)
        y += logoSize + (compact ? 24 : 32)
        heading.frame = CGRect(x: x, y: y, width: width, height: 36)
        y += 44
        descriptionLabel.frame = CGRect(x: x, y: y, width: width, height: 22)
        y += 22 + (compact ? 24 : 32)
        countryButton.frame = CGRect(x: x, y: y, width: 78, height: 52)
        phone.frame = CGRect(x: x + 88, y: y, width: width - 88, height: 52)
        y += 68
        passwordBox.frame = CGRect(x: x, y: y, width: width, height: 52)
        credential.frame = CGRect(x: 16, y: 1, width: width - 68, height: 50)
        eye.frame = CGRect(x: width - 48, y: 1, width: 44, height: 50)
        eye.imageEdgeInsets = UIEdgeInsets(top: 14, left: 11, bottom: 14, right: 11)
        y += 68
        forgot.frame = CGRect(x: x + width - 70, y: y, width: 70, height: 24)
        y += 44
        consent.frame = CGRect(x: x + 1, y: y + 3, width: 16, height: 16)
        legal.frame = CGRect(x: x + 26, y: y, width: width - 26, height: 44)
        let legalHeight = max(22, legal.sizeThatFits(CGSize(width: width - 26, height: .greatestFiniteMagnitude)).height)
        legal.frame.size.height = legalHeight
        y += legalHeight + 20
        loginButton.frame = CGRect(x: x, y: y, width: width, height: 50)
        y += 78
        register.frame = CGRect(x: x, y: y, width: width, height: 24)
        smsLogin.frame = CGRect(x: x + width / 2, y: y, width: width / 2, height: 24)
        scroll.contentSize = CGSize(width: view.bounds.width, height: max(y + 56 + view.safeAreaInsets.bottom, view.bounds.height + 1))
    }

    @objc private func selectCountry() {
        if countryOverlay != nil { dismissCountry(); return }
        view.endEditing(true)
        let r: (CGFloat) -> CGFloat = { NativeUITheme.rpx($0, width: self.view.bounds.width) }
        let overlay = UIControl(frame: view.bounds)
        overlay.addTarget(self, action: #selector(dismissCountry), for: .touchUpInside)
        let anchor = countryButton.convert(countryButton.bounds, to: view)
        let panel = UIView(frame: CGRect(x: anchor.minX, y: anchor.maxY + r(8), width: r(280), height: r(400)))
        panel.backgroundColor = .white
        panel.layer.cornerRadius = r(12)
        panel.layer.shadowColor = UIColor.black.cgColor
        panel.layer.shadowOpacity = 0.18
        panel.layer.shadowRadius = r(24)
        panel.layer.shadowOffset = CGSize(width: 0, height: r(8))
        overlay.addSubview(panel)
        for (index, country) in countries.enumerated() {
            let row = UIButton(type: .custom)
            row.frame = CGRect(x: 0, y: CGFloat(index) * r(80), width: panel.bounds.width, height: r(80))
            row.tag = index
            row.addTarget(self, action: #selector(chooseCountry(_:)), for: .touchUpInside)
            row.accessibilityLabel = "\(country.0) \(country.1)"
            let name = NativeUITheme.label(country.0, size: r(26), color: index == selectedCountry ? NativeUITheme.primary : NativeUITheme.body)
            name.frame = CGRect(x: r(24), y: 0, width: panel.bounds.width - r(130), height: r(80))
            let code = NativeUITheme.label(country.1, size: r(26), color: UIColor(hex: 0x8a8f9c))
            code.textAlignment = .right
            code.frame = CGRect(x: panel.bounds.width - r(110), y: 0, width: r(86), height: r(80))
            row.addSubview(name)
            row.addSubview(code)
            let line = UIView(frame: CGRect(x: 0, y: row.bounds.height - r(1), width: row.bounds.width, height: r(1)))
            line.backgroundColor = UIColor(hex: 0xf0f0f0)
            row.addSubview(line)
            panel.addSubview(row)
        }
        countryOverlay = overlay
        view.addSubview(overlay)
    }

    @objc private func dismissCountry() { countryOverlay?.removeFromSuperview(); countryOverlay = nil }
    @objc private func chooseCountry(_ sender: UIButton) { selectedCountry = sender.tag; updateCountry(); dismissCountry() }

    private func updateCountry() {
        let selected = countries[selectedCountry]
        countryButton.setTitle(selected.1 + "  ▾", for: .normal)
        phone.attributedPlaceholder = NSAttributedString(string: selected.2, attributes: [.foregroundColor: NativeUITheme.secondary])
    }

    @objc private func togglePassword() {
        credential.isSecureTextEntry.toggle()
        eye.setImage(NativeUITheme.image(credential.isSecureTextEntry ? "uni_auth_eye_off" : "uni_auth_eye"), for: .normal)
        eye.accessibilityLabel = credential.isSecureTextEntry ? "显示密码" : "隐藏密码"
    }

    @objc private func toggleConsent() {
        agreed.toggle()
        consent.backgroundColor = agreed ? .white : .clear
        consent.setTitle(agreed ? "✓" : "", for: .normal)
        consent.setTitleColor(NativeUITheme.primary, for: .normal)
        consent.titleLabel?.font = .systemFont(ofSize: 12, weight: .semibold)
        consent.accessibilityValue = agreed ? "已同意" : "未同意"
    }

    func textView(_ textView: UITextView, shouldInteractWith URL: URL, in characterRange: NSRange, interaction: UITextItemInteraction) -> Bool {
        guard URL.scheme == "imlegal", let document = URL.host, ["agreement", "privacy"].contains(document) else { return false }
        navigationController?.pushViewController(LegalViewController(document: document), animated: true)
        return false
    }

    @objc private func forgotPassword() { openAuthFlow(.resetPassword) }
    @objc private func registerAccount() { openAuthFlow(.register) }
    @objc private func openSMSLogin() { openAuthFlow(.smsLogin) }

    private func openAuthFlow(_ mode: NativeAuthFlowController.Mode) {
        cancelAuthentication()
        do {
            let configuration = try APIConfiguration(baseURL: serverAddress)
            weak var authFlow: NativeAuthFlowController?
            let controller = NativeAuthFlowController(configuration: configuration, deviceID: deviceID, mode: mode) { [weak self] account in
                guard let self = self, let flow = authFlow,
                      self.navigationController?.viewControllers.contains(where: { $0 === flow }) == true,
                      self.navigationController?.topViewController === flow || self.navigationController?.topViewController is NativeOnboardingController else { return }
                self.beginAuthenticatedSession(account, configuration: configuration)
            }
            authFlow = controller
            navigationController?.pushViewController(controller, animated: true)
        } catch { showNativeNotice(error.localizedDescription) }
    }

    @objc private func openDebugPanel(_ recognizer: UILongPressGestureRecognizer) {
        guard recognizer.state == .began else { return }
        let alert = UIAlertController(title: "开发验证", message: "默认连接易可聊业务服务。可覆盖 HTTPS 地址；本地样例仅在内存中运行，不联网、不送达。", preferredStyle: .actionSheet)
        alert.addAction(UIAlertAction(title: "覆盖 HTTPS 服务地址", style: .default) { [weak self] _ in self?.configureServer() })
        alert.addAction(UIAlertAction(title: "打开本地样例", style: .default) { [weak self] _ in self?.openSample() })
        alert.addAction(UIAlertAction(title: "取消当前认证", style: .destructive) { [weak self] _ in self?.cancelAuthentication() })
        alert.addAction(UIAlertAction(title: "关闭", style: .cancel))
        alert.popoverPresentationController?.sourceView = logo
        alert.popoverPresentationController?.sourceRect = logo.bounds
        present(alert, animated: true)
    }

    private func configureServer() {
        let alert = UIAlertController(title: "业务服务", message: "仅填写已授权的 HTTPS 地址。保存后在下次登录时使用，不会自动发送请求。", preferredStyle: .alert)
        alert.addTextField { field in field.placeholder = "https://服务域名/api/v1"; field.text = self.serverAddress; field.autocapitalizationType = .none; field.keyboardType = .URL }
        alert.addAction(UIAlertAction(title: "保存", style: .default) { [weak self, weak alert] _ in
            guard let self = self else { return }
            let input = alert?.textFields?.first?.text ?? ""
            do {
                _ = try APIConfiguration(baseURL: input)
                self.cancelAuthentication()
                self.serverAddress = input
            }
            catch { self.showNativeNotice(error.localizedDescription) }
        })
        alert.addAction(UIAlertAction(title: "取消", style: .cancel))
        present(alert, animated: true)
    }

    private func setLoading(_ loading: Bool) {
        loginButton.isEnabled = !loading
        phone.isEnabled = !loading
        credential.isEnabled = !loading
        countryButton.isEnabled = !loading
        forgot.isEnabled = !loading
        register.isEnabled = !loading
        smsLogin.isEnabled = !loading
        loginButton.setTitle(loading ? "登录中…" : "登录", for: .normal)
    }

    @objc private func login() {
        guard agreed else { showNativeNotice("请先阅读并同意用户协议与隐私政策"); return }
        let selected = countries[selectedCountry]
        let number = (phone.text ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard number.range(of: selected.3, options: .regularExpression) != nil else { showNativeNotice(selected.2); return }
        let secret = credential.text ?? ""
        guard !secret.isEmpty else { showNativeNotice("请输入密码"); return }
        loginTask?.cancel()
        do {
            let configuration = try APIConfiguration(baseURL: serverAddress)
            let api = APIClient(configuration: configuration)
            let operationID = UUID()
            activeOperationID = operationID
            setLoading(true)
            loginTask = Task { [weak self] in
                guard let self = self, !Task.isCancelled, self.activeOperationID == operationID else { return }
                do {
                    let account = try await api.businessPasswordLogin(PasswordLoginRequest(countryCode: selected.1, phone: number, password: secret, deviceId: self.deviceID))
                    guard !Task.isCancelled, self.activeOperationID == operationID else { return }
                    let saved = SavedBusinessLogin(account: account, configuration: configuration)
                    try await NativeSessionVault.shared.save(saved)
                    try await self.activate(account, configuration: configuration, operationID: operationID)
                } catch {
                    guard !Task.isCancelled, self.activeOperationID == operationID else { return }
                    self.showNativeNotice(error.localizedDescription)
                }
                if self.activeOperationID == operationID {
                    self.activeOperationID = nil
                    self.loginTask = nil
                    self.setLoading(false)
                }
            }
        } catch { showNativeNotice(error.localizedDescription) }
    }

    private func beginAuthenticatedSession(_ account: BusinessAccountSession, configuration: APIConfiguration) {
        cancelAuthentication()
        let operationID = UUID(); activeOperationID = operationID; setLoading(true)
        loginTask = Task { [weak self] in
            guard let self = self else { return }
            do {
                try await NativeSessionVault.shared.save(SavedBusinessLogin(account: account, configuration: configuration))
                try await self.activate(account, configuration: configuration, operationID: operationID)
            } catch {
                if !Task.isCancelled, self.activeOperationID == operationID { self.showNativeNotice(error.localizedDescription) }
            }
            self.finishAuthentication(operationID)
        }
    }

    private func activate(_ account: BusinessAccountSession, configuration: APIConfiguration, operationID: UUID) async throws {
        try Task.checkCancellation()
        guard activeOperationID == operationID else { throw CancellationError() }
        let chat = NativeIMService(account: account, configuration: configuration)
        startingChat = chat
        await chat.start()
        guard !Task.isCancelled, activeOperationID == operationID else { await chat.stop(); throw CancellationError() }
        startingChat = nil; credential.text = ""; view.endEditing(true)
        navigationController?.setViewControllers([self, SampleMainViewController(mode: .realAccount(chat))], animated: true)
    }

    private func finishAuthentication(_ operationID: UUID) {
        guard activeOperationID == operationID else { return }
        activeOperationID = nil; loginTask = nil; setLoading(false)
    }

    private func isUnauthorized(_ error: Error) -> Bool {
        guard let error = error as? APIError else { return false }
        switch error {
        case .httpStatus(401), .business(code: 401, message: _): return true
        default: return false
        }
    }

    private func restoreSession() {
        let operationID = UUID(); activeOperationID = operationID; setLoading(true)
        loginButton.setTitle("恢复登录中…", for: .normal)
        loginTask = Task { [weak self] in
            guard let self = self else { return }
            do {
                guard var saved = try await NativeSessionVault.shared.load() else { self.finishAuthentication(operationID); return }
                let configuration = try saved.validate()
                let api = APIClient(configuration: configuration)
                var profile: UserProfile?
                var needsRefresh = saved.expiresAt <= Date().addingTimeInterval(60)
                if !needsRefresh {
                    do { profile = try await api.currentUser(accessToken: saved.authentication.accessToken, expectedUserID: saved.profile.id) }
                    catch { if self.isUnauthorized(error) { needsRefresh = true } else { throw error } }
                }
                if needsRefresh {
                    let previousRefreshToken = saved.authentication.refreshToken
                    let tokens = try await api.refreshToken(RefreshTokenRequest(refreshToken: saved.authentication.refreshToken, deviceId: self.deviceID))
                    try Task.checkCancellation()
                    guard self.activeOperationID == operationID else { throw CancellationError() }
                    let auth = AuthResult(accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, expiresIn: tokens.expiresIn, user: saved.profile)
                    saved = SavedBusinessLogin(account: BusinessAccountSession(authentication: auth, profile: saved.profile), configuration: configuration)
                    // 先保存旋转后的 refreshToken；资料请求暂时失败不能丢掉新凭据。
                    try await NativeSessionVault.shared.save(saved, expectedRefreshToken: previousRefreshToken)
                    profile = try await api.currentUser(accessToken: tokens.accessToken, expectedUserID: saved.profile.id)
                }
                try Task.checkCancellation()
                guard self.activeOperationID == operationID, let profile = profile else { throw CancellationError() }
                let auth = AuthResult(accessToken: saved.authentication.accessToken, refreshToken: saved.authentication.refreshToken, expiresIn: saved.authentication.expiresIn, user: profile)
                let account = BusinessAccountSession(authentication: auth, profile: profile)
                try await NativeSessionVault.shared.save(SavedBusinessLogin(account: account, configuration: configuration, expiresAt: saved.expiresAt), expectedRefreshToken: saved.authentication.refreshToken)
                self.serverAddress = configuration.baseURL.absoluteString
                try await self.activate(account, configuration: configuration, operationID: operationID)
            } catch {
                if !Task.isCancelled, self.activeOperationID == operationID { self.showNativeNotice(error.localizedDescription) }
            }
            self.finishAuthentication(operationID)
        }
    }

    private func cancelAuthentication() {
        loginTask?.cancel()
        loginTask = nil
        activeOperationID = nil
        if let chat = startingChat { Task { await chat.stop() } }
        startingChat = nil
        credential.text = ""
        setLoading(false)
    }

    private func openSample() {
        cancelAuthentication()
        navigationController?.pushViewController(SampleMainViewController(), animated: true)
    }
}
