import UIKit
import UserNotifications
import IMCore
import AVKit

@MainActor
final class NativeSettingsController: NativeBusinessListController {
    enum Kind { case notifications, chat, privacy, security, general, blocked, about }
    private let kind: Kind
    private let service: NativeIMService
    private var privacy: NativePrivacy?
    private var defaults: UserDefaults { .standard }
    private var prefix: String { "native.\(context.configuration.baseURL.host ?? "").\(context.userID)." }
    init(context: NativeBusinessContext, service: NativeIMService, kind: Kind) {
        self.service = service; self.kind = kind
        let names: [Kind: String] = [.notifications: "通知设置", .chat: "聊天设置", .privacy: "隐私", .security: "安全", .general: "通用", .blocked: "黑名单", .about: "关于"]
        super.init(title: names[kind] ?? "设置", context: context)
    }
    required init?(coder: NSCoder) { fatalError("不使用 Storyboard") }
    override func viewDidLoad() {
        super.viewDidLoad()
        if [.notifications, .chat, .general].contains(kind) {
            view.backgroundColor = .white; tableView.backgroundColor = .white
            tableView.register(NativeNotificationSettingCell.self, forCellReuseIdentifier: "notification-setting")
        }
    }
    override func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        guard kind == .notifications || kind == .chat else { return super.tableView(tableView, cellForRowAt: indexPath) }
        let cell = tableView.dequeueReusableCell(withIdentifier: "notification-setting", for: indexPath) as! NativeNotificationSettingCell
        cell.configure(sections[indexPath.section][indexPath.row], inset: kind == .notifications ? 40 : 32, showsArrow: !(kind == .chat && indexPath.row == 3)); return cell
    }
    override func tableView(_ tableView: UITableView, heightForHeaderInSection section: Int) -> CGFloat {
        guard kind == .notifications else { return super.tableView(tableView, heightForHeaderInSection: section) }
        return section == 0 ? 0.01 : NativeUITheme.rpx(120, width: view.bounds.width)
    }
    override func tableView(_ tableView: UITableView, viewForHeaderInSection section: Int) -> UIView? {
        guard kind == .notifications else { return super.tableView(tableView, viewForHeaderInSection: section) }
        guard section > 0 else { return nil }
        let r = view.bounds.width / 750, holder = UIView(); holder.backgroundColor = .white
        let line = UIView(); line.backgroundColor = UIColor(hex: 0xe5e7eb); line.frame = CGRect(x: 40 * r, y: 30 * r, width: view.bounds.width - 80 * r, height: max(0.5, r)); holder.addSubview(line)
        let title = section < sectionTitles.count ? sectionTitles[section] : ""
        let label = NativeUITheme.label(title, size: 26 * r, weight: .bold, color: UIColor(hex: 0x111111)); label.frame = CGRect(x: 40 * r, y: 60 * r, width: view.bounds.width - 80 * r, height: 44 * r); holder.addSubview(label); return holder
    }
    private func localSwitch(_ title: String, key: String, defaultValue: Bool = false) -> NativeBusinessRow {
        let full = prefix + key, value = defaults.object(forKey: full) == nil ? defaultValue : defaults.bool(forKey: full)
        return NativeBusinessRow(title: title, checked: value, toggle: { [weak self] value in
            self?.defaults.set(value, forKey: full)
            if key == "message", value { UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { _, _ in } }
            self?.reloadContent()
        })
    }
    override func reloadContent() {
        switch kind {
        case .privacy:
            perform { [self] in privacy = try await context.request("me/privacy-settings"); renderPrivacy() }
        case .blocked:
            perform { [self] in
                struct Result: Decodable { let items: [NativeContact] }
                let result: Result = try await context.request("contacts/blocked", query: [URLQueryItem(name: "limit", value: "100")])
                setRows([result.items.map { contact in NativeBusinessRow(title: contact.displayName, avatar: contact.avatar, action: { [weak self] in
                    self?.confirm("解除对 \(contact.displayName) 的拉黑？", destructiveTitle: "解除") { self?.perform { try await self?.context.change("contacts/\(contact.id)/block", method: "DELETE", body: nil); self?.scheduleReload() } }
                }) }])
            }
        case .notifications:
            var groups = [[localSwitch("消息免打扰", key: "noDisturb")]]
            if !defaults.bool(forKey: prefix + "noDisturb") { groups += [[localSwitch("新消息通知", key: "message", defaultValue: true), localSwitch("语音邀请", key: "voice", defaultValue: true)], [localSwitch("声音", key: "sound", defaultValue: true)]] }
            setRows(groups, titles: defaults.bool(forKey: prefix + "noDisturb") ? [] : ["", "应用未打开时", "应用打开时"])
        case .chat:
            setRows([[localSwitch("回车键送出消息", key: "enterToSend", defaultValue: true), NativeBusinessRow(title: "群发助手", action: { [weak self] in guard let self = self else { return }; self.push(NativeMassAssistantController(service: self.service)) }), NativeBusinessRow(title: "我的表情", action: { [weak self] in guard let self = self else { return }; self.push(NativeEmotionsController(context: self.context)) }), NativeBusinessRow(title: "清除聊天记录", action: { [weak self] in self?.clearAllHistory() })]])
        case .security:
            setRows([[NativeBusinessRow(title: "手机号码", detail: context.profile.phoneMasked)], [NativeBusinessRow(title: context.profile.hasPassword ? "修改密码" : "设置密码", action: { [weak self] in self?.changePassword() })], [NativeBusinessRow(title: "注销账号", destructive: true, action: { [weak self] in guard let self = self else { return }; self.push(NativeAccountDeletionController(service: self.service)) })]])
        case .general:
            setRows([[
                NativeBusinessRow(title: "切换语言", detail: "简体中文", action: { [weak self] in self?.showNativeNotice("暂仅支持简体中文") }),
                NativeBusinessRow(title: "显示模式", detail: "行动版", action: { [weak self] in self?.showNativeNotice("暂仅支持行动版") })
            ,
                NativeBusinessRow(title: "意见反馈", action: { [weak self] in self?.openFeedback() }),
                NativeBusinessRow(title: "关于我们", action: { [weak self] in guard let self = self else { return }; self.push(NativeAboutController(context: self.context)) }),
                NativeBusinessRow(title: "清除缓存数据", action: { [weak self] in self?.confirm("清除图片缓存，聊天记录和待发消息会保留。", destructiveTitle: "清除") { Task { do { try await NativeImageCache.shared.clear(); self?.showNativeNotice("已清除图片缓存。") } catch { self?.showNativeNotice("图片缓存未完全清除：" + error.localizedDescription) } } } })
            ,
                NativeBusinessRow(title: "重新选线", action: { [weak self] in self?.confirm("重新连接聊天服务？", destructiveTitle: "确认") { guard let self = self else { return }; self.perform { try await self.service.reconnect(); self.showNativeNotice("已请求重新连接。") } } }),
                NativeBusinessRow(title: "调试资讯", action: { [weak self] in guard let self = self else { return }; self.push(NativeDiagnosticsController(service: self.service)) })
            ]])
        case .about:
            let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? ""
            setRows([[NativeBusinessRow(title: "易可聊", detail: "版本 \(version)")], [
                NativeBusinessRow(title: "用户协议", action: { [weak self] in self?.push(LegalViewController(document: "agreement")) }),
                NativeBusinessRow(title: "隐私政策", action: { [weak self] in self?.push(LegalViewController(document: "privacy")) })
            ]])
        }
    }
    private func renderPrivacy() {
        guard let privacy = privacy else { return }
        setRows([[
            NativeBusinessRow(title: "加我为好友需验证", checked: privacy.requireFriendApproval, toggle: { [weak self] value in self?.savePrivacy(friend: value, group: privacy.requireGroupApproval) }),
            NativeBusinessRow(title: "邀请我加入群聊需验证", checked: privacy.requireGroupApproval, toggle: { [weak self] value in self?.savePrivacy(friend: privacy.requireFriendApproval, group: value) })
        ], [NativeBusinessRow(title: "黑名单", action: { [weak self] in guard let self = self else { return }; self.push(NativeSettingsController(context: self.context, service: self.service, kind: .blocked)) })]])
    }
    private func savePrivacy(friend: Bool, group: Bool) {
        perform { [self] in
            do { privacy = try await context.request("me/privacy-settings", method: "POST", body: ["requireFriendApproval": .bool(friend), "requireGroupApproval": .bool(group)]); renderPrivacy() }
            catch { renderPrivacy(); throw error }
        }
    }
    private func changePassword() {
        if context.profile.hasPassword {
            edit(title: "验证旧密码", secure: true) { [weak self] old in
                guard let self = self else { return }; try await self.context.change("me/password/verify", body: ["oldPassword": .string(old)])
                // 旧密码只留在本次闭包，不持久化。
                self.edit(title: "设置新密码", secure: true) { [weak self] password in try await self?.savePassword(password, old: old) }
            }
        } else { edit(title: "设置密码", secure: true) { [weak self] password in try await self?.savePassword(password, old: nil) } }
    }
    private func savePassword(_ password: String, old: String?) async throws {
        guard password.count >= 6 else { throw APIError.business(code: -1, message: "密码至少需要 6 位。") }
        var body: [String: JSONValue] = ["password": .string(password)]; if let old = old { body["oldPassword"] = .string(old) }
        try await context.change("me/password", method: "PUT", body: body); try await context.refreshProfile(); showNativeNotice("密码已更新。")
    }
    private func openFeedback() {
        push(NativeEvidenceFormController(context: context, mode: .feedback, title: "意见反馈"))
    }
    private func clearAllHistory() {
        confirm("聊天记录将从你的所有设备中删除，不会影响其他人的聊天记录。", destructiveTitle: "清除") { [weak self] in
            guard let self = self else { return }; self.perform { let conversations = try await self.service.loadAllConversations(); for conversation in conversations { try await self.service.clearHistory(conversation) }; self.showNativeNotice("已清除聊天记录。") }
        }
    }
}

