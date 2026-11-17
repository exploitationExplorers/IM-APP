import Foundation
import Darwin
import IMCore

struct Input: Decodable { let label: String; let phone: String; let password: String }

func hiddenInput() -> Data? {
    var original = termios()
    let terminal = isatty(STDIN_FILENO) != 0 && tcgetattr(STDIN_FILENO, &original) == 0
    if terminal {
        var hidden = original; hidden.c_lflag &= ~tcflag_t(ECHO)
        tcsetattr(STDIN_FILENO, TCSANOW, &hidden)
    }
    defer { if terminal { tcsetattr(STDIN_FILENO, TCSANOW, &original) } }
    print("Ready for authorized credentials; only anonymous status is printed.")
    fflush(stdout)
    return readLine()?.data(using: .utf8)
}

func status(_ error: Error) -> String {
    guard let failure = error as? APIError else { return "transport_or_decode" }
    switch failure {
    case .httpStatus(let value): return "http_\(value)"
    case .business(let code, _): return "business_\(code)"
    case .timedOut: return "timeout"
    case .profileMismatch: return "identity_mismatch"
    case .platformMismatch: return "platform_mismatch"
    case .invalidCredentials: return "credential_shape"
    default: return "other_client_error"
    }
}

func openIM(_ ticket: IMToken, path: String, body: [String: Any], authorized: Bool) async throws -> (Int, [String: Any]) {
    guard let url = URL(string: ticket.apiAddr + path) else { throw APIError.invalidResponse }
    var request = URLRequest(url: url)
    request.httpMethod = "POST"; request.timeoutInterval = 20
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.setValue("application/json", forHTTPHeaderField: "Accept")
    request.setValue(UUID().uuidString, forHTTPHeaderField: "operationID")
    if authorized { request.setValue(ticket.token, forHTTPHeaderField: "token") }
    request.httpBody = try JSONSerialization.data(withJSONObject: body)
    let response = try await URLSessionTransport().send(request)
    return (response.status, try JSONSerialization.jsonObject(with: response.body) as? [String: Any] ?? [:])
}

func run(_ input: Input) async -> [String: Any] {
    var result: [String: Any] = ["case": input.label, "sdk_invoked": false, "keychain_used": false, "platform": 1]
    do {
        let configuration = try APIConfiguration(baseURL: "https://www.xn--jprz53bj9s.com/api/v1")
        let client = APIClient(configuration: configuration)
        let account = try await client.businessPasswordLogin(.init(countryCode: "+86", phone: input.phone,
            password: input.password, deviceId: "ios-readonly-probe-" + UUID().uuidString))
        result["business_login"] = "ok"
        result["profile_loaded"] = account.profileLoadWarning == nil
        var checks: [[String: Any]] = []
        var previous: String?
        for attempt in 1...2 {
            var check: [String: Any] = ["attempt": attempt]
            do {
                let token = try await client.imToken(accessToken: account.authentication.accessToken)
                _ = try IMBootstrapCredential(businessUserID: account.profile.id,
                    apiBaseURL: configuration.baseURL.absoluteString, token: token)
                    .validForLogin(businessUserID: account.profile.id, configuration: configuration)
                check["identity_platform_endpoint_expiry_validation"] = "ok"
                if let previous { check["same_ticket_as_previous_request"] = previous == token.token }
                previous = token.token
                let (parseHTTP, parsed) = try await openIM(token, path: "/auth/parse_token",
                    body: ["token": token.token], authorized: false)
                check["parse_http"] = parseHTTP; check["parse_code"] = parsed["errCode"]
                if let data = parsed["data"] as? [String: Any] {
                    check["parsed_identity_matches"] = data["userID"] as? String == token.userId
                    check["parsed_platform_matches"] = data["platformID"] as? Int == 1
                }
                let (readHTTP, read) = try await openIM(token, path: "/conversation/get_all_conversations",
                    body: ["ownerUserID": token.userId], authorized: true)
                check["conversation_http"] = readHTTP; check["conversation_code"] = read["errCode"]
                if let data = read["data"] as? [String: Any], let rows = data["conversations"] as? [Any] {
                    check["conversation_count"] = rows.count
                }
            } catch { check["error"] = status(error) }
            checks.append(check)
        }
        result["checks"] = checks
    } catch { result["error"] = status(error) }
    return result
}

@main struct Probe {
    static func main() async {
        guard let data = hiddenInput(), let inputs = try? JSONDecoder().decode([Input].self, from: data),
              inputs.count <= 2, inputs.allSatisfy({ ["working_control", "failing_case"].contains($0.label) }) else {
            print("Invalid input"); return
        }
        var results: [[String: Any]] = []
        for input in inputs { results.append(await run(input)) }
        let report: [String: Any] = ["checked_at_utc": ISO8601DateFormatter().string(from: Date()),
            "client_source": "IM-APP-ios/Packages/IMCore", "cases": results]
        if let output = try? JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys]),
           let text = String(data: output, encoding: .utf8) { print(text) }
    }
}
