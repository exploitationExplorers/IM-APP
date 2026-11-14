import XCTest
import Foundation
@testable import IMCore

final class ChatReliabilityTests: XCTestCase {
    func testForwardBatchReceiptRequiresExplicitQueueAndCompleteIdentifiers() {
        XCTAssertTrue(ForwardBatchReceiptPolicy.isAccepted(status: "queued", batchID: "batch-1", taskIDs: ["task-1", "task-2"]))
        for status in ["", "success", "completed"] { XCTAssertFalse(ForwardBatchReceiptPolicy.isAccepted(status: status, batchID: "batch-1", taskIDs: ["task-1"])) }
        for batch in ["", " ", " batch-1", "batch\n1"] { XCTAssertFalse(ForwardBatchReceiptPolicy.isAccepted(status: "queued", batchID: batch, taskIDs: ["task-1"])) }
        for tasks in [[], [""], [" "], ["task-1", "task-1"], ["task-1", "task\n2"]] { XCTAssertFalse(ForwardBatchReceiptPolicy.isAccepted(status: "queued", batchID: "batch-1", taskIDs: tasks)) }
    }
    func testForwardCacheBindingsPreservePictureVariantsAndDuplicateSources() throws {
        let source = try ForwardMessageSnapshot.make(serialized: """
        {"contentType":102,"pictureElem":{"sourcePicture":{"url":"https://example.invalid/source.jpg"},"snapshotPicture":{"url":"https://example.invalid/source.jpg"}}}
        """)
        let destination = try ForwardMessageSnapshot.make(serialized: """
        {"contentType":102,"pictureElem":{"sourcePicture":{"url":"https://example.invalid/archived-original.jpg"},"snapshotPicture":{"url":"https://example.invalid/archived-thumb.jpg"}}}
        """)
        let pairs = source.imageCopies(to: destination)
        XCTAssertEqual(pairs.count, 2)
        XCTAssertEqual(pairs.map(\.destination), ["https://example.invalid/archived-original.jpg", "https://example.invalid/archived-thumb.jpg"])
        let text = try ForwardMessageSnapshot.make(serialized: "{\"contentType\":101,\"textElem\":{\"content\":\"hello\"}}")
        XCTAssertTrue(source.imageCopies(to: text).isEmpty)
    }
    func testNativeUpdateAcceptsOnlySpecificAppleDistributionPages() throws {
        let links = NativeDistributionLinks(testFlightURL: "https://testflight.apple.com/join/Ab12Cd34", appStoreURL: "https://apps.apple.com/cn/app/example/id123456789")
        XCTAssertNotNil(links.testFlight); XCTAssertNotNil(links.appStore)
        let decoded = try JSONDecoder().decode(NativeDistributionLinks.self, from: Data("{\"testFlightURL\":\"\",\"appStoreURL\":\"https://apps.apple.com/app/id123\"}".utf8))
        XCTAssertNil(decoded.testFlight); XCTAssertNotNil(decoded.appStore)
        for bad in ["https://testflight.apple.com.evil.invalid/join/Ab12Cd34", "http://testflight.apple.com/join/Ab12Cd34", "https://user@ testflight.apple.com/join/Ab12Cd34", "https://testflight.apple.com/join/invalid", "https://testflight.apple.com/"] {
            XCTAssertNil(NativeDistributionLinks(testFlightURL: bad).testFlight)
        }
        for bad in ["https://apps.apple.com/file.ipa", "https://apps.apple.com/app/idabc", "https://evil.invalid/app/id123", "https://user@apps.apple.com/app/id123", "https://apps.apple.com:443/app/id123"] {
            XCTAssertNil(NativeDistributionLinks(appStoreURL: bad).appStore)
        }
    }

