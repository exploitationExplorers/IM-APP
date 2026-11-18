import AVFoundation
import CryptoKit
import Foundation
import IMCore
import ImageIO
import UIKit
import OSLog

/// Re-downloadable bytes, separate from the SDK and Outbox. All filesystem work is actor isolated.
actor NativeRecentMediaCache {
    static let shared = NativeRecentMediaCache()
    private let manager = FileManager.default
    private let byteBudget = 512 * 1024 * 1024
    private let fileBudget = 800
    private var epoch = UUID()
    private var lastMaintenance = Date.distantPast
    private let logger = Logger(subsystem: "im.native", category: "recent-media")

    func generation() -> UUID { epoch }

    func plan(_ items: [ChatTextItem], policy: MediaURLPolicy, scope: RecentChatMediaScope) -> [RecentChatMediaJob] {
        RecentChatMediaResource.prefetch(items, policy: policy, scope: scope, now: Date())
    }
    func invalidate() { epoch = UUID() }

    /// Returns the cached key so later, lower priority jobs cannot evict it.
    func prefetch(_ job: RecentChatMediaJob, scope: RecentChatMediaScope, wifiOnly: Bool,
                  generation: UUID, protecting: Set<String>) async throws -> String? {
        let resource = job.resource
        try Task.checkCancellation()
        guard epoch == generation else { throw CancellationError() }
        let directory = try directory()
        let name = key(resource.identity, scope: scope)
        let destination = directory.appendingPathComponent(name)
        guard job.expiresAt > Date() else { throw APIError.cancelled }
        if try reuse(destination, job: job, scope: scope) { return name }
        let temp = try await NativeBoundedDownload(limit: resource.limit, cacheOnly: true, wifiOnly: wifiOnly).download(resource.url)
        defer { discard(temp) }
        try Task.checkCancellation()
        guard epoch == generation else { throw CancellationError() }
        switch resource.kind {
        case .image:
            guard let source = CGImageSourceCreateWithURL(temp as CFURL, [kCGImageSourceShouldCache: false] as CFDictionary),
                  CGImageSourceGetCount(source) > 0 else { throw APIError.invalidResponse }
        case .audio, .video:
            guard try await AVURLAsset(url: temp).load(.isPlayable) else { throw APIError.invalidResponse }
        case .file:
            break
        }
        try Task.checkCancellation()
        guard epoch == generation else { throw CancellationError() }
        guard job.expiresAt > Date() else { throw APIError.cancelled }
        if try reuse(destination, job: job, scope: scope) { return name }
        let bytes = try temp.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
        guard bytes > 0 else { throw APIError.invalidResponse }
        guard try trim(directory, reserving: bytes, protecting: protecting) else { return nil }
        // Use the message's remaining lifetime, so a late download cannot extend it.
        try manager.setAttributes([.creationDate: job.expiresAt.addingTimeInterval(-scope.lifetime),
                                   .modificationDate: Date(), .protectionKey: FileProtectionType.completeUntilFirstUserAuthentication], ofItemAtPath: temp.path)
        try manager.moveItem(at: temp, to: destination)
        return name
    }

    /// Copies keep the preview stable if eviction or explicit cache clearing happens mid-playback.
    func copy(identity: String, scope: RecentChatMediaScope?, fileExtension: String = "") -> URL? {
        guard !Task.isCancelled else { return nil }
        do {
            let directory = try directory(create: false)
            let scopes: [RecentChatMediaScope] = scope.map { [$0] } ?? [.group, .direct]
            for scope in scopes {
                let file = directory.appendingPathComponent(key(identity, scope: scope))
                guard availableSince(file) != nil else { continue }
                let suffix = fileExtension.utf8.count <= 12 && fileExtension.allSatisfy { $0.isASCII && ($0.isLetter || $0.isNumber) } ? fileExtension : ""
                let name = UUID().uuidString + (suffix.isEmpty ? "" : "." + suffix)
                let copy = manager.temporaryDirectory.appendingPathComponent(name)
                try manager.copyItem(at: file, to: copy)
                do { try manager.setAttributes([.modificationDate: Date()], ofItemAtPath: file.path) }
                catch { logger.debug("Could not update recent media access time") }
                return copy
            }
        } catch { logger.debug("Recent media cache lookup unavailable") }
        return nil
    }

    func remove(identity: String, scope: RecentChatMediaScope?) {
        guard let directory = try? directory(create: false) else { return }
        for scope in scope.map({ [$0] }) ?? [.group, .direct] {
            discard(directory.appendingPathComponent(key(identity, scope: scope)))
        }
    }

    func maintain() {
        guard Date().timeIntervalSince(lastMaintenance) >= 60 else { return }
        do {
            let directory = try directory(create: false)
            if manager.fileExists(atPath: directory.path) {
                _ = try trim(directory, reserving: 0, protecting: [])
            }
            lastMaintenance = Date()
        } catch { logger.debug("Recent media maintenance unavailable") }
    }

    func clear() throws {
        invalidate()
        let directory = try directory(create: false)
        if manager.fileExists(atPath: directory.path) { try manager.removeItem(at: directory) }
    }

    private func directory(create: Bool = true) throws -> URL {
        var directory = try manager.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: create)
            .appendingPathComponent("NativeRecentMedia-v1", isDirectory: true)
        if create, !manager.fileExists(atPath: directory.path) {
            try manager.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
            var values = URLResourceValues()
            values.isExcludedFromBackup = true
            try directory.setResourceValues(values)
        }
        return directory
    }

    private func key(_ identity: String, scope: RecentChatMediaScope) -> String {
        let digest = SHA256.hash(data: Data(identity.utf8)).map { String(format: "%02x", $0) }.joined()
        return scope.rawValue + "-" + digest
    }

    private func reuse(_ file: URL, job: RecentChatMediaJob, scope: RecentChatMediaScope) throws -> Bool {
        guard let created = availableSince(file) else { return false }
        let messageDate = job.expiresAt.addingTimeInterval(-scope.lifetime)
        if messageDate > created {
            try manager.setAttributes([.creationDate: messageDate], ofItemAtPath: file.path)
        }
        return true
    }

    private func lifetime(for file: URL) -> TimeInterval {
        let scope: RecentChatMediaScope = file.lastPathComponent.hasPrefix("group-") ? .group : .direct
        return scope.lifetime
    }

    private func availableSince(_ file: URL) -> Date? {
        guard let info = try? file.resourceValues(forKeys: [.isRegularFileKey, .fileSizeKey, .creationDateKey]),
              info.isRegularFile == true, (info.fileSize ?? 0) > 0, let created = info.creationDate else { return nil }
        if Date().timeIntervalSince(created) < lifetime(for: file) { return created }
        discard(file)
        return nil
    }

    private func trim(_ directory: URL, reserving bytes: Int, protecting protected: Set<String>) throws -> Bool {
        let keys: Set<URLResourceKey> = [.fileSizeKey, .creationDateKey, .contentModificationDateKey, .isRegularFileKey]
        var retained: [(URL, Int, Date)] = []
        var total = bytes
        let now = Date()
        for file in try manager.contentsOfDirectory(at: directory, includingPropertiesForKeys: Array(keys)) {
            let info = try file.resourceValues(forKeys: keys)
            guard info.isRegularFile == true else { continue }
            guard let created = info.creationDate, now.timeIntervalSince(created) < lifetime(for: file) else {
                try manager.removeItem(at: file)
                continue
            }
            let size = info.fileSize ?? 0
            retained.append((file, size, info.contentModificationDate ?? created))
            total += size
        }
        let protectedEntries = retained.filter { protected.contains($0.0.lastPathComponent) }
        let reservedCount = bytes == 0 ? 0 : 1
        guard protectedEntries.reduce(bytes, { $0 + $1.1 }) <= byteBudget,
              protectedEntries.count + reservedCount <= fileBudget else { return false }
        var count = retained.count + reservedCount
        for (file, size, _) in retained.sorted(by: { $0.2 < $1.2 }) {
            guard total > byteBudget || count > fileBudget else { break }
            guard !protected.contains(file.lastPathComponent) else { continue }
            try manager.removeItem(at: file)
            total -= size
            count -= 1
        }
        return true
    }

    private func discard(_ url: URL) {
        if manager.fileExists(atPath: url.path) {
            do { try manager.removeItem(at: url) }
            catch { logger.debug("Could not remove recent media temporary or expired file") }
        }
    }
}

