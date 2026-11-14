import UIKit
import ImageIO
import Photos
import QuickLook
import AVKit
import IMCore
import CryptoKit

/// 下载到临时文件并在传输中检查上限；不携带业务Token，只允许HTTPS跳转。
final class NativeBoundedDownload: NSObject, URLSessionDownloadDelegate, @unchecked Sendable {
    private let limit: Int64
    private let lock = NSLock()
    private var continuation: CheckedContinuation<URL, Error>?
    private var cancelled = false
    private var task: URLSessionDownloadTask?
    private lazy var session: URLSession = {
        let config = URLSessionConfiguration.ephemeral; config.timeoutIntervalForRequest = 30; config.timeoutIntervalForResource = 180
        return URLSession(configuration: config, delegate: self, delegateQueue: nil)
    }()
    init(limit: Int64) { self.limit = limit }
    func download(_ url: URL) async throws -> URL {
        guard url.scheme == "https" else { throw APIError.invalidConfiguration }
        return try await withTaskCancellationHandler(operation: {
            try await withCheckedThrowingContinuation { continuation in
                lock.lock()
                if cancelled { lock.unlock(); continuation.resume(throwing: APIError.cancelled); return }
                self.continuation = continuation; let task = session.downloadTask(with: url); self.task = task; lock.unlock(); task.resume()
            }
        }, onCancel: { self.cancel() })
    }
    private func cancel() { lock.lock(); cancelled = true; let task = task; lock.unlock(); task?.cancel(); finish(.failure(APIError.cancelled)) }
    private func finish(_ result: Result<URL, Error>) {
        lock.lock(); let callback = continuation; continuation = nil; lock.unlock()
        if let callback = callback { callback.resume(with: result) }
        else if case .success(let file) = result { try? FileManager.default.removeItem(at: file) }
        session.finishTasksAndInvalidate()
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(request.url?.scheme == "https" ? request : nil)
    }
    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didWriteData bytesWritten: Int64, totalBytesWritten: Int64, totalBytesExpectedToWrite: Int64) {
        if totalBytesWritten > limit || totalBytesExpectedToWrite > limit { downloadTask.cancel(); finish(.failure(APIError.business(code: -1, message: "文件超过本机预览大小限制。"))) }
    }
    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {
        do {
            guard let response = downloadTask.response as? HTTPURLResponse, (200..<300).contains(response.statusCode), response.url?.scheme == "https" else { throw APIError.invalidResponse }
            let size = (try FileManager.default.attributesOfItem(atPath: location.path)[.size] as? NSNumber)?.int64Value ?? Int64.max
            guard size <= limit else { throw APIError.business(code: -1, message: "文件超过本机预览大小限制。") }
            lock.lock(); let active = continuation != nil && !cancelled; lock.unlock(); guard active else { return }
            let file = FileManager.default.temporaryDirectory.appendingPathComponent("native-media-" + UUID().uuidString)
            try FileManager.default.moveItem(at: location, to: file); finish(.success(file))
        } catch { finish(.failure(error)) }
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) { if let error = error { finish(.failure(error)) } }
}

private final class NativeImageMemory: @unchecked Sendable {
    let values = NSCache<NSString, UIImage>()
    init() { values.totalCostLimit = 32 * 1024 * 1024; values.countLimit = 150 }
}

