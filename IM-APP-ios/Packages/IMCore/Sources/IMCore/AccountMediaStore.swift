import Foundation

/// 只管理自有账号媒体目录，不接触 SDK 数据库。路径校验与文件保护在单一边界维护。
public struct AccountMediaStore: Sendable {
    private let directory: URL

    public init(accountDirectory: URL) {
        directory = accountDirectory.appendingPathComponent("media", isDirectory: true)
            .standardizedFileURL.resolvingSymlinksInPath()
    }

    public func ownedURL(_ path: String) -> URL? {
        let candidate = path.hasPrefix("file:") ? URL(string: path) : URL(fileURLWithPath: path)
        guard let url = candidate?.standardizedFileURL.resolvingSymlinksInPath(), url.isFileURL,
              url.path.hasPrefix(directory.path + "/"),
              (try? url.resourceValues(forKeys: [.isRegularFileKey]).isRegularFile) == true else { return nil }
        return url
    }

    public func create(data: Data, fileExtension: String) throws -> URL {
        let destination = try newDestination(fileExtension: fileExtension)
        try data.write(to: destination, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        return destination
    }

    public func importFile(_ source: URL) throws -> URL {
        let destination = try newDestination(fileExtension: source.pathExtension)
        do {
            try FileManager.default.copyItem(at: source, to: destination)
            #if os(iOS)
            try FileManager.default.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication], ofItemAtPath: destination.path)
            #endif
            return destination
        } catch {
            try? FileManager.default.removeItem(at: destination)
            throw error
        }
    }

    /// 文件复制是同步 API，明确放到独立执行上下文；结束后响应取消并清理新副本。
    public func importInBackground(_ source: URL) async throws -> URL {
        try Task.checkCancellation()
        let file = try await Task.detached(priority: .userInitiated) { try importFile(source) }.value
        do {
            try Task.checkCancellation()
            return file
        } catch {
            try removeOwnedFile(file)
            throw error
        }
    }

    public func removeOwnedFile(_ file: URL) throws {
        guard let owned = ownedURL(file.path) else { throw APIError.invalidResponse }
        try FileManager.default.removeItem(at: owned)
    }

    private func newDestination(fileExtension: String) throws -> URL {
        var attributes: [FileAttributeKey: Any] = [:]
        #if os(iOS)
        attributes[.protectionKey] = FileProtectionType.completeUntilFirstUserAuthentication
        #endif
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: attributes)
        let sanitized = fileExtension.lowercased().filter { $0.isASCII && ($0.isLetter || $0.isNumber) }
        let suffix = sanitized.isEmpty ? "bin" : String(sanitized.prefix(12))
        return directory.appendingPathComponent(UUID().uuidString).appendingPathExtension(suffix)
    }
}
