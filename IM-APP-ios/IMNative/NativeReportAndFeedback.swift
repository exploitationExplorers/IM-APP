import UIKit
import PhotosUI
import IMCore

private struct NativeReportReason: Decodable { let id: String; let reason: String }

@MainActor
final class NativeReportController: NativeBusinessListController {
    private let targetID: String; private let group: Bool
    init(context: NativeBusinessContext, targetID: String, group: Bool) { self.targetID = targetID; self.group = group; super.init(title: "检举", context: context) }
    required init?(coder: NSCoder) { fatalError("不使用 Storyboard") }
    override func reloadContent() {
        if group {
            let reasons = [("spam", "垃圾广告"), ("fraud", "欺诈骗钱"), ("pornography", "色情低俗"), ("violence", "暴力恐吓"), ("harassment", "骚扰辱骂"), ("other", "其他")]
            setRows([reasons.map { key, title in NativeBusinessRow(title: title, action: { [weak self] in self?.open(reason: key, label: title) }) }])
        } else {
            perform { [self] in let reasons: [NativeReportReason] = try await context.request("report-reasons", query: [URLQueryItem(name: "targetType", value: "user"), URLQueryItem(name: "language", value: "zh")]); setRows([reasons.map { item in NativeBusinessRow(title: item.reason, action: { [weak self] in self?.open(reason: item.id, label: item.reason) }) }]) }
        }
    }
    private func open(reason: String, label: String) {
        let destination = NativeEvidenceFormController(context: context, mode: group ? .groupReport(targetID, reason) : .userReport(targetID, reason), title: label)
        destination.onSubmitted = { [weak self] in guard let self = self else { return }; if let index = self.navigationController?.viewControllers.firstIndex(where: { $0 === self }), index > 0, let previous = self.navigationController?.viewControllers[index - 1] { self.navigationController?.popToViewController(previous, animated: true); previous.showNativeNotice("已送出。") } }
        push(destination)
    }
}