actor NativeImageCache {
    static let shared = NativeImageCache()
    private nonisolated let memory = NativeImageMemory()
    private let directory: URL
    private let diskLimit = 120 * 1024 * 1024
    private var epoch = UUID()
    private struct Flight { let id: UUID; let task: Task<URL, Error>; var consumers: Set<UUID> }
    private var flights: [String: Flight] = [:]
    private var active = 0
    private var queue: [(UUID, CheckedContinuation<Void, Error>)] = []
    private var lastMaintenance = Date.distantPast
    private var writesSinceMaintenance = 0
    private var bytesSinceMaintenance = 0
    private var metrics: [String] = []
    init() {
        directory = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("NativeMedia-v2", isDirectory: true)
    }
    private nonisolated func resourceKey(_ identity: String) -> String { SHA256.hash(data: Data(identity.utf8)).map { String(format: "%02x", $0) }.joined() }
    nonisolated func peek(identity: String, edge: Int) -> UIImage? { memory.values.object(forKey: "\(edge):\(resourceKey(identity))" as NSString) }
    private func record(_ key: String, _ tier: String, _ start: Date) { metrics.append("\(key.prefix(10)) \(tier) \(Int(Date().timeIntervalSince(start) * 1000))ms"); if metrics.count > 60 { metrics.removeFirst(metrics.count - 60) } }
    func diagnosticLines() -> [String] { ["媒体缓存采样（当前进程，非现网性能验收）"] + metrics }
    func image(_ url: URL, edge: Int, identity: String) async throws -> UIImage {
        guard url.scheme == "https" else { throw APIError.invalidResponse }; try Task.checkCancellation()
        let started = Date(), expectedEpoch = epoch
        let key = resourceKey(identity), memoryKey = "\(edge):\(key)" as NSString
        if let image = memory.values.object(forKey: memoryKey) { record(key, "MEMORY_CACHE", started); return image }
        let file = directory.appendingPathComponent(key)
        let tier = valid(file) ? "DISK_CACHE" : "NETWORK"
        if !valid(file) {
            let consumer = UUID(), flightID: UUID, task: Task<URL, Error>
            if var flight = flights[key] { flight.consumers.insert(consumer); flights[key] = flight; flightID = flight.id; task = flight.task }
            else {
                flightID = UUID(); let capturedEpoch = epoch
                task = Task { try await self.fetch(url, key: key, epoch: capturedEpoch) }
                flights[key] = Flight(id: flightID, task: task, consumers: [consumer])
            }
            do {
                _ = try await withTaskCancellationHandler(operation: { try await task.value }, onCancel: { Task { await self.releaseConsumer(key, flight: flightID, consumer: consumer) } })
                releaseConsumer(key, flight: flightID, consumer: consumer); try Task.checkCancellation()
            } catch { releaseConsumer(key, flight: flightID, consumer: consumer); throw error }
        }
        try Task.checkCancellation(); guard expectedEpoch == epoch else { throw APIError.cancelled }
        // 同一编码下载完成后，后续消费者复用已解码结果。
        if let image = memory.values.object(forKey: memoryKey) { record(key, "MEMORY_CACHE", started); return image }
        // ImageIO在本actor中解码，绝不在MainActor上解码全尺寸原图。
        let image: UIImage
        do { image = try decode(file, edge: min(max(64, edge), 1920)) }
        catch { try? FileManager.default.removeItem(at: file); throw error }
        try Task.checkCancellation(); try? FileManager.default.setAttributes([.modificationDate: Date()], ofItemAtPath: file.path)
        let cost = (image.images ?? [image]).reduce(0) { $0 + ($1.cgImage?.bytesPerRow ?? 0) * ($1.cgImage?.height ?? 0) }
        memory.values.setObject(image, forKey: memoryKey, cost: cost); record(key, tier, started); return image
    }
    func cachedImage(identity: String, edge: Int) -> UIImage? {
        let key = resourceKey(identity), memoryKey = "\(edge):\(key)" as NSString
        if let image = memory.values.object(forKey: memoryKey) { return image }
        let file = directory.appendingPathComponent(key)
        guard valid(file) else { return nil }
        do {
            let started = Date(), image = try decode(file, edge: min(max(64, edge), 1920))
            let cost = (image.images ?? [image]).reduce(0) { $0 + ($1.cgImage?.bytesPerRow ?? 0) * ($1.cgImage?.height ?? 0) }
            memory.values.setObject(image, forKey: memoryKey, cost: cost); record(key, "DISK_CACHE", started); return image
        } catch { try? FileManager.default.removeItem(at: file); return nil }
    }
    func mutationEpoch() -> UUID { epoch }
    /// 只由账号 owner 传入其验证过的私有源文件；捕获的代次失效后禁止补写缓存。
    func seedOwned(_ local: URL, identities: [String], expectedEpoch: UUID) {
        guard expectedEpoch == epoch, !Task.isCancelled else { return }
        guard let source = CGImageSourceCreateWithURL(local as CFURL, [kCGImageSourceShouldCache: false] as CFDictionary), CGImageSourceGetCount(source) > 0,
              let size = (try? local.resourceValues(forKeys: [.fileSizeKey]))?.fileSize, size > 0, size <= 30 * 1024 * 1024 else { return }
        var writes = 0; var lastKey: String?
        defer { if let key = lastKey { maintainAfterWrites(count: writes, bytes: writes * size, protecting: key) } }
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
            // 本地气泡通常已经解码；多个远端身份共享同一份解码结果。
            let image = try? localImage(local, edge: 720)
            let cost = image.map { value in (value.images ?? [value]).reduce(0) { $0 + ($1.cgImage?.bytesPerRow ?? 0) * ($1.cgImage?.height ?? 0) } } ?? 0
            for identity in Set(identities) {
                guard expectedEpoch == epoch, !Task.isCancelled else { return }
                let key = resourceKey(identity), destination = directory.appendingPathComponent(key)
                if !valid(destination) {
                    try FileManager.default.copyItem(at: local, to: destination)
                    writes += 1; lastKey = key
                    try FileManager.default.setAttributes([.modificationDate: Date()], ofItemAtPath: destination.path)
                }
                if let image = image {
                    memory.values.setObject(image, forKey: "720:\(key)" as NSString, cost: cost)
                }
            }
        } catch { /* 缓存可选；写入失败不改变 SDK 已确认的发送状态。 */ }
    }
    func aliasCached(from sourceIdentity: String, to destinationIdentity: String, expectedEpoch: UUID) {
        guard expectedEpoch == epoch, !Task.isCancelled, sourceIdentity != destinationIdentity else { return }
        let sourceKey = resourceKey(sourceIdentity), key = resourceKey(destinationIdentity)
        let source = directory.appendingPathComponent(sourceKey), destination = directory.appendingPathComponent(key)
        // 仅复制已缓存且未过期的同规格内容，不发起额外网络下载。
        if valid(source), !valid(destination) {
            do {
                guard expectedEpoch == epoch, !Task.isCancelled else { return }
                try FileManager.default.copyItem(at: source, to: destination)
                let bytes = (try? destination.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
                maintainAfterWrites(count: 1, bytes: bytes, protecting: key)
            } catch { /* 已有源缓存仍可使用，别名复制失败不影响发送结果。 */ }
        }
        for edge in [256, 720, 1920] {
            guard expectedEpoch == epoch, !Task.isCancelled else { return }
            if let image = memory.values.object(forKey: "\(edge):\(sourceKey)" as NSString) {
                let cost = (image.images ?? [image]).reduce(0) { $0 + ($1.cgImage?.bytesPerRow ?? 0) * ($1.cgImage?.height ?? 0) }
                memory.values.setObject(image, forKey: "\(edge):\(key)" as NSString, cost: cost)
            }
        }
    }
    private func releaseConsumer(_ key: String, flight: UUID, consumer: UUID) {
        guard var current = flights[key], current.id == flight, current.consumers.remove(consumer) != nil else { return }
        if current.consumers.isEmpty { current.task.cancel(); flights.removeValue(forKey: key) } else { flights[key] = current }
    }
    private func acquire() async throws {
        try Task.checkCancellation()
        if active < 4 { active += 1; return }
        let id = UUID()
        try await withTaskCancellationHandler(operation: {
            try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
                if Task.isCancelled { continuation.resume(throwing: APIError.cancelled) } else { queue.append((id, continuation)) }
            }
        }, onCancel: { Task { await self.cancelWaiter(id) } })
    }
    private func cancelWaiter(_ id: UUID) { if let index = queue.firstIndex(where: { $0.0 == id }) { let waiter = queue.remove(at: index); waiter.1.resume(throwing: APIError.cancelled) } }
    private func releaseSlot() { active -= 1; if !queue.isEmpty { let next = queue.removeFirst(); active += 1; next.1.resume() } }
    private func fetch(_ url: URL, key: String, epoch expected: UUID) async throws -> URL {
        try await acquire(); defer { releaseSlot() }; try Task.checkCancellation()
        let temporary = try await NativeBoundedDownload(limit: 30 * 1024 * 1024).download(url)
        defer { try? FileManager.default.removeItem(at: temporary) }
        try Task.checkCancellation(); guard epoch == expected else { throw APIError.cancelled }
        // 坏图片不写磁盘；仅做ImageIO头校验，实际缩图按需求解码。
        guard let source = CGImageSourceCreateWithURL(temporary as CFURL, [kCGImageSourceShouldCache: false] as CFDictionary), CGImageSourceGetCount(source) > 0 else { throw APIError.invalidResponse }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
        var excluded = directory; var values = URLResourceValues(); values.isExcludedFromBackup = true; try excluded.setResourceValues(values)
        let destination = directory.appendingPathComponent(key)
        if !FileManager.default.fileExists(atPath: destination.path) { try FileManager.default.moveItem(at: temporary, to: destination); try FileManager.default.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication, .modificationDate: Date()], ofItemAtPath: destination.path) }
        maintainAfterWrites(count: 1, bytes: (try? destination.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0, protecting: key)
        return destination
    }
    /// 网络写入、本地种子和转发别名共用批次门槛，避免每个身份都扫描缓存目录。
    private func maintainAfterWrites(count: Int, bytes: Int, protecting key: String) {
        guard count > 0 else { return }
        writesSinceMaintenance += count
        bytesSinceMaintenance += bytes
        if writesSinceMaintenance >= 16 || bytesSinceMaintenance >= 8 * 1024 * 1024 || Date().timeIntervalSince(lastMaintenance) >= 60 {
            trim(protecting: key); lastMaintenance = Date(); writesSinceMaintenance = 0; bytesSinceMaintenance = 0
        }
    }
    private func valid(_ file: URL) -> Bool {
        guard let values = try? file.resourceValues(forKeys: [.fileSizeKey, .contentModificationDateKey]), let size = values.fileSize, size > 0, size <= 30 * 1024 * 1024, let date = values.contentModificationDate, date > Date().addingTimeInterval(-7 * 86400) else { try? FileManager.default.removeItem(at: file); return false }; return true
    }
    private func trim(protecting key: String) {
        guard let files = try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: [.fileSizeKey, .contentModificationDateKey]) else { return }
        var rows: [(URL, Int, Date)] = []; var bytes = 0
        for file in files { guard let values = try? file.resourceValues(forKeys: [.fileSizeKey, .contentModificationDateKey]) else { continue }; let size = values.fileSize ?? 0; bytes += size; rows.append((file, size, values.contentModificationDate ?? .distantPast)) }
        var count = rows.count
        for row in rows.sorted(by: { $0.2 < $1.2 }) { guard bytes > diskLimit || count > 400 else { break }; if row.0.lastPathComponent == key || flights[row.0.lastPathComponent] != nil { continue }; do { try FileManager.default.removeItem(at: row.0); bytes -= row.1; count -= 1 } catch {} }
    }
    private func decode(_ url: URL, edge: Int) throws -> UIImage {
        guard let source = CGImageSourceCreateWithURL(url as CFURL, [kCGImageSourceShouldCache: false] as CFDictionary) else { throw APIError.invalidResponse }
        func bitmap(_ index: Int, edge: Int) -> CGImage? { CGImageSourceCreateThumbnailAtIndex(source, index, [kCGImageSourceCreateThumbnailFromImageAlways: true, kCGImageSourceCreateThumbnailWithTransform: true, kCGImageSourceThumbnailMaxPixelSize: edge, kCGImageSourceShouldCacheImmediately: true] as CFDictionary) }
        guard let first = bitmap(0, edge: edge) else { throw APIError.invalidResponse }; let still = UIImage(cgImage: first)
        let count = CGImageSourceGetCount(source)
        guard count > 1, count <= 32 else { return still }
        var frames: [UIImage] = []; var bytes = 0; var duration: Double = 0
        for index in 0..<count {
            try Task.checkCancellation(); guard let frame = bitmap(index, edge: min(edge, 256)) else { return still }
            bytes += frame.bytesPerRow * frame.height; guard bytes <= 12 * 1024 * 1024 else { return still }
            frames.append(UIImage(cgImage: frame))
            let properties = CGImageSourceCopyPropertiesAtIndex(source, index, nil) as? [String: Any] ?? [:]
            let animation = properties[kCGImagePropertyGIFDictionary as String] as? [String: Any] ?? properties["{WebP}"] as? [String: Any] ?? [:]
            let delay = (animation[kCGImagePropertyGIFUnclampedDelayTime as String] as? NSNumber)?.doubleValue ?? (animation[kCGImagePropertyGIFDelayTime as String] as? NSNumber)?.doubleValue ?? (animation["DelayTime"] as? NSNumber)?.doubleValue ?? 0.1
            duration += min(10, max(0.02, delay))
        }
        return UIImage.animatedImage(with: frames, duration: duration) ?? still
    }
    func invalidateSession() {
        epoch = UUID(); memory.values.removeAllObjects(); let current = flights.values.map(\.task); flights.removeAll(); current.forEach { $0.cancel() }; metrics.removeAll()
    }
    func clear() throws {
        invalidateSession()
        if FileManager.default.fileExists(atPath: directory.path) { try FileManager.default.removeItem(at: directory) }
        let legacy = directory.deletingLastPathComponent().appendingPathComponent("NativeMedia-v1", isDirectory: true)
        if FileManager.default.fileExists(atPath: legacy.path) { try FileManager.default.removeItem(at: legacy) }
    }
    func dataImage(_ data: Data, edge: Int) throws -> UIImage {
        guard let source = CGImageSourceCreateWithData(data as CFData, [kCGImageSourceShouldCache: false] as CFDictionary), let bitmap = CGImageSourceCreateThumbnailAtIndex(source, 0, [kCGImageSourceCreateThumbnailFromImageAlways: true, kCGImageSourceCreateThumbnailWithTransform: true, kCGImageSourceThumbnailMaxPixelSize: min(edge, 1920), kCGImageSourceShouldCacheImmediately: true] as CFDictionary) else { throw APIError.invalidResponse }; return UIImage(cgImage: bitmap)
    }
    func invalidateLocalImage(_ url: URL, edge: Int = 720) {
        memory.values.removeObject(forKey: "\(edge):\(resourceKey(url.absoluteString))" as NSString)
        // 只移除显示缓存别名，Outbox 持有的原始媒体文件仍保留供核对与重试。
    }
    func localImage(_ url: URL, edge: Int) throws -> UIImage {
        try Task.checkCancellation()
        let key = "\(edge):\(resourceKey(url.absoluteString))" as NSString
        if let cached = memory.values.object(forKey: key) { return cached }
        let image = try decode(url, edge: min(edge, 1920))
        let cost = (image.images ?? [image]).reduce(0) { $0 + ($1.cgImage?.bytesPerRow ?? 0) * ($1.cgImage?.height ?? 0) }
        memory.values.setObject(image, forKey: key, cost: cost); return image
    }
}

