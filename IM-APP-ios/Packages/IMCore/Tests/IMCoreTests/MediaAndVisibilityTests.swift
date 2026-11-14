import XCTest
import Foundation
@testable import IMCore

final class MediaAndVisibilityTests: XCTestCase {
    private var policy: MediaURLPolicy { MediaURLPolicy(businessBaseURL: URL(string: "https://business.invalid/api/v1/")!) }
    func testVideoPlaybackRecoversOnlyKnownLegacySignedChatObject() {
        let raw = "https://oss-chat-test.xn--jprz53bj9s.com/oss-test/chat/a%20b/movie.mp4?OSSAccessKeyId=k&Signature=expired%2Bsignature&Expires=1"
        XCTAssertEqual(policy.playback(raw), "https://business.invalid/object/a%20b/movie.mp4")
        XCTAssertEqual(policy.image(raw), raw)
        for value in [
            "https://unknown.invalid/oss-test/chat/movie.mp4?OSSAccessKeyId=k&Signature=x%2By",
            "https://oss-chat-test.xn--jprz53bj9s.com/oss-test/business/movie.mp4?OSSAccessKeyId=k&Signature=x%2By",
            "https://oss-chat.whs188.xin/oss-test/chat/movie.mp4?OSSAccessKeyId=k&Signature=x%2By"
        ] { XCTAssertEqual(policy.playback(value), value) }
    }
    func testForwardSuccessRequiresCompletedAndEveryTargetAcknowledged() {
        func state(_ status: String, target: Int = 2, success: Int = 2, failed: Int = 0, skipped: Int = 0, cancelled: Int = 0, pending: Int = 0, processing: Int = 0) -> ForwardBatchReceiptPolicy.DeliveryState {
            ForwardBatchReceiptPolicy.deliveryState(status: status, targetCount: target, successCount: success, failedCount: failed, skippedCount: skipped, cancelledCount: cancelled, pendingCount: pending, processingCount: processing)
        }
        XCTAssertEqual(state("completed"), .success)
        XCTAssertEqual(state("queued"), .unconfirmed); XCTAssertEqual(state("processing", success: 1, processing: 1), .pending)
        XCTAssertEqual(state("completed", target: 0, success: 0), .unconfirmed)
        XCTAssertEqual(state("completed", success: 1), .unconfirmed)
        XCTAssertEqual(state("completed", skipped: 1), .unconfirmed)
        XCTAssertEqual(state("completed", pending: 1), .unconfirmed)
        XCTAssertEqual(state("completed", processing: 1), .unconfirmed)
        XCTAssertEqual(state("completed", failed: -1), .unconfirmed)
        XCTAssertEqual(state("partially_completed", success: 1, failed: 1), .failure)
        XCTAssertEqual(state("failed", success: 0, failed: 2), .failure)
        XCTAssertEqual(state("cancelled", success: 0, cancelled: 2), .failure)
    }
    func testSignedChatImageRecoversLogicalKeyForPreviewAndOriginal() {
        let raw = "https://oss-chat-test.xn--jprz53bj9s.com/oss-test/chat/a%20b/image.jpg?OSSAccessKeyId=key&Signature=expired%2Bsignature&Expires=1"
        let image = URLComponents(string: policy.image(raw, variant: .preview))!
        XCTAssertEqual(image.host, "business.invalid"); XCTAssertEqual(image.path, "/object/a b/image.jpg")
        XCTAssertEqual(image.queryItems?.first { $0.name == "width" }?.value, "960")
        XCTAssertNil(image.queryItems?.first { $0.name == "Signature" })
        XCTAssertEqual(policy.original(raw), "https://business.invalid/object/a%20b/image.jpg")
    }
    func testOtherSignedURLsRemainByteIdenticalAndVideoIsNotAnImage() {
        for raw in ["https://example.invalid/a%2Fb.jpg?X-Amz-Signature=a%2Bb&x=1+2", "https://oss-chat.whs188.xin/oss-test/chat/p.jpg?x-oss-signature=one%2Btwo", "https://oss-chat-test.xn--jprz53bj9s.com/oss-test/chat/p.mp4?OSSAccessKeyId=k&Signature=s"] {
            XCTAssertEqual(policy.image(raw), raw)
            XCTAssertEqual(policy.original(raw), raw)
        }
    }
    func testCDNTransformationRequiresMatchingHostAndBucket() {
        let allowed = "https://oss-business.whs188.xin/im-app-production/business/avatars/a.png"
        XCTAssertTrue(policy.image(allowed, variant: .avatar).contains("x-oss-process="))
        for raw in ["https://unknown.invalid/im-app-production/chat/a.jpg", "https://oss-business.whs188.xin/im-app-production/chat/a.jpg", "https://oss-chat.whs188.xin/im-app-production/chat/a.mp4"] {
            XCTAssertEqual(policy.image(raw), raw)
        }
    }
    func testSignedUnknownHostAndCrossBucketURLsRemainByteIdentical() {
        for raw in [
            "https://unknown.invalid/oss-test/chat/a%2Fb.jpg?OSSAccessKeyId=k&Signature=x%2By&opaque=1+2#keep",
            "https://oss-business.whs188.xin/im-app-production/chat/a.jpg?X-Amz-Signature=x%2By",
            "https://oss-chat-test.xn--jprz53bj9s.com/oss-test/business/a.jpg?x-oss-signature=x%2By",
            "https://unknown.invalid/oss-test/chat/a.gif?x-amz-signature=x%2By&variant=list"
        ] {
            XCTAssertEqual(policy.image(raw), raw)
            XCTAssertEqual(policy.image(raw, variant: .preview), raw)
            XCTAssertEqual(policy.original(raw), raw)
        }
    }
    func testGIFStableKeyRetainsAnimationAndOpaqueToken() {
        let raw = "/api/v1/public/oss-media?key=stickers%2Fanimated.GIF&token=keep%2Bthis&variant=list"
        XCTAssertTrue(policy.isGIF(raw))
        let image = URLComponents(string: policy.image(raw))!
        XCTAssertNil(image.queryItems?.first { $0.name == "variant" })
        XCTAssertEqual(image.queryItems?.first { $0.name == "token" }?.value, "keep+this")
        XCTAssertEqual(image.queryItems?.first { $0.name == "key" }?.value, "stickers/animated.GIF")
        let signed = "https://oss-chat-test.xn--jprz53bj9s.com/oss-test/chat/animated.gif?OSSAccessKeyId=k&Signature=expired"
        XCTAssertEqual(policy.image(signed), "https://business.invalid/object/animated.gif")
    }
    func testGIFPublicAndObjectURLsDoNotReceiveStaticWebPProcessing() {
        let raw = "https://oss-chat.whs188.xin/im-app-production/chat/animated.gif"
        XCTAssertEqual(policy.image(raw), raw)
        XCTAssertEqual(policy.image("/object/animated.gif?type=image&width=360&height=360&format=webp"), "https://business.invalid/object/animated.gif")
    }
    func testStableVariantsKeepTokenAndOriginalRemovesOnlyProcessing() {
        let raw = "/api/v1/public/oss-media?key=avatars%2Fa.jpg&token=opaque&variant=list"
        let preview = URLComponents(string: policy.image(raw, variant: .preview))!
        XCTAssertEqual(preview.queryItems?.first { $0.name == "token" }?.value, "opaque")
        XCTAssertEqual(preview.queryItems?.first { $0.name == "variant" }?.value, "preview-mobile")
        let original = URLComponents(string: policy.original(preview.url!.absoluteString))!
        XCTAssertNil(original.queryItems?.first { $0.name == "variant" }); XCTAssertEqual(original.queryItems?.first { $0.name == "token" }?.value, "opaque")
    }
    func testOnlyKnownUnsignedHTTPMediaUpgradesWithoutATSGlobalBypass() {
        XCTAssertEqual(policy.absolute("http://8.154.44.197/object/a.jpg?x=1")?.absoluteString, "https://business.invalid/object/a.jpg?x=1")
        XCTAssertEqual(policy.absolute("http://unknown.invalid/object/a.jpg")?.scheme, "http")
        let signed = "http://8.154.44.197/object/a.jpg?X-Amz-Signature=x"
        XCTAssertEqual(policy.image(signed), signed)
        XCTAssertNil(policy.absolute("file:///var/private/another-user/image.jpg"))
        XCTAssertNil(policy.absolute("https://user:password@other.invalid/image.jpg"))
    }
    func testRetentionFloorsPersistMonotonicallyAndDoNotEstimateSevenDays() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let file = directory.appendingPathComponent("visibility.json")
        let ledger = try GroupVisibilityLedger(file: file, owner: "env/account")
        _ = try await ledger.apply([GroupRetentionState(conversationId: "g", minVisibleSeq: 100, revision: 2)])
        let current = try await ledger.apply([GroupRetentionState(conversationId: "g", minVisibleSeq: 10, revision: 3), GroupRetentionState(conversationId: "g", minVisibleSeq: 500, revision: 1)])
        XCTAssertEqual(current.floors["g"]?.minVisibleSeq, 100)
        XCTAssertFalse(current.permits(ChatTextItem(id: "old", senderID: "a", text: "", timestamp: 9999999999999, status: 2, seq: 99), conversationID: "g"))
        XCTAssertTrue(current.permits(ChatTextItem(id: "new", senderID: "a", text: "", timestamp: 1, status: 2, seq: 100), conversationID: "g"))
        let recovered = try GroupVisibilityLedger(file: file, owner: "env/account")
        let snapshot = await recovered.snapshot(); XCTAssertEqual(snapshot, current)
        XCTAssertThrowsError(try GroupVisibilityLedger(file: file, owner: "env/other"))
    }
    func testMemberPurgeDoesNotHideMessagesAfterRejoiningAndHiddenIDsSurviveRestart() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let file = directory.appendingPathComponent("visibility.json"), user = "01234567-89ab-cdef-0123-456789abcdef"
        let ledger = try GroupVisibilityLedger(file: file, owner: "owner")
        let state = try await ledger.applyPurges([GroupMessagePurge(userId: user, purgedAt: "2026-01-01T00:00:00Z")], conversationID: "g")
        let threshold: Int64 = 1767225600000
        XCTAssertFalse(state.permits(ChatTextItem(id: "before", senderID: user.replacingOccurrences(of: "-", with: ""), text: "", timestamp: threshold, status: 2), conversationID: "g"))
        XCTAssertTrue(state.permits(ChatTextItem(id: "after", senderID: user, text: "", timestamp: threshold + 1, status: 2), conversationID: "g"))
        _ = try await ledger.hide(["pending-id"])
        let restored = try GroupVisibilityLedger(file: file, owner: "owner"); let snapshot = await restored.snapshot()
        XCTAssertFalse(snapshot.permits(ChatTextItem(id: "pending-id", senderID: user, text: "", timestamp: threshold + 100, status: 1), conversationID: "g"))
    }
}
final class MediaCacheIdentityTests: XCTestCase {
    func testTrustedSignatureRotationKeepsIdentityAndVariantsRemainDistinct() {
        let base = URL(string: "https://business.invalid/api/v1")!
        let policy = MediaURLPolicy(businessBaseURL: base, accountScope: "a")
        let url = "https://oss-chat-test.xn--jprz53bj9s.com/oss-test/chat/p.jpg?Signature=first&Expires=1&x-oss-process=small"
        XCTAssertEqual(policy.cacheIdentity(url), policy.cacheIdentity(url.replacingOccurrences(of: "first", with: "second")))
        XCTAssertNotEqual(policy.cacheIdentity(url), policy.cacheIdentity(url.replacingOccurrences(of: "small", with: "large")))
        XCTAssertNotEqual(policy.cacheIdentity(url), MediaURLPolicy(businessBaseURL: base, accountScope: "b").cacheIdentity(url))
        XCTAssertNotEqual(policy.cacheIdentity(url), MediaURLPolicy(businessBaseURL: URL(string: "https://test.invalid/api/v1")!, accountScope: "a").cacheIdentity(url))
    }
    func testUnknownSignaturesCapabilityTokensAndObjectVersionsRemainDistinct() {
        let policy = MediaURLPolicy(businessBaseURL: URL(string: "https://business.invalid/api/v1")!, accountScope: "a")
        for raw in ["https://unknown.invalid/p.jpg?Signature=first", "https://business.invalid/api/v1/public/oss-media?key=p.jpg&token=first"] {
            XCTAssertNotEqual(policy.cacheIdentity(raw), policy.cacheIdentity(raw.replacingOccurrences(of: "first", with: "second")))
        }
        XCTAssertEqual(policy.cacheIdentity("/object/p.jpg?width=360&v=1"), policy.cacheIdentity("/object/p.jpg?v=1&width=360"))
        XCTAssertNotEqual(policy.cacheIdentity("/object/p.jpg?width=360&width=960"), policy.cacheIdentity("/object/p.jpg?width=960&width=360"))
        XCTAssertNotEqual(policy.cacheIdentity("/object/p.jpg?v=1"), policy.cacheIdentity("/object/p.jpg?v=2"))
        XCTAssertNotEqual(policy.cacheIdentity("/object/a%2Fb.jpg"), policy.cacheIdentity("/object/a/b.jpg"))
    }
}
