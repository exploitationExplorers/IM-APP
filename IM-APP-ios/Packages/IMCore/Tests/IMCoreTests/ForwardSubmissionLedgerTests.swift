import Foundation
import XCTest
@testable import IMCore

final class ForwardSubmissionLedgerTests: XCTestCase {
    func testAcceptedReceiptDoesNotOverwriteOtherPendingBatchAndSurvivesRestart() async throws {
        let folder = try temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: folder) }
        let file = folder.appendingPathComponent("forward-submissions.json")
        let ledger = ForwardSubmissionLedger(file: file)
        let first = submission(key: "a")
        let second = submission(key: "b")
        try await ledger.save(first)
        try await ledger.save(second)
        try await ledger.save(first)
        let receipt = ForwardAccepted(batchId: "batch", taskIds: ["task"], status: "queued")
        try await ledger.record(receipt, for: first)
        let restored = ForwardSubmissionLedger(file: file)
        let rows = try await restored.submissions()
        XCTAssertEqual(rows.count, 2)
        XCTAssertEqual(rows.first(where: { $0.key == "a" })?.accepted, receipt)
        XCTAssertNil(rows.first(where: { $0.key == "b" })?.accepted)
    }

    func testConflictingIdempotencyKeyAndStoppedOwnerCannotWrite() async throws {
        let folder = try temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: folder) }
        let file = folder.appendingPathComponent("forward-submissions.json")
        let ledger = ForwardSubmissionLedger(file: file)
        try await ledger.save(submission(key: "a"))
        let before = try Data(contentsOf: file)
        do {
            try await ledger.save(submission(key: "a", value: "changed"))
            XCTFail("同一幂等键不能对应不同内容")
        } catch APIError.invalidResponse { }
        await ledger.stop()
        do {
            try await ledger.save(submission(key: "b"))
            XCTFail("旧 owner 不得迟到写入")
        } catch APIError.cancelled { }
        XCTAssertEqual(try Data(contentsOf: file), before)
    }

    func testCorruptArchiveIsPreservedInsteadOfSilentlyReset() async throws {
        let folder = try temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: folder) }
        let file = folder.appendingPathComponent("forward-submissions.json")
        let corrupt = Data("not-json".utf8)
        try corrupt.write(to: file)
        let ledger = ForwardSubmissionLedger(file: file)
        do {
            try await ledger.save(submission(key: "a"))
            XCTFail("坏日志不得当成空数据覆盖")
        } catch is DecodingError { }
        XCTAssertEqual(try Data(contentsOf: file), corrupt)
    }

    private func submission(key: String, value: String = "content") -> ForwardSubmission {
        ForwardSubmission(key: key, sourceConversationID: "source", messageIDs: ["message"],
                          body: ["idempotencyKey": .string(key), "value": .string(value)], createdAt: Date(timeIntervalSince1970: 1))
    }

    private func temporaryDirectory() throws -> URL {
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        return folder
    }
}