@MainActor
private final class NativeAnimationVisibility {
    static let shared = NativeAnimationVisibility()
    private let images = NSHashTable<NativeRemoteImageView>.weakObjects()
    private var observations: [ObjectIdentifier: (UIScrollView, NSKeyValueObservation)] = [:]
    private var timer: Timer?
    private var lastScrollRefresh = Date.distantPast
    private var foreground: NSObjectProtocol?
    private var background: NSObjectProtocol?
    private init() {
        foreground = NotificationCenter.default.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in Task { @MainActor in self?.refresh() } }
        background = NotificationCenter.default.addObserver(forName: UIApplication.willResignActiveNotification, object: nil, queue: .main) { [weak self] _ in Task { @MainActor in self?.pause() } }
    }
    func register(_ image: NativeRemoteImageView) {
        images.add(image); observeScrolls(); image.refreshAnimationVisibility()
        if timer == nil {
            // 仅检查已加载动图的弱引用；低频兜底捕获页面遮挡，不逐帧遍历视图树。
            let value = Timer(timeInterval: 0.5, repeats: true) { [weak self] _ in Task { @MainActor in self?.refresh() } }
            RunLoop.main.add(value, forMode: .common); timer = value
        }
    }
    func remove(_ image: NativeRemoteImageView) { images.remove(image); image.stopAnimating(); observeScrolls(); stopWhenEmpty() }
    private func pause() { images.allObjects.forEach { $0.stopAnimating() } }
    private func scrollChanged() {
        guard Date().timeIntervalSince(lastScrollRefresh) >= 0.08 else { return }
        lastScrollRefresh = Date(); images.allObjects.forEach { $0.refreshAnimationVisibility() }
    }
    private func refresh() { images.allObjects.forEach { $0.refreshAnimationVisibility() }; observeScrolls(); stopWhenEmpty() }
    private func stopWhenEmpty() { if images.allObjects.isEmpty { timer?.invalidate(); timer = nil; observations.removeAll() } }
    private func observeScrolls() {
        var wanted: [ObjectIdentifier: UIScrollView] = [:]
        for image in images.allObjects {
            var parent = image.superview
            while let view = parent { if let scroll = view as? UIScrollView { wanted[ObjectIdentifier(scroll)] = scroll }; parent = view.superview }
        }
        for key in Array(observations.keys) where wanted[key] == nil { observations.removeValue(forKey: key) }
        for (key, scroll) in wanted where observations[key] == nil {
            let observation = scroll.observe(\.contentOffset, options: [.new]) { [weak self] _, _ in Task { @MainActor in self?.scrollChanged() } }
            observations[key] = (scroll, observation)
        }
    }
}