@MainActor
private final class NativeNotificationSettingCell: UITableViewCell {
    private let label = UILabel(); private let control = NativeNotificationToggle(); private let arrow = UIImageView(image: NativeUITheme.image("uni_mine_icon_chevron")); private var inset: CGFloat = 40
    override init(style: UITableViewCell.CellStyle, reuseIdentifier: String?) { super.init(style: .default, reuseIdentifier: reuseIdentifier); contentView.addSubview(label); contentView.addSubview(control); contentView.addSubview(arrow); arrow.contentMode = .scaleAspectFit; backgroundColor = .white; selectionStyle = .none; label.textColor = UIColor(hex: 0x111111) }
    required init?(coder: NSCoder) { fatalError("不使用 Storyboard") }
    func configure(_ row: NativeBusinessRow, inset: CGFloat, showsArrow: Bool) { self.inset = inset; label.text = row.title; control.value = row.checked ?? false; control.isHidden = row.toggle == nil; arrow.isHidden = row.toggle != nil || row.action == nil || !showsArrow; control.accessibilityLabel = row.title; control.change = { [weak self] value in self?.control.value = row.checked ?? false; row.toggle?(value) }; selectionStyle = row.action == nil ? .none : .default; setNeedsLayout() }
    override func layoutSubviews() { super.layoutSubviews(); let r = bounds.width / 750; label.font = .systemFont(ofSize: 30 * r); label.frame = CGRect(x: inset * r, y: 0, width: bounds.width - (inset + 128) * r, height: contentView.bounds.height); control.frame = CGRect(x: bounds.width - (inset + 72) * r, y: 0, width: 88 * r, height: contentView.bounds.height); arrow.frame = CGRect(x: bounds.width - (inset + 40) * r, y: (bounds.height - 40 * r) / 2, width: 40 * r, height: 40 * r) }
    override func prepareForReuse() { super.prepareForReuse(); control.change = nil }
}

