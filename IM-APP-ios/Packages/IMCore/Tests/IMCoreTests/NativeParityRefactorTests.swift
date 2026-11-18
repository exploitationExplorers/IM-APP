import Foundation
import XCTest
@testable import IMCore

final class NativeParityRefactorTests: XCTestCase {
    private let reply = #"{"clientMsgID":"reply-1","contentType":114,"sendID":"owner","seq":0,"quoteElem":{"text":"回复","quoteMessage":{"clientMsgID":"original","senderNickname":"朋友","contentType":102,"pictureElem":{"sourcePicture":{"url":"https://media.example/source?token=keep","width":10,"height":10},"snapshotPicture":{"url":"https://media.example/thumb?token=keep"}}}}}"#

    func testQuotePrefersRemoteThumbnailAndPreservesSignedQuery() throws {
        let quote = try XCTUnwrap(MessageQuoteReference(serialized: reply))
        XCTAssertEqual(quote.image, "https://media.example/thumb?token=keep")
        XCTAssertEqual(quote.id, "original")
        XCTAssertEqual(quote.summary, "[图片]")
        XCTAssertEqual(quote.replyText, "回复")
    }

    func testQuoteReadsLegacyEncodedContentAndSkipsSenderLocalPaths() throws {
        let picture: [String: Any] = ["PictureElem": ["SourcePicture": ["URL": "file:///private/sender.jpg"], "BigPicture": ["Url": "/object/remote.jpg?sig=keep"]]]
        let embedded = String(decoding: try JSONSerialization.data(withJSONObject: picture), as: UTF8.self)
        let quote: [String: Any] = ["ClientMsgID": "q", "ContentType": 102, "PictureElem": [:], "Content": embedded]
        let root: [String: Any] = ["ContentType": 106, "AtTextElem": [:], "Content": ["AtTextElem": ["Text": "@好友 回复", "QuoteMessage": quote]]]
        let parsed = try XCTUnwrap(MessageQuoteReference(serialized: encode(root)))
        XCTAssertEqual(parsed.image, "/object/remote.jpg?sig=keep")
        XCTAssertEqual(parsed.replyText, "@好友 回复")
    }

    func testQuoteVideoSupportsPascalCaseStoredElementWithoutUsingLocalCover() throws {
        let root: [String: Any] = ["ContentType": 114, "QuoteElem": ["Text": "视频回复", "QuoteMessage": ["ClientMsgID": "v", "ContentType": 104, "VideoElem": [:], "Content": ["VideoElem": ["SnapshotUrl": "/api/media/poster?sig=keep", "SnapshotPath": "/private/local.jpg"]]]]]
        let quote = try XCTUnwrap(MessageQuoteReference(serialized: encode(root)))
        XCTAssertEqual(quote.image, "/api/media/poster?sig=keep")
        XCTAssertEqual(quote.summary, "[视频]")
        let local = #"{"contentType":114,"quoteElem":{"text":"r","quoteMessage":{"clientMsgID":"v","contentType":104,"videoElem":{"snapshotUrl":"file:///private/a.jpg","snapshotPath":"/private/a.jpg"}}}}"#
        XCTAssertEqual(MessageQuoteReference(serialized: local)?.image, "")
    }

    func testProtectedQuoteKeepsEnvelopeAndRejectsChangedReplyOrSourceIdentity() throws {
        let original = try ForwardMessageSnapshot.make(serialized: reply)
        let updated = try original.applying(to: reply)
        let root = try XCTUnwrap(MessagePayload.object(updated))
        XCTAssertEqual(root["clientMsgID"] as? String, "reply-1")
        XCTAssertEqual(root["sendID"] as? String, "owner")
        XCTAssertEqual(MessageQuoteReference(serialized: updated)?.replyText, "回复")
        let changed = ForwardMessageSnapshot(contentType: 114, content: .object([
            "text": .string("篡改回复"), "quoteMessage": .object(["clientMsgID": .string("other"), "contentType": .number(101), "textElem": .object(["content": .string("x")])])
        ]))
        XCTAssertThrowsError(try changed.applying(to: reply))
        XCTAssertThrowsError(try ForwardMessageSnapshot(contentType: 102, content: original.content).applying(to: reply))
    }

    func testProtectedQuoteDisplaysArchivedCoverAndRetainsReplyID() throws {
        let snapshot = try ForwardMessageSnapshot.make(serialized: reply)
        guard case .object(var body) = snapshot.content,
              case .object(var quoted)? = body["quoteMessage"],
              case .object(var picture)? = quoted["pictureElem"] else { return XCTFail("引用快照无效") }
        picture["snapshotPicture"] = .object(["url": .string("https://media.example/archived-cover?cap=keep"), "type": .string("image/jpeg")])
        quoted["pictureElem"] = .object(picture)
        body["quoteMessage"] = .object(quoted)
        let protected = ForwardMessageSnapshot(contentType: 114, content: .object(body))
        let result = try protected.applying(to: reply)
        XCTAssertEqual(MessagePayload.object(result)?["clientMsgID"] as? String, "reply-1")
        XCTAssertEqual(MessageQuoteReference(serialized: result)?.image, "https://media.example/archived-cover?cap=keep")
        XCTAssertEqual(MessageQuoteReference(serialized: result)?.id, "original")
    }

    func testQuotePreparationPropagatesProtectionFailureAndSkipsPlainText() async throws {
        enum Failure: Error { case unavailable }
        let policy = MediaURLPolicy(businessBaseURL: URL(string: "https://chat.example/api/v1")!, accountScope: "owner")
        do {
            _ = try await QuoteMessagePreparation.prepare(serialized: reply, mediaPolicy: policy) { _ in throw Failure.unavailable }
            XCTFail("保护失败不能当作已准备")
        } catch Failure.unavailable { }
        let text = #"{"contentType":101,"textElem":{"content":"hello"}}"#
        let unchanged = try await QuoteMessagePreparation.prepare(serialized: text, mediaPolicy: policy) { _ in
            XCTFail("普通文字不应请求媒体保护")
            throw Failure.unavailable
        }
        XCTAssertEqual(unchanged, text)
    }

