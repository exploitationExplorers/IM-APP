import UIKit
import AVFoundation
import PhotosUI
import CoreImage
import IMCore
import ImageIO
import UniformTypeIdentifiers

/// 主线程的可见性改变立即作废队列中的旧启动请求。
private final class NativeQRCaptureGate: @unchecked Sendable {
    private let lock = NSLock(); private var value: UUID?
    func activate() -> UUID { lock.lock(); defer { lock.unlock() }; let id = UUID(); value = id; return id }
    func invalidate() { lock.lock(); value = nil; lock.unlock() }
    func permits(_ id: UUID) -> Bool { lock.lock(); defer { lock.unlock() }; return value == id }
}

@MainActor
final class NativeQRScannerController: UIViewController, AVCaptureMetadataOutputObjectsDelegate, PHPickerViewControllerDelegate {
    private let service: NativeIMService
    private let capture = AVCaptureSession()
    private let queue = DispatchQueue(label: "im.qr.camera")
    private var preview: AVCaptureVideoPreviewLayer?
    private var configured = false; private var configuring = false; private var isVisible = false
    private let captureGate = NativeQRCaptureGate(); private var appearanceID = UUID()
    private var handling = false
    private var resolveTask: Task<Void, Never>?
    private let hint = UILabel()
    init(service: NativeIMService) { self.service = service; super.init(nibName: nil, bundle: nil); title = "扫一扫" }
    required init?(coder: NSCoder) { fatalError("不使用 Storyboard") }
    override func viewDidLoad() {
        super.viewDidLoad(); view.backgroundColor = .black
        navigationItem.rightBarButtonItem = UIBarButtonItem(title: "相册", style: .plain, target: self, action: #selector(album))
        hint.text = "将二维码放入取景框内，即可自动扫描"; hint.textColor = .white; hint.textAlignment = .center; hint.numberOfLines = 0
        view.addSubview(hint)
    }
    override func viewDidLayoutSubviews() { super.viewDidLayoutSubviews(); preview?.frame = view.bounds; hint.frame = CGRect(x: 24, y: view.bounds.height - view.safeAreaInsets.bottom - 105, width: view.bounds.width - 48, height: 70) }
    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated); navigationController?.setNavigationBarHidden(false, animated: animated); handling = false; isVisible = true; appearanceID = captureGate.activate(); let id = appearanceID
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized: start()
        case .notDetermined: AVCaptureDevice.requestAccess(for: .video) { [weak self] allowed in Task { @MainActor in guard let self = self, self.isVisible, self.appearanceID == id else { return }; if allowed { self.start() } else { self.hint.text = "请在系统设置中允许相机，或从相册识别二维码。" } } }
        default: hint.text = "请在系统设置中允许相机，或从相册识别二维码。"
        }
    }
    private func start() {
        guard isVisible, !handling, navigationController?.topViewController === self else { return }
        let session = capture, gate = captureGate, id = appearanceID
        if configured { queue.async { guard gate.permits(id) else { return }; if !session.isRunning { session.startRunning() } }; return }
        guard !configuring else { return }; configuring = true
        queue.async { [weak self] in
            guard gate.permits(id) else { Task { @MainActor [weak self] in guard let self = self else { return }; self.configuring = false; if self.isVisible { self.start() } }; return }
            do {
                guard let camera = AVCaptureDevice.default(for: .video) else { throw APIError.business(code: -1, message: "此设备没有可用摄像头，请从相册识别二维码。") }
                let input = try AVCaptureDeviceInput(device: camera); let output = AVCaptureMetadataOutput()
                session.beginConfiguration()
                guard session.canAddInput(input), session.canAddOutput(output) else { session.commitConfiguration(); throw APIError.invalidResponse }
                session.addInput(input); session.addOutput(output); output.metadataObjectTypes = [.qr]; session.commitConfiguration()
                Task { @MainActor [weak self] in
                    guard let self = self else { return }; self.configured = true; self.configuring = false; output.setMetadataObjectsDelegate(self, queue: .main)
                    let layer = AVCaptureVideoPreviewLayer(session: session); layer.videoGravity = .resizeAspectFill; self.preview = layer; self.view.layer.insertSublayer(layer, at: 0); self.view.setNeedsLayout()
                    guard self.isVisible, !self.handling else { return }; self.start()
                }
            } catch { Task { @MainActor [weak self] in guard let self = self else { return }; self.configured = false; self.configuring = false; if self.isVisible, self.appearanceID == id { self.hint.text = error.localizedDescription } } }
        }
    }
    override func viewWillDisappear(_ animated: Bool) { super.viewWillDisappear(animated); isVisible = false; captureGate.invalidate(); let session = capture; queue.async { if session.isRunning { session.stopRunning() } }; resolveTask?.cancel() }
    func metadataOutput(_ output: AVCaptureMetadataOutput, didOutput metadataObjects: [AVMetadataObject], from connection: AVCaptureConnection) {
        guard let text = (metadataObjects.first as? AVMetadataMachineReadableCodeObject)?.stringValue else { return }; resolve(text)
    }
    @objc private func album() { var config = PHPickerConfiguration(); config.filter = .images; config.selectionLimit = 1; let picker = PHPickerViewController(configuration: config); picker.delegate = self; present(picker, animated: true) }
    func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
        let provider = results.first?.itemProvider
        picker.dismiss(animated: true) { [weak self] in
            guard let self = self, let provider = provider, self.isVisible else { return }; let id = self.appearanceID
            provider.loadFileRepresentation(forTypeIdentifier: UTType.image.identifier) { [weak self] url, error in
                do {
                    guard let url = url else { throw error ?? APIError.invalidResponse }
                    let size = (try FileManager.default.attributesOfItem(atPath: url.path)[.size] as? NSNumber)?.intValue ?? Int.max
                    guard size <= 30 * 1024 * 1024, let source = CGImageSourceCreateWithURL(url as CFURL, [kCGImageSourceShouldCache: false] as CFDictionary), let bitmap = CGImageSourceCreateThumbnailAtIndex(source, 0, [kCGImageSourceCreateThumbnailFromImageAlways: true, kCGImageSourceCreateThumbnailWithTransform: true, kCGImageSourceThumbnailMaxPixelSize: 1600, kCGImageSourceShouldCacheImmediately: true] as CFDictionary) else { throw APIError.business(code: -1, message: "无法读取图片，请选择 30 MB 以内的图片。") }
                    let detector = CIDetector(ofType: CIDetectorTypeQRCode, context: nil, options: [CIDetectorAccuracy: CIDetectorAccuracyHigh])
                    let text = (detector?.features(in: CIImage(cgImage: bitmap)) as? [CIQRCodeFeature])?.compactMap(\.messageString).first
                    Task { @MainActor [weak self] in guard let self = self, self.isVisible, self.appearanceID == id, self.navigationController?.topViewController === self else { return }; if let text = text { self.resolve(text) } else { self.showNativeNotice("图片中未识别到二维码。") } }
                } catch { Task { @MainActor [weak self] in guard let self = self, self.isVisible, self.appearanceID == id else { return }; self.showNativeNotice(error.localizedDescription) } }
            }
        }
    }
    private func resolve(_ raw: String) {
        guard isVisible, navigationController?.topViewController === self, !handling, !raw.isEmpty else { return }; handling = true; hint.text = "正在识别…"
        let session = capture; queue.async { if session.isRunning { session.stopRunning() } }
        let payload = QRBusinessPayload(raw)
        if payload.kind == nil {
            // 不把任意扫码结果发给外部网站；类型不明时由用户选择既有业务解析入口。
            let sheet = UIAlertController(title: "识别二维码", message: "请选择二维码类型", preferredStyle: .actionSheet)
            for (title, kind) in [("个人二维码", "user"), ("群二维码", "group")] { sheet.addAction(UIAlertAction(title: title, style: .default) { [weak self] _ in self?.openResult(payload, kind: kind) }) }
            sheet.addAction(UIAlertAction(title: "取消", style: .cancel) { [weak self] _ in self?.handling = false; self?.start() }); sheet.popoverPresentationController?.sourceView = view; present(sheet, animated: true)
        } else { openResult(payload, kind: payload.kind!) }
    }
    private func openResult(_ payload: QRBusinessPayload, kind: String) {
        let page = NativeQRResultController(service: service, payload: payload, kind: kind)
        navigationController?.pushViewController(page, animated: true)
    }
}

