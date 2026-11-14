import UIKit
import IMCore

private struct NativeDeletionPreview: Decodable {
    struct Blocker: Decodable { let code: String; let message: String; let action: String; let groupId: String?; let groupName: String? }
    struct Summary: Decodable { let friendCount: Int; let groupCount: Int; let ownedGroupCount: Int; let favoriteCount: Int; let fileCount: Int }
    let canDelete: Bool; let blockers: [Blocker]; let summary: Summary; let confirmPhrase: String; let verificationMethod: String
}

@MainActor
final class NativeAccountDeletionController: NativeBusinessListController {
    private let service: NativeIMService; private var preview: NativeDeletionPreview?
    init(service: NativeIMService) { self.service = service; super.init(title: "注销账号", context: service.business) }
    required init?(coder: NSCoder) { fatalError("不使用 Storyboard") }
    override func reloadContent() {
        perform { [self] in
            let result: NativeDeletionPreview = try await context.request("me/deletion-preview"); preview = result
            let summary = result.summary
            var groups = [[NativeBusinessRow(title: "注销后账号及关联数据不可恢复"), NativeBusinessRow(title: "好友", detail: "\(summary.friendCount)"), NativeBusinessRow(title: "群聊", detail: "\(summary.groupCount)"), NativeBusinessRow(title: "收藏", detail: "\(summary.favoriteCount)"), NativeBusinessRow(title: "文件", detail: "\(summary.fileCount)")]]
            if !result.blockers.isEmpty { groups.append(result.blockers.map { blocker in NativeBusinessRow(title: blocker.groupName ?? "请先处理以下事项", detail: blocker.message, action: blocker.groupId == nil ? nil : { [weak self] in guard let self = self, let id = blocker.groupId else { return }; self.push(NativeGroupController(service: self.service, groupID: id)) }) }) }
            if result.canDelete, result.blockers.isEmpty { groups.append([NativeBusinessRow(title: "已了解，继续注销", destructive: true, action: { [weak self] in self?.continueDeletion() })]) }
            setRows(groups)
        }
    }
    private func continueDeletion() {
        guard let preview = preview, preview.canDelete, preview.blockers.isEmpty, !preview.confirmPhrase.isEmpty else { return }
        push(NativeDeletionVerifyController(service: service, confirmPhrase: preview.confirmPhrase))
    }
}