    func testOutboxPayloadRepairIsDurableAndCannotResetSubmittedState() async throws {
        let folder = try temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: folder) }
        let file = folder.appendingPathComponent("outbox.json")
        let store = try PersistentOutbox(fileURL: file, ownerKey: "owner")
        let entry = OutboxEntry(clientMsgID: "reply-1", conversationID: "chat", targetID: "peer", sessionType: 1,
                                text: "回复", serializedMessage: reply, createdAt: 1)
        try await store.prepare(entry)
        let protected = try ForwardMessageSnapshot.make(serialized: reply).applying(to: reply)
        let repaired = try await store.replaceUnsubmittedPayload(entry.clientMsgID, serialized: protected)
        XCTAssertEqual(repaired.state, .prepared)
        XCTAssertEqual(repaired.clientMsgID, entry.clientMsgID)
        try await store.transition(entry.clientMsgID, to: .sending)
        do {
            _ = try await store.replaceUnsubmittedPayload(entry.clientMsgID, serialized: protected)
            XCTFail("sending 不得修复后回退成 prepared")
        } catch OutboxError.invalidEntry { }
        let restored = try PersistentOutbox(fileURL: file, ownerKey: "owner")
        let rows = await restored.snapshot()
        XCTAssertEqual(rows.first?.serializedMessage, protected)
        XCTAssertEqual(rows.first?.state, .uncertain)
    }

    func testMemberPermissionsAndHomeBadgeMatchBusinessSemantics() {
        XCTAssertFalse(GroupMemberRole.admin.canModerate(target: .admin, isSelf: false))
        XCTAssertTrue(GroupMemberRole.owner.canModerate(target: .admin, isSelf: false))
        XCTAssertTrue(GroupMemberRole.admin.canModerate(target: .member, isSelf: false))
        XCTAssertFalse(GroupMemberRole.owner.canModerate(target: .owner, isSelf: false))
        XCTAssertFalse(GroupMemberRole.owner.canModerate(target: .member, isSelf: true))
        XCTAssertFalse(GroupMemberRole.owner.canModerate(target: .unknown, isSelf: false))
        XCTAssertEqual(GroupMemberRole(serverValue: "60"), .admin)
        let muted = HomeChatBadge(unmutedUnread: 0, mutedUnread: 4, pendingJoinRequests: 0)
        XCTAssertTrue(muted.mutedOnly)
        let requests = HomeChatBadge(unmutedUnread: 0, mutedUnread: 4, pendingJoinRequests: 3)
        XCTAssertFalse(requests.mutedOnly)
        XCTAssertEqual(requests.count, 3)
        XCTAssertEqual(HomeChatBadge(unmutedUnread: Int.max, mutedUnread: 0, pendingJoinRequests: Int.max).count, 100)
    }

    func testPendingRequestCountsRejectInvalidResponseAndDeduplicateGroups() throws {
        let rows = try JSONDecoder().decode([PendingGroupJoinCount].self, from: Data(#"[{"groupId":"g","count":4},{"groupId":"g","count":2},{"groupId":"h","count":3}]"#.utf8))
        XCTAssertEqual(PendingGroupJoinCount.badgeTotal(rows), 5)
        XCTAssertThrowsError(try JSONDecoder().decode([PendingGroupJoinCount].self, from: Data(#"[{"groupId":"g","count":-1}]"#.utf8)))
    }

    func testMediaStoreRejectsOtherAccountsAndEscapingSymlinks() async throws {
        let folder = try temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: folder) }
        let first = AccountMediaStore(accountDirectory: folder.appendingPathComponent("a"))
        let second = AccountMediaStore(accountDirectory: folder.appendingPathComponent("b"))
        let data = Data("media".utf8)
        let file = try first.create(data: data, fileExtension: "../JpG")
        XCTAssertEqual(file.pathExtension, "jpg")
        XCTAssertNotNil(first.ownedURL(file.path))
        XCTAssertNil(second.ownedURL(file.path))
        let other = try second.create(data: data, fileExtension: "png")
        let link = file.deletingLastPathComponent().appendingPathComponent("outside.jpg")
        try FileManager.default.createSymbolicLink(at: link, withDestinationURL: other)
        XCTAssertNil(first.ownedURL(link.path))
        XCTAssertNil(first.ownedURL(file.deletingLastPathComponent().path))
        let imported = try await first.importInBackground(other)
        XCTAssertEqual(try Data(contentsOf: imported), data)
        XCTAssertNotNil(first.ownedURL(imported.path))
    }

    func testLateSendCompletionCannotUnlockNewDraftSubmission() throws {
        var gate = ComposerSubmissionGate()
        let first = try XCTUnwrap(gate.begin())
        XCTAssertNil(gate.begin())
        XCTAssertTrue(gate.finish(first))
        let second = try XCTUnwrap(gate.begin())
        XCTAssertFalse(gate.finish(first))
        XCTAssertTrue(gate.isSubmitting)
        XCTAssertNil(gate.begin())
        XCTAssertTrue(gate.finish(second))
        XCTAssertFalse(gate.isSubmitting)
    }

    private func encode(_ object: [String: Any]) throws -> String {
        String(decoding: try JSONSerialization.data(withJSONObject: object), as: UTF8.self)
    }

    private func temporaryDirectory() throws -> URL {
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        return folder
    }
}
