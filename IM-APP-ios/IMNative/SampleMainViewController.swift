import UIKit
import IMCore

private final class ConversationRowCell: UITableViewCell {
    let avatar = UIImageView()
    let name = UILabel()
    let preview = UILabel()
    let time = UILabel()
    let line = UIView()

    override init(style: UITableViewCell.CellStyle, reuseIdentifier: String?) {
        super.init(style: style, reuseIdentifier: reuseIdentifier)
        selectionStyle = .none
        avatar.image = NativeUITheme.image("uni_avatar_1")
        avatar.contentMode = .scaleAspectFill
        avatar.clipsToBounds = true
        [avatar, name, preview, time, line].forEach { contentView.addSubview($0) }
        name.text = "样例会话"
        preview.text = "这是本机样例会话，不会发送到服务器。"
        name.textColor = UIColor(hex: 0x111111)
        preview.textColor = UIColor(hex: 0x999999)
        time.textColor = UIColor(hex: 0x999999)
        time.text = "本地"
        line.backgroundColor = UIColor(hex: 0xf0f1f4)
    }

    required init?(coder: NSCoder) { fatalError("不使用 Storyboard") }

    override func layoutSubviews() {
        super.layoutSubviews()
        let r: (CGFloat) -> CGFloat = { NativeUITheme.rpx($0, width: self.bounds.width) }
        avatar.frame = CGRect(x: r(40), y: r(24), width: r(96), height: r(96))
        avatar.layer.cornerRadius = r(48)
        let bodyX = r(160)
        let bodyWidth = bounds.width - bodyX - r(40)
        name.frame = CGRect(x: bodyX, y: r(27), width: bodyWidth - r(72), height: r(40))
        name.font = .systemFont(ofSize: r(32), weight: .medium)
        time.frame = CGRect(x: bounds.width - r(104), y: r(29), width: r(64), height: r(34))
        time.textAlignment = .right
        time.font = .systemFont(ofSize: r(24))
        preview.frame = CGRect(x: bodyX, y: r(79), width: bodyWidth, height: r(36))
        preview.font = .systemFont(ofSize: r(26))
        line.frame = CGRect(x: 0, y: bounds.height - r(1), width: bounds.width, height: r(1))
    }
}

enum NativeMainMode {
    case localSample
    case realAccount(BusinessAccountSession)
}

@MainActor
final class SampleMainViewController: UIViewController, UITableViewDataSource, UITableViewDelegate, UITextFieldDelegate {
    private let mode: NativeMainMode
    private let header = UIView()
    private let titleLabel = UILabel()
    private let more = UIButton(type: .system)
    private let add = NativeUITheme.imageButton("uni_icon_plus", accessibility: "添加")
    private let sampleNotice = UILabel()
    private let searchBox = UIView()
    private let search = UITextField()
    private let searchIcon = UIImageView(image: UIImage(systemName: "magnifyingglass"))
    private let filter = UIButton(type: .system)
    private let table = UITableView(frame: .zero, style: .plain)
    private let empty = UILabel()
    private let profilePanel = UIScrollView()
    private let profileAvatar = UIImageView(image: NativeUITheme.image("uni_avatar_1"))
    private let profileName = UILabel()
    private let profileFields = UILabel()
    private let profileWarning = UILabel()
    private let tabbar = UIView()
    private var tabs: [UIButton] = []
    private var tabImages: [UIImageView] = []
    private var tabLabels: [UILabel] = []
    private var currentTab = 1
    private var unreadOnly = false
    private var latestPreview = "这是本机样例会话，不会发送到服务器。"
    private let conversation: LocalSampleConversation?

    init(mode: NativeMainMode = .localSample) {
        self.mode = mode
        if case .localSample = mode { self.conversation = LocalSampleConversation() }
        else { self.conversation = nil }
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) { fatalError("不使用 Storyboard") }

