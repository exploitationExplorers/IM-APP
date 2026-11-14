import UIKit
import IMCore
import PhotosUI

@MainActor
final class NativeAuthFlowController: UIViewController {
    enum Mode { case register, resetPassword, smsLogin }
    private let configuration: APIConfiguration; private let deviceID: String; private let mode: Mode
    private let onAuthenticated: ((BusinessAccountSession) -> Void)?
    private let scroll = UIScrollView(); private let country = UIButton(type: .system)
    private let phone = UITextField(); private let code = UITextField(); private let password = UITextField(); private let confirmation = UITextField()
    private let sendCode = UIButton(type: .system); private let submit = UIButton(type: .system); private let consent = UIButton(type: .system)
    private let gradient = CAGradientLayer(); private let heading = UILabel(); private let legal = UIButton(type: .system)
    private let logo = UIImageView(image: NativeUITheme.image("uni_logo"))
    private let eye = NativeUITheme.imageButton("uni_auth_eye_off", accessibility: "显示密码")
    private let confirmationEye = NativeUITheme.imageButton("uni_auth_eye_off", accessibility: "显示确认密码")
    private var resetStep = 1
    private let countries = [("中国", "+86"), ("中国香港", "+852"), ("美国", "+1"), ("新加坡", "+65"), ("马来西亚", "+60")]
    private var selected = 0; private var agreed = false; private var busy = false; private var deadline: Date?; private var timer: Timer?
    private var operation = UUID()
    private var operationTask: Task<Void, Never>?
    init(configuration: APIConfiguration, deviceID: String, mode: Mode, onAuthenticated: ((BusinessAccountSession) -> Void)? = nil) {
        self.configuration = configuration; self.deviceID = deviceID; self.mode = mode; self.onAuthenticated = onAuthenticated; super.init(nibName: nil, bundle: nil)
        title = mode == .register ? "注册" : mode == .resetPassword ? "忘记密码" : "验证码登录"
    }
    required init?(coder: NSCoder) { fatalError("不使用 Storyboard") }
    override func viewWillAppear(_ animated: Bool) { super.viewWillAppear(animated); navigationController?.setNavigationBarHidden(false, animated: animated); updateCountdown() }
    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated); operation = UUID(); operationTask?.cancel(); operationTask = nil; timer?.invalidate(); timer = nil; setBusy(false)
    }
    private func require(_ id: UUID) throws { try Task.checkCancellation(); guard operation == id, navigationController?.topViewController === self else { throw APIError.cancelled } }
    @objc private func selectCountry() {
        let sheet = UIAlertController(title: "选择国家 / 地区", message: nil, preferredStyle: .actionSheet)
        for (index, item) in countries.enumerated() { sheet.addAction(UIAlertAction(title: item.0 + " " + item.1, style: .default) { [weak self] _ in self?.selected = index; self?.country.setTitle(item.0 + " " + item.1 + " ▾", for: .normal) }) }
        sheet.addAction(UIAlertAction(title: "取消", style: .cancel)); sheet.popoverPresentationController?.sourceView = country; present(sheet, animated: true)
    }
    override func viewDidLoad() {
        super.viewDidLoad(); gradient.colors = [UIColor(hex: 0x2f9de2).cgColor, UIColor(hex: 0x1c41c7).cgColor, UIColor(hex: 0x0c1b54).cgColor]; gradient.startPoint = CGPoint(x: 0.78, y: 0.915); gradient.endPoint = CGPoint(x: 0.22, y: 0.085); view.layer.addSublayer(gradient)
        if mode == .resetPassword { navigationItem.leftBarButtonItem = UIBarButtonItem(image: NativeUITheme.image("uni_icon_back"), style: .plain, target: self, action: #selector(resetBack)) }
        view.addSubview(scroll); scroll.keyboardDismissMode = .interactive
        heading.text = title; heading.font = .boldSystemFont(ofSize: 26); heading.textColor = .white; heading.textAlignment = .center
        [logo, heading, country, phone, code, sendCode, password, confirmation, consent, legal, submit].forEach { scroll.addSubview($0) }
        logo.contentMode = .scaleAspectFit; logo.layer.cornerRadius = 12; logo.clipsToBounds = true
        country.setTitle("中国 +86 ▾", for: .normal); country.setTitleColor(NativeUITheme.body, for: .normal); country.backgroundColor = .white; country.layer.cornerRadius = 12; country.addTarget(self, action: #selector(selectCountry), for: .touchUpInside)
        for (field, placeholder) in [(phone, "请输入手机号码"), (code, "请输入验证码"), (password, "请设置密码"), (confirmation, "请再次输入密码")] {
            field.placeholder = placeholder; field.font = .systemFont(ofSize: 15); field.backgroundColor = UIColor(hex: 0xf8fafc); field.layer.cornerRadius = 12
            field.leftView = UIView(frame: CGRect(x: 0, y: 0, width: 16, height: 1)); field.leftViewMode = .always; field.autocapitalizationType = .none; field.autocorrectionType = .no
        }
        phone.keyboardType = .numberPad; phone.textContentType = .telephoneNumber; code.keyboardType = .numberPad; code.textContentType = .oneTimeCode
        password.isSecureTextEntry = true; confirmation.isSecureTextEntry = true; password.textContentType = .newPassword; confirmation.textContentType = .newPassword
        eye.frame = CGRect(x: 0, y: 0, width: 44, height: 50); password.rightView = eye; password.rightViewMode = .always
        eye.addAction(UIAction { [weak self] _ in guard let self = self else { return }; self.password.isSecureTextEntry.toggle() }, for: .touchUpInside)
        confirmationEye.frame = eye.frame; confirmation.rightView = confirmationEye; confirmation.rightViewMode = .always
        confirmationEye.addAction(UIAction { [weak self] _ in guard let self = self else { return }; self.confirmation.isSecureTextEntry.toggle() }, for: .touchUpInside)
        password.isHidden = mode == .smsLogin; confirmation.isHidden = mode == .smsLogin
        sendCode.setTitle("获取验证码", for: .normal); sendCode.setTitleColor(UIColor(hex: 0x245bd6), for: .normal); sendCode.backgroundColor = UIColor(hex: 0xf8fafc); sendCode.layer.cornerRadius = 12; sendCode.titleLabel?.font = .systemFont(ofSize: 13); sendCode.addTarget(self, action: #selector(requestCode), for: .touchUpInside)
        consent.setTitle("□ 我已阅读并同意", for: .normal); consent.setTitleColor(.white, for: .normal); consent.titleLabel?.font = .systemFont(ofSize: 12); consent.addTarget(self, action: #selector(toggleConsent), for: .touchUpInside)
        legal.setTitle("用户协议和隐私政策", for: .normal); legal.setTitleColor(.white, for: .normal); legal.titleLabel?.font = .systemFont(ofSize: 12); legal.addTarget(self, action: #selector(openLegal), for: .touchUpInside)
        consent.isHidden = mode == .resetPassword; legal.isHidden = mode == .resetPassword
        submit.backgroundColor = .white; submit.layer.cornerRadius = 12; submit.setTitle(title, for: .normal); submit.setTitleColor(NativeUITheme.primary, for: .normal); submit.addTarget(self, action: #selector(submitForm), for: .touchUpInside)
    }
    @objc private func resetBack() {
        guard !busy else { return }
        if resetStep == 2 { resetStep = 1; password.text = ""; view.setNeedsLayout() }
        else { navigationController?.popViewController(animated: true) }
    }
    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews(); gradient.frame = view.bounds; scroll.frame = view.bounds
        let width = min(400, view.bounds.width - 48), x = (view.bounds.width - width) / 2, y = view.safeAreaInsets.top + 24
        logo.frame = CGRect(x: (view.bounds.width - 44) / 2, y: y, width: 44, height: 44)
        heading.frame = CGRect(x: x, y: logo.frame.maxY + 24, width: width, height: 36)
        let form = heading.frame.maxY + 28
        country.frame = CGRect(x: x, y: form, width: 102, height: 52)
        phone.frame = CGRect(x: x + 112, y: form, width: width - 112, height: 52)
        code.frame = CGRect(x: x, y: form + 68, width: width, height: 52); code.rightView = UIView(frame: CGRect(x: 0, y: 0, width: 112, height: 50)); code.rightViewMode = .always
        sendCode.frame = CGRect(x: code.frame.maxX - 114, y: code.frame.minY + 1, width: 110, height: 50)
        password.frame = CGRect(x: x, y: form + 136, width: width, height: 52); confirmation.frame = CGRect(x: x, y: form + 204, width: width, height: 52)
        if mode == .resetPassword {
            country.isHidden = resetStep == 2; phone.isHidden = resetStep == 2; code.isHidden = resetStep == 2; sendCode.isHidden = resetStep == 2
            password.isHidden = resetStep == 1; confirmation.isHidden = true
            if resetStep == 2 { password.frame.origin.y = form }
            heading.text = resetStep == 1 ? "忘记密码" : "设置新密码"; submit.setTitle(resetStep == 1 ? "下一步" : "确认", for: .normal)
        }
        let bottom = mode == .smsLogin ? code.frame.maxY : mode == .resetPassword ? (resetStep == 1 ? code.frame.maxY : password.frame.maxY) : confirmation.frame.maxY
        consent.frame = CGRect(x: x, y: bottom + 14, width: width / 2, height: 34); legal.frame = CGRect(x: x + width / 2, y: bottom + 14, width: width / 2, height: 34)
        submit.frame = CGRect(x: x, y: bottom + 66, width: width, height: 48); scroll.contentSize = CGSize(width: view.bounds.width, height: submit.frame.maxY + 40)
    }
    private func validatedPhone() throws -> String {
        let number = (phone.text ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let patterns = ["^1[0-9]{10}$", "^[0-9]{8}$", "^[0-9]{10}$", "^[0-9]{8}$", "^[0-9]{9,10}$"]
        guard number.range(of: patterns[selected], options: .regularExpression) != nil else { throw APIError.business(code: -1, message: "请输入正确的手机号码。") }; return number
    }
    private func setBusy(_ value: Bool) { busy = value; submit.isEnabled = !value; country.isEnabled = !value; phone.isEnabled = !value; code.isEnabled = !value; password.isEnabled = !value; confirmation.isEnabled = !value; updateCountdown() }
    @objc private func requestCode() {
        guard !busy, deadline == nil || deadline! <= Date() else { return }
        guard mode == .resetPassword || agreed else { showNativeNotice("请先阅读并同意用户协议与隐私政策。"); return }
        do {
            let number = try validatedPhone(), countryCode = countries[selected].1, id = UUID(); operation = id; setBusy(true)
            operationTask = Task { defer { if operation == id { setBusy(false); operationTask = nil } }; do {
                let result = try await APIClient(configuration: configuration).sendSMS(SendSMSRequest(countryCode: countryCode, phone: number, scene: mode == .register ? "register" : mode == .resetPassword ? "reset" : "login", deviceId: deviceID))
                try require(id); deadline = Date().addingTimeInterval(TimeInterval(max(1, result.retryAfterSec))); timer?.invalidate(); timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in Task { @MainActor in self?.updateCountdown() } }; updateCountdown()
            } catch { if operation == id && !Task.isCancelled { showNativeNotice(error.localizedDescription) } } }
        } catch { showNativeNotice(error.localizedDescription) }
    }
    private func updateCountdown() { let remaining = max(0, Int(ceil(deadline?.timeIntervalSinceNow ?? 0))); sendCode.isEnabled = !busy && remaining == 0; sendCode.setTitle(remaining > 0 ? "\(remaining) 秒后重发" : "获取验证码", for: .normal); if remaining == 0 { timer?.invalidate(); timer = nil } }
    @objc private func toggleConsent() { agreed.toggle(); consent.setTitle(agreed ? "☑ 我已阅读并同意" : "□ 我已阅读并同意", for: .normal) }
    @objc private func openLegal() { let sheet = UIAlertController(title: "协议", message: nil, preferredStyle: .actionSheet); for (title, name) in [("用户协议", "agreement"), ("隐私政策", "privacy")] { sheet.addAction(UIAlertAction(title: title, style: .default) { [weak self] _ in self?.navigationController?.pushViewController(LegalViewController(document: name), animated: true) }) }; sheet.addAction(UIAlertAction(title: "取消", style: .cancel)); sheet.popoverPresentationController?.sourceView = legal; present(sheet, animated: true) }
    @objc private func submitForm() {
        guard !busy else { return }; guard mode == .resetPassword || agreed else { showNativeNotice("请先阅读并同意用户协议与隐私政策。"); return }
        do {
            let number = try validatedPhone(), code = self.code.text ?? "", secret = password.text ?? "", countryCode = countries[selected].1
            guard !code.isEmpty else { throw APIError.business(code: -1, message: "请输入验证码。") }
            if mode == .resetPassword && resetStep == 1 { resetStep = 2; view.setNeedsLayout(); return }
            if mode != .smsLogin { guard secret.count >= 6, mode == .resetPassword || secret == confirmation.text else { throw APIError.business(code: -1, message: "密码至少 6 位，且两次输入必须一致。") } }
            let id = UUID(); operation = id; setBusy(true)
            operationTask = Task { defer { if operation == id { setBusy(false); operationTask = nil } }; do {
                let api = APIClient(configuration: configuration)
                if mode == .resetPassword { try await api.resetPassword(countryCode: countryCode, phone: number, code: code, password: secret); try require(id); password.text = ""; confirmation.text = ""; navigationController?.popViewController(animated: true); return }
                let auth: AuthResult
                if mode == .register { auth = try await api.register(countryCode: countryCode, phone: number, code: code, password: secret, deviceID: deviceID) }
                else { auth = try await api.smsLogin(SMSLoginRequest(countryCode: countryCode, phone: number, code: code, deviceId: deviceID)) }
                try require(id)
                let profile = try await api.currentUser(accessToken: auth.accessToken, expectedUserID: auth.user.id)
                try require(id)
                password.text = ""; confirmation.text = ""
                let account = BusinessAccountSession(authentication: auth, profile: profile, profileLoadWarning: nil)
                if mode == .register {
                    let onboarding = NativeOnboardingController(account: account, configuration: configuration) { [weak self] account in
                        guard let self = self else { return }; self.onAuthenticated?(account)
                    }; navigationController?.pushViewController(onboarding, animated: true)
                } else { onAuthenticated?(account) }
            } catch { if operation == id && !Task.isCancelled { showNativeNotice(error.localizedDescription) } } }
        } catch { showNativeNotice(error.localizedDescription) }
    }
    deinit { timer?.invalidate() }
}

@MainActor
final class NativeOnboardingController: UIViewController, PHPickerViewControllerDelegate {
    private let account: BusinessAccountSession; private let configuration: APIConfiguration; private let completed: (BusinessAccountSession) -> Void
    private let heading = UILabel(); private let subtitle = UILabel(); private let avatar = NativeRemoteImageView(); private let name = UITextField(); private let count = UILabel(); private let join = UIButton(type: .system); private let skip = UIButton(type: .system)
    private let gradient = CAGradientLayer(); private var imageData: Data?; private var task: Task<Void, Never>?
    init(account: BusinessAccountSession, configuration: APIConfiguration, completed: @escaping (BusinessAccountSession) -> Void) { self.account = account; self.configuration = configuration; self.completed = completed; super.init(nibName: nil, bundle: nil); title = "完善资料" }
    required init?(coder: NSCoder) { fatalError("不使用 Storyboard") }
    override func viewDidLoad() {
        super.viewDidLoad(); gradient.colors = [UIColor(hex: 0x2f9de2).cgColor, UIColor(hex: 0x1c41c7).cgColor, UIColor(hex: 0x0c1b54).cgColor]; gradient.startPoint = CGPoint(x: 0.78, y: 0.915); gradient.endPoint = CGPoint(x: 0.22, y: 0.085); view.layer.addSublayer(gradient)
        heading.text = "还差一步！"; heading.textColor = .white; heading.font = .boldSystemFont(ofSize: 28)
        subtitle.text = "请输入你的个人资料，以完成注册流程"; subtitle.textColor = .white; subtitle.font = .systemFont(ofSize: 14)
        avatar.contentMode = .scaleAspectFill; avatar.clipsToBounds = true; avatar.load(account.profile.avatar, policy: MediaURLPolicy(businessBaseURL: configuration.baseURL, accountScope: account.profile.id)); avatar.isUserInteractionEnabled = true; avatar.addGestureRecognizer(UITapGestureRecognizer(target: self, action: #selector(pick)))
        name.backgroundColor = .white; name.layer.cornerRadius = 10; name.placeholder = "用户昵称"; name.text = account.profile.nickname; name.leftView = UIView(frame: CGRect(x: 0, y: 0, width: 16, height: 1)); name.leftViewMode = .always; name.addTarget(self, action: #selector(nameChanged), for: .editingChanged)
        count.textColor = .white; count.font = .systemFont(ofSize: 12)
        join.setTitle("立即加入", for: .normal); join.backgroundColor = .white; join.layer.cornerRadius = 12; join.setTitleColor(NativeUITheme.primary, for: .normal); join.addTarget(self, action: #selector(save), for: .touchUpInside)
        skip.setTitle("可稍后在个人页面设定头像和昵称", for: .normal); skip.setTitleColor(.white, for: .normal); skip.titleLabel?.font = .systemFont(ofSize: 12); skip.addTarget(self, action: #selector(skipNow), for: .touchUpInside)
        [heading, subtitle, avatar, name, count, join, skip].forEach { view.addSubview($0) }; nameChanged()
    }
    override func viewDidLayoutSubviews() { super.viewDidLayoutSubviews(); gradient.frame = view.bounds; let width = view.bounds.width, x: CGFloat = 24, y = view.safeAreaInsets.top + 40; heading.frame = CGRect(x: x, y: y, width: width - 48, height: 40); subtitle.frame = CGRect(x: x, y: y + 48, width: width - 48, height: 24); avatar.frame = CGRect(x: (width - 100) / 2, y: y + 112, width: 100, height: 100); avatar.layer.cornerRadius = 50; name.frame = CGRect(x: x, y: avatar.frame.maxY + 48, width: width - 48, height: 52); count.frame = CGRect(x: x, y: name.frame.maxY + 8, width: width - 48, height: 22); join.frame = CGRect(x: x, y: max(count.frame.maxY + 36, view.bounds.height - view.safeAreaInsets.bottom - 120), width: width - 48, height: 50); skip.frame = CGRect(x: x, y: join.frame.maxY + 12, width: width - 48, height: 32) }
    @objc private func nameChanged() { if (name.text ?? "").count > 15 { name.text = String((name.text ?? "").prefix(15)) }; count.text = "昵称最多 15 个字    \((name.text ?? "").count)/15"; join.isEnabled = !(name.text ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
    @objc private func pick() { var config = PHPickerConfiguration(); config.filter = .images; config.selectionLimit = 1; let picker = PHPickerViewController(configuration: config); picker.delegate = self; present(picker, animated: true) }
    func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) { picker.dismiss(animated: true); results.first?.itemProvider.loadObject(ofClass: UIImage.self) { [weak self] object, _ in guard let image = object as? UIImage, let data = image.jpegData(compressionQuality: 0.85) else { return }; Task { @MainActor in self?.imageData = data; self?.avatar.image = image } } }
    @objc private func skipNow() { guard task == nil else { return }; completed(account) }
    @objc private func save() {
        guard task == nil else { return }; let value = (name.text ?? "").trimmingCharacters(in: .whitespacesAndNewlines); guard !value.isEmpty else { return }; join.isEnabled = false
        task = Task { defer { task = nil; nameChanged() }; do {
            let context = NativeBusinessContext(account: account, configuration: configuration, ownerIsActive: { [weak self] in self?.navigationController?.topViewController === self })
            var fileID = ""; if let data = imageData { fileID = try await context.upload(data: data, filename: "avatar.jpg", contentType: "image/jpeg", purpose: "avatar").id }
            try Task.checkCancellation(); guard navigationController?.topViewController === self else { return }
            let profile: UserProfile = try await context.request("me", method: "PATCH", body: ["nickname": .string(value), "avatarFileId": .string(fileID), "bio": .string("")])
            try Task.checkCancellation(); guard navigationController?.topViewController === self else { return }; completed(BusinessAccountSession(authentication: account.authentication, profile: profile))
        } catch { if !Task.isCancelled, navigationController?.topViewController === self { showNativeNotice(error.localizedDescription) } } }
    }
    override func viewDidDisappear(_ animated: Bool) { super.viewDidDisappear(animated); if navigationController?.viewControllers.contains(where: { $0 === self }) != true { task?.cancel(); task = nil } }
}
