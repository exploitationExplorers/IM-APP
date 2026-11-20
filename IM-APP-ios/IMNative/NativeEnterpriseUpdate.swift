import IMCore
import UIKit

/// 企业内测包通过独立清单检查 Build，安装页与清单部署在同一个目录。
struct NativeEnterpriseUpdate: Sendable {
    private struct Manifest: Decodable {
        let schemaVersion: Int
        let bundleIdentifier: String
        let build: Int
        let version: String
        let releaseNotes: String?
    }

    struct Release: Sendable {
        let message: String
        let downloadPage: URL

        @MainActor func present(from presenter: UIViewController) {
            let alert = UIAlertController(title: "发现新版本", message: message, preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: "稍后", style: .cancel))
            alert.addAction(UIAlertAction(title: "立即更新", style: .default) { _ in
                UIApplication.shared.open(downloadPage)
            })
            presenter.present(alert, animated: true)
        }
    }

    private let manifestURL: URL
    private let downloadPage: URL
    private let bundleIdentifier: String
    private let installedBuild: Int

    init?(bundle: Bundle = .main) {
        guard let rawURL = bundle.object(forInfoDictionaryKey: "NativeEnterpriseUpdateManifestURL") as? String,
              var parts = URLComponents(string: rawURL), parts.scheme == "https",
              let host = parts.host, !host.isEmpty, parts.user == nil, parts.password == nil,
              parts.fragment == nil, let url = parts.url, url.lastPathComponent == "update.json",
              let bundleIdentifier = bundle.bundleIdentifier,
              let build = bundle.object(forInfoDictionaryKey: "CFBundleVersion") as? String,
              let installedBuild = Int(build), installedBuild > 0 else { return nil }
        parts.query = nil
        guard let base = parts.url?.deletingLastPathComponent() else { return nil }
        self.manifestURL = url
        self.downloadPage = base.appendingPathComponent("index.html")
        self.bundleIdentifier = bundleIdentifier
        self.installedBuild = installedBuild
    }

    func check() async throws -> Release? {
        let file = try await NativeBoundedDownload(limit: 64 * 1024).download(manifestURL)
        defer { try? FileManager.default.removeItem(at: file) }
        try Task.checkCancellation()
        let manifest = try JSONDecoder().decode(Manifest.self, from: Data(contentsOf: file))
        let version = manifest.version.trimmingCharacters(in: .whitespacesAndNewlines)
        guard manifest.schemaVersion == 1, manifest.bundleIdentifier == bundleIdentifier,
              manifest.build > 0, !version.isEmpty, version.count <= 32,
              version.rangeOfCharacter(from: .controlCharacters) == nil else { throw APIError.invalidResponse }
        guard manifest.build > installedBuild else { return nil }
        let notes = manifest.releaseNotes?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let detail = notes.isEmpty ? "前往下载页安装新版。" : String(notes.prefix(500))
        return Release(message: "版本 \(version)（\(manifest.build)）\n\n\(detail)", downloadPage: downloadPage)
    }
}