/// 原表单的说明、联系方式与截图均真实提交；图片先上传获取 fileId。
@MainActor
final class NativeEvidenceFormController: UIViewController, PHPickerViewControllerDelegate, UITextViewDelegate {
    enum Mode { case feedback, userReport(String, String), groupReport(String, String) }
    private let context: NativeBusinessContext; private let mode: Mode
    private let scroll = UIScrollView(); private let stack = UIStackView(); private let contact = UITextField(); private let content = UITextView(); private let count = UILabel(); private let images = UIStackView(); private let add = UIButton(type: .system)
    private var evidence: [Data] = []; private var submitting = false; private var task: Task<Void, Never>?
    var onSubmitted: (() -> Void)?
    private var isFeedback: Bool { if case .feedback = mode { return true }; return false }
    private var isGroup: Bool { if case .groupReport = mode { return true }; return false }
    private var maxLength: Int { isFeedback || isGroup ? 200 : 1000 }
    private var maxImages: Int { isFeedback ? 1 : 9 }
    init(context: NativeBusinessContext, mode: Mode, title: String) { self.context = context; self.mode = mode; super.init(nibName: nil, bundle: nil); self.title = title }
    required init?(coder: NSCoder) { fatalError("不使用 Storyboard") }
    override func viewDidLoad() {
        super.viewDidLoad(); view.backgroundColor = UIColor(hex: 0xf5f6f8)
        navigationItem.rightBarButtonItem = UIBarButtonItem(title: "送出", style: .done, target: self, action: #selector(submit))
        scroll.translatesAutoresizingMaskIntoConstraints = false; view.addSubview(scroll); stack.translatesAutoresizingMaskIntoConstraints = false; stack.axis = .vertical; stack.spacing = 14; scroll.addSubview(stack)
        NSLayoutConstraint.activate([scroll.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor), scroll.leadingAnchor.constraint(equalTo: view.leadingAnchor), scroll.trailingAnchor.constraint(equalTo: view.trailingAnchor), scroll.bottomAnchor.constraint(equalTo: view.keyboardLayoutGuide.topAnchor), stack.topAnchor.constraint(equalTo: scroll.contentLayoutGuide.topAnchor, constant: 20), stack.leadingAnchor.constraint(equalTo: scroll.contentLayoutGuide.leadingAnchor, constant: 20), stack.trailingAnchor.constraint(equalTo: scroll.contentLayoutGuide.trailingAnchor, constant: -20), stack.bottomAnchor.constraint(equalTo: scroll.contentLayoutGuide.bottomAnchor, constant: -24), stack.widthAnchor.constraint(equalTo: scroll.frameLayoutGuide.widthAnchor, constant: -40)])
        if isFeedback { stack.addArrangedSubview(NativeUITheme.label("联系方式", size: 16)); contact.placeholder = "手机号码、邮箱、QQ、微信等"; contact.backgroundColor = .white; contact.borderStyle = .roundedRect; contact.heightAnchor.constraint(equalToConstant: 48).isActive = true; stack.addArrangedSubview(contact) }
        stack.addArrangedSubview(NativeUITheme.label(isFeedback ? "反馈内容" : "补充说明", size: 16))
        content.backgroundColor = .white; content.layer.cornerRadius = 6; content.font = .systemFont(ofSize: 16); content.delegate = self; content.textContainerInset = UIEdgeInsets(top: 12, left: 12, bottom: 12, right: 12); content.heightAnchor.constraint(equalToConstant: 180).isActive = true; stack.addArrangedSubview(content)
        count.font = .systemFont(ofSize: 12); count.textColor = NativeUITheme.secondary; count.textAlignment = .right; stack.addArrangedSubview(count)
        let note = NativeUITheme.label(isGroup ? "请填写 5～200 字说明，可上传最多 9 张截图。" : isFeedback ? "请描述遇到的问题，可上传 1 张截图。" : "说明为选填，可上传最多 9 张截图。", size: 13, color: NativeUITheme.secondary); note.numberOfLines = 0; stack.addArrangedSubview(note)
        images.axis = .vertical; images.spacing = 12; stack.addArrangedSubview(images)
        add.setTitle("＋ 添加截图", for: .normal); add.addTarget(self, action: #selector(addImages), for: .touchUpInside); stack.addArrangedSubview(add); textViewDidChange(content)
    }
    override func viewWillAppear(_ animated: Bool) { super.viewWillAppear(animated); navigationController?.setNavigationBarHidden(false, animated: animated) }
    func textViewDidChange(_ textView: UITextView) { if textView.markedTextRange == nil, textView.text.count > maxLength { textView.text = String(textView.text.prefix(maxLength)) }; count.text = "\(textView.text.count)/\(maxLength)" }
    @objc private func addImages() { guard !submitting, evidence.count < maxImages else { return }; var config = PHPickerConfiguration(); config.filter = .images; config.selectionLimit = maxImages - evidence.count; let picker = PHPickerViewController(configuration: config); picker.delegate = self; present(picker, animated: true) }
    func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
        picker.dismiss(animated: true)
        for result in results { result.itemProvider.loadObject(ofClass: UIImage.self) { [weak self] value, error in
            guard let image = value as? UIImage else { Task { @MainActor in self?.showNativeNotice(error?.localizedDescription ?? "无法读取截图。") }; return }
            let scale = min(1, 1920 / max(image.size.width, image.size.height)); let size = CGSize(width: image.size.width * scale, height: image.size.height * scale)
            let format = UIGraphicsImageRendererFormat(); format.scale = 1
            let rendered = UIGraphicsImageRenderer(size: size, format: format).image { _ in image.draw(in: CGRect(origin: .zero, size: size)) }
            guard let data = rendered.jpegData(compressionQuality: 0.85) else { return }
            Task { @MainActor [weak self] in guard let self = self, !self.submitting, self.evidence.count < self.maxImages else { return }; self.evidence.append(data); self.renderImages() }
        } }
    }
    private func renderImages() {
        images.arrangedSubviews.forEach { images.removeArrangedSubview($0); $0.removeFromSuperview() }
        for (index, data) in evidence.enumerated() {
            let row = UIStackView(); row.axis = .horizontal; row.spacing = 12
            let image = UIImageView(image: UIImage(data: data)); image.contentMode = .scaleAspectFit; image.widthAnchor.constraint(equalToConstant: 100).isActive = true; image.heightAnchor.constraint(equalToConstant: 100).isActive = true
            let remove = UIButton(type: .system); remove.setTitle("删除截图", for: .normal); remove.addAction(UIAction { [weak self] _ in guard let self = self, !self.submitting, index < self.evidence.count else { return }; self.evidence.remove(at: index); self.renderImages() }, for: .touchUpInside)
            row.addArrangedSubview(image); row.addArrangedSubview(remove); images.addArrangedSubview(row)
        }; add.isHidden = evidence.count >= maxImages
    }
    @objc private func submit() {
        guard !submitting else { return }; let text = content.text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard (!isFeedback || !text.isEmpty), (!isGroup || text.count >= 5), text.count <= maxLength, (contact.text?.count ?? 0) <= 64 else { showNativeNotice(isGroup ? "请填写 5～200 字说明。" : "请检查内容和联系方式。 "); return }
        submitting = true; navigationItem.rightBarButtonItem?.isEnabled = false; content.isEditable = false; contact.isEnabled = false; add.isEnabled = false
        let snapshots = evidence
        task = Task {
            defer { submitting = false; navigationItem.rightBarButtonItem?.isEnabled = true; content.isEditable = true; contact.isEnabled = true; add.isEnabled = true; task = nil }
            do {
                var ids: [JSONValue] = []
                for data in snapshots { let file = try await context.upload(data: data, filename: "evidence.jpg", contentType: "image/jpeg", purpose: "image"); try Task.checkCancellation(); ids.append(.string(file.id)) }
                switch mode {
                case .feedback: try await context.change("feedbacks", body: ["contact": .string(contact.text ?? ""), "content": .string(text), "imageFileIds": .array(ids)])
                case .userReport(let id, let reason): try await context.change("reports", body: ["targetType": .string("user"), "targetId": .string(id), "reasonId": .string(reason), "description": .string(text), "evidenceFileIds": .array(ids)])
                case .groupReport(let id, let reason): try await context.change("groups/reports", body: ["groupId": .string(id), "reason": .string(reason), "description": .string(text), "imageFileIds": .array(ids)])
                }
                try Task.checkCancellation()
                if let submitted = onSubmitted { submitted() } else { let parent = navigationController?.viewControllers.dropLast().last; navigationController?.popViewController(animated: true); parent?.showNativeNotice("已送出。") }
            } catch { if !Task.isCancelled, view.window != nil { showNativeNotice(error.localizedDescription) } }
        }
    }
    override func viewDidDisappear(_ animated: Bool) { super.viewDidDisappear(animated); if navigationController?.viewControllers.contains(where: { $0 === self }) != true { task?.cancel() } }
}