    func testPendingLocalImageSurvivesRestartWithoutBeingMarkedSent() async throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }
        let file = dir.appendingPathComponent("outbox.json")
        let serialized = "{\"clientMsgID\":\"local-image\",\"contentType\":102,\"pictureElem\":{\"sourcePath\":\"/account/media/image.jpg\"}}"
        let outbox = try PersistentOutbox(fileURL: file, ownerKey: "account-A")
        try await outbox.prepare(OutboxEntry(clientMsgID: "local-image", conversationID: "group-1", targetID: "group-1", sessionType: 3, text: "[图片]", serializedMessage: serialized, createdAt: 123))
        let before = await outbox.snapshot(); XCTAssertEqual(before.first?.state, .prepared)
        let recovered = try PersistentOutbox(fileURL: file, ownerKey: "account-A")
        let after = await recovered.snapshot()
        XCTAssertEqual(after.first?.serializedMessage, serialized)
        XCTAssertEqual(after.first?.state, .uncertain)
        do { try await recovered.transition("local-image", to: .sending); XCTFail("重启后无回执不能盲重发") } catch { XCTAssertTrue(error is OutboxError) }
    }
    func testOnlyExactExistingLegacyEndpointsUpgradeOnDefaultOrigin() throws {
        let business = try XCTUnwrap(URL(string: IMEndpointPolicy.defaultOrigin + "/api/v1/"))
        XCTAssertEqual(try IMEndpointPolicy.resolve("http://8.154.44.197/openim-api", webSocket: false, businessBaseURL: business), IMEndpointPolicy.defaultOrigin + "/openim-api")
        XCTAssertEqual(try IMEndpointPolicy.resolve("ws://8.154.44.197/openim-ws", webSocket: true, businessBaseURL: business), "wss://www.xn--jprz53bj9s.com/openim-ws")
        XCTAssertEqual(try IMEndpointPolicy.resolve("http://8.154.44.197:80/openim-api/", webSocket: false, businessBaseURL: business), IMEndpointPolicy.defaultOrigin + "/openim-api")
        for source in ["http://8.154.44.197:8080/openim-api", "http://8.154.44.197/openim-api//", "http://8.154.44.197/other", "http://other.invalid/openim-api", "https://user:secret@im.invalid", "https://im.invalid?a=1", "https://im.invalid#fragment"] {
            XCTAssertThrowsError(try IMEndpointPolicy.resolve(source, webSocket: false, businessBaseURL: business))
        }
        let test = try XCTUnwrap(URL(string: "https://test.invalid/api/v1"))
        XCTAssertThrowsError(try IMEndpointPolicy.resolve("http://8.154.44.197/openim-api", webSocket: false, businessBaseURL: test))
        XCTAssertEqual(try IMEndpointPolicy.resolve("https://explicit-secure.invalid/api", webSocket: false, businessBaseURL: test), "https://explicit-secure.invalid/api")
    }

    private func entry(_ id: String = "stable-sdk-client-id") -> OutboxEntry {
        OutboxEntry(clientMsgID: id, conversationID: "si_account_peer", targetID: "peer", sessionType: 1,
                    text: "待发文字", serializedMessage: "{\"clientMsgID\":\"\(id)\"}", createdAt: 123)
    }

    func testOutboxRecoversInFlightAsUncertainAndRefusesBlindResend() async throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }
        let file = dir.appendingPathComponent("outbox.json")
        let first = try PersistentOutbox(fileURL: file, ownerKey: "environment/account-A")
        try await first.prepare(entry())
        try await first.transition("stable-sdk-client-id", to: .sending)
        let recovered = try PersistentOutbox(fileURL: file, ownerKey: "environment/account-A")
        let snapshot = await recovered.snapshot()
        XCTAssertEqual(snapshot.first?.state, .uncertain)
        XCTAssertEqual(snapshot.first?.serializedMessage, entry().serializedMessage)
        do { try await recovered.transition("stable-sdk-client-id", to: .sending); XCTFail("不确定结果不能盲重发") }
        catch { XCTAssertTrue(error is OutboxError) }
        try await recovered.transition("stable-sdk-client-id", to: .accepted)
        let accepted = await recovered.snapshot()
        XCTAssertEqual(accepted.first?.state, .accepted)
    }

    func testOutboxRejectsCrossAccountReadAndDuplicateID() async throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }
        let file = dir.appendingPathComponent("outbox.json")
        let outbox = try PersistentOutbox(fileURL: file, ownerKey: "test/account-A")
        try await outbox.prepare(entry())
        XCTAssertThrowsError(try PersistentOutbox(fileURL: file, ownerKey: "test/account-B"))
        do { try await outbox.prepare(entry()); XCTFail("相同 clientMsgID 不能创建第二次发送") }
        catch { XCTAssertTrue(error is OutboxError) }
    }

    func testOutboxWriteFailureLeavesNoRecordAndCannotProceedToSend() async throws {
        let missing = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString).appendingPathComponent("missing/outbox.json")
        let outbox = try PersistentOutbox(fileURL: missing, ownerKey: "test/account-A")
        do { try await outbox.prepare(entry()); XCTFail("写盘失败必须向调用者抛错") }
        catch { }
        let snapshot = await outbox.snapshot()
        XCTAssertTrue(snapshot.isEmpty)
    }

    func testOnlyExplicitFailureCanRetrySameStableID() async throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }
        let outbox = try PersistentOutbox(fileURL: dir.appendingPathComponent("outbox.json"), ownerKey: "test/account-A")
        try await outbox.prepare(entry())
        try await outbox.transition("stable-sdk-client-id", to: .sending)
        try await outbox.transition("stable-sdk-client-id", to: .failed)
        try await outbox.transition("stable-sdk-client-id", to: .sending)
        let snapshot = await outbox.snapshot()
        XCTAssertEqual(snapshot.count, 1)
        XCTAssertEqual(snapshot[0].clientMsgID, "stable-sdk-client-id")
    }

    func testHistoryAndIncomingDeduplicateStableIDsWithoutDowngradingSDKSuccess() {
        let waiting = ChatTextItem(id: "a", senderID: "mine", text: "文字", timestamp: 2, status: 1)
        let success = ChatTextItem(id: "a", senderID: "mine", text: "文字", timestamp: 2, status: 2)
        let incoming = ChatTextItem(id: "b", senderID: "peer", text: "回复", timestamp: 3, status: 2)
        let merged = ChatTextItem.merge(ChatTextItem.merge([waiting], [success, incoming]), [waiting])
        XCTAssertEqual(merged.map(\.id), ["a", "b"])
        XCTAssertEqual(merged[0].status, 2)
    }

    func testRevokedStatusCannotBeReplacedByLateHistoryOriginal() {
        let original = ChatTextItem(id: "revoked", senderID: "peer", text: "撤回前原文", timestamp: 1, status: 2)
        let revoked = ChatTextItem(id: "revoked", senderID: "peer", text: "[消息已撤回]", timestamp: 1, status: 4)
        let merged = ChatTextItem.merge(ChatTextItem.merge([original], [revoked]), [original])
        XCTAssertEqual(merged.first?.text, "[消息已撤回]")
        XCTAssertEqual(merged.first?.status, 4)
    }

    func testPruningOnlyRemovesConfirmedAcceptedAndPreservesUncertainAndFailed() async throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }
        let outbox = try PersistentOutbox(fileURL: dir.appendingPathComponent("outbox.json"), ownerKey: "test/account-A")
        for id in ["confirmed", "uncertain", "failed"] { try await outbox.prepare(entry(id)) }
        try await outbox.transition("confirmed", to: .sending)
        try await outbox.transition("confirmed", to: .accepted)
        try await outbox.transition("uncertain", to: .sending)
        try await outbox.transition("uncertain", to: .uncertain)
        try await outbox.transition("failed", to: .failed)
        try await outbox.pruneConfirmedAccepted(Set(["confirmed", "uncertain", "failed"]))
        let snapshot = await outbox.snapshot()
        XCTAssertEqual(snapshot.map(\.clientMsgID), ["uncertain", "failed"])
        XCTAssertEqual(snapshot.map(\.state), [.uncertain, .failed])
    }
    func testLateSendingEvidenceRestoresUncertaintyAndBlocksBlindRetry() async throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }
        let outbox = try PersistentOutbox(fileURL: dir.appendingPathComponent("outbox.json"), ownerKey: "test/account-A")
        try await outbox.prepare(entry())
        try await outbox.transition("stable-sdk-client-id", to: .failed)
        try await outbox.transition("stable-sdk-client-id", to: .uncertain)
        do { try await outbox.transition("stable-sdk-client-id", to: .sending); XCTFail("迟到的发送中证据必须阻断重试") } catch { XCTAssertTrue(error is OutboxError) }
        let snapshot = await outbox.snapshot()
        XCTAssertEqual(snapshot.first?.state, .uncertain)
        try await outbox.transition("stable-sdk-client-id", to: .accepted)
        try await outbox.pruneConfirmedAccepted(Set(["stable-sdk-client-id"]))
        let final = await outbox.snapshot(); XCTAssertTrue(final.isEmpty)
    }

    func testLateFailureCannotReplaceAnActiveRetryOrConfirmedAcceptance() async throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }
        let outbox = try PersistentOutbox(fileURL: dir.appendingPathComponent("outbox.json"), ownerKey: "test/account-A")
        try await outbox.prepare(entry()); try await outbox.transition("stable-sdk-client-id", to: .sending)
        let first = try await outbox.confirmUncertainFailure("stable-sdk-client-id"); XCTAssertFalse(first)
        try await outbox.transition("stable-sdk-client-id", to: .uncertain)
        let confirmed = try await outbox.confirmUncertainFailure("stable-sdk-client-id"); XCTAssertTrue(confirmed)
        try await outbox.transition("stable-sdk-client-id", to: .sending)
        let retry = try await outbox.confirmUncertainFailure("stable-sdk-client-id"); XCTAssertFalse(retry)
        try await outbox.transition("stable-sdk-client-id", to: .accepted)
        let accepted = try await outbox.confirmUncertainFailure("stable-sdk-client-id"); XCTAssertFalse(accepted)
        let snapshot = await outbox.snapshot(); XCTAssertEqual(snapshot.first?.state, .accepted)
    }

}