private struct NativeQRUserResult: Decodable { let user: NativeContact; let relation: String }
private struct NativeQRGroupResult: Decodable { let group: NativeGroup; let joined: Bool; let joinMode: String; let nextAction: String }
private struct NativeQRGroupJoin: Decodable { let action: String; let group: NativeGroup; let requestId: String? }

@MainActor
final class NativeQRResultController: NativeBusinessListController {
    private let service: NativeIMService; private let payload: QRBusinessPayload; private let kind: String
    private var user: NativeContact?; private var group: NativeGroup?; private var relation = "none"; private var nextAction = "join"
    init(service: NativeIMService, payload: QRBusinessPayload, kind: String) { self.service = service; self.payload = payload; self.kind = kind; super.init(title: "识别结果", context: service.business) }
    required init?(coder: NSCoder) { fatalError("不使用 Storyboard") }
    override func reloadContent() {
        perform { [self] in
            if kind == "group" {
                let result: NativeQRGroupResult = try await context.request("groups/qrcode/resolve", method: "POST", body: payload.requestBody); group = result.group; nextAction = result.nextAction
            } else if let id = payload.publicID, payload.token == nil {
                user = try await context.request("users/search", query: [URLQueryItem(name: "publicId", value: id)]); relation = user?.id == context.userID ? "self" : "none"
            } else {
                let result: NativeQRUserResult = try await context.request("users/qrcode/resolve", method: "POST", body: payload.requestBody); user = result.user; relation = result.relation
            }; render()
        }
    }
    private func render() {
        if let group = group {
            let button = nextAction == "enter" ? "进入群聊" : nextAction == "apply" ? "申请加入" : nextAction == "pending" ? "已提交申请" : "加入群组"
            setRows([[NativeBusinessRow(title: group.name, detail: "群成员 \(group.memberCount ?? 0) 人", avatar: group.avatar)], [NativeBusinessRow(title: button, action: nextAction == "pending" ? nil : { [weak self] in self?.groupAction() })]])
        } else if let user = user {
            let labels = ["friend": "发消息", "pending": "已发送申请", "blocked": "无法添加", "self": "这是你自己"]
            let allowed = !["pending", "blocked", "self"].contains(relation)
            setRows([[NativeBusinessRow(title: user.displayName, detail: user.publicId ?? "", avatar: user.avatar)], [NativeBusinessRow(title: labels[relation] ?? "添加到通讯录", action: allowed ? { [weak self] in self?.userAction() } : nil)]])
        }
    }
    private func userAction() {
        guard let user = user else { return }
        if relation == "friend" {
            perform { [self] in let peer: NativePeer = try await context.request("im/peers/\(user.id)"); guard peer.canChat else { throw APIError.business(code: -1, message: peer.denyReason ?? "当前不能发起聊天。") }; let chat = try await service.openConversation(target: peer.imUserId, type: 1); push(NativeConversationViewController(service: service, conversation: chat)) }
        } else {
            edit(title: "申请添加朋友", value: "我是\(context.profile.nickname)") { [weak self] message in
                guard let self = self else { return }; struct Result: Decodable { let status: String? }
                let result: Result = try await self.context.request("friend-requests", method: "POST", body: ["toUserId": .string(user.id), "message": .string(message)])
                self.relation = result.status == "accepted" ? "friend" : "pending"; self.render()
            }
        }
    }
    private func groupAction() {
        guard let group = group else { return }
        if nextAction == "enter" { openGroup(group); return }
        if nextAction == "apply" { edit(title: "入群申请", placeholder: "填写申请说明") { [weak self] value in try await self?.join(remark: value) } }
        else { perform { [self] in try await join(remark: "") } }
    }
    private func join(remark: String) async throws {
        var body = payload.requestBody; body["remark"] = .string(remark)
        let result: NativeQRGroupJoin = try await context.request("groups/qrcode/join", method: "POST", body: body)
        group = result.group
        if result.action == "pending_approval" { nextAction = "pending"; render() } else { nextAction = "enter"; render(); openGroup(result.group) }
    }
    private func openGroup(_ group: NativeGroup) {
        // 允许已入群的禁言成员进入历史，只由发送入口校验 canChat。
        Task { do { let peer: NativeGroupPeer = try await context.request("im/groups/\(group.id)"); let chat = try await service.openConversation(target: peer.imGroupId, type: 3); push(NativeConversationViewController(service: service, conversation: chat)) } catch { showNativeNotice(error.localizedDescription) } }
    }
}
