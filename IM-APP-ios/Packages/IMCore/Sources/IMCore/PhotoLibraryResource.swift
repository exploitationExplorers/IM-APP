import Foundation
import ImageIO

/// 相册资源必须按实际文件类型命名；不能依赖下载地址或无扩展名的缓存路径。
public struct PhotoLibraryResource: Sendable {
    public let fileURL: URL
    public let uniformTypeIdentifier: String
    public var originalFilename: String { fileURL.lastPathComponent }

    public static func prepare(file: URL, directory: URL = FileManager.default.temporaryDirectory) throws -> Self {
        guard let source = CGImageSourceCreateWithURL(file as CFURL, [kCGImageSourceShouldCache: false] as CFDictionary),
              CGImageSourceGetStatus(source) == .statusComplete,
              CGImageSourceGetCount(source) > 0,
              let type = CGImageSourceGetType(source) as String?,
              let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
              (properties[kCGImagePropertyPixelWidth] as? NSNumber)?.intValue ?? 0 > 0,
              (properties[kCGImagePropertyPixelHeight] as? NSNumber)?.intValue ?? 0 > 0 else {
            throw PreparationError.invalidImage
        }
        let extensions = ["public.jpeg": "jpg", "public.png": "png", "public.heic": "heic", "public.heif": "heif", "com.compuserve.gif": "gif", "public.tiff": "tif"]
        if let ext = extensions[type] {
            let output = directory.appendingPathComponent("IM-" + UUID().uuidString).appendingPathExtension(ext)
            try FileManager.default.copyItem(at: file, to: output)
            return Self(fileURL: output, uniformTypeIdentifier: type)
        }
        guard type.lowercased().contains("webp") else { throw PreparationError.unsupportedImage }
        let count = CGImageSourceGetCount(source)
        guard count <= 240 else { throw PreparationError.animationTooLarge }
        let animated = count > 1
        let outputType = animated ? "com.compuserve.gif" : "public.png"
        let output = directory.appendingPathComponent("IM-" + UUID().uuidString).appendingPathExtension(animated ? "gif" : "png")
        var finished = false
        defer { if !finished { try? FileManager.default.removeItem(at: output) } }
        guard let destination = CGImageDestinationCreateWithURL(output as CFURL, outputType as CFString, count, nil) else { throw PreparationError.invalidImage }
        if animated {
            let properties = CGImageSourceCopyProperties(source, nil) as? [CFString: Any]
            let webp = properties?[kCGImagePropertyWebPDictionary] as? [CFString: Any]
            CGImageDestinationSetProperties(destination, [kCGImagePropertyGIFDictionary: [kCGImagePropertyGIFLoopCount: webp?[kCGImagePropertyWebPLoopCount] ?? 0]] as CFDictionary)
        }
        var pixels = 0
        for index in 0..<count {
            try Task.checkCancellation()
            try autoreleasepool {
                guard let bitmap = CGImageSourceCreateThumbnailAtIndex(source, index, [kCGImageSourceCreateThumbnailFromImageAlways: true, kCGImageSourceCreateThumbnailWithTransform: true, kCGImageSourceThumbnailMaxPixelSize: animated ? 2048 : 4096, kCGImageSourceShouldCacheImmediately: true] as CFDictionary) else { throw PreparationError.invalidImage }
                pixels += bitmap.width * bitmap.height
                guard pixels <= 120_000_000 else { throw PreparationError.animationTooLarge }
                var options: [CFString: Any] = [:]
                if animated {
                    let properties = CGImageSourceCopyPropertiesAtIndex(source, index, nil) as? [CFString: Any]
                    let webp = properties?[kCGImagePropertyWebPDictionary] as? [CFString: Any]
                    let delay = webp?[kCGImagePropertyWebPUnclampedDelayTime] ?? webp?[kCGImagePropertyWebPDelayTime] ?? 0.1
                    options[kCGImagePropertyGIFDictionary] = [kCGImagePropertyGIFDelayTime: delay, kCGImagePropertyGIFUnclampedDelayTime: delay]
                }
                CGImageDestinationAddImage(destination, bitmap, options as CFDictionary)
            }
        }
        guard CGImageDestinationFinalize(destination) else { throw PreparationError.invalidImage }
        finished = true
        return Self(fileURL: output, uniformTypeIdentifier: outputType)
    }

    public enum PreparationError: LocalizedError {
        case invalidImage, unsupportedImage, animationTooLarge
        public var errorDescription: String? {
            switch self {
            case .invalidImage: return "图片文件不完整或已损坏，请重新打开原图后再保存。"
            case .unsupportedImage: return "此图片格式暂不能保存到相册。"
            case .animationTooLarge: return "动图过大，暂不能在本机转换保存。"
            }
        }
    }
}
