import UIKit
import PhotosUI
import CoreImage.CIFilterBuiltins
import ImageIO
import UniformTypeIdentifiers
import Photos
import AVFoundation
import IMCore

@MainActor
final class NativeMineViewController: UIViewController {
    private let service: NativeIMService
    private let scroll = UIScrollView()
    private let hero = UIView()
    private let background = UIImageView(image: NativeUITheme.image("uni_mine_header"))
    private let heading = NativeUITheme.label("个人中心", size: 24, weight: .bold, color: .white)
    private let avatar = NativeRemoteImageView()
    private let nickname = UILabel()
    private let edit = NativeUITheme.imageButton("uni_mine_icon_edit", accessibility: "编辑资料")
    private let qr = NativeUITheme.imageButton("uni_mine_icon_qrcode", accessibility: "我的二维码")
    private var menu: [UIButton] = []
    init(service: NativeIMService) { self.service = service; super.init(nibName: nil, bundle: nil) }
    required init?(coder: NSCoder) { fatalError("不使用 Storyboard") }
    override func viewDidLoad() {
        super.viewDidLoad(); view.backgroundColor = UIColor(hex: 0xf5f6f8); view.addSubview(scroll)
        scroll.contentInsetAdjustmentBehavior = .never; scroll.addSubview(hero); hero.backgroundColor = NativeUITheme.primary
        [background, heading, avatar, nickname, edit, qr].forEach { hero.addSubview($0) }
        background.contentMode = .scaleAspectFill; background.clipsToBounds = true; background.alpha = 1
        avatar.clipsToBounds = true; avatar.contentMode = .scaleAspectFill; avatar.layer.borderWidth = 2; avatar.layer.borderColor = UIColor.white.cgColor
        nickname.textColor = .white; nickname.textAlignment = .center; nickname.font = .boldSystemFont(ofSize: 16)
        edit.addTarget(self, action: #selector(openProfile), for: .touchUpInside); qr.addTarget(self, action: #selector(openQR), for: .touchUpInside)
        let entries = [("我的收藏", "uni_mine_icon_favorites"), ("通知设置", "uni_mine_icon_notifications"), ("聊天设置", "uni_mine_icon_chat_settings"), ("隐私", "uni_mine_icon_privacy"), ("安全", "uni_mine_icon_security"), ("通用", "uni_mine_icon_general"), ("退出", "uni_mine_icon_logout")]
        for (index, entry) in entries.enumerated() {
            let button = UIButton(type: .custom); button.backgroundColor = .white; button.tag = index
            let icon = UIImageView(image: NativeUITheme.image(entry.1)); icon.tag = 1; icon.contentMode = .scaleAspectFit
            let label = NativeUITheme.label(entry.0, size: 16, color: index == 6 ? UIColor(hex: 0xdc2828) : NativeUITheme.body); label.tag = 2
            let chevron = UIImageView(image: NativeUITheme.image("uni_mine_icon_chevron")); chevron.tag = 3; chevron.contentMode = .scaleAspectFit; chevron.isHidden = index == 6
            [icon, label, chevron].forEach { button.addSubview($0) }; button.addTarget(self, action: #selector(openMenu(_:)), for: .touchUpInside)
            scroll.addSubview(button); menu.append(button)
        }; refreshProfile()
    }
    override func viewWillAppear(_ animated: Bool) { super.viewWillAppear(animated); refreshProfile(); Task { try? await service.business.refreshProfile(); refreshProfile() } }
    private func refreshProfile() { guard isViewLoaded else { return }; nickname.text = service.business.profile.nickname; avatar.load(service.business.profile.avatar, policy: service.business.media) }
    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews(); scroll.frame = view.bounds
        let width = view.bounds.width, top = view.safeAreaInsets.top
        let r: (CGFloat) -> CGFloat = { NativeUITheme.rpx($0, width: width) }
        hero.frame = CGRect(x: 0, y: 0, width: width, height: top + r(144 + 160 + 8 + 48 + 48))
        background.frame = hero.bounds; heading.frame = CGRect(x: r(40), y: top, width: width - r(80), height: r(96)); heading.font = .boldSystemFont(ofSize: r(48))
        avatar.frame = CGRect(x: r(48), y: top + r(144), width: r(160), height: r(160)); avatar.layer.cornerRadius = r(80)
        nickname.frame = CGRect(x: r(48), y: avatar.frame.maxY + r(8), width: r(160), height: r(48)); nickname.font = .boldSystemFont(ofSize: r(32))
        edit.frame = CGRect(x: width - r(48 + 64 + 4 + 64), y: top + r(220), width: r(64), height: r(64))
        qr.frame = CGRect(x: edit.frame.maxX + r(4), y: edit.frame.minY, width: r(64), height: r(64))
        for index in menu.indices {
            menu[index].frame = CGRect(x: 0, y: hero.frame.maxY + CGFloat(index) * r(96) + (index == 6 ? r(16) : 0), width: width, height: r(96))
            menu[index].viewWithTag(1)?.frame = CGRect(x: r(32), y: r(28), width: r(40), height: r(40))
            menu[index].viewWithTag(2)?.frame = CGRect(x: r(88), y: 0, width: width - r(176), height: r(96))
            (menu[index].viewWithTag(2) as? UILabel)?.font = .systemFont(ofSize: r(32))
            menu[index].viewWithTag(3)?.frame = CGRect(x: width - r(72), y: r(28), width: r(40), height: r(40))
        }; scroll.contentSize = CGSize(width: width, height: (menu.last?.frame.maxY ?? 0) + 16)
    }
    @objc private func openProfile() { navigationController?.pushViewController(NativeProfileController(context: service.business, service: service), animated: true) }
    @objc private func openQR() { navigationController?.pushViewController(NativeQRCodeController(context: service.business, service: service), animated: true) }
    @objc private func openMenu(_ sender: UIButton) {
        if sender.tag == 0 { navigationController?.pushViewController(NativeFavoritesController(context: service.business, service: service), animated: true); return }
        if sender.tag == 6 {
            let alert = UIAlertController(title: "退出登录", message: "退出当前设备，聊天记录保留在本机。", preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: "取消", style: .cancel)); alert.addAction(UIAlertAction(title: "退出", style: .destructive) { [weak self] _ in
                guard let self = self else { return }; Task { await self.service.logout(); let root = self.navigationController?.viewControllers.first; self.navigationController?.popToRootViewController(animated: true); if let warning = self.service.business.logoutWarning { DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { root?.showNativeNotice(warning) } } }
            }); present(alert, animated: true); return
        }
        if sender.tag == 4 { navigationController?.pushViewController(NativeSecurityController(context: service.business), animated: true); return }
        let kinds: [NativeSettingsController.Kind] = [.notifications, .chat, .privacy, .security, .general]
        navigationController?.pushViewController(NativeSettingsController(context: service.business, service: service, kind: kinds[sender.tag - 1]), animated: true)
    }
}