    private var realAccount: BusinessAccountSession? {
        if case .realAccount(let account) = mode { return account }
        return nil
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        navigationController?.setNavigationBarHidden(true, animated: animated)
        guard let conversation = conversation else { refreshTab(); return }
        Task { [weak self] in
            let messages = await conversation.snapshot()
            guard let self = self else { return }
            self.latestPreview = messages.last?.text ?? "暂无消息"
            self.refreshTab()
        }
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .white
        [header, sampleNotice, searchBox, filter, table, empty, profilePanel, tabbar].forEach { view.addSubview($0) }
        [titleLabel, more, add].forEach { header.addSubview($0) }
        titleLabel.textColor = NativeUITheme.body
        more.setTitle("⋯", for: .normal)
        more.setTitleColor(NativeUITheme.body, for: .normal)
        more.addTarget(self, action: #selector(showMore), for: .touchUpInside)
        add.addTarget(self, action: #selector(showAdd), for: .touchUpInside)
        sampleNotice.text = realAccount == nil ? NativeUITheme.sampleNotice : "账号已登录 · 聊天功能接入中"
        sampleNotice.textColor = NativeUITheme.secondary
        sampleNotice.textAlignment = .center
        sampleNotice.font = .systemFont(ofSize: 11)
        sampleNotice.backgroundColor = UIColor(hex: 0xf6f7fb)
        searchBox.backgroundColor = UIColor(hex: 0xf3f4f7)
        searchBox.addSubview(searchIcon)
        searchBox.addSubview(search)
        searchIcon.tintColor = UIColor(hex: 0x8a8f9c)
        search.placeholder = "搜索聊天 / 关键词"
        search.clearButtonMode = .whileEditing
        search.textColor = NativeUITheme.body
        search.returnKeyType = .search
        search.addTarget(self, action: #selector(searchChanged), for: .editingChanged)
        search.delegate = self
        filter.setTitleColor(NativeUITheme.secondary, for: .normal)
        filter.addTarget(self, action: #selector(showFilter), for: .touchUpInside)
        table.separatorStyle = .none
        table.backgroundColor = .white
        table.dataSource = self
        table.delegate = self
        table.register(ConversationRowCell.self, forCellReuseIdentifier: "conversation")
        table.keyboardDismissMode = .onDrag
        empty.textAlignment = .center
        empty.textColor = NativeUITheme.body
        empty.numberOfLines = 0
        configureProfile()
        tabbar.backgroundColor = .white
        tabbar.layer.shadowColor = UIColor.black.cgColor
        tabbar.layer.shadowOpacity = 0.05
        tabbar.layer.shadowOffset = CGSize(width: 0, height: -1)
        tabbar.layer.shadowRadius = 3
        for (index, title) in ["通讯录", "聊天", "我的"].enumerated() {
            let button = UIButton(type: .custom)
            button.tag = index
            button.addTarget(self, action: #selector(selectTab(_:)), for: .touchUpInside)
            let icon = UIImageView()
            icon.contentMode = .scaleAspectFit
            let label = UILabel()
            label.text = title
            label.textAlignment = .center
            button.addSubview(icon)
            button.addSubview(label)
            tabbar.addSubview(button)
            tabs.append(button)
            tabImages.append(icon)
            tabLabels.append(label)
        }
        refreshTab()
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        let width = view.bounds.width
        let r: (CGFloat) -> CGFloat = { NativeUITheme.rpx($0, width: width) }
        let top = view.safeAreaInsets.top
        header.frame = CGRect(x: 0, y: top, width: width, height: r(96))
        titleLabel.frame = CGRect(x: r(40), y: 0, width: width / 2, height: r(96))
        titleLabel.font = .systemFont(ofSize: r(48), weight: .bold)
        more.frame = CGRect(x: width - r(176), y: r(16), width: r(64), height: r(64))
        more.titleLabel?.font = .systemFont(ofSize: r(44), weight: .bold)
        add.frame = CGRect(x: width - r(104), y: r(16), width: r(64), height: r(64))
        add.imageEdgeInsets = UIEdgeInsets(top: r(8), left: r(8), bottom: r(8), right: r(8))
        sampleNotice.frame = CGRect(x: 0, y: header.frame.maxY, width: width, height: 24)
        searchBox.frame = CGRect(x: r(40), y: sampleNotice.frame.maxY + r(16), width: width - r(80), height: r(72))
        searchBox.layer.cornerRadius = r(8)
        searchIcon.frame = CGRect(x: r(32), y: (r(72) - 16) / 2, width: 16, height: 16)
        search.frame = CGRect(x: r(32) + 16 + r(16), y: 0, width: searchBox.bounds.width - r(72) - 16, height: r(72))
        search.font = .systemFont(ofSize: r(28))
        filter.frame = CGRect(x: width - r(160), y: searchBox.frame.maxY + r(16), width: r(120), height: r(40))
        filter.titleLabel?.font = .systemFont(ofSize: r(24))
        let tabHeight = r(144) + view.safeAreaInsets.bottom
        tabbar.frame = CGRect(x: 0, y: view.bounds.height - tabHeight, width: width, height: tabHeight)
        for index in 0..<tabs.count {
            tabs[index].frame = CGRect(x: CGFloat(index) * width / 3, y: r(16), width: width / 3, height: r(112))
            tabImages[index].frame = CGRect(x: (width / 3 - r(48)) / 2, y: r(14), width: r(48), height: r(48))
            tabLabels[index].frame = CGRect(x: 0, y: r(66), width: width / 3, height: r(32))
            tabLabels[index].font = .systemFont(ofSize: r(24))
        }
        table.frame = CGRect(x: 0, y: filter.frame.maxY + r(8), width: width, height: max(0, tabbar.frame.minY - filter.frame.maxY - r(8)))
        table.rowHeight = r(144) + r(1)
        empty.frame = CGRect(x: r(40), y: searchBox.frame.maxY + r(100), width: width - r(80), height: r(140))
        empty.font = .systemFont(ofSize: r(32))
        profilePanel.frame = CGRect(x: r(40), y: sampleNotice.frame.maxY + r(40), width: width - r(80), height: max(0, tabbar.frame.minY - sampleNotice.frame.maxY - r(40)))
        profileAvatar.frame = CGRect(x: r(8), y: 0, width: r(120), height: r(120))
        profileAvatar.layer.cornerRadius = r(60)
        profileName.frame = CGRect(x: r(160), y: r(30), width: profilePanel.bounds.width - r(160), height: r(60))
        profileName.font = .systemFont(ofSize: r(36), weight: .semibold)
        let profileWidth = max(0, profilePanel.bounds.width - r(16))
        profileFields.font = .systemFont(ofSize: r(28))
        let fieldsHeight = profileFields.sizeThatFits(CGSize(width: profileWidth, height: .greatestFiniteMagnitude)).height
        profileFields.frame = CGRect(x: r(8), y: r(160), width: profileWidth, height: fieldsHeight)
        profileWarning.font = .systemFont(ofSize: r(24))
        let warningHeight = profileWarning.sizeThatFits(CGSize(width: profileWidth, height: .greatestFiniteMagnitude)).height
        profileWarning.frame = CGRect(x: r(8), y: profileFields.frame.maxY + r(32), width: profileWidth, height: warningHeight)
        profilePanel.contentSize = CGSize(width: profilePanel.bounds.width, height: profileWarning.frame.maxY + r(48))
    }

    private func configureProfile() {
        [profileAvatar, profileName, profileFields, profileWarning].forEach { profilePanel.addSubview($0) }
        profileAvatar.contentMode = .scaleAspectFill
        profileAvatar.clipsToBounds = true
        profileAvatar.accessibilityLabel = "默认头像"
        profileName.textColor = NativeUITheme.body
        profileFields.textColor = NativeUITheme.body
        profileFields.numberOfLines = 0
        profileWarning.textColor = NativeUITheme.secondary
        profileWarning.numberOfLines = 0
        guard let account = realAccount else { return }
        let profile = account.profile
        profileName.text = profile.nickname.isEmpty ? "未设置昵称" : profile.nickname
        profileFields.text = "易可聊号：\(profile.publicId)\n\n手机号：\(profile.phoneMasked)\n\n个人简介：\(profile.bio.isEmpty ? "未填写" : profile.bio)"
        profileWarning.text = account.profileLoadWarning
    }

    private var hasVisibleConversation: Bool {
        let keyword = (search.text ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        return conversation != nil && currentTab == 1 && !unreadOnly && (keyword.isEmpty || "样例会话".contains(keyword) || latestPreview.contains(keyword))
    }

    private func refreshTab() {
        let names = ["contacts", "chat", "mine"]
        let titles = ["通讯录", "聊天", "我的"]
        titleLabel.text = titles[currentTab]
        for index in 0..<tabs.count {
            tabImages[index].image = NativeUITheme.image("uni_tab_" + names[index] + (currentTab == index ? "_active" : ""))
            tabLabels[index].textColor = currentTab == index ? NativeUITheme.primary : NativeUITheme.body
        }
        let chat = currentTab == 1
        let sampleChat = chat && conversation != nil
        searchBox.isHidden = !sampleChat
        filter.isHidden = !sampleChat
        table.isHidden = !sampleChat
        add.isHidden = !sampleChat
        profilePanel.isHidden = currentTab != 2 || realAccount == nil
        filter.setTitle(unreadOnly ? "未读 ▾" : "全部 ▾", for: .normal)
        if realAccount != nil {
            empty.text = chat ? "聊天功能接入中\n当前不会收发消息或同步聊天记录" : "通讯录功能接入中"
            empty.isHidden = currentTab == 2
        } else {
            empty.text = chat ? "暂无对话…" : (currentTab == 0 ? "通讯录页面尚未接入\n当前仅提供聊天页面本地样例" : "个人中心页面尚未接入\n当前仅提供聊天页面本地样例")
            empty.isHidden = chat && hasVisibleConversation
        }
        table.reloadData()
        view.setNeedsLayout()
    }

    @objc private func selectTab(_ sender: UIButton) { currentTab = sender.tag; refreshTab() }
    @objc private func searchChanged() { refreshTab() }
    func textFieldShouldReturn(_ textField: UITextField) -> Bool { textField.resignFirstResponder(); return true }

    @objc private func showFilter() {
        showAnchoredNativeMenu(anchor: filter, items: [
            NativeMenuItem(title: "全部", action: { [weak self] in self?.unreadOnly = false; self?.refreshTab() }),
            NativeMenuItem(title: "未读", action: { [weak self] in self?.unreadOnly = true; self?.refreshTab() })
        ], width: 200)
    }

    @objc private func showMore() {
        if realAccount != nil {
            showAnchoredNativeMenu(anchor: more, items: [
                NativeMenuItem(title: "退出登录", destructive: true, action: { [weak self] in
                    // 仅释放本机内存业务凭据，不调用会影响其他客户端的全局退出接口。
                    self?.navigationController?.popViewController(animated: true)
                })
            ])
            return
        }
        showAnchoredNativeMenu(anchor: more, items: [
            NativeMenuItem(title: "全部已读", action: { [weak self] in self?.showNativeNotice("本地样例没有真实未读消息，不会更新服务器。") }),
            NativeMenuItem(title: "退出本地样例", destructive: true, action: { [weak self] in
                guard let self = self else { return }
                if let conversation = self.conversation { Task { await conversation.clear() } }
                self.navigationController?.popViewController(animated: true)
            })
        ])
    }

    @objc private func showAdd() {
        let items = [("添加朋友", "uni_menu_add_friend"), ("添加群聊", "uni_menu_add_group"), ("创建群聊", "uni_menu_create_group")].map { title, icon in
            NativeMenuItem(title: title, icon: icon, action: { [weak self] in self?.showNativeNotice("\(title)尚未接入；本地样例不会修改账号或群关系。") })
        }
        showAnchoredNativeMenu(anchor: add, items: items)
    }

    func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int { hasVisibleConversation ? 1 : 0 }
    func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        let cell = tableView.dequeueReusableCell(withIdentifier: "conversation", for: indexPath) as! ConversationRowCell
        cell.preview.text = latestPreview
        return cell
    }
    func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
        guard let conversation = conversation else { return }
        navigationController?.pushViewController(SampleConversationViewController(sample: conversation), animated: true)
    }
}
