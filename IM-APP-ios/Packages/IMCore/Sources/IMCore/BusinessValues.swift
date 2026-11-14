import Foundation

/// 某些已存在的修改接口成功时返回 data:null。
public struct EmptyReply: Decodable, Sendable { public init() {} }

/// HTTP 成功只代表收到了响应，批次号和任务号齐全才可记为服务端受理。
public enum ForwardBatchReceiptPolicy {
    public enum DeliveryState: Equatable, Sendable { case pending, success, failure, unconfirmed }
    public static func isAccepted(status: String, batchID: String, taskIDs: [String]) -> Bool {
        func validID(_ id: String) -> Bool {
            !id.isEmpty && id.count <= 256 && id == id.trimmingCharacters(in: .whitespacesAndNewlines) && id.unicodeScalars.allSatisfy { !CharacterSet.controlCharacters.contains($0) }
        }
        return status == "queued" && validID(batchID) && !taskIDs.isEmpty && taskIDs.allSatisfy(validID) && Set(taskIDs).count == taskIDs.count
    }
    /// queued 不是送达；只有全部目标已确认成功，且没有待处理/跳过/失败对象，才显示成功。
    public static func deliveryState(status: String, targetCount: Int, successCount: Int, failedCount: Int, skippedCount: Int, cancelledCount: Int, pendingCount: Int, processingCount: Int) -> DeliveryState {
        let counts = [targetCount, successCount, failedCount, skippedCount, cancelledCount, pendingCount, processingCount]
        guard counts.allSatisfy({ $0 >= 0 }) else { return .unconfirmed }
        if ["failed", "partially_completed", "cancelled"].contains(status) { return .failure }
        if status == "completed" {
            return targetCount > 0 && successCount == targetCount && failedCount == 0 && skippedCount == 0 && cancelledCount == 0 && pendingCount == 0 && processingCount == 0 ? .success : .unconfirmed
        }
        return ["draft", "expanding", "pending", "processing", "paused"].contains(status) ? .pending : .unconfirmed
    }
}

/// 原生包只跳转 Apple 分发入口，不把旧 WGT/IPA 地址当作可安装更新。
public struct NativeDistributionLinks: Decodable, Sendable {
    public let testFlightURL: String
    public let appStoreURL: String
    public init(testFlightURL: String = "", appStoreURL: String = "") { self.testFlightURL = testFlightURL; self.appStoreURL = appStoreURL }
    public var testFlight: URL? { Self.appleURL(testFlightURL, testFlight: true) }
    public var appStore: URL? { Self.appleURL(appStoreURL, testFlight: false) }
    private static func appleURL(_ raw: String, testFlight: Bool) -> URL? {
        guard let parts = URLComponents(string: raw), parts.scheme?.lowercased() == "https", parts.user == nil, parts.password == nil, parts.port == nil,
              parts.host?.lowercased() == (testFlight ? "testflight.apple.com" : "apps.apple.com"), let url = parts.url else { return nil }
        let pattern = testFlight ? "^/join/[A-Za-z0-9]{8}/?$" : "^/(?:[A-Za-z]{2}/)?app/(?:[^/]+/)?id[0-9]+/?$"
        guard parts.path.range(of: pattern, options: .regularExpression) != nil else { return nil }; return url
    }
}

/// 仅用来编码已有业务接口参数；界面仍使用各自的领域模型。
public enum JSONValue: Codable, Equatable, Sendable {
    case string(String), number(Double), bool(Bool), array([JSONValue]), object([String: JSONValue]), null
    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() { self = .null }
        else if let value = try? container.decode(Bool.self) { self = .bool(value) }
        else if let value = try? container.decode(String.self) { self = .string(value) }
        else if let value = try? container.decode(Double.self) { self = .number(value) }
        else if let value = try? container.decode([JSONValue].self) { self = .array(value) }
        else { self = .object(try container.decode([String: JSONValue].self)) }
    }
    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .string(let value): try container.encode(value)
        case .number(let value): try container.encode(value)
        case .bool(let value): try container.encode(value)
        case .array(let value): try container.encode(value)
        case .object(let value): try container.encode(value)
        case .null: try container.encodeNil()
        }
    }
}
