import Foundation
import ImageIO
import UniformTypeIdentifiers
import IMCore

/// 保留原图/动图，磁盘读取与格式检测在后台执行，页面只管理操作状态。
@MainActor
enum NativeStickerAddition {
    static func add(_ message: ChatTextItem, service: NativeIMService, stage: (String) -> Void) async throws {
        guard let media = message.media, media.kind == 102 else { throw APIError.invalidResponse }
        let cacheEpoch = await NativeImageCache.shared.mutationEpoch()
        stage("正在准备原图…")
        let local = service.ownedImageURL(for: message)
        let file: URL
        if let local = local { file = local }
        else {
            let policy = service.business.media, original = policy.original(media.url)
            guard let url = policy.absolute(original), url.scheme == "https" else { throw APIError.invalidResponse }
            if let cached = try await NativeImageCache.shared.copyOriginal(identity: policy.cacheIdentity(original)) { file = cached }
            else { file = try await NativeBoundedDownload(limit: 20 * 1024 * 1024).download(url) }
        }
        defer { if local == nil { try? FileManager.default.removeItem(at: file) } }
        let preparation = Task.detached(priority: .userInitiated) { () throws -> (Data, String, String) in
            try Task.checkCancellation()
            let size = try file.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? Int.max
            guard size > 0, size <= 20 * 1024 * 1024,
                  let source = CGImageSourceCreateWithURL(file as CFURL, nil),
                  let raw = CGImageSourceGetType(source) as String?, let type = UTType(raw), type.conforms(to: .image) else { throw APIError.invalidResponse }
            return (try Data(contentsOf: file, options: .mappedIfSafe), type.preferredMIMEType ?? "image/png", type.preferredFilenameExtension ?? "png")
        }
        let payload = try await withTaskCancellationHandler(operation: { try await preparation.value }, onCancel: { preparation.cancel() })
        try Task.checkCancellation(); guard service.isActive else { throw APIError.cancelled }
        stage("正在上传表情…")
        let uploaded = try await service.business.upload(data: payload.0, filename: "sticker." + payload.2, contentType: payload.1, purpose: "sticker", completing: { stage("正在确认上传…") })
        try Task.checkCancellation(); guard service.isActive else { throw APIError.cancelled }
        stage("正在加入表情包…")
        try await service.business.change("stickers", body: ["fileId": .string(uploaded.id)])
        try Task.checkCancellation(); guard service.isActive else { throw APIError.cancelled }
        if let raw = uploaded.url, !raw.isEmpty {
            let policy = service.business.media
            let identities = policy.imageCandidates(raw, variant: .list).map { policy.cacheIdentity($0) }
            await NativeImageCache.shared.seedOwned(file, identities: identities, expectedEpoch: cacheEpoch)
        }
        try Task.checkCancellation(); guard service.isActive else { throw APIError.cancelled }
    }
}