@MainActor
final class NativeRemoteImageView: UIImageView {
    var onImageLoaded: (() -> Void)?
    var loadedImageSize: CGSize? { loaded ? image?.size : nil }
    private var task: Task<Void, Never>?
    private var represented = ""
    private var loaded = false
    private var failedOwnedIdentities: [String] = []
    func load(_ raw: String, policy: MediaURLPolicy, variant: MediaURLPolicy.Variant = .avatar, placeholder: String = "uni_avatar_default", fallbacks: [String] = []) {
        var seen = Set<String>()
        let candidates = ([raw] + fallbacks).filter { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }.map { policy.image($0, variant: variant) }.filter { seen.insert(policy.cacheIdentity($0)).inserted }
        let identity = candidates.map { policy.cacheIdentity($0) }.joined(separator: "\n")
        if represented == identity, loaded || task != nil { refreshAnimationRegistration(); return }
        NativeAnimationVisibility.shared.remove(self); task?.cancel(); loaded = false; accessibilityLabel = nil; represented = identity
        let edge = variant == .avatar ? 256 : (variant == .list ? 720 : 1920)
        // 先查所有候选的内存缓存，避免已缓存原图却仍等待失效缩略图网络。
        for candidate in candidates {
            if let cached = NativeImageCache.shared.peek(identity: policy.cacheIdentity(candidate), edge: edge) { image = cached; loaded = true; refreshAnimationRegistration(); onImageLoaded?(); return }
        }
        image = NativeUITheme.image(placeholder)
        guard !candidates.isEmpty else { accessibilityLabel = "图片地址尚未就绪"; return }
        task = Task { [weak self] in
            defer { if self?.represented == identity { self?.task = nil } }
            // 缓存过的备用原图先于失效缩略图请求，重启后也不重复等待失败下载。
            for candidate in candidates {
                guard !Task.isCancelled, self?.represented == identity else { return }
                if let cached = await NativeImageCache.shared.cachedImage(identity: policy.cacheIdentity(candidate), edge: edge) {
                    guard !Task.isCancelled, self?.represented == identity else { return }
                    self?.image = cached; self?.loaded = true; self?.refreshAnimationRegistration(); self?.onImageLoaded?(); return
                }
            }
            for candidate in candidates {
                guard !Task.isCancelled, self?.represented == identity else { return }
                guard let url = policy.absolute(candidate), url.scheme == "https" else { continue }
                do {
                    let image = try await NativeImageCache.shared.image(url, edge: edge, identity: policy.cacheIdentity(candidate))
                    guard !Task.isCancelled, self?.represented == identity else { return }
                    self?.image = image; self?.loaded = true; self?.accessibilityLabel = nil; self?.refreshAnimationRegistration(); self?.onImageLoaded?(); return
                } catch {
                    if Task.isCancelled || error is CancellationError { return }
                }
            }
            guard !Task.isCancelled, self?.represented == identity else { return }
            self?.image = UIImage(systemName: "photo.badge.exclamationmark"); self?.accessibilityLabel = "图片加载失败，轻点可重新打开"
        }
    }
    func cancel() { stopAnimating(); NativeAnimationVisibility.shared.remove(self); task?.cancel(); task = nil; represented = ""; loaded = false; image = nil; accessibilityLabel = nil }
    override func didMoveToWindow() { super.didMoveToWindow(); refreshAnimationRegistration() }
    override func didMoveToSuperview() { super.didMoveToSuperview(); refreshAnimationRegistration() }
    private func refreshAnimationRegistration() {
        if loaded, window != nil, (image?.images?.count ?? 0) > 1 { NativeAnimationVisibility.shared.register(self) }
        else { NativeAnimationVisibility.shared.remove(self) }
    }
    fileprivate func refreshAnimationVisibility() {
        guard loaded, let window = window, !window.isHidden, UIApplication.shared.applicationState == .active,
              window.windowScene?.activationState == .foregroundActive else { stopAnimating(); return }
        var rect = convert(bounds, to: window); var ancestor: UIView? = self
        while let current = ancestor {
            guard !current.isHidden, current.alpha > 0.01 else { stopAnimating(); return }
            if current.clipsToBounds || current === window { rect = rect.intersection(current.convert(current.bounds, to: window)) }
            guard !rect.isEmpty, !rect.isNull else { stopAnimating(); return }; ancestor = current.superview
        }
        var responder: UIResponder? = self; var controller: UIViewController?
        while let next = responder?.next { if let owner = next as? UIViewController { controller = owner; break }; responder = next }
        while let owner = controller {
            if let presented = owner.presentedViewController, !presented.isBeingDismissed { stopAnimating(); return }
            if let navigation = owner.parent as? UINavigationController, navigation.visibleViewController !== owner { stopAnimating(); return }
            if let tab = owner.parent as? UITabBarController, tab.selectedViewController !== owner { stopAnimating(); return }
            controller = owner.parent
        }
        if !isAnimating { startAnimating() }
    }
    func loadOwnedLocal(_ url: URL, remote: [String] = [], policy: MediaURLPolicy? = nil) {
        let identity = url.absoluteString
        let remoteSources = remote.filter { raw in
            guard let policy = policy, let candidate = policy.absolute(policy.image(raw, variant: .list)) else { return false }
            return candidate.scheme == "https"
        }
        if failedOwnedIdentities.contains(identity) {
            if let policy = policy, let first = remoteSources.first { load(first, policy: policy, variant: .list, placeholder: "", fallbacks: Array(remoteSources.dropFirst())) }
            else { NativeAnimationVisibility.shared.remove(self); task?.cancel(); task = nil; represented = identity; loaded = false; image = UIImage(systemName: "photo.badge.exclamationmark"); accessibilityLabel = "本机图片读取失败，请重新选择图片。" }
            return
        }
        if represented == identity, loaded || task != nil { refreshAnimationRegistration(); return }
        NativeAnimationVisibility.shared.remove(self); task?.cancel(); represented = identity; loaded = false; image = nil; accessibilityLabel = nil
        if let cached = NativeImageCache.shared.peek(identity: identity, edge: 720) { image = cached; loaded = true; refreshAnimationRegistration(); onImageLoaded?(); return }
        task = Task { [weak self] in
            defer { if self?.represented == identity { self?.task = nil } }
            do {
                let image = try await NativeImageCache.shared.localImage(url, edge: 720)
                guard !Task.isCancelled, self?.represented == identity else { return }
                self?.image = image; self?.loaded = true; self?.accessibilityLabel = nil; self?.refreshAnimationRegistration(); self?.onImageLoaded?()
            } catch {
                guard !Task.isCancelled, !(error is CancellationError), self?.represented == identity else { return }
                await NativeImageCache.shared.invalidateLocalImage(url)
                guard !Task.isCancelled, let self = self, self.represented == identity else { return }
                // 同一坏本地图只尝试一次；后续重配继续使用远端身份，不重新抢占下载任务。
                self.failedOwnedIdentities.append(identity)
                if self.failedOwnedIdentities.count > 32 { self.failedOwnedIdentities.removeFirst(self.failedOwnedIdentities.count - 32) }
                self.task = nil
                if let policy = policy, let first = remoteSources.first { self.load(first, policy: policy, variant: .list, placeholder: "", fallbacks: Array(remoteSources.dropFirst())) }
                else { self.image = UIImage(systemName: "photo.badge.exclamationmark"); self.accessibilityLabel = "本机图片读取失败，请重新选择图片。" }
            }
        }
    }
    deinit { task?.cancel() }
}