@MainActor
private final class NativeNotificationToggle: UIControl {
    var value = false { didSet { accessibilityValue = value ? "开启" : "关闭"; setNeedsLayout() } }
    var change: ((Bool) -> Void)?
    private let track = UIView(); private let dot = UIView()
    override init(frame: CGRect) { super.init(frame: frame); addSubview(track); track.addSubview(dot); dot.backgroundColor = .white; isAccessibilityElement = true; accessibilityTraits = .button; addTarget(self, action: #selector(toggle), for: .touchUpInside) }
    required init?(coder: NSCoder) { fatalError("不使用 Storyboard") }
    override func layoutSubviews() { super.layoutSubviews(); let r = bounds.width / 88; track.frame = CGRect(x: 16 * r, y: (bounds.height - 36 * r) / 2, width: 56 * r, height: 36 * r); track.layer.cornerRadius = 18 * r; track.backgroundColor = UIColor(hex: value ? 0x153dcc : 0xe1e5ed); dot.frame = CGRect(x: (value ? 24 : 4) * r, y: 4 * r, width: 28 * r, height: 28 * r); dot.layer.cornerRadius = 14 * r }
    @objc private func toggle() { change?(!value) }
}

@MainActor
final class NativeSecurityController: UIViewController {
    private let context: NativeBusinessContext; private var step: Int
    private let scroll = UIScrollView(); private let phoneLabel = UILabel(); private let phoneValue = UILabel(); private let divider = UIView(); private let heading = UILabel(); private let oldLabel = UILabel()
    private let first = UITextField(); private let second = UITextField(); private let button = UIButton(type: .system)
    private var oldPassword: String?; private var task: Task<Void, Never>?
    init(context: NativeBusinessContext) { self.context = context; step = context.profile.hasPassword ? 0 : 1; super.init(nibName: nil, bundle: nil); title = step == 0 ? "安全" : "重置密码" }
    required init?(coder: NSCoder) { fatalError("不使用 Storyboard") }
    override func viewDidLoad() {
        super.viewDidLoad(); view.backgroundColor = .white; scroll.keyboardDismissMode = .interactive; view.addSubview(scroll)
        phoneLabel.text = "手机号码"; phoneValue.text = context.profile.countryCode.replacingOccurrences(of: "+", with: "") + " " + context.profile.phoneMasked; phoneValue.textColor = NativeUITheme.secondary; divider.backgroundColor = UIColor(hex: 0xe1e3ea); heading.text = "修改密码"; oldLabel.text = "旧密码"
        [phoneLabel, phoneValue, divider, heading, oldLabel, first, second].forEach { scroll.addSubview($0) }; view.addSubview(button)
        for field in [first, second] { field.isSecureTextEntry = true; field.autocapitalizationType = .none; field.autocorrectionType = .no; field.layer.borderColor = UIColor(hex: 0xe1e3ea).cgColor; field.layer.borderWidth = 0.5; field.leftViewMode = .always; field.rightViewMode = .always; let eye = NativeUITheme.imageButton("uni_auth_eye_off", accessibility: "显示密码"); eye.frame = CGRect(x: 0, y: 0, width: 44, height: 44); eye.addAction(UIAction { [weak field, weak eye] _ in guard let field = field else { return }; field.isSecureTextEntry.toggle(); eye?.setImage(NativeUITheme.image(field.isSecureTextEntry ? "uni_auth_eye_off" : "uni_auth_eye"), for: .normal) }, for: .touchUpInside); field.rightView = eye; field.addTarget(self, action: #selector(changed), for: .editingChanged) }
        button.setTitleColor(.white, for: .normal); button.addTarget(self, action: #selector(save), for: .touchUpInside)
        navigationItem.leftBarButtonItem = UIBarButtonItem(image: NativeUITheme.image("uni_icon_back"), style: .plain, target: self, action: #selector(back)); configure()
    }
    override func viewWillAppear(_ animated: Bool) { super.viewWillAppear(animated); navigationController?.setNavigationBarHidden(false, animated: animated) }
    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews(); let r = view.bounds.width / 750, left = 40 * r, width = view.bounds.width - 80 * r, top = view.safeAreaInsets.top
        let keyboard = view.keyboardLayoutGuide.layoutFrame.minY; let bottom = min(view.bounds.height - view.safeAreaInsets.bottom, keyboard)
        scroll.frame = CGRect(x: 0, y: top, width: view.bounds.width, height: max(0, bottom - top - 152 * r)); button.frame = CGRect(x: left, y: bottom - 128 * r, width: width, height: 96 * r); button.layer.cornerRadius = (step == 0 ? 8 : 16) * r; button.titleLabel?.font = .systemFont(ofSize: (step == 0 ? 28 : 34) * r, weight: .semibold)
        phoneLabel.frame = CGRect(x: left, y: 16 * r, width: width, height: 48 * r); phoneValue.frame = CGRect(x: left, y: 80 * r, width: width, height: 48 * r); divider.frame = CGRect(x: left, y: 160 * r, width: width, height: max(0.5, r)); heading.frame = CGRect(x: left, y: 193 * r, width: width, height: 48 * r); oldLabel.frame = CGRect(x: left, y: 257 * r, width: width, height: 48 * r)
        for label in [phoneLabel, phoneValue, oldLabel] { label.font = .systemFont(ofSize: 28 * r) }; heading.font = .boldSystemFont(ofSize: 32 * r)
        first.frame = CGRect(x: left, y: (step == 0 ? 321 : 32) * r, width: width, height: 96 * r); second.frame = CGRect(x: left, y: first.frame.maxY + 24 * r, width: width, height: 96 * r)
        for field in [first, second] { field.font = .systemFont(ofSize: (step == 0 ? 32 : 34) * r); field.layer.cornerRadius = (step == 0 ? 8 : 12) * r; field.leftView = UIView(frame: CGRect(x: 0, y: 0, width: 24 * r, height: 1)) }; scroll.contentSize = CGSize(width: view.bounds.width, height: (step == 0 ? first : second).frame.maxY + 48 * r)
    }
    private func configure() {
        title = step == 0 ? "安全" : "重置密码"; [phoneLabel, phoneValue, divider, heading, oldLabel].forEach { $0.isHidden = step != 0 }; second.isHidden = step == 0
        first.placeholder = step == 0 ? "请输入旧密码" : "请输入新密码"; second.placeholder = "请再次输入新密码"; first.textContentType = step == 0 ? .password : .newPassword; second.textContentType = .newPassword; button.setTitle(step == 0 ? "下一步" : "確認", for: .normal); changed(); view.setNeedsLayout()
    }
    @objc private func changed() { let text = first.text ?? ""; let valid = step == 0 ? !text.isEmpty : text.count >= 6 && text == second.text; button.isEnabled = valid && task == nil; button.backgroundColor = UIColor(hex: valid ? 0x0a2fc2 : 0xe1e4ea) }
    @objc private func back() { guard task == nil else { return }; if step == 1, context.profile.hasPassword { oldPassword = nil; step = 0; first.text = ""; second.text = ""; configure() } else { navigationController?.popViewController(animated: true) } }
    @objc private func save() {
        guard task == nil, button.isEnabled else { return }; let value = first.text ?? ""; button.isEnabled = false
        task = Task { defer { task = nil; changed() }; do {
            if step == 0 { try await context.change("me/password/verify", body: ["oldPassword": .string(value)]); try Task.checkCancellation(); guard navigationController?.topViewController === self else { return }; oldPassword = value; first.text = ""; second.text = ""; step = 1; configure() }
            else { guard value.count >= 6, value == second.text else { return }; var body: [String: JSONValue] = ["password": .string(value)]; if let old = oldPassword { body["oldPassword"] = .string(old) }; try await context.change("me/password", method: "PUT", body: body); try await context.refreshProfile(); try Task.checkCancellation(); oldPassword = nil; first.text = ""; second.text = ""; step = 0; configure(); showNativeNotice("密码已更新。") }
        } catch { if !Task.isCancelled, navigationController?.topViewController === self { showNativeNotice(error.localizedDescription) } } }
    }
    override func viewWillDisappear(_ animated: Bool) { super.viewWillDisappear(animated); if isMovingFromParent || isBeingDismissed { task?.cancel(); oldPassword = nil; first.text = ""; second.text = "" } }
}

@MainActor
final class NativeAboutController: UIViewController {
    private struct Distribution: Decodable { let schemaVersion: Int; let ios: NativeDistributionLinks? }
    private let context: NativeBusinessContext; private let logo = UIImageView(image: NativeUITheme.image("uni_logo")); private let name = UILabel(); private let version = UILabel(); private let check = UIButton(type: .system); private let agreement = UIButton(type: .system); private let privacy = UIButton(type: .system); private var task: Task<Void, Never>?
    init(context: NativeBusinessContext) { self.context = context; super.init(nibName: nil, bundle: nil); title = "关于我们" }
    required init?(coder: NSCoder) { fatalError("不使用 Storyboard") }
    override func viewDidLoad() { super.viewDidLoad(); view.backgroundColor = .white; name.text = "易可聊"; version.text = "v" + (Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? ""); version.textColor = UIColor(hex: 0x3a4558); check.setTitle("检查更新", for: .normal); check.setTitleColor(.white, for: .normal); check.backgroundColor = UIColor(hex: 0x0a2fc2); check.addTarget(self, action: #selector(checkUpdate), for: .touchUpInside); agreement.setTitle("用户协议", for: .normal); privacy.setTitle("隐私政策", for: .normal); agreement.addAction(UIAction { [weak self] _ in self?.navigationController?.pushViewController(LegalViewController(document: "agreement"), animated: true) }, for: .touchUpInside); privacy.addAction(UIAction { [weak self] _ in self?.navigationController?.pushViewController(LegalViewController(document: "privacy"), animated: true) }, for: .touchUpInside); [logo, name, version, check, agreement, privacy].forEach { view.addSubview($0) }; name.textAlignment = .center; version.textAlignment = .center; logo.clipsToBounds = true; logo.contentMode = .scaleAspectFit }
    override func viewDidLayoutSubviews() { super.viewDidLayoutSubviews(); let r = view.bounds.width / 750, center = view.bounds.midX, top = view.safeAreaInsets.top + 160 * r; logo.frame = CGRect(x: center - 80 * r, y: top, width: 160 * r, height: 160 * r); logo.layer.cornerRadius = 28 * r; name.frame = CGRect(x: 20, y: logo.frame.maxY + 32 * r, width: view.bounds.width - 40, height: 52 * r); name.font = .boldSystemFont(ofSize: 36 * r); version.frame = CGRect(x: 20, y: name.frame.maxY + 12 * r, width: view.bounds.width - 40, height: 40 * r); version.font = .systemFont(ofSize: 26 * r); check.frame = CGRect(x: center - 120 * r, y: version.frame.maxY + 48 * r, width: 240 * r, height: 80 * r); check.layer.cornerRadius = 12 * r; check.titleLabel?.font = .systemFont(ofSize: 28 * r, weight: .semibold); agreement.frame = CGRect(x: center - 180 * r, y: check.frame.maxY + 40 * r, width: 164 * r, height: 44 * r); privacy.frame = CGRect(x: center + 16 * r, y: agreement.frame.minY, width: 164 * r, height: 44 * r); [agreement, privacy].forEach { $0.titleLabel?.font = .systemFont(ofSize: 28 * r); $0.setTitleColor(UIColor(hex: 0x0a2fc2), for: .normal) } }
    override func viewWillAppear(_ animated: Bool) { super.viewWillAppear(animated); navigationController?.setNavigationBarHidden(false, animated: animated) }
    @objc private func checkUpdate() {
        guard task == nil else { return }; check.isEnabled = false; check.setTitle("检查中...", for: .normal)
        task = Task { defer { task = nil; check.isEnabled = true; check.setTitle("检查更新", for: .normal) }; do {
            let info = Bundle.main.infoDictionary ?? [:]
            let configured: (String) -> String = { key in let value = (info[key] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines); return value.hasPrefix("$(") ? "" : value }
            var links = NativeDistributionLinks(testFlightURL: configured("NativeTestFlightURL"), appStoreURL: configured("NativeAppStoreURL"))
            let rawManifest = configured("NativeUpdateManifestURL")
            if !rawManifest.isEmpty {
                guard let parts = URLComponents(string: rawManifest), parts.scheme?.lowercased() == "https", parts.host != nil, parts.user == nil, parts.password == nil, let url = parts.url else { throw APIError.invalidConfiguration }
                let file = try await NativeBoundedDownload(limit: 64 * 1024).download(url); defer { try? FileManager.default.removeItem(at: file) }
                let manifest = try JSONDecoder().decode(Distribution.self, from: Data(contentsOf: file))
                guard manifest.schemaVersion == 1 else { throw APIError.invalidResponse }
                if let remote = manifest.ios { links = NativeDistributionLinks(testFlightURL: links.testFlight?.absoluteString ?? remote.testFlightURL, appStoreURL: links.appStore?.absoluteString ?? remote.appStoreURL) }
            }
            try Task.checkCancellation(); guard navigationController?.topViewController === self else { return }
            guard links.testFlight != nil || links.appStore != nil else { showNativeNotice("原生版更新入口尚未配置，请联系管理员开通 TestFlight 或 App Store 分发。"); return }
            let sheet = UIAlertController(title: "更新应用", message: "在 TestFlight 或 App Store 中安装新版本，可在对应应用中开启自动更新。", preferredStyle: .actionSheet)
            if let url = links.testFlight { sheet.addAction(UIAlertAction(title: "打开 TestFlight", style: .default) { _ in UIApplication.shared.open(url) }) }
            if let url = links.appStore { sheet.addAction(UIAlertAction(title: "打开 App Store", style: .default) { _ in UIApplication.shared.open(url) }) }
            sheet.addAction(UIAlertAction(title: "取消", style: .cancel)); sheet.popoverPresentationController?.sourceView = check; present(sheet, animated: true)
        } catch { if !Task.isCancelled { showNativeNotice(error.localizedDescription) } } }
    }
    override func viewWillDisappear(_ animated: Bool) { super.viewWillDisappear(animated); if isMovingFromParent { task?.cancel() } }
}

@MainActor
final class NativeFavoritesController: NativeBusinessListController {
    private var items: [NativeFavorites] = []; private var page = 1; private var type = 0
    private let service: NativeIMService?; private var grouped: [[NativeFavorites]] = []
    private let onSelected: ((NativeFavorites) -> Void)?
    init(context: NativeBusinessContext, service: NativeIMService? = nil, onSelected: ((NativeFavorites) -> Void)? = nil) { self.service = service; self.onSelected = onSelected; super.init(title: onSelected == nil ? "我的收藏" : "选择收藏", context: context) }
    required init?(coder: NSCoder) { fatalError("不使用 Storyboard") }
    override func viewDidLoad() {
        super.viewDidLoad(); tableView.backgroundColor = .white; tableView.register(NativeFavoriteCardCell.self, forCellReuseIdentifier: "favorite-card"); let filter = UISegmentedControl(items: ["全部", "文字", "图片与视频", "文件", "语音"]); filter.selectedSegmentIndex = 0
        filter.addTarget(self, action: #selector(filterChanged(_:)), for: .valueChanged); filter.frame = CGRect(x: 16, y: 8, width: view.bounds.width - 32, height: 36)
        let header = UIView(frame: CGRect(x: 0, y: 0, width: view.bounds.width, height: 52)); header.addSubview(filter); tableView.tableHeaderView = header
    }
    override func reloadContent() { page = 1; load(reset: true) }
    @objc private func filterChanged(_ sender: UISegmentedControl) { type = sender.selectedSegmentIndex; reloadContent() }
    private func load(reset: Bool) {
        perform { [self] in
            let requestedPage = reset ? 1 : page
            let batch: [NativeFavorites] = try await context.request("favorites/list", method: "POST", body: ["type": .number(Double(type)), "page": .number(Double(requestedPage)), "size": .number(20)])
            page = requestedPage + 1
            if reset { items = [] }; items += batch
            var keys: [String] = []; var groups: [String: [NativeFavorites]] = [:]
            for item in items { let key = item.conversationId + "|" + String(item.createdAt.prefix(10)); if groups[key] == nil { keys.append(key) }; groups[key, default: []].append(item) }
            grouped = keys.compactMap { groups[$0] }
            var rows = grouped.map { values in values.map { item in NativeBusinessRow(title: item.type == "text" || item.type == "emoji" ? item.content : ["image": "图片", "video": "视频", "voice": "语音", "file": "文件"][item.type] ?? "收藏", detail: item.createdAt, action: { [weak self] in self?.open(item) }) } }
            let titles = grouped.map { values -> String in guard let item = values.first else { return "" }; return (service?.conversations.first(where: { $0.id == item.conversationId })?.title ?? "聊天收藏") + " · " + String(item.createdAt.prefix(10)) }
            if batch.count == 20 { rows.append([NativeBusinessRow(title: "加载更多", action: { [weak self] in self?.load(reset: false) })]) }
            setRows(rows, titles: titles)
        }
    }
    override func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        guard grouped.indices.contains(indexPath.section), grouped[indexPath.section].indices.contains(indexPath.row) else { return super.tableView(tableView, cellForRowAt: indexPath) }
        let item = grouped[indexPath.section][indexPath.row], cell = tableView.dequeueReusableCell(withIdentifier: "favorite-card", for: indexPath) as! NativeFavoriteCardCell
        cell.configure(item, policy: context.media) { [weak self] in self?.open(item) }; return cell
    }
    override func tableView(_ tableView: UITableView, heightForRowAt indexPath: IndexPath) -> CGFloat {
        guard grouped.indices.contains(indexPath.section), grouped[indexPath.section].indices.contains(indexPath.row) else { return super.tableView(tableView, heightForRowAt: indexPath) }; let item = grouped[indexPath.section][indexPath.row]
        return NativeUITheme.rpx(["image", "video"].contains(item.type) ? 320 : 176, width: view.bounds.width)
    }
    private func open(_ item: NativeFavorites) {
        if let selected = onSelected { navigationController?.popViewController(animated: true); selected(item); return }
        let sheet = UIAlertController(title: "收藏", message: item.type == "text" ? item.content : nil, preferredStyle: .actionSheet)
        if let service = service { sheet.addAction(UIAlertAction(title: "转发", style: .default) { [weak self] _ in guard let self = self else { return }; self.perform { let (source, message) = try await service.sourceForFavorite(item); self.push(NativeForwardPickerController(service: service, message: message, sourceConversation: source)) } }) }
        if ["text", "emoji"].contains(item.type) { sheet.addAction(UIAlertAction(title: "复制", style: .default) { _ in UIPasteboard.general.string = item.content }) }
        let parsed = FavoriteContent(type: item.type, content: item.content)
        if item.type == "image", !parsed.url.isEmpty {
            sheet.addAction(UIAlertAction(title: "查看图片", style: .default) { [weak self] _ in guard let self = self else { return }; self.push(NativeImagePreviewController(url: parsed.url, policy: self.context.media, allImages: self.items.filter { $0.type == "image" }.map { FavoriteContent(type: $0.type, content: $0.content).url })) })
        } else if ["voice", "video", "file"].contains(item.type), !parsed.url.isEmpty {
            sheet.addAction(UIAlertAction(title: item.type == "file" ? "打开文件" : "播放", style: .default) { [weak self] _ in
                guard let self = self, let url = self.context.media.absolute(item.type == "video" ? self.context.media.playback(parsed.url) : parsed.url), url.scheme == "https" else { return }
                if item.type == "file" { self.push(NativeFilePreviewController(url: url, filename: parsed.filename.isEmpty ? "文件" : parsed.filename)) }
                else { let player = NativeVideoPreviewController(url: url, allowSave: item.type == "video"); self.push(player) }
            })
        }
        sheet.addAction(UIAlertAction(title: "删除收藏", style: .destructive) { [weak self] _ in guard let self = self else { return }; self.confirm("确定删除该收藏吗？", destructiveTitle: "删除") { self.perform { try await self.context.change("favorites/\(item.id)", method: "DELETE", body: nil); self.scheduleReload() } } })
        sheet.addAction(UIAlertAction(title: "取消", style: .cancel)); sheet.popoverPresentationController?.sourceView = tableView; present(sheet, animated: true)
    }
}

@MainActor
private final class NativeFavoriteCardCell: UITableViewCell {
    private let card = UIView(); private let preview = NativeRemoteImageView(); private let text = UILabel(); private let more = UIButton(type: .system); private var item: NativeFavorites?; private var action: (() -> Void)?
    override init(style: UITableViewCell.CellStyle, reuseIdentifier: String?) { super.init(style: .default, reuseIdentifier: reuseIdentifier); backgroundColor = .white; contentView.addSubview(card); [preview, text, more].forEach { card.addSubview($0) }; card.backgroundColor = UIColor(hex: 0xf3f4f7); preview.clipsToBounds = true; preview.contentMode = .scaleAspectFit; text.numberOfLines = 4; text.textColor = NativeUITheme.body; more.setTitle("⋮", for: .normal); more.setTitleColor(NativeUITheme.secondary, for: .normal); more.addTarget(self, action: #selector(menu), for: .touchUpInside); selectionStyle = .none }
    required init?(coder: NSCoder) { fatalError("不使用 Storyboard") }
    func configure(_ item: NativeFavorites, policy: MediaURLPolicy, action: @escaping () -> Void) { self.item = item; self.action = action; let parsed = FavoriteContent(type: item.type, content: item.content); preview.isHidden = !["image", "video"].contains(item.type); text.isHidden = !preview.isHidden; if !preview.isHidden { preview.load(item.type == "video" ? parsed.thumbnail : parsed.url, policy: policy, variant: .list) } else { preview.cancel() }; text.text = item.type == "voice" ? "语音 \(parsed.duration / 60):\(String(format: "%02d", parsed.duration % 60))" : item.type == "file" ? (parsed.filename.isEmpty ? "文件" : parsed.filename) : item.content; setNeedsLayout() }
    override func layoutSubviews() { super.layoutSubviews(); let r = bounds.width / 750; card.frame = CGRect(x: 32 * r, y: 4 * r, width: bounds.width - 64 * r, height: bounds.height - 28 * r); card.layer.cornerRadius = 16 * r; more.frame = CGRect(x: card.bounds.width - 64 * r, y: 12 * r, width: 56 * r, height: 64 * r); more.titleLabel?.font = .systemFont(ofSize: 36 * r); preview.frame = CGRect(x: 28 * r, y: 20 * r, width: card.bounds.width - 112 * r, height: card.bounds.height - 40 * r); text.frame = CGRect(x: 28 * r, y: 20 * r, width: card.bounds.width - 112 * r, height: card.bounds.height - 40 * r); text.font = .systemFont(ofSize: 30 * r) }
    @objc private func menu() { action?() }
    override func prepareForReuse() { super.prepareForReuse(); preview.cancel(); action = nil; item = nil }
}
