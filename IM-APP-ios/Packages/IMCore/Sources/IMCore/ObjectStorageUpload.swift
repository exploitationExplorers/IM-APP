import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// 只编码对象存储请求，不携带业务认证；调用者在后台执行大块数据拼装。
public enum ObjectStorageUpload {
    public static func encode(url: URL, data: Data, contentType: String, fields: [String: String]?, headers: [String: String] = [:], boundary: String = "im-" + UUID().uuidString) throws -> (request: URLRequest, body: Data) {
        guard url.scheme == "https", url.host != nil, url.user == nil, url.password == nil,
              contentType.rangeOfCharacter(from: .newlines) == nil,
              !boundary.isEmpty, boundary.rangeOfCharacter(from: .newlines) == nil, !boundary.contains("\"") else { throw APIError.invalidResponse }
        var request = URLRequest(url: url); request.timeoutInterval = 60
        var body: Data
        if let fields = fields, !fields.isEmpty {
            request.httpMethod = "POST"
            request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
            body = Data(); body.reserveCapacity(data.count + 2048)
            for key in fields.keys.sorted() {
                guard key.rangeOfCharacter(from: .newlines) == nil, !key.contains("\"") else { throw APIError.invalidResponse }
                body.append(Data("--\(boundary)\r\nContent-Disposition: form-data; name=\"\(key)\"\r\n\r\n\(fields[key] ?? "")\r\n".utf8))
            }
            body.append(Data("--\(boundary)\r\nContent-Disposition: form-data; name=\"file\"; filename=\"upload\"\r\nContent-Type: \(contentType)\r\n\r\n".utf8))
            body.append(data); body.append(Data("\r\n--\(boundary)--\r\n".utf8))
        } else {
            request.httpMethod = "PUT"; body = data
            request.setValue(contentType, forHTTPHeaderField: "Content-Type")
        }
        for (key, value) in headers where key.lowercased() != "authorization" { request.setValue(value, forHTTPHeaderField: key) }
        return (request, body)
    }
}