@MainActor
final class NativeImagePreviewController: UIViewController, UIScrollViewDelegate {
    private var raw: String
    private let policy: MediaURLPolicy
    private var allImages: [String] = []; private var currentIndex = 0
    private let ownedLocal: URL?
    private let scroll = UIScrollView()
    private let imageView = NativeRemoteImageView()
    private var saveTask: Task<Void, Never>?
    init(url: String, policy: MediaURLPolicy, allImages: [String] = []) { raw = url; self.policy = policy; ownedLocal = nil; if let index = allImages.firstIndex(of: url) { self.allImages = allImages; currentIndex = index } else { self.allImages = [url] }; super.init(nibName: nil, bundle: nil) }
    init(ownedLocal: URL, policy: MediaURLPolicy, remote: String = "") { raw = remote; self.policy = policy; self.ownedLocal = ownedLocal; super.init(nibName: nil, bundle: nil) }
    required init?(coder: NSCoder) { fatalError("不使用 Storyboard") }
    override func viewDidLoad() {
        super.viewDidLoad(); view.backgroundColor = .black; title = "图片"
        navigationItem.rightBarButtonItem = UIBarButtonItem(title: "保存", style: .plain, target: self, action: #selector(save))
        let left = UISwipeGestureRecognizer(target: self, action: #selector(swipe(_:))); left.direction = .left; scroll.addGestureRecognizer(left); let right = UISwipeGestureRecognizer(target: self, action: #selector(swipe(_:))); right.direction = .right; scroll.addGestureRecognizer(right)
        scroll.delegate = self; scroll.minimumZoomScale = 1; scroll.maximumZoomScale = 4
        view.addSubview(scroll); scroll.addSubview(imageView); imageView.contentMode = .scaleAspectFit
        if let local = ownedLocal { imageView.loadOwnedLocal(local, remote: [raw], policy: policy) } else { imageView.load(raw, policy: policy, variant: .preview) }
    }
    override func viewWillAppear(_ animated: Bool) { super.viewWillAppear(animated); navigationController?.setNavigationBarHidden(false, animated: animated) }
    override func viewDidLayoutSubviews() { super.viewDidLayoutSubviews(); scroll.frame = view.bounds; if scroll.zoomScale == 1 { imageView.frame = scroll.bounds } }
    func viewForZooming(in scrollView: UIScrollView) -> UIView? { imageView }
    @objc private func swipe(_ gesture: UISwipeGestureRecognizer) {
        guard saveTask == nil, scroll.zoomScale == 1, ownedLocal == nil, allImages.count > 1 else { return }
        let next = currentIndex + (gesture.direction == .left ? 1 : -1); guard allImages.indices.contains(next) else { return }
        currentIndex = next; raw = allImages[next]; imageView.cancel(); imageView.load(raw, policy: policy, variant: .preview); title = "图片 \(next + 1)/\(allImages.count)"
    }
    @objc private func save() {
        navigationItem.rightBarButtonItem?.isEnabled = false
        saveTask = Task {
            defer { navigationItem.rightBarButtonItem?.isEnabled = true; saveTask = nil }
            do {
                guard ownedLocal != nil || policy.absolute(policy.original(raw))?.scheme == "https" else { throw APIError.invalidResponse }
                let status = await PHPhotoLibrary.requestAuthorization(for: .addOnly)
                guard status == .authorized || status == .limited else { showNativeNotice("请在系统设置中允许添加照片。"); return }
                let file: URL
                if let local = ownedLocal { file = local } else {
                    guard let url = policy.absolute(policy.original(raw)) else { throw APIError.invalidResponse }
                    file = try await NativeBoundedDownload(limit: 40 * 1024 * 1024).download(url)
                }
                defer { if ownedLocal == nil { try? FileManager.default.removeItem(at: file) } }
                try Task.checkCancellation()
                let photo = try await Task.detached(priority: .userInitiated) { () -> URL in
                    guard let source = CGImageSourceCreateWithURL(file as CFURL, [kCGImageSourceShouldCache: false] as CFDictionary), let type = CGImageSourceGetType(source) as String? else { throw APIError.invalidResponse }
                    let originals: Set<String> = ["public.jpeg", "public.png", "public.heic", "public.heif", "com.compuserve.gif", "public.tiff"]
                    if originals.contains(type) { return file }
                    guard type.lowercased().contains("webp") else { throw APIError.business(code: -1, message: "此图片格式暂不能保存到相册。") }
                    // 仅WebP转换，不进入缩图缓存；最大4096边长，防止超大解码占满内存。
                    guard let bitmap = CGImageSourceCreateThumbnailAtIndex(source, 0, [kCGImageSourceCreateThumbnailFromImageAlways: true, kCGImageSourceCreateThumbnailWithTransform: true, kCGImageSourceThumbnailMaxPixelSize: 4096, kCGImageSourceShouldCacheImmediately: true] as CFDictionary) else { throw APIError.invalidResponse }
                    let output = file.appendingPathExtension("jpg")
                    guard let destination = CGImageDestinationCreateWithURL(output as CFURL, "public.jpeg" as CFString, 1, nil) else { throw APIError.invalidResponse }
                    CGImageDestinationAddImage(destination, bitmap, [kCGImageDestinationLossyCompressionQuality: 0.95] as CFDictionary)
                    guard CGImageDestinationFinalize(destination) else { throw APIError.invalidResponse }; return output
                }.value
                defer { if photo != file { try? FileManager.default.removeItem(at: photo) } }
                try Task.checkCancellation()
                try await PHPhotoLibrary.shared().performChanges { let options = PHAssetResourceCreationOptions(); options.shouldMoveFile = false; if let source = CGImageSourceCreateWithURL(photo as CFURL, nil) { options.uniformTypeIdentifier = CGImageSourceGetType(source) as String? }; PHAssetCreationRequest.forAsset().addResource(with: .photo, fileURL: photo, options: options) }
                showNativeNotice("已保存到相册。")
            } catch { if !Task.isCancelled, view.window != nil { showNativeNotice(error.localizedDescription) } }
        }
    }
    override func viewDidDisappear(_ animated: Bool) { super.viewDidDisappear(animated); if navigationController?.viewControllers.contains(where: { $0 === self }) != true { saveTask?.cancel(); saveTask = nil } }
}

@MainActor
final class NativeFilePreviewController: QLPreviewController, QLPreviewControllerDataSource {
    private var file: URL?
    private let remote: URL
    private let filename: String
    private var downloadTask: Task<Void, Never>?
    private var temporaryDirectory: URL?
    init(url: URL, filename: String) { remote = url; self.filename = filename; super.init(nibName: nil, bundle: nil); dataSource = self }
    required init?(coder: NSCoder) { fatalError("不使用 Storyboard") }
    override func viewDidLoad() {
        super.viewDidLoad(); title = filename
        downloadTask = Task {
            do {
                guard remote.scheme == "https" else { throw APIError.invalidResponse }
                let temp = try await NativeBoundedDownload(limit: 100 * 1024 * 1024).download(remote)
                defer { try? FileManager.default.removeItem(at: temp) }; try Task.checkCancellation()
                let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
                try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
                temporaryDirectory = folder
                let safe = (filename as NSString).lastPathComponent
                let destination = folder.appendingPathComponent(safe.isEmpty ? "文件" : safe)
                try FileManager.default.moveItem(at: temp, to: destination); file = destination; reloadData()
            } catch { if !Task.isCancelled, view.window != nil { showNativeNotice(error.localizedDescription) } }
        }
    }
    func numberOfPreviewItems(in controller: QLPreviewController) -> Int { file == nil ? 0 : 1 }
    func previewController(_ controller: QLPreviewController, previewItemAt index: Int) -> QLPreviewItem { file! as NSURL }
    override func viewDidDisappear(_ animated: Bool) { super.viewDidDisappear(animated); if navigationController?.viewControllers.contains(where: { $0 === self }) != true { downloadTask?.cancel(); downloadTask = nil; if let directory = temporaryDirectory { try? FileManager.default.removeItem(at: directory) }; temporaryDirectory = nil; file = nil } }
}

@MainActor
final class NativeVideoPreviewController: AVPlayerViewController {
    private let source: URL
    private let allowSave: Bool
    private var saveTask: Task<Void, Never>?
    private var playbackObservation: NSKeyValueObservation?
    private var backgroundObserver: NSObjectProtocol?
    private var playbackFailed = false
    private var failureReported = false
    init(url: URL, allowSave: Bool = true) { source = url; self.allowSave = allowSave; super.init(nibName: nil, bundle: nil); player = AVPlayer(url: url) }
    required init?(coder: NSCoder) { fatalError("不使用 Storyboard") }
    override func viewDidLoad() {
        super.viewDidLoad()
        if allowSave { navigationItem.rightBarButtonItem = UIBarButtonItem(title: "保存", style: .plain, target: self, action: #selector(save)) }
        playbackObservation = player?.currentItem?.observe(\.status, options: [.initial, .new]) { [weak self] item, _ in
            let failed = item.status == .failed
            Task { @MainActor in guard let self = self, failed else { return }; self.playbackFailed = true; self.reportPlaybackFailure() }
        }
        backgroundObserver = NotificationCenter.default.addObserver(forName: UIApplication.willResignActiveNotification, object: nil, queue: .main) { [weak self] _ in Task { @MainActor in self?.player?.pause() } }
    }
    override func viewWillAppear(_ animated: Bool) { super.viewWillAppear(animated); navigationController?.setNavigationBarHidden(false, animated: animated); player?.play() }
    override func viewDidAppear(_ animated: Bool) { super.viewDidAppear(animated); reportPlaybackFailure() }
    private func reportPlaybackFailure() {
        guard playbackFailed, !failureReported, view.window != nil, presentedViewController == nil else { return }
        failureReported = true; showNativeNotice("视频暂时无法播放，请检查网络后重新打开。")
    }
    @objc private func save() {
        guard saveTask == nil else { return }; navigationItem.rightBarButtonItem?.isEnabled = false
        saveTask = Task {
            defer { saveTask = nil; navigationItem.rightBarButtonItem?.isEnabled = true }
            do {
                let status = await PHPhotoLibrary.requestAuthorization(for: .addOnly)
                guard status == .authorized || status == .limited else { throw APIError.business(code: -1, message: "请在系统设置中允许添加照片。") }
                let temp: URL
                if source.isFileURL { temp = source } else { temp = try await NativeBoundedDownload(limit: 300 * 1024 * 1024).download(source) }
                defer { if !source.isFileURL { try? FileManager.default.removeItem(at: temp) } }
                try Task.checkCancellation()
                let asset = AVURLAsset(url: temp); guard try await asset.load(.isPlayable) else { throw APIError.invalidResponse }
                let ext = source.pathExtension.isEmpty ? "mp4" : source.pathExtension
                let named = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString).appendingPathExtension(ext)
                try FileManager.default.copyItem(at: temp, to: named); defer { try? FileManager.default.removeItem(at: named) }
                try Task.checkCancellation()
                try await PHPhotoLibrary.shared().performChanges { PHAssetChangeRequest.creationRequestForAssetFromVideo(atFileURL: named) }
                showNativeNotice("已保存到相册。")
            } catch { if !Task.isCancelled, view.window != nil { showNativeNotice(error.localizedDescription) } }
        }
    }
    override func viewDidDisappear(_ animated: Bool) { super.viewDidDisappear(animated); player?.pause(); if navigationController?.viewControllers.contains(where: { $0 === self }) != true { saveTask?.cancel(); playbackObservation?.invalidate(); playbackObservation = nil; player?.replaceCurrentItem(with: nil); player = nil } }
    deinit { if let token = backgroundObserver { NotificationCenter.default.removeObserver(token) } }
}

/// 气泡菜单直接保存媒体；不把已降采样的显示位图当原图写入相册。
@MainActor
enum NativeMediaExport {
    static func save(media: ChatMedia, policy: MediaURLPolicy, ownedLocal: URL?) async throws {
        guard [102, 104].contains(media.kind) else { throw APIError.invalidResponse }
        let authorization = await PHPhotoLibrary.requestAuthorization(for: .addOnly)
        guard authorization == .authorized || authorization == .limited else { throw APIError.business(code: -1, message: "请在系统设置中允许添加照片。") }
        let file: URL
        if let local = ownedLocal { file = local }
        else {
            guard let url = policy.absolute(media.kind == 104 ? policy.playback(media.url) : policy.original(media.url)), url.scheme == "https" else { throw APIError.invalidResponse }
            file = try await NativeBoundedDownload(limit: media.kind == 102 ? 40 * 1024 * 1024 : 300 * 1024 * 1024).download(url)
        }
        defer { if ownedLocal == nil { try? FileManager.default.removeItem(at: file) } }
        try Task.checkCancellation()
        if media.kind == 104 {
            let asset = AVURLAsset(url: file); guard try await asset.load(.isPlayable) else { throw APIError.invalidResponse }
            let ext = (policy.absolute(media.url)?.pathExtension).flatMap { $0.isEmpty ? nil : $0 } ?? "mp4"
            let named = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString).appendingPathExtension(ext)
            try FileManager.default.copyItem(at: file, to: named); defer { try? FileManager.default.removeItem(at: named) }
            try Task.checkCancellation(); try await PHPhotoLibrary.shared().performChanges { PHAssetChangeRequest.creationRequestForAssetFromVideo(atFileURL: named) }; return
        }
        let output = try await Task.detached(priority: .userInitiated) { () -> (URL, String) in
            guard let source = CGImageSourceCreateWithURL(file as CFURL, [kCGImageSourceShouldCache: false] as CFDictionary), let type = CGImageSourceGetType(source) as String? else { throw APIError.invalidResponse }
            if ["public.jpeg", "public.png", "public.heic", "public.heif", "com.compuserve.gif", "public.tiff"].contains(type) { return (file, type) }
            guard type.lowercased().contains("webp"), let bitmap = CGImageSourceCreateThumbnailAtIndex(source, 0, [kCGImageSourceCreateThumbnailFromImageAlways: true, kCGImageSourceCreateThumbnailWithTransform: true, kCGImageSourceThumbnailMaxPixelSize: 4096, kCGImageSourceShouldCacheImmediately: true] as CFDictionary) else { throw APIError.invalidResponse }
            let result = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString).appendingPathExtension("jpg")
            guard let destination = CGImageDestinationCreateWithURL(result as CFURL, "public.jpeg" as CFString, 1, nil) else { throw APIError.invalidResponse }
            CGImageDestinationAddImage(destination, bitmap, [kCGImageDestinationLossyCompressionQuality: 0.95] as CFDictionary)
            guard CGImageDestinationFinalize(destination) else { try? FileManager.default.removeItem(at: result); throw APIError.invalidResponse }; return (result, "public.jpeg")
        }.value
        defer { if output.0 != file { try? FileManager.default.removeItem(at: output.0) } }
        try Task.checkCancellation()
        try await PHPhotoLibrary.shared().performChanges { let options = PHAssetResourceCreationOptions(); options.shouldMoveFile = false; options.uniformTypeIdentifier = output.1; PHAssetCreationRequest.forAsset().addResource(with: .photo, fileURL: output.0, options: options) }
    }
}