@MainActor
final class NativeProfileController: NativeBusinessListController, PHPickerViewControllerDelegate, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
    private let service: NativeIMService?
    private var avatarSelection = UUID()
    private var avatarProgress: Progress?
    private let avatarHeader = UIView(); private let profileAvatar = NativeRemoteImageView(); private let avatarArrow = UIImageView(image: NativeUITheme.image("uni_mine_icon_chevron"))
    init(context: NativeBusinessContext, service: NativeIMService? = nil) { self.service = service; super.init(title: "个人资料", context: context) }
    override func viewDidLoad() {
        super.viewDidLoad(); avatarHeader.backgroundColor = UIColor(hex: 0xf5f6f8); avatarHeader.addSubview(profileAvatar); avatarHeader.addSubview(avatarArrow); profileAvatar.contentMode = .scaleAspectFill; profileAvatar.clipsToBounds = true; avatarHeader.addGestureRecognizer(UITapGestureRecognizer(target: self, action: #selector(chooseAvatarFromHeader))); tableView.tableHeaderView = avatarHeader; tableView.register(NativeProfileIDCell.self, forCellReuseIdentifier: "profile-id")
    }
    override func viewDidLayoutSubviews() { super.viewDidLayoutSubviews(); let r: (CGFloat) -> CGFloat = { NativeUITheme.rpx($0, width: self.view.bounds.width) }; let frame = CGRect(x: 0, y: 0, width: view.bounds.width, height: r(168)); if avatarHeader.frame != frame { avatarHeader.frame = frame; tableView.tableHeaderView = avatarHeader }; profileAvatar.frame = CGRect(x: r(32), y: r(24), width: r(120), height: r(120)); profileAvatar.layer.cornerRadius = r(60); avatarArrow.frame = CGRect(x: view.bounds.width - r(72), y: r(64), width: r(40), height: r(40)); avatarArrow.contentMode = .scaleAspectFit }
    @objc private func chooseAvatarFromHeader() { pickAvatar() }
    override func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        if indexPath.section == 1, indexPath.row == 1 { let cell = tableView.dequeueReusableCell(withIdentifier: "profile-id", for: indexPath) as! NativeProfileIDCell; cell.publicID = context.profile.publicId; cell.copyID = { [weak self] in guard let self = self else { return }; UIPasteboard.general.string = self.context.profile.publicId; self.showNativeNotice("已复制。") }; return cell }; return super.tableView(tableView, cellForRowAt: indexPath)
    }
    required init?(coder: NSCoder) { fatalError("不使用 Storyboard") }
    override func reloadContent() {
        let p = context.profile
        profileAvatar.load(p.avatar, policy: context.media)
        var rows = [[
            NativeBusinessRow(title: "昵称", detail: p.nickname, action: { [weak self] in self?.editNickname() }),
            NativeBusinessRow(title: "个性签名", detail: p.bio, action: { [weak self] in self?.editBio() })
        ], [
            NativeBusinessRow(title: "电话号码", detail: p.phoneMasked),
            NativeBusinessRow(title: "聊天号", detail: p.publicId, action: { [weak self] in self?.editPublicID() }),
            NativeBusinessRow(title: "二维码", action: { [weak self] in guard let self = self else { return }; self.push(NativeQRCodeController(context: self.context, service: self.service)) })
        ]]
        if let service = service { rows.append([NativeBusinessRow(title: "注销帐号", destructive: true, action: { [weak self] in self?.push(NativeAccountDeletionController(service: service)) })]) }; setRows(rows)
    }
    private func update(_ body: [String: JSONValue]) async throws { let _: UserProfile = try await context.request("me", method: "PATCH", body: body); try await context.refreshProfile() }
    private func editNickname() { edit(title: "设置昵称", value: context.profile.nickname) { [weak self] value in guard let self = self else { return }; guard !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { throw APIError.business(code: -1, message: "昵称不能为空。") }; try await self.update(["nickname": .string(value), "avatarFileId": .string(""), "bio": .string(self.context.profile.bio)]) } }
    private func editBio() { push(NativeTextEditorController(title: "个人简介", value: context.profile.bio) { [weak self] value in guard let self = self else { return }; try await self.update(["nickname": .string(self.context.profile.nickname), "avatarFileId": .string(""), "bio": .string(value)]) }) }
    private func editPublicID() {
        confirm("聊天号只可修改一次，请确认后保存。", destructiveTitle: "继续") { [weak self] in self?.edit(title: "修改聊天号", value: self?.context.profile.publicId ?? "") { [weak self] value in guard let self = self else { return }; let _: UserProfile = try await self.context.request("me/public-id", method: "PUT", body: ["publicId": .string(value)]); try await self.context.refreshProfile() } }
    }
    override func viewDidDisappear(_ animated: Bool) { super.viewDidDisappear(animated); if isMovingFromParent || navigationController == nil { avatarSelection = UUID(); avatarProgress?.cancel(); avatarProgress = nil } }
    private func pickAvatar() {
        let sheet = UIAlertController(title: nil, message: nil, preferredStyle: .actionSheet)
        sheet.addAction(UIAlertAction(title: "拍照", style: .default) { [weak self] _ in self?.takeAvatar() })
        sheet.addAction(UIAlertAction(title: "从相册选择", style: .default) { [weak self] _ in self?.pickAvatarAlbum() })
        sheet.addAction(UIAlertAction(title: "取消", style: .cancel)); sheet.popoverPresentationController?.sourceView = avatarHeader; sheet.popoverPresentationController?.sourceRect = avatarHeader.bounds; present(sheet, animated: true)
    }
    private func pickAvatarAlbum() { avatarSelection = UUID(); avatarProgress?.cancel(); var config = PHPickerConfiguration(); config.filter = .images; config.selectionLimit = 1; let picker = PHPickerViewController(configuration: config); picker.delegate = self; present(picker, animated: true) }
    func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
        picker.dismiss(animated: true); guard let provider = results.first?.itemProvider else { return }; let id = avatarSelection
        // 文件回调结束前完成有界解码；不把 iPhone 全尺寸 HEIC 解码到主线程。
        avatarProgress = provider.loadFileRepresentation(forTypeIdentifier: UTType.image.identifier) { [weak self] url, error in
            let data = url.flatMap { NativeAvatarEncoding.jpeg(from: $0) }
            Task { @MainActor [weak self] in self?.acceptAvatar(data, selection: id, error: error?.localizedDescription) }
        }
    }
    private func takeAvatar() {
        guard UIImagePickerController.isSourceTypeAvailable(.camera) else { showNativeNotice("此设备没有可用相机，请从相册选择。"); return }; avatarSelection = UUID(); let id = avatarSelection
        let open: () -> Void = { [weak self] in guard let self = self, self.avatarSelection == id, self.navigationController?.topViewController === self, self.presentedViewController == nil else { return }; let picker = UIImagePickerController(); picker.sourceType = .camera; picker.cameraCaptureMode = .photo; picker.delegate = self; self.present(picker, animated: true) }
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized: open()
        case .notDetermined: AVCaptureDevice.requestAccess(for: .video) { [weak self] allowed in Task { @MainActor in guard let self = self, self.avatarSelection == id, self.navigationController?.topViewController === self else { return }; if allowed { open() } else { self.showNativeNotice("请在系统设置中允许相机，或从相册选择头像。") } } }
        default: showNativeNotice("请在系统设置中允许相机，或从相册选择头像。")
        }
    }
    func imagePickerControllerDidCancel(_ picker: UIImagePickerController) { picker.dismiss(animated: true) }
    func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
        let id = avatarSelection; let image = info[.originalImage] as? UIImage
        picker.dismiss(animated: true); DispatchQueue.global(qos: .userInitiated).async { [weak self] in let data = image.flatMap { NativeAvatarEncoding.jpeg(from: $0) }; Task { @MainActor [weak self] in self?.acceptAvatar(data, selection: id, error: nil) } }
    }
    private func acceptAvatar(_ data: Data?, selection: UUID, error: String?) {
        guard avatarSelection == selection, navigationController?.topViewController === self else { return }; avatarProgress = nil
        guard let data = data else { showNativeNotice(error ?? "无法读取图片，请重新选择。"); return }
        perform { [self] in let file = try await context.upload(data: data, filename: "avatar.jpg", contentType: "image/jpeg", purpose: "avatar"); try Task.checkCancellation(); guard avatarSelection == selection else { return }; try await update(["nickname": .string(context.profile.nickname), "avatarFileId": .string(file.id), "bio": .string(context.profile.bio)]); reloadContent() }
    }
}

