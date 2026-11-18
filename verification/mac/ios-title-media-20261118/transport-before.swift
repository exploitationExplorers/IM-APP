import Foundation
enum APIError: Error { case invalidResponse, invalidConfiguration, cancelled; case business(code: Int, message: String) }
final class NativeBoundedDownload: NSObject, URLSessionDownloadDelegate, @unchecked Sendable {
    func urlSession(_ session: URLSession, task: URLSessionTask, didFinishCollecting metrics: URLSessionTaskMetrics) {
        for metric in metrics.transactionMetrics {
            print("transport reused=\(metric.isReusedConnection) protocol=\(metric.networkProtocolName ?? "unknown") durationMS=\(Int(metrics.taskInterval.duration * 1000))")
        }
    }
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
        guard url.scheme == "http" else { throw APIError.invalidConfiguration }
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
        completionHandler(request.url?.scheme == "http" ? request : nil)
    }
    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didWriteData bytesWritten: Int64, totalBytesWritten: Int64, totalBytesExpectedToWrite: Int64) {
        if totalBytesWritten > limit || totalBytesExpectedToWrite > limit { downloadTask.cancel(); finish(.failure(APIError.business(code: -1, message: "文件超过本机预览大小限制。"))) }
    }
    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {
        do {
            guard let response = downloadTask.response as? HTTPURLResponse, (200..<300).contains(response.statusCode), response.url?.scheme == "http" else { throw APIError.invalidResponse }
            let size = (try FileManager.default.attributesOfItem(atPath: location.path)[.size] as? NSNumber)?.int64Value ?? Int64.max
            guard size <= limit else { throw APIError.business(code: -1, message: "文件超过本机预览大小限制。") }
            lock.lock(); let active = continuation != nil && !cancelled; lock.unlock(); guard active else { return }
            let file = FileManager.default.temporaryDirectory.appendingPathComponent("native-media-" + UUID().uuidString)
            try FileManager.default.moveItem(at: location, to: file); finish(.success(file))
        } catch { finish(.failure(error)) }
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) { if let error = error { finish(.failure(error)) } }
}


@main struct Probe {
 static func main() async throws {
  for _ in 0..<4 {
   let file = try await NativeBoundedDownload(limit: 1048576).download(URL(string: "http://127.0.0.1:18763/image")!)
   try FileManager.default.removeItem(at: file)
  }
 }
}
