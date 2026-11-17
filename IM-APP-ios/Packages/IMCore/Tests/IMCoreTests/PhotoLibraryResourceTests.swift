import XCTest
import ImageIO
@testable import IMCore

final class PhotoLibraryResourceTests: XCTestCase {
    private func withDirectory(_ test: (URL) throws -> Void) throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        try test(directory)
    }
    private func image(at file: URL, type: String, frames: Int = 1) throws {
        let context = try XCTUnwrap(CGContext(data: nil, width: 12, height: 8, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue))
        let destination = try XCTUnwrap(CGImageDestinationCreateWithURL(file as CFURL, type as CFString, frames, nil))
        for frame in 0..<frames {
            context.setFillColor(CGColor(red: CGFloat(frame) / CGFloat(frames), green: 0.5, blue: 1, alpha: 1)); context.fill(CGRect(x: 0, y: 0, width: 12, height: 8))
            let bitmap = try XCTUnwrap(context.makeImage())
            CGImageDestinationAddImage(destination, bitmap, [kCGImagePropertyGIFDictionary: [kCGImagePropertyGIFDelayTime: 0.2]] as CFDictionary)
        }
        XCTAssertTrue(CGImageDestinationFinalize(destination))
    }
    func testExtensionlessPNGIsNamedAndPreservedWithoutChangingOwnedOriginal() throws {
        try withDirectory { directory in
            let input = directory.appendingPathComponent("download-without-extension")
            try image(at: input, type: "public.png")
            let original = try Data(contentsOf: input)
            let resource = try PhotoLibraryResource.prepare(file: input, directory: directory)
            XCTAssertEqual(resource.fileURL.pathExtension, "png")
            XCTAssertEqual(resource.uniformTypeIdentifier, "public.png")
            XCTAssertEqual(resource.originalFilename, resource.fileURL.lastPathComponent)
            XCTAssertNotEqual(resource.fileURL, input)
            XCTAssertEqual(try Data(contentsOf: resource.fileURL), original)
            try FileManager.default.removeItem(at: resource.fileURL)
            XCTAssertEqual(try Data(contentsOf: input), original)
        }
    }
    func testActualTypeOverridesMisleadingJPEGExtension() throws {
        try withDirectory { directory in
            let input = directory.appendingPathComponent("wrong.jpg")
            try image(at: input, type: "public.png")
            let resource = try PhotoLibraryResource.prepare(file: input, directory: directory)
            XCTAssertEqual(resource.uniformTypeIdentifier, "public.png"); XCTAssertEqual(resource.fileURL.pathExtension, "png")
        }
    }
    func testAnimatedGIFPreservesEveryFrameAndOriginalBytes() throws {
        try withDirectory { directory in
            let input = directory.appendingPathComponent("animated-cache")
            try image(at: input, type: "com.compuserve.gif", frames: 3)
            let resource = try PhotoLibraryResource.prepare(file: input, directory: directory)
            XCTAssertEqual(resource.fileURL.pathExtension, "gif")
            XCTAssertEqual(resource.uniformTypeIdentifier, "com.compuserve.gif")
            XCTAssertEqual(try Data(contentsOf: input), try Data(contentsOf: resource.fileURL))
            let output = try XCTUnwrap(CGImageSourceCreateWithURL(resource.fileURL as CFURL, nil))
            XCTAssertEqual(CGImageSourceGetCount(output), 3)
        }
    }
    func testJPEGPreservesFullResolution() throws {
        try withDirectory { directory in
            let input = directory.appendingPathComponent("jpeg-cache")
            try image(at: input, type: "public.jpeg")
            let resource = try PhotoLibraryResource.prepare(file: input, directory: directory)
            XCTAssertEqual(resource.fileURL.pathExtension, "jpg")
            XCTAssertEqual(try Data(contentsOf: input), try Data(contentsOf: resource.fileURL))
        }
    }
    func testStaticWebPConvertsToPNGWithTransparency() throws {
        try withDirectory { directory in
            let fixture = try XCTUnwrap(Bundle.module.url(forResource: "photo-static", withExtension: "webp", subdirectory: "Fixtures"))
            let input = directory.appendingPathComponent("webp-cache")
            try FileManager.default.copyItem(at: fixture, to: input)
            let resource = try PhotoLibraryResource.prepare(file: input, directory: directory)
            XCTAssertEqual(resource.uniformTypeIdentifier, "public.png"); XCTAssertEqual(resource.fileURL.pathExtension, "png")
            let source = try XCTUnwrap(CGImageSourceCreateWithURL(resource.fileURL as CFURL, nil))
            let properties = try XCTUnwrap(CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any])
            XCTAssertEqual(properties[kCGImagePropertyPixelWidth] as? Int, 12)
            XCTAssertEqual(properties[kCGImagePropertyPixelHeight] as? Int, 8)
            XCTAssertEqual(properties[kCGImagePropertyHasAlpha] as? Bool, true)
        }
    }
    func testAnimatedWebPConversionKeepsFramesTimingAndLoop() throws {
        try withDirectory { directory in
            let fixture = try XCTUnwrap(Bundle.module.url(forResource: "photo-animated", withExtension: "webp", subdirectory: "Fixtures"))
            let resource = try PhotoLibraryResource.prepare(file: fixture, directory: directory)
            XCTAssertEqual(resource.uniformTypeIdentifier, "com.compuserve.gif"); XCTAssertEqual(resource.fileURL.pathExtension, "gif")
            let source = try XCTUnwrap(CGImageSourceCreateWithURL(resource.fileURL as CFURL, nil))
            XCTAssertEqual(CGImageSourceGetCount(source), 3)
            let properties = CGImageSourceCopyProperties(source, nil) as? [CFString: Any]
            let gif = properties?[kCGImagePropertyGIFDictionary] as? [CFString: Any]
            XCTAssertEqual(gif?[kCGImagePropertyGIFLoopCount] as? Int, 2)
            for (index, expected) in [0.1, 0.2, 0.3].enumerated() {
                let frame = CGImageSourceCopyPropertiesAtIndex(source, index, nil) as? [CFString: Any]
                let timing = frame?[kCGImagePropertyGIFDictionary] as? [CFString: Any]
                let delay = try XCTUnwrap((timing?[kCGImagePropertyGIFUnclampedDelayTime] ?? timing?[kCGImagePropertyGIFDelayTime]) as? Double)
                XCTAssertEqual(delay, expected, accuracy: 0.01)
            }
        }
    }
    func testInvalidOrTruncatedDownloadIsRejectedBeforePhotosTransaction() throws {
        try withDirectory { directory in
            let input = directory.appendingPathComponent("server-response.png")
            try Data("<html>download failed</html>".utf8).write(to: input)
            XCTAssertThrowsError(try PhotoLibraryResource.prepare(file: input, directory: directory))
            try image(at: input, type: "public.png")
            let truncated = try Data(contentsOf: input).prefix(20)
            try truncated.write(to: input)
            XCTAssertThrowsError(try PhotoLibraryResource.prepare(file: input, directory: directory))
            XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: directory.path), [input.lastPathComponent])
        }
    }
}
