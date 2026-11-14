import UIKit
import IMCore

struct NativeBusinessRow {
    var title: String
    var detail = ""
    var icon: String? = nil
    var avatar: String? = nil
    var destructive = false
    var checked: Bool? = nil
    var toggle: ((Bool) -> Void)? = nil
    var action: (() -> Void)? = nil
}

@MainActor
class NativeBusinessListController: UITableViewController {
    let context: NativeBusinessContext
    var sections: [[NativeBusinessRow]] = []
    var sectionTitles: [String] = []
    private let spinner = UIActivityIndicatorView(style: .medium)
    private var workTask: Task<Void, Never>?
    private(set) var working = false
    init(title: String, context: NativeBusinessContext, style: UITableView.Style = .grouped) { self.context = context; super.init(style: style); self.title = title }
    required init?(coder: NSCoder) { fatalError("不使用 Storyboard") }
    override func viewDidLoad() {
        super.viewDidLoad(); tableView.backgroundColor = UIColor(hex: 0xf5f6f8)
        tableView.rowHeight = UITableView.automaticDimension; tableView.estimatedRowHeight = 52
        tableView.separatorStyle = .none
        tableView.sectionHeaderTopPadding = 0
        tableView.register(NativeBusinessCell.self, forCellReuseIdentifier: "original-business-row")
        tableView.keyboardDismissMode = .onDrag
        refreshControl = UIRefreshControl(); refreshControl?.addTarget(self, action: #selector(reloadFromPull), for: .valueChanged)
        tableView.backgroundView = spinner
    }
    override func viewWillAppear(_ animated: Bool) { super.viewWillAppear(animated); if !(parent is SampleMainViewController) { navigationController?.setNavigationBarHidden(false, animated: animated) }; reloadContent() }
    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        if isMovingFromParent || isBeingDismissed || navigationController?.isBeingDismissed == true { workTask?.cancel() }
    }
    func reloadContent() {}
    func scheduleReload() { DispatchQueue.main.async { [weak self] in self?.reloadContent() } }
    @objc private func reloadFromPull() { reloadContent() }
    func setRows(_ sections: [[NativeBusinessRow]], titles: [String] = []) {
        self.sections = sections; sectionTitles = titles; tableView.reloadData()
    }
    func perform(_ work: @escaping () async throws -> Void) {
        guard !working else { return }; working = true; spinner.startAnimating()
        workTask = Task { [weak self] in
            guard let self = self else { return }
            defer { self.workTask = nil; self.working = false; self.spinner.stopAnimating(); self.refreshControl?.endRefreshing() }
            do { try Task.checkCancellation(); try await work() } catch { if !Task.isCancelled, self.view.window != nil { self.showNativeNotice(error.localizedDescription) } }
        }
    }
    func push(_ controller: UIViewController) { navigationController?.pushViewController(controller, animated: true) }
    func confirm(_ message: String, destructiveTitle: String, action: @escaping () -> Void) {
        let dialog = UIAlertController(title: "请确认", message: message, preferredStyle: .alert)
        dialog.addAction(UIAlertAction(title: "取消", style: .cancel)); dialog.addAction(UIAlertAction(title: destructiveTitle, style: .destructive) { _ in action() }); present(dialog, animated: true)
    }
    func edit(title: String, value: String = "", placeholder: String? = nil, secure: Bool = false, submit: @escaping (String) async throws -> Void) {
        push(NativeFieldEditorController(title: title, value: value, placeholder: placeholder, secure: secure) { [weak self] text in
            try await submit(text)
            self?.scheduleReload()
        })
    }
    override func numberOfSections(in tableView: UITableView) -> Int { sections.count }
    override func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int { sections[section].count }
    override func tableView(_ tableView: UITableView, titleForHeaderInSection section: Int) -> String? { section < sectionTitles.count ? sectionTitles[section] : nil }
    override func tableView(_ tableView: UITableView, heightForRowAt indexPath: IndexPath) -> CGFloat {
        let r = view.bounds.width / 750
        let row = sections[indexPath.section][indexPath.row]
        return (row.avatar == nil ? 96 : 128) * r
    }
    override func tableView(_ tableView: UITableView, heightForHeaderInSection section: Int) -> CGFloat {
        let title = section < sectionTitles.count ? sectionTitles[section] : ""
        return title.isEmpty ? (section == 0 ? 0.01 : NativeUITheme.rpx(16, width: view.bounds.width)) : NativeUITheme.rpx(80, width: view.bounds.width)
    }
    override func tableView(_ tableView: UITableView, heightForFooterInSection section: Int) -> CGFloat { 0.01 }
    override func tableView(_ tableView: UITableView, viewForHeaderInSection section: Int) -> UIView? {
        let title = section < sectionTitles.count ? sectionTitles[section] : ""
        guard !title.isEmpty else { return nil }
        let holder = UIView(); holder.backgroundColor = UIColor(hex: 0xf5f6f8)
        let label = NativeUITheme.label(title, size: NativeUITheme.rpx(26, width: view.bounds.width), color: NativeUITheme.secondary)
        label.translatesAutoresizingMaskIntoConstraints = false; holder.addSubview(label)
        NSLayoutConstraint.activate([label.leadingAnchor.constraint(equalTo: holder.leadingAnchor, constant: NativeUITheme.rpx(32, width: view.bounds.width)), label.trailingAnchor.constraint(lessThanOrEqualTo: holder.trailingAnchor, constant: -16), label.centerYAnchor.constraint(equalTo: holder.centerYAnchor)])
        return holder
    }
    override func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        let row = sections[indexPath.section][indexPath.row]
        let cell = tableView.dequeueReusableCell(withIdentifier: "original-business-row", for: indexPath) as! NativeBusinessCell
        cell.configure(row, policy: context.media)
        return cell
    }
    override func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) { tableView.deselectRow(at: indexPath, animated: true); sections[indexPath.section][indexPath.row].action?() }
}