/// A single foreground worker owned by the visible chat page.
@MainActor
final class NativeRecentMediaPrefetch {
    private let logger = Logger(subsystem: "im.native", category: "recent-media")
    private var work: Task<Void, Never>?
    private var items: [ChatTextItem]?
    private var plan: Task<Void, Never>?
    private var requested: [RecentChatMediaJob] = []
    private var wifiOnly = true

    func update(items: [ChatTextItem], service: NativeIMService, scope: RecentChatMediaScope) {
        let wifiOnly = service.mediaPreference(.wifiOnly)
        guard service.mediaPreference(.automatic), service.canPrefetchMedia(wifiOnly: wifiOnly) else { stop(); return }
        guard items != self.items || wifiOnly != self.wifiOnly else { return }
        self.items = items
        plan?.cancel()
        let policy = service.business.media
        plan = Task(priority: .utility) { [weak self, weak service] in
            let resources = await NativeRecentMediaCache.shared.plan(items, policy: policy, scope: scope)
            guard !Task.isCancelled, let self = self, let service = service else { return }
            self.schedule(resources, service: service, scope: scope, wifiOnly: wifiOnly)
        }
    }

    private func schedule(_ resources: [RecentChatMediaJob], service: NativeIMService, scope: RecentChatMediaScope, wifiOnly: Bool) {
        guard resources != requested || self.wifiOnly != wifiOnly else { return }
        requested = resources
        self.wifiOnly = wifiOnly
        let previous = work
        previous?.cancel()
        work = Task(priority: .utility) { [weak service, logger] in
            await previous?.value
            guard !Task.isCancelled else { return }
            let generation = await NativeRecentMediaCache.shared.generation()
            var protected = Set<String>()
            for job in resources {
                guard !Task.isCancelled, service?.canPrefetchMedia(wifiOnly: wifiOnly) == true else { return }
                do {
                    guard let key = try await NativeRecentMediaCache.shared.prefetch(job, scope: scope, wifiOnly: wifiOnly,
                                                                                     generation: generation, protecting: protected) else { return }
                    protected.insert(key)
                } catch { if !Task.isCancelled { logger.debug("Recent media prefetch skipped a resource") } }
            }
        }
    }

    func stop() {
        plan?.cancel()
        plan = nil
        work?.cancel()
        items = nil
        requested = []
    }
}

enum NativeMediaPreference: String {
    case automatic = "autoCacheMedia"
    case wifiOnly = "autoCacheMediaWifiOnly"

    func key(for policy: MediaURLPolicy) -> String {
        "native.recent-media.\(policy.businessBaseURL.absoluteString).\(policy.accountScope).\(rawValue)"
    }
}