private enum NativeAvatarEncoding {
    static func jpeg(from url: URL) -> Data? {
        guard let source = CGImageSourceCreateWithURL(url as CFURL, [kCGImageSourceShouldCache: false] as CFDictionary), let image = CGImageSourceCreateThumbnailAtIndex(source, 0, [kCGImageSourceCreateThumbnailFromImageAlways: true, kCGImageSourceThumbnailMaxPixelSize: 720, kCGImageSourceCreateThumbnailWithTransform: true, kCGImageSourceShouldCacheImmediately: true] as CFDictionary) else { return nil }
        return UIImage(cgImage: image).jpegData(compressionQuality: 0.85)
    }
    static func jpeg(from image: UIImage) -> Data? {
        guard image.size.width > 0, image.size.height > 0 else { return nil }; let scale = min(1, 720 / max(image.size.width, image.size.height)); let format = UIGraphicsImageRendererFormat(); format.scale = 1
        return UIGraphicsImageRenderer(size: CGSize(width: image.size.width * scale, height: image.size.height * scale), format: format).image { _ in image.draw(in: CGRect(x: 0, y: 0, width: image.size.width * scale, height: image.size.height * scale)) }.jpegData(compressionQuality: 0.85)
    }
}

@MainActor
final class NativeQRCodeController: UIViewController {
    private let context: NativeBusinessContext; private let groupID: String?; private let service: NativeIMService?
    private let scroll = UIScrollView(); private let card = UIView(); private let avatar = NativeRemoteImageView(); private let initial = UILabel()
    private let image = UIImageView(); private let label = UILabel(); private let errorLabel = UILabel(); private let footer = UIView(); private let divider = UIView()
    private let saveButton = UIButton(type: .custom); private let shareButton = UIButton(type: .custom)
    private var loadTask: Task<Void, Never>?; private var saveTask: Task<Void, Never>?; private var loadID = UUID(); private var payload = ""
    init(context: NativeBusinessContext, groupID: String? = nil, service: NativeIMService? = nil) { self.context = context; self.groupID = groupID; self.service = service; super.init(nibName: nil, bundle: nil); title = groupID == nil ? "二维码" : "群二维码" }
    required init?(coder: NSCoder) { fatalError("不使用 Storyboard") }
    override func viewDidLoad() {
        super.viewDidLoad(); view.backgroundColor = UIColor(hex: 0xf3f4f7); scroll.contentInsetAdjustmentBehavior = .never; view.addSubview(scroll); scroll.addSubview(card); card.backgroundColor = .white
        image.contentMode = .scaleAspectFit; image.layer.magnificationFilter = .nearest; avatar.contentMode = .scaleAspectFill; avatar.clipsToBounds = true; avatar.backgroundColor = UIColor(hex: 0xeef1f6)
        label.text = context.profile.nickname; label.textColor = NativeUITheme.body; initial.textColor = .white; initial.textAlignment = .center; initial.backgroundColor = NativeUITheme.primary; initial.clipsToBounds = true
        errorLabel.numberOfLines = 0; errorLabel.textAlignment = .center; errorLabel.textColor = NativeUITheme.secondary
        [avatar, initial, label, image, errorLabel].forEach { card.addSubview($0) }; view.addSubview(footer); footer.backgroundColor = .white; divider.backgroundColor = UIColor(hex: 0xe1e3ea); footer.addSubview(divider)
        configure(saveButton, title: "保存", icon: "uni_icon_download", action: #selector(save)); configure(shareButton, title: "分享", icon: "uni_icon_share", action: #selector(share))
        var actions = [UIBarButtonItem(customView: makeNavButton("uni_icon_share", label: "分享", action: #selector(share)))]
        if service != nil { actions.append(UIBarButtonItem(customView: makeNavButton("uni_icon_scan", label: "扫一扫", action: #selector(scan)))) }; navigationItem.rightBarButtonItems = actions
        image.isUserInteractionEnabled = true; image.addGestureRecognizer(UILongPressGestureRecognizer(target: self, action: #selector(longPress(_:))))
    }
    override func viewWillAppear(_ animated: Bool) { super.viewWillAppear(animated); navigationController?.setNavigationBarHidden(false, animated: animated); load() }
    override func viewWillDisappear(_ animated: Bool) { super.viewWillDisappear(animated); loadID = UUID(); loadTask?.cancel(); loadTask = nil; saveTask?.cancel(); saveTask = nil }
    private func configure(_ button: UIButton, title: String, icon: String, action: Selector) {
        let picture = UIImageView(image: NativeUITheme.image(icon)); picture.tag = 1; picture.contentMode = .scaleAspectFit; let text = NativeUITheme.label(title, size: 12, color: NativeUITheme.secondary); text.tag = 2; text.textAlignment = .center; button.addSubview(picture); button.addSubview(text); button.accessibilityLabel = title; button.addTarget(self, action: action, for: .touchUpInside); footer.addSubview(button)
    }
    private func makeNavButton(_ icon: String, label: String, action: Selector) -> UIButton { let button = NativeUITheme.imageButton(icon, accessibility: label); button.frame = CGRect(x: 0, y: 0, width: 32, height: 32); button.imageEdgeInsets = UIEdgeInsets(top: 5, left: 5, bottom: 5, right: 5); button.addTarget(self, action: action, for: .touchUpInside); return button }
    private func load() {
        loadTask?.cancel(); let id = UUID(); loadID = id; payload = ""; image.image = nil; errorLabel.text = "加载中..."; saveButton.isEnabled = false; shareButton.isEnabled = false
        loadTask = Task { [weak self] in
            guard let self = self else { return }
            do {
                let result: NativeQR = try await self.context.request(self.groupID.map { "groups/\($0)/qrcode" } ?? "me/qrcode"); try Task.checkCancellation()
                let identity = self.groupID == nil ? result.user : result.group
                var name = identity?.nickname ?? identity?.name ?? self.context.profile.nickname; var photo = identity?.avatar ?? (self.groupID == nil ? self.context.profile.avatar : "")
                if let groupID = self.groupID { let group: NativeGroup = try await self.context.request("groups/\(groupID)"); name = group.name; photo = group.avatar }; try Task.checkCancellation()
                let filter = CIFilter.qrCodeGenerator(); filter.message = Data(result.payload.utf8)
                guard let output = filter.outputImage, let bitmap = CIContext().createCGImage(output.transformed(by: CGAffineTransform(scaleX: 10, y: 10)), from: output.extent.applying(CGAffineTransform(scaleX: 10, y: 10))) else { throw APIError.invalidResponse }
                guard self.loadID == id else { return }; self.label.text = name; self.initial.text = String(name.prefix(1)); self.initial.isHidden = !photo.isEmpty; self.avatar.isHidden = photo.isEmpty; self.avatar.load(photo, policy: self.context.media)
                self.image.image = UIImage(cgImage: bitmap); self.payload = result.payload; self.errorLabel.text = nil; self.saveButton.isEnabled = true; self.shareButton.isEnabled = true
            } catch is CancellationError { } catch { guard self.loadID == id else { return }; self.errorLabel.text = "二维码加载失败\n\(error.localizedDescription)" }
        }
    }
    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews(); let w = view.bounds.width; let r: (CGFloat) -> CGFloat = { NativeUITheme.rpx($0, width: w) }; let top = view.safeAreaInsets.top; let bottom = view.safeAreaInsets.bottom; let footerHeight = r(132) + bottom
        footer.frame = CGRect(x: 0, y: view.bounds.height - footerHeight, width: w, height: footerHeight); divider.frame = CGRect(x: 0, y: 0, width: w, height: max(0.5, r(1)))
        for (index, button) in [saveButton, shareButton].enumerated() { button.frame = CGRect(x: CGFloat(index) * w / 2, y: 0, width: w / 2, height: r(132)); button.viewWithTag(1)?.frame = CGRect(x: w / 4 - r(22), y: r(28), width: r(44), height: r(44)); button.viewWithTag(2)?.frame = CGRect(x: 0, y: r(80), width: w / 2, height: r(28)); (button.viewWithTag(2) as? UILabel)?.font = .systemFont(ofSize: r(24)) }
        scroll.frame = CGRect(x: 0, y: top, width: w, height: max(0, footer.frame.minY - top)); let height = max(scroll.bounds.height, r(820)); card.frame = CGRect(x: 0, y: 0, width: w, height: height); scroll.contentSize = CGSize(width: w, height: height)
        avatar.frame = CGRect(x: r(40), y: r(32), width: r(88), height: r(88)); avatar.layer.cornerRadius = r(44); initial.frame = avatar.frame; initial.layer.cornerRadius = r(44); initial.font = .systemFont(ofSize: r(36), weight: .semibold)
        label.frame = CGRect(x: r(148), y: r(32), width: w - r(188), height: r(88)); label.font = .systemFont(ofSize: r(34), weight: .semibold); image.frame = CGRect(x: (w - r(560)) / 2, y: r(168), width: r(560), height: r(560)); errorLabel.frame = image.frame; errorLabel.font = .systemFont(ofSize: r(28))
    }
    private func cardImage() -> UIImage? {
        guard image.image != nil, !payload.isEmpty else { return nil }; let size = CGSize(width: 750, height: 820); let format = UIGraphicsImageRendererFormat(); format.scale = 1
        return UIGraphicsImageRenderer(size: size, format: format).image { renderer in
            UIColor.white.setFill(); renderer.fill(CGRect(origin: .zero, size: size)); let avatarRect = CGRect(x: 40, y: 32, width: 88, height: 88); renderer.cgContext.saveGState(); UIBezierPath(ovalIn: avatarRect).addClip()
            if !avatar.isHidden, let photo = avatar.image, photo.size.width > 0, photo.size.height > 0 { let scale = max(88 / photo.size.width, 88 / photo.size.height); let target = CGSize(width: photo.size.width * scale, height: photo.size.height * scale); photo.draw(in: CGRect(x: avatarRect.midX - target.width / 2, y: avatarRect.midY - target.height / 2, width: target.width, height: target.height)) } else { NativeUITheme.primary.setFill(); renderer.fill(avatarRect); let text = String((label.text ?? "?").prefix(1)) as NSString; text.draw(at: CGPoint(x: 65, y: 53), withAttributes: [.font: UIFont.systemFont(ofSize: 36, weight: .semibold), .foregroundColor: UIColor.white]) }; renderer.cgContext.restoreGState()
            let paragraph = NSMutableParagraphStyle(); paragraph.lineBreakMode = .byTruncatingTail; (label.text ?? "").draw(in: CGRect(x: 148, y: 56, width: 562, height: 48), withAttributes: [.font: UIFont.systemFont(ofSize: 34, weight: .semibold), .foregroundColor: NativeUITheme.body, .paragraphStyle: paragraph]); renderer.cgContext.interpolationQuality = .none; image.image?.draw(in: CGRect(x: 95, y: 168, width: 560, height: 560))
        }
    }
    @objc private func scan() { guard let service = service else { return }; navigationController?.pushViewController(NativeQRScannerController(service: service), animated: true) }
    @objc private func longPress(_ gesture: UILongPressGestureRecognizer) { if gesture.state == .began { share() } }
    @objc private func share() { guard let card = cardImage() else { return }; let sheet = UIActivityViewController(activityItems: [card], applicationActivities: nil); sheet.popoverPresentationController?.sourceView = shareButton; sheet.popoverPresentationController?.sourceRect = shareButton.bounds; present(sheet, animated: true) }
    @objc private func save() {
        guard saveTask == nil, let card = cardImage() else { return }; saveButton.isEnabled = false
        saveTask = Task { [weak self] in
            guard let self = self else { return }; defer { self.saveTask = nil; self.saveButton.isEnabled = self.image.image != nil }
            let authorization = await PHPhotoLibrary.requestAuthorization(for: .addOnly); guard !Task.isCancelled else { return }
            guard authorization == .authorized || authorization == .limited else { if self.navigationController?.topViewController === self { self.showNativeNotice("请在系统设置中允许添加照片后重试。") }; return }
            do { try await PHPhotoLibrary.shared().performChanges { PHAssetChangeRequest.creationRequestForAsset(from: card) }; guard !Task.isCancelled, self.navigationController?.topViewController === self else { return }; self.showNativeNotice("已保存到相册。") } catch { guard !Task.isCancelled, self.navigationController?.topViewController === self else { return }; self.showNativeNotice(error.localizedDescription) }
        }
    }
}

private final class NativeProfileIDCell: UITableViewCell {
    private let label = UILabel(); private let value = UILabel(); private let copyButton = UIButton(type: .system); private let arrow = UIImageView(image: NativeUITheme.image("uni_mine_icon_chevron"))
    var publicID = "" { didSet { value.text = publicID } }; var copyID: (() -> Void)?
    override init(style: UITableViewCell.CellStyle, reuseIdentifier: String?) { super.init(style: .default, reuseIdentifier: reuseIdentifier); label.text = "聊天号"; copyButton.setTitle("复制", for: .normal); copyButton.setTitleColor(NativeUITheme.primary, for: .normal); copyButton.addTarget(self, action: #selector(copyTapped), for: .touchUpInside); [label, value, copyButton, arrow].forEach { contentView.addSubview($0) }; value.textColor = NativeUITheme.secondary; arrow.contentMode = .scaleAspectFit }
    required init?(coder: NSCoder) { fatalError("不使用 Storyboard") }
    override func layoutSubviews() { super.layoutSubviews(); let r = bounds.width / 750; label.font = .systemFont(ofSize: 32 * r); value.font = .systemFont(ofSize: 28 * r); copyButton.titleLabel?.font = .systemFont(ofSize: 24 * r); label.frame = CGRect(x: 32 * r, y: 0, width: 130 * r, height: bounds.height); arrow.frame = CGRect(x: bounds.width - 72 * r, y: (bounds.height - 40 * r) / 2, width: 40 * r, height: 40 * r); copyButton.frame = CGRect(x: arrow.frame.minX - 88 * r, y: 0, width: 72 * r, height: bounds.height); value.frame = CGRect(x: 168 * r, y: 0, width: max(0, copyButton.frame.minX - 180 * r), height: bounds.height); value.textAlignment = .right }
    @objc private func copyTapped() { copyID?() }
    override func prepareForReuse() { super.prepareForReuse(); copyID = nil }
}