/// 保留原 ImSwitch 的 56×36rpx 轨道和 28rpx 圆点，触摸区域扩大但不改变视觉尺寸。
private final class NativeParityToggle: UIControl {
    private let track = UIView(); private let dot = UIView()
    var value = false { didSet { setNeedsLayout(); accessibilityValue = value ? "开启" : "关闭" } }
    var change: ((Bool) -> Void)?
    override init(frame: CGRect) {
        super.init(frame: frame); isAccessibilityElement = true; accessibilityTraits = .button
        addSubview(track); track.addSubview(dot); dot.backgroundColor = .white
        addTarget(self, action: #selector(toggle), for: .touchUpInside)
    }
    required init?(coder: NSCoder) { fatalError("不使用 Storyboard") }
    override func layoutSubviews() {
        super.layoutSubviews(); let r = bounds.width / 88
        track.frame = CGRect(x: 16 * r, y: (bounds.height - 36 * r) / 2, width: 56 * r, height: 36 * r)
        track.layer.cornerRadius = 18 * r; track.backgroundColor = UIColor(hex: value ? 0x153dcc : 0xe1e5ed)
        dot.frame = CGRect(x: (value ? 24 : 4) * r, y: 4 * r, width: 28 * r, height: 28 * r); dot.layer.cornerRadius = 14 * r
    }
    @objc private func toggle() { value.toggle(); change?(value) }
}

private final class NativeBusinessCell: UITableViewCell {
    private let name = UILabel(); private let valueLabel = UILabel(); private let icon = UIImageView()
    private let avatar = NativeRemoteImageView(); private let arrow = UIImageView(image: NativeUITheme.image("uni_mine_icon_chevron"))
    private let check = UILabel(); private let control = NativeParityToggle(); private let line = UIView()
    private var represented: NativeBusinessRow?
    override init(style: UITableViewCell.CellStyle, reuseIdentifier: String?) {
        super.init(style: .default, reuseIdentifier: reuseIdentifier)
        [name, valueLabel, icon, avatar, arrow, check, control, line].forEach { contentView.addSubview($0) }
        icon.contentMode = .scaleAspectFit; avatar.contentMode = .scaleAspectFill; avatar.clipsToBounds = true
        arrow.contentMode = .scaleAspectFit; check.text = "✓"; check.textAlignment = .center; check.textColor = NativeUITheme.primary
        name.lineBreakMode = .byTruncatingTail; valueLabel.lineBreakMode = .byTruncatingTail; valueLabel.textColor = NativeUITheme.secondary
        line.backgroundColor = UIColor(hex: 0xf0f1f4); backgroundColor = .white
    }
    required init?(coder: NSCoder) { fatalError("不使用 Storyboard") }
    override func prepareForReuse() { super.prepareForReuse(); avatar.cancel(); control.change = nil; represented = nil }
    func configure(_ row: NativeBusinessRow, policy: MediaURLPolicy) {
        represented = row; name.text = row.title; valueLabel.text = row.detail
        name.textColor = row.destructive ? UIColor(hex: 0xdc2828) : UIColor(hex: 0x212121)
        icon.image = row.icon.flatMap(NativeUITheme.image); icon.isHidden = row.icon == nil
        avatar.isHidden = row.avatar == nil
        if let raw = row.avatar { avatar.load(raw, policy: policy) } else { avatar.cancel() }
        control.isHidden = row.toggle == nil; control.value = row.checked ?? false
        // 服务端确认并重载后再保留新值，失败时不能显示一个未保存的开关状态。
        control.change = { [weak self] next in self?.control.value = row.checked ?? false; row.toggle?(next) }
        control.accessibilityLabel = row.title
        check.isHidden = row.toggle != nil || row.checked != true
        arrow.isHidden = row.action == nil || row.toggle != nil || row.checked != nil
        selectionStyle = row.action == nil ? .none : .default; setNeedsLayout()
    }
    override func layoutSubviews() {
        super.layoutSubviews(); guard let row = represented else { return }
        let r = bounds.width / 750, height = contentView.bounds.height
        var left = 32 * r; var right = bounds.width - 32 * r
        if row.avatar != nil { avatar.frame = CGRect(x: left, y: (height - 88 * r) / 2, width: 88 * r, height: 88 * r); avatar.layer.cornerRadius = 44 * r; left += 112 * r }
        else if row.icon != nil { icon.frame = CGRect(x: left, y: (height - 40 * r) / 2, width: 40 * r, height: 40 * r); left += 56 * r }
        if !control.isHidden { control.frame = CGRect(x: right - 72 * r, y: 0, width: 88 * r, height: height); right -= 88 * r }
        else if !check.isHidden { check.frame = CGRect(x: right - 40 * r, y: 0, width: 40 * r, height: height); right -= 52 * r }
        else if !arrow.isHidden { arrow.frame = CGRect(x: right - 40 * r, y: (height - 40 * r) / 2, width: 40 * r, height: 40 * r); right -= 56 * r }
        name.font = .systemFont(ofSize: 32 * r); valueLabel.font = .systemFont(ofSize: 28 * r); check.font = .systemFont(ofSize: 32 * r)
        if row.avatar != nil && !row.detail.isEmpty {
            name.frame = CGRect(x: left, y: height / 2 - 39 * r, width: max(0, right - left), height: 44 * r)
            valueLabel.textAlignment = .left; valueLabel.frame = CGRect(x: left, y: height / 2 + 9 * r, width: max(0, right - left), height: 36 * r)
        } else {
            let available = max(0, right - left), detailWidth = row.detail.isEmpty ? 0 : min(available * 0.53, valueLabel.sizeThatFits(CGSize(width: available, height: height)).width)
            name.frame = CGRect(x: left, y: 0, width: max(0, available - detailWidth - (detailWidth > 0 ? 16 * r : 0)), height: height)
            valueLabel.textAlignment = .right; valueLabel.frame = CGRect(x: right - detailWidth, y: 0, width: detailWidth, height: height)
        }
        line.frame = CGRect(x: left, y: height - 0.5, width: max(0, bounds.width - left), height: 0.5)
    }
}

private struct NativeFieldRules {
    let title: String
    let maximum: Int
    let hint: String
    var placeholder: String = ""
    var allowEmpty = false
    var tips = ""
    var groupID = false
    var chatID = false
    static func matching(_ title: String) -> Self? {
        switch title {
        case "设置昵称", "修改昵称": return Self(title: "修改昵称", maximum: 15, hint: "昵称最多 15 个字", placeholder: "输入昵称")
        case "群聊名称", "群组名称": return Self(title: "群组名称", maximum: 50, hint: "群组名称最多 50 个字", placeholder: "请输入群组名称")
        case "群备注": return Self(title: title, maximum: 64, hint: "群备注仅自己可见，最多 64 个字", placeholder: "请输入群备注", allowEmpty: true)
        case "我在本群的昵称": return Self(title: title, maximum: 32, hint: "仅群内成员可见，最多 32 个字", placeholder: "未设置", allowEmpty: true)
        case "设置备注", "备注名": return Self(title: "备注名", maximum: 50, hint: "备注名最多 50 个字", placeholder: "请输入备注名", allowEmpty: true)
        case "修改聊天号": return Self(title: title, maximum: 20, hint: "6-20 位，字母开头，只能用字母和数字", placeholder: "字母开头，只能用字母和数字", tips: "· 聊天号是别人搜索你时用的号码，好友看不到你的手机号\n· 大小写会按输入保留，搜索时不区分大小写\n· 只能修改一次，改完就不能再改了，请谨慎设置", chatID: true)
        case "修改群号": return Self(title: title, maximum: 24, hint: "qun_ 开头，后接 6-20 位字母或数字", placeholder: "qun_ 开头，后接字母或数字", tips: "· 群号用于加群搜索，别人知道群号后可以申请加入\n· 大小写按输入保留，搜索时不区分大小写\n· 每个群只能修改一次，改完就不能再改了，请谨慎设置", groupID: true)
        default: return nil
        }
    }
}

/// 与旧 input/textarea 的 UTF-16 计数一致，截断时不切断字符。
private func nativeLimited(_ text: String, maximum: Int) -> String {
    var count = 0
    return String(text.prefix { character in let size = String(character).utf16.count; guard count + size <= maximum else { return false }; count += size; return true })
}

@MainActor
final class NativeFieldEditorController: UIViewController {
    private let field = UITextField(); private let eye = UIButton(type: .custom)
    private let scroll = UIScrollView(); private let form = UIView(); private let line = UIView()
    private let hint = UILabel(); private let counter = UILabel(); private let tips = UILabel()
    private let clear = UIButton(type: .custom); private let confirm = UIButton(type: .system)
    private let initial: String; private let placeholder: String?; private let secure: Bool
    private let rules: NativeFieldRules?
    private let submit: (String) async throws -> Void
    private var task: Task<Void, Never>?
    init(title: String, value: String, placeholder: String?, secure: Bool, submit: @escaping (String) async throws -> Void) {
        initial = value; self.placeholder = placeholder; self.secure = secure; self.submit = submit; rules = secure ? nil : NativeFieldRules.matching(title)
        super.init(nibName: nil, bundle: nil); self.title = rules?.title ?? title
    }
    required init?(coder: NSCoder) { fatalError("不使用 Storyboard") }
    override func viewDidLoad() {
        super.viewDidLoad(); view.backgroundColor = UIColor(hex: 0xf3f4f7)
        field.backgroundColor = .white; field.text = initial; field.placeholder = placeholder ?? rules?.placeholder
        field.textColor = NativeUITheme.body; field.isSecureTextEntry = secure
        field.autocapitalizationType = .none; field.autocorrectionType = .no
        field.addTarget(self, action: #selector(changed), for: .editingChanged)
        if let rules = rules {
            view.addSubview(scroll); scroll.addSubview(form); form.backgroundColor = .white; scroll.keyboardDismissMode = .interactive; scroll.contentInsetAdjustmentBehavior = .never
            [field, line, hint, counter, tips, clear].forEach { form.addSubview($0) }; view.addSubview(confirm)
            line.backgroundColor = UIColor(hex: 0xe1e3ea); hint.text = rules.hint; hint.numberOfLines = 0; counter.textAlignment = .right
            [hint, counter, tips].forEach { $0.textColor = UIColor(hex: 0x636e86) }; tips.text = rules.tips; tips.numberOfLines = 0
            clear.setTitle("×", for: .normal); clear.setTitleColor(.white, for: .normal); clear.backgroundColor = UIColor(hex: 0xc8ccd6); clear.accessibilityLabel = "清除输入"; clear.addTarget(self, action: #selector(clearInput), for: .touchUpInside)
            confirm.setTitle("確認", for: .normal); confirm.setTitleColor(.white, for: .normal); confirm.addTarget(self, action: #selector(save), for: .touchUpInside)
            changed()
        } else {
            view.addSubview(field); field.font = .systemFont(ofSize: 16); field.leftView = UIView(frame: CGRect(x: 0, y: 0, width: 20, height: 1)); field.leftViewMode = .always
            field.clearButtonMode = secure ? .never : .whileEditing
            navigationItem.rightBarButtonItem = UIBarButtonItem(title: "保存", style: .done, target: self, action: #selector(save))
        }
        if secure { field.textContentType = .password; eye.setImage(NativeUITheme.image("uni_auth_eye_off"), for: .normal); eye.addTarget(self, action: #selector(toggleSecret), for: .touchUpInside); view.addSubview(eye) }
    }
    override func viewWillAppear(_ animated: Bool) { super.viewWillAppear(animated); navigationController?.setNavigationBarHidden(false, animated: animated) }
    override func viewDidAppear(_ animated: Bool) { super.viewDidAppear(animated); if rules != nil { field.becomeFirstResponder() } }
    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews(); let r = view.bounds.width / 750, top = view.safeAreaInsets.top
        guard rules != nil else {
            field.frame = CGRect(x: 0, y: top + 12, width: view.bounds.width, height: 52); eye.frame = CGRect(x: view.bounds.width - 52, y: top + 12, width: 44, height: 52); eye.imageEdgeInsets = UIEdgeInsets(top: 16, left: 12, bottom: 16, right: 12)
            if secure { field.rightView = UIView(frame: CGRect(x: 0, y: 0, width: 52, height: 1)); field.rightViewMode = .always }; return
        }
        let bottom = min(view.bounds.height - view.safeAreaInsets.bottom, view.keyboardLayoutGuide.layoutFrame.minY), width = view.bounds.width - 80 * r
        confirm.frame = CGRect(x: 40 * r, y: bottom - 120 * r, width: width, height: 96 * r); confirm.layer.cornerRadius = 16 * r; confirm.titleLabel?.font = .systemFont(ofSize: 34 * r, weight: .semibold)
        scroll.frame = CGRect(x: 0, y: top, width: view.bounds.width, height: max(0, confirm.frame.minY - top - 24 * r))
        field.font = .systemFont(ofSize: 34 * r); field.frame = CGRect(x: 40 * r, y: 24 * r, width: width - 64 * r, height: 96 * r)
        clear.frame = CGRect(x: view.bounds.width - 88 * r, y: 48 * r, width: 48 * r, height: 48 * r); clear.layer.cornerRadius = 24 * r; clear.titleLabel?.font = .systemFont(ofSize: 32 * r)
        line.frame = CGRect(x: 40 * r, y: 120 * r, width: width, height: max(0.5, r))
        hint.font = .systemFont(ofSize: 24 * r); counter.font = hint.font; tips.font = .systemFont(ofSize: 24 * r)
        let hintWidth = width - 100 * r, hintSize = hint.sizeThatFits(CGSize(width: hintWidth, height: .greatestFiniteMagnitude)), metaHeight = max(32 * r, hintSize.height)
        hint.frame = CGRect(x: 40 * r, y: 136 * r, width: hintWidth, height: metaHeight); counter.frame = CGRect(x: view.bounds.width - 140 * r, y: 136 * r, width: 100 * r, height: 32 * r)
        let tipHeight = tips.sizeThatFits(CGSize(width: width, height: .greatestFiniteMagnitude)).height
        tips.frame = CGRect(x: 40 * r, y: hint.frame.maxY + 24 * r, width: width, height: tipHeight)
        form.frame = CGRect(x: 0, y: 0, width: view.bounds.width, height: (tips.text?.isEmpty == false ? tips.frame.maxY : hint.frame.maxY) + 24 * r); scroll.contentSize = form.bounds.size
    }
    override func viewWillDisappear(_ animated: Bool) { super.viewWillDisappear(animated); if isMovingFromParent || isBeingDismissed { task?.cancel(); if secure { field.text = "" } } }
    @objc private func clearInput() { field.text = rules?.groupID == true ? "qun_" : ""; changed() }
    @objc private func changed() {
        guard let rules = rules, field.markedTextRange == nil else { return }
        let value = nativeLimited(field.text ?? "", maximum: rules.maximum); if field.text != value { field.text = value }; counter.text = "\(value.utf16.count)/\(rules.maximum)"; clear.isHidden = value.isEmpty
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        let valid = (rules.allowEmpty || !trimmed.isEmpty) && trimmed != initial.trimmingCharacters(in: .whitespacesAndNewlines)
        confirm.isEnabled = task == nil && valid; confirm.backgroundColor = UIColor(hex: confirm.isEnabled ? 0x0a2fc2 : 0xc8ccd6)
        let format = rules.groupID ? "^qun_[A-Za-z0-9]{6,20}$" : rules.chatID ? "^[A-Za-z][A-Za-z0-9]{5,19}$" : ""
        let warning = !format.isEmpty && !value.isEmpty && trimmed.range(of: format, options: .regularExpression) == nil
        hint.textColor = UIColor(hex: warning ? 0xdc2828 : 0x636e86); view.setNeedsLayout()
    }
    @objc private func toggleSecret() { field.isSecureTextEntry.toggle(); eye.setImage(NativeUITheme.image(field.isSecureTextEntry ? "uni_auth_eye_off" : "uni_auth_eye"), for: .normal) }
    @objc private func save() {
        guard task == nil else { return }
        if rules != nil, !confirm.isEnabled { return }
        let value = rules == nil ? field.text ?? "" : (field.text ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        if rules?.groupID == true, value.range(of: "^qun_[A-Za-z0-9]{6,20}$", options: .regularExpression) == nil { showNativeNotice("群号需 qun_ 开头，后接 6-20 位字母或数字"); return }
        field.isEnabled = false; confirm.isEnabled = false; navigationItem.rightBarButtonItem?.isEnabled = false
        task = Task { [weak self] in
            guard let self = self else { return }
            defer { self.task = nil; self.field.isEnabled = true; self.navigationItem.rightBarButtonItem?.isEnabled = true; self.changed() }
            do {
                try Task.checkCancellation(); try await self.submit(value); try Task.checkCancellation()
                if self.secure { self.field.text = "" }
                if self.navigationController?.topViewController === self { self.navigationController?.popViewController(animated: true) }
                else if let navigation = self.navigationController { navigation.setViewControllers(navigation.viewControllers.filter { $0 !== self }, animated: false) }
            } catch { if !Task.isCancelled, self.view.window != nil { self.showNativeNotice(error.localizedDescription) } }
        }
    }
}

@MainActor
final class NativeTextEditorController: UIViewController, UITextViewDelegate {
    private let textView = UITextView(); private let form = UIView(); private let scroll = UIScrollView()
    private let hint = UILabel(); private let counter = UILabel(); private let line = UIView(); private let clear = UIButton(type: .custom); private let confirm = UIButton(type: .system); private let placeholderLabel = UILabel()
    private let initial: String; private let bio: Bool
    private let onSave: (String) async throws -> Void
    private var task: Task<Void, Never>?
    init(title: String, value: String = "", save: @escaping (String) async throws -> Void) { initial = value; onSave = save; bio = ["个人简介", "修改个性签名", "个性签名"].contains(title); super.init(nibName: nil, bundle: nil); self.title = bio ? "修改个性签名" : title }
    required init?(coder: NSCoder) { fatalError("不使用 Storyboard") }
    override func viewDidLoad() {
        super.viewDidLoad(); view.backgroundColor = UIColor(hex: 0xf3f4f7); textView.backgroundColor = .white; textView.text = initial; textView.delegate = self
        textView.textColor = NativeUITheme.body
        if bio {
            view.addSubview(scroll); scroll.addSubview(form); scroll.contentInsetAdjustmentBehavior = .never; scroll.keyboardDismissMode = .interactive; form.backgroundColor = .white
            [textView, hint, counter, line, clear, placeholderLabel].forEach { form.addSubview($0) }; view.addSubview(confirm)
            placeholderLabel.text = "请输入个性签名"; placeholderLabel.textColor = UIColor(hex: 0x636e86); placeholderLabel.isUserInteractionEnabled = false
            textView.textContainerInset = .zero; textView.textContainer.lineFragmentPadding = 0; textView.isScrollEnabled = false
            hint.text = "个性签名最多 50 个字"; counter.textAlignment = .right; line.backgroundColor = UIColor(hex: 0xe1e3ea)
            [hint, counter].forEach { $0.textColor = UIColor(hex: 0x636e86) }
            clear.setTitle("×", for: .normal); clear.setTitleColor(.white, for: .normal); clear.backgroundColor = UIColor(hex: 0xc8ccd6); clear.accessibilityLabel = "清除签名"; clear.addTarget(self, action: #selector(clearText), for: .touchUpInside)
            confirm.setTitle("確認", for: .normal); confirm.setTitleColor(.white, for: .normal); confirm.addTarget(self, action: #selector(save), for: .touchUpInside); textViewDidChange(textView)
        } else {
            textView.font = .systemFont(ofSize: 16); textView.textContainerInset = UIEdgeInsets(top: 18, left: 14, bottom: 18, right: 14); view.addSubview(textView)
            navigationItem.rightBarButtonItem = UIBarButtonItem(title: "保存", style: .done, target: self, action: #selector(save))
        }
    }
    override func viewWillAppear(_ animated: Bool) { super.viewWillAppear(animated); navigationController?.setNavigationBarHidden(false, animated: animated) }
    override func viewDidAppear(_ animated: Bool) { super.viewDidAppear(animated); if bio { textView.becomeFirstResponder() } }
    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews(); guard bio else { textView.frame = CGRect(x: 0, y: view.safeAreaInsets.top + 12, width: view.bounds.width, height: max(180, view.bounds.height / 3)); return }
        let r = view.bounds.width / 750, width = view.bounds.width - 80 * r, top = view.safeAreaInsets.top, bottom = min(view.bounds.height - view.safeAreaInsets.bottom, view.keyboardLayoutGuide.layoutFrame.minY)
        confirm.frame = CGRect(x: 40 * r, y: bottom - 120 * r, width: width, height: 96 * r); confirm.layer.cornerRadius = 16 * r; confirm.titleLabel?.font = .systemFont(ofSize: 34 * r, weight: .semibold)
        scroll.frame = CGRect(x: 0, y: top, width: view.bounds.width, height: max(0, confirm.frame.minY - top - 24 * r))
        textView.font = .systemFont(ofSize: 34 * r); let textWidth = width - 64 * r, textHeight = max(160 * r, textView.sizeThatFits(CGSize(width: textWidth, height: .greatestFiniteMagnitude)).height)
        textView.frame = CGRect(x: 40 * r, y: 24 * r, width: textWidth, height: textHeight); clear.frame = CGRect(x: view.bounds.width - 88 * r, y: 32 * r, width: 48 * r, height: 48 * r); clear.layer.cornerRadius = 24 * r; clear.titleLabel?.font = .systemFont(ofSize: 32 * r)
        placeholderLabel.font = textView.font; placeholderLabel.frame = CGRect(x: 40 * r, y: 24 * r, width: textWidth, height: 44 * r)
        line.frame = CGRect(x: 40 * r, y: textView.frame.maxY + 16 * r, width: width, height: max(0.5, r)); hint.font = .systemFont(ofSize: 24 * r); counter.font = hint.font
        hint.frame = CGRect(x: 40 * r, y: line.frame.maxY + 16 * r, width: width - 100 * r, height: 32 * r); counter.frame = CGRect(x: view.bounds.width - 140 * r, y: hint.frame.minY, width: 100 * r, height: 32 * r)
        form.frame = CGRect(x: 0, y: 0, width: view.bounds.width, height: counter.frame.maxY + 24 * r); scroll.contentSize = form.bounds.size
    }
    func textViewDidChange(_ textView: UITextView) {
        guard bio, textView.markedTextRange == nil else { return }; let value = nativeLimited(textView.text ?? "", maximum: 50); if textView.text != value { textView.text = value }; counter.text = "\(textView.text.utf16.count)/50"; clear.isHidden = textView.text.isEmpty; placeholderLabel.isHidden = !textView.text.isEmpty
        confirm.isEnabled = task == nil && textView.text.trimmingCharacters(in: .whitespacesAndNewlines) != initial.trimmingCharacters(in: .whitespacesAndNewlines); confirm.backgroundColor = UIColor(hex: confirm.isEnabled ? 0x0a2fc2 : 0xc8ccd6); view.setNeedsLayout()
    }
    @objc private func clearText() { textView.text = ""; textViewDidChange(textView) }
    override func viewWillDisappear(_ animated: Bool) { super.viewWillDisappear(animated); if isMovingFromParent || isBeingDismissed { task?.cancel() } }
    @objc private func save() {
        guard task == nil, !bio || confirm.isEnabled else { return }
        navigationItem.rightBarButtonItem?.isEnabled = false; confirm.isEnabled = false; textView.isEditable = false; let text = (textView.text ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        task = Task { [weak self] in
            guard let self = self else { return }
            defer { self.task = nil; self.textView.isEditable = true; self.navigationItem.rightBarButtonItem?.isEnabled = true; self.textViewDidChange(self.textView) }
            do {
                try Task.checkCancellation(); try await self.onSave(text); try Task.checkCancellation()
                if self.navigationController?.topViewController === self { self.navigationController?.popViewController(animated: true) }
                else if let navigation = self.navigationController { navigation.setViewControllers(navigation.viewControllers.filter { $0 !== self }, animated: false) }
            } catch { if !Task.isCancelled, self.view.window != nil { self.showNativeNotice(error.localizedDescription) } }
        }
    }
}