@MainActor
private final class NativeDeletionVerifyController: UIViewController {
    private let service: NativeIMService; private let phrase: String
    private let country = UITextField(); private let phone = UITextField(); private let code = UITextField(); private let acknowledge = UITextField(); private let sms = UIButton(type: .system); private let submit = UIButton(type: .system)
    private var smsTask: Task<Void, Never>?; private var deleteTask: Task<Void, Never>?; private var countdown: Task<Void, Never>?
    private var seconds = 0
    init(service: NativeIMService, confirmPhrase: String) { self.service = service; phrase = confirmPhrase; super.init(nibName: nil, bundle: nil); title = "验证并注销" }
    required init?(coder: NSCoder) { fatalError("不使用 Storyboard") }
    override func viewDidLoad() {
        super.viewDidLoad(); view.backgroundColor = UIColor(hex: 0xf5f6f8)
        let scroll = UIScrollView(); scroll.keyboardDismissMode = .interactive; scroll.translatesAutoresizingMaskIntoConstraints = false; view.addSubview(scroll)
        let stack = UIStackView(); stack.axis = .vertical; stack.spacing = 18; stack.translatesAutoresizingMaskIntoConstraints = false; scroll.addSubview(stack)
        NSLayoutConstraint.activate([scroll.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor), scroll.bottomAnchor.constraint(equalTo: view.keyboardLayoutGuide.topAnchor), scroll.leadingAnchor.constraint(equalTo: view.leadingAnchor), scroll.trailingAnchor.constraint(equalTo: view.trailingAnchor), stack.topAnchor.constraint(equalTo: scroll.contentLayoutGuide.topAnchor, constant: 24), stack.leadingAnchor.constraint(equalTo: scroll.contentLayoutGuide.leadingAnchor, constant: 20), stack.trailingAnchor.constraint(equalTo: scroll.contentLayoutGuide.trailingAnchor, constant: -20), stack.bottomAnchor.constraint(equalTo: scroll.contentLayoutGuide.bottomAnchor, constant: -24), stack.widthAnchor.constraint(equalTo: scroll.frameLayoutGuide.widthAnchor, constant: -40)])
        let notice = NativeUITheme.label("此操作不可恢复。请验证绑定手机号，并输入确认文字。", size: 16); notice.numberOfLines = 0; stack.addArrangedSubview(notice)
        country.text = service.business.profile.countryCode.isEmpty ? "+86" : service.business.profile.countryCode; country.placeholder = "国家区号"; country.keyboardType = .phonePad
        phone.placeholder = "请输入完整的绑定手机号"; phone.keyboardType = .phonePad; phone.textContentType = .telephoneNumber
        code.placeholder = "短信验证码"; code.keyboardType = .numberPad; code.textContentType = .oneTimeCode
        acknowledge.placeholder = phrase; acknowledge.autocapitalizationType = .none; acknowledge.autocorrectionType = .no
        for field in [country, phone, code, acknowledge] { field.borderStyle = .roundedRect; field.backgroundColor = .white; field.heightAnchor.constraint(equalToConstant: 48).isActive = true; stack.addArrangedSubview(field) }
        sms.setTitle("发送验证码", for: .normal); sms.addTarget(self, action: #selector(sendSMS), for: .touchUpInside); stack.addArrangedSubview(sms)
        submit.setTitle("永久注销账号", for: .normal); submit.setTitleColor(.white, for: .normal); submit.backgroundColor = .systemRed; submit.layer.cornerRadius = 6; submit.heightAnchor.constraint(equalToConstant: 48).isActive = true; submit.addTarget(self, action: #selector(confirmDeletion), for: .touchUpInside); stack.addArrangedSubview(submit)
        let label = NativeUITheme.label("需要输入：\(phrase)", size: 13, color: NativeUITheme.secondary); label.numberOfLines = 0; stack.addArrangedSubview(label)
    }
    private func fields() throws -> (String, String) {
        let number = (phone.text ?? "").trimmingCharacters(in: .whitespacesAndNewlines), region = (country.text ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard number.range(of: "^[0-9]{6,20}$", options: .regularExpression) != nil, region.range(of: "^\\+?[0-9]{1,5}$", options: .regularExpression) != nil else { throw APIError.business(code: -1, message: "请输入完整手机号和国家区号。") }; return (number, region)
    }
    @objc private func sendSMS() {
        guard smsTask == nil, seconds == 0, deleteTask == nil else { return }
        do {
            let (number, region) = try fields(); sms.isEnabled = false
            smsTask = Task { defer { smsTask = nil; sms.isEnabled = seconds == 0 }; do {
                try await service.business.change("auth/sms/send", body: ["phone": .string(number), "countryCode": .string(region), "deviceId": .string(UIDevice.current.identifierForVendor?.uuidString ?? "ios-native"), "scene": .string("delete_account")]); try Task.checkCancellation(); seconds = 60; startCountdown()
            } catch { if !Task.isCancelled { showNativeNotice(error.localizedDescription) } } }
        } catch { showNativeNotice(error.localizedDescription) }
    }
    private func startCountdown() {
        countdown?.cancel(); countdown = Task {
            while seconds > 0 { sms.setTitle("\(seconds) 秒后重新发送", for: .normal); do { try await Task.sleep(nanoseconds: 1_000_000_000) } catch { return }; seconds -= 1 }
            sms.setTitle("发送验证码", for: .normal); sms.isEnabled = true
        }
    }
    @objc private func confirmDeletion() {
        guard deleteTask == nil else { return }
        do {
            let (number, region) = try fields(); let value = (code.text ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            guard !value.isEmpty, acknowledge.text == phrase else { throw APIError.business(code: -1, message: "请填写验证码并完整输入确认文字。") }
            let alert = UIAlertController(title: "最后确认", message: "账号、好友关系、收藏及关联数据将永久删除。此操作不能撤销。", preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: "取消", style: .cancel)); alert.addAction(UIAlertAction(title: "确认永久注销", style: .destructive) { [weak self] _ in self?.delete(number: number, region: region, code: value) }); present(alert, animated: true)
        } catch { showNativeNotice(error.localizedDescription) }
    }
    private func delete(number: String, region: String, code: String) {
        guard deleteTask == nil else { return }; submit.isEnabled = false; sms.isEnabled = false
        deleteTask = Task {
            defer { deleteTask = nil; submit.isEnabled = true; sms.isEnabled = seconds == 0 }
            do {
                struct Result: Decodable { let ok: Bool; let deletedAt: String; let recordId: String; let imCleanup: String }
                let result: Result = try await service.business.request("me/account/delete", method: "POST", body: ["phone": .string(number), "countryCode": .string(region), "code": .string(code), "acknowledge": .string(phrase)])
                guard result.ok else { throw APIError.invalidResponse }
                // 服务端账号已删除：只清理本机认证并停止SDK，不再调用任何注销后的业务接口。
                var message = "账号已注销。"; if result.imCleanup == "failed" { message += "聊天服务清理仍待处理，记录号：\(result.recordId)。" }
                do { try await service.finishAccountDeletion() } catch { message += "本机登录凭据清理失败，请在重新登录前处理：" + error.localizedDescription }
                let root = navigationController?.viewControllers.first; navigationController?.popToRootViewController(animated: true)
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { root?.showNativeNotice(message) }
            } catch { if !Task.isCancelled { showNativeNotice(error.localizedDescription) } }
        }
    }
    override func viewDidDisappear(_ animated: Bool) {
        super.viewDidDisappear(animated)
        if navigationController?.viewControllers.contains(where: { $0 === self }) != true { smsTask?.cancel(); countdown?.cancel() }
        // 已明确确认的不可逆请求继续等待结果，不能因离栈直接伪装取消成功。
    }
}
