import XCTest
@testable import IMCore

final class MessageContentTests: XCTestCase {
    func testForwardPictureCompletesEveryRequiredTypeWithoutLosingPreview() throws {
        let raw = #"{"ContentType":102,"PictureElem":{"SourcePicture":{"URL":"https://media.example/original.png","Type":"image/png","UUID":"source","Width":1200,"Height":800},"BigPicture":{"Url":"https://media.example/big.webp","Type":"image/webp","Width":960},"SnapshotPicture":{"URL":"https://media.example/thumb.jpg","Type":" ","Width":360,"Height":240}}}"#
        let result = try ForwardMessageSnapshot.make(serialized: raw)
        guard case .object(let body) = result.content, case .object(let source)? = body["sourcePicture"], case .object(let big)? = body["bigPicture"], case .object(let thumb)? = body["snapshotPicture"] else { return XCTFail("缺少三种图片规格") }
        XCTAssertEqual(source["type"], .string("image/png")); XCTAssertEqual(source["uuid"], .string("source"))
        XCTAssertEqual(big["type"], .string("image/webp")); XCTAssertEqual(big["url"], .string("https://media.example/big.webp"))
        XCTAssertEqual(thumb["type"], .string("image/png")); XCTAssertEqual(thumb["url"], .string("https://media.example/thumb.jpg")); XCTAssertEqual(thumb["width"], .number(360))
    }
    func testForwardLegacySinglePictureFillsMissingSpecsAndDefaultMIME() throws {
        let result = try ForwardMessageSnapshot.make(serialized: #"{"contentType":102,"pictureElem":{"bigPicture":{"url":"https://media.example/a.jpg","width":900,"height":600}}}"#)
        guard case .object(let body) = result.content else { return XCTFail("缺少图片") }
        for key in ["sourcePicture", "bigPicture", "snapshotPicture"] {
            guard case .object(let picture)? = body[key] else { return XCTFail("未补齐 \(key)") }
            XCTAssertEqual(picture["type"], .string("image/jpeg")); XCTAssertEqual(picture["url"], .string("https://media.example/a.jpg")); XCTAssertEqual(picture["width"], .number(900))
        }
    }
    func testForwardNestedQuoteAlsoCompletesPictureTypes() throws {
        let result = try ForwardMessageSnapshot.make(serialized: #"{"contentType":114,"quoteElem":{"text":"回复","quoteMessage":{"contentType":102,"pictureElem":{"sourcePicture":{"url":"https://media.example/a.gif","type":"image/gif"}}}}}"#)
        guard case .object(let body) = result.content, case .object(let quote)? = body["quoteMessage"], case .object(let picture)? = quote["pictureElem"], case .object(let thumbnail)? = picture["snapshotPicture"] else { return XCTFail("引用图片未规范化") }
        XCTAssertEqual(thumbnail["type"], .string("image/gif"))
    }
    func testVideoPortraitCoverFitsWithoutCroppingOrStretching() {
        let value = VideoMessageMetadata(serialized: #"{"ContentType":104,"VideoElem":{"SnapshotWidth":1080,"SnapshotHeight":1920,"Duration":61,"SnapshotURL":"/object/poster.jpg","SnapshotPath":"/private/poster.jpg"}}"#)
        XCTAssertTrue(value.hasDimensions); XCTAssertEqual(value.durationLabel, "1:01"); XCTAssertEqual(value.thumbnail, "/object/poster.jpg"); XCTAssertEqual(value.localThumbnail, "/private/poster.jpg")
        let size = value.fitted(maxWidth: 280, maxHeight: 360)
        XCTAssertEqual(size.height, 360, accuracy: 0.001); XCTAssertEqual(size.width, 202.5, accuracy: 0.001)
        XCTAssertEqual(size.width / size.height, 1080.0 / 1920, accuracy: 0.001)
    }
    func testVideoEmptyElementFallsBackToEncodedLegacyContentAndVideoDimensions() throws {
        let element: [String: Any] = ["videoWidth":1920, "videoHeight":1080, "duration":"9", "snapshotUrl":"https://media.example/poster.jpg"]
        let root: [String: Any] = ["contentType":104, "videoElem":[:], "content":String(decoding: try JSONSerialization.data(withJSONObject: element), as: UTF8.self)]
        let value = VideoMessageMetadata(serialized: String(decoding: try JSONSerialization.data(withJSONObject: root), as: UTF8.self))
        XCTAssertTrue(value.hasDimensions); XCTAssertEqual(value.durationLabel, "0:09")
        let size = value.fitted(maxWidth: 280, maxHeight: 360)
        XCTAssertEqual(size.width, 280); XCTAssertEqual(size.height, 157.5, accuracy: 0.001)
    }
    func testVideoUnknownOrPartialDimensionsUseStableFallback() {
        let value = VideoMessageMetadata(serialized: #"{"videoElem":{"snapshotWidth":100,"duration":-5}}"#, duration: 7)
        XCTAssertFalse(value.hasDimensions); XCTAssertEqual(value.durationLabel, "0:07")
        XCTAssertEqual(value.fitted(maxWidth: 280, maxHeight: 360).height, 210)
        XCTAssertEqual(value.fitted(maxWidth: .infinity, maxHeight: 360).width, 0)
    }
    func testVideoPreparationRejectsInvalidDurationBeforeSDKIntegerConversion() throws {
        XCTAssertEqual(try VideoMessageMetadata.preparedDuration(seconds: 0.1), 1)
        XCTAssertEqual(try VideoMessageMetadata.preparedDuration(seconds: 60.6), 61)
        for value in [Double.nan, .infinity, -.infinity, 0, -1, Double(Int.max)] { XCTAssertThrowsError(try VideoMessageMetadata.preparedDuration(seconds: value)) }
    }
    func testMenuDoesNotOfferUnimplementedForwardOrActionsForRecalledSystemMessages() {
        XCTAssertFalse(MessageMenuCapabilities(contentType: 119, status: 2).forward)
        for (kind, status) in [(1501, 2), (102, 4), (101, 4)] {
            let value = MessageMenuCapabilities(contentType: kind, status: status)
            XCTAssertFalse(value.quote); XCTAssertFalse(value.favorite); XCTAssertFalse(value.pin); XCTAssertFalse(value.multiSelect)
            XCTAssertFalse(value.canRecall(isMine: true, canManageSender: true))
        }
    }
    func testOwnMessagesCanBeRecalledInMultiSelectionWithoutManagerRole() {
        let sent = MessageMenuCapabilities(contentType: 104, status: 2)
        XCTAssertTrue(sent.canRecall(isMine: true, canManageSender: false))
        XCTAssertFalse(sent.canRecall(isMine: false, canManageSender: false))
        XCTAssertTrue(sent.canRecall(isMine: false, canManageSender: true))
        for status in [0, 1, 3, 4] { XCTAssertFalse(MessageMenuCapabilities(contentType: 104, status: status).canRecall(isMine: true, canManageSender: true)) }
    }
    func testLegacyFavoriteSnapshotsAndRawImageURL() {
        XCTAssertEqual(FavoriteContent(type: "image", content: "https://media.example/a.png?token=A%2BB").url, "https://media.example/a.png?token=A%2BB")
        let voice = FavoriteContent(type: "voice", content: #"{"path":"/object/voice.m4a","duration":8}"#)
        XCTAssertEqual(voice.url, "/object/voice.m4a"); XCTAssertEqual(voice.duration, 8)
        let video = FavoriteContent(type: "video", content: #"{"url":"https://media.example/v.mp4","snapshotUrl":"https://media.example/v.jpg","duration":12}"#)
        XCTAssertEqual(video.thumbnail, "https://media.example/v.jpg"); XCTAssertEqual(video.duration, 12)
        XCTAssertEqual(FavoriteContent(type: "file", content: #"{"path":"/object/test.pdf","name":"测试.pdf"}"#).filename, "测试.pdf")
    }
    func testNewFavoriteSnapshotRemainsReadableByOldClient() throws {
        let media = ChatMedia(kind: 103, url: "/object/voice.m4a", filename: "语音.m4a", duration: 6)
        let value = try FavoriteContent.snapshot(type: "voice", media: media, text: "[语音]")
        let decoded = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(value.utf8)) as? [String: Any])
        XCTAssertEqual(decoded["path"] as? String, "/object/voice.m4a")
        XCTAssertEqual(decoded["duration"] as? Int, 6)
    }
    func testQRURLExtractsDataWithoutChangingTokenEncoding() {
        let qr = QRBusinessPayload("https://chat.example/?qrcodetype=g&qrcode=A%2BB%2FC%3D")
        XCTAssertEqual(qr.kind, "group"); XCTAssertEqual(qr.token, "A+B/C=")
        XCTAssertEqual(qr.requestBody["qrcode"], .string(qr.raw))
    }
    func testQRJSONPublicIDAndUnknownURLDoNotBecomeNavigation() {
        let qr = QRBusinessPayload(#"{"type":"user","publicId":"abc123"}"#)
        XCTAssertEqual(qr.publicID, "abc123"); XCTAssertNil(qr.token)
        let unknown = QRBusinessPayload("https://example.invalid/arbitrary")
        XCTAssertNil(unknown.kind); XCTAssertNil(unknown.token)
        XCTAssertEqual(QRBusinessPayload(" raw-token ").token, "raw-token")
    }
    func testPascalCaseForwardMediaStripsOnlyLocalPaths() throws {
        let result = try ForwardMessageSnapshot.make(serialized: #"{"ContentType":104,"VideoElem":{"VideoPath":"/private/local.mp4","SnapshotPath":"/private/local.jpg","VideoUrl":"https://media.example/v.mp4?token=A%2BB","SnapshotUrl":"/object/v.jpg","Duration":9}}"#)
        XCTAssertEqual(result.contentType, 104)
        guard case .object(let content) = result.content else { return XCTFail("缺少视频内容") }
        XCTAssertEqual(content["videoPath"], .string("")); XCTAssertEqual(content["snapshotPath"], .string(""))
        XCTAssertEqual(content["videoUrl"], .string("https://media.example/v.mp4?token=A%2BB"))
        XCTAssertEqual(content["duration"], .number(9))
    }
    func testForwardQuoteUsesOldClientReadableEmbeddedJSONString() throws {
        let result = try ForwardMessageSnapshot.make(serialized: #"{"contentType":114,"quoteElem":{"text":"回复","quoteMessage":{"contentType":101,"textElem":{"content":"原文"}}}}"#)
        guard case .object(let quote) = result.content, let value = quote["quoteMessage"], case .object(let embedded) = value, let body = embedded["content"], case .string(let serialized) = body else { return XCTFail("引用应为旧端可解析的字符串内容") }
        let content = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(serialized.utf8)) as? [String: Any])
        XCTAssertEqual(content["content"] as? String, "原文")
    }
    func testUnuploadedAndSystemMessagesCannotCreateForwardTasks() {
        XCTAssertThrowsError(try ForwardMessageSnapshot.make(serialized: #"{"contentType":102,"pictureElem":{"sourcePath":"/local/a.png","sourcePicture":{"url":""}}}"#))
        XCTAssertThrowsError(try ForwardMessageSnapshot.make(serialized: #"{"contentType":103,"soundElem":{"sourceUrl":"file:///local/a.m4a"}}"#))
        XCTAssertThrowsError(try ForwardMessageSnapshot.make(serialized: #"{"contentType":1501,"notificationElem":{"detail":"system"}}"#))
    }
    func testDeepQuoteCannotRecurseWithoutBound() throws {
        var current: [String: Any] = ["contentType": 101, "textElem": ["content": "原文"]]
        for _ in 0..<8 { current = ["contentType": 114, "quoteElem": ["text": "回复", "quoteMessage": current]] }
        let serialized = String(decoding: try JSONSerialization.data(withJSONObject: current), as: UTF8.self)
        XCTAssertThrowsError(try ForwardMessageSnapshot.make(serialized: serialized))
    }
    func testPascalCustomInvitationPreservesOpaqueTokenAndGroupIdentity() throws {
        let payload: [String: Any] = ["BusinessKey": "group_invite", "Token": "opaque+/token", "GroupID": "42", "GroupName": "测试群", "MemberCount": 12]
        let root: [String: Any] = ["ContentType": 110, "CustomElem": ["Data": String(decoding: try JSONSerialization.data(withJSONObject: payload), as: UTF8.self)]]
        let card = try XCTUnwrap(BusinessMessageCard(serialized: String(decoding: try JSONSerialization.data(withJSONObject: root), as: UTF8.self)))
        XCTAssertEqual(card.kind, .invitation); XCTAssertEqual(card.groupID, "42"); XCTAssertEqual(card.token, "opaque+/token"); XCTAssertEqual(card.memberCount, 12)
    }
    func testJoinRequestCustomCardRequiresRealRequestAndSafeGroupID() throws {
        let root = #"{"contentType":110,"customElem":{"data":{"businessKey":"group_join_request","requestId":"r1","groupId":"42","applicantNickname":"张三"}}}"#
        let card = try XCTUnwrap(BusinessMessageCard(serialized: root)); XCTAssertEqual(card.kind, .joinRequest); XCTAssertEqual(card.requestID, "r1")
        XCTAssertNil(BusinessMessageCard(serialized: root.replacingOccurrences(of: "\"r1\"", with: "\"\"")))
        XCTAssertNil(BusinessMessageCard(serialized: root.replacingOccurrences(of: "\"42\"", with: "\"42/leave\"")))
        XCTAssertNil(BusinessMessageCard(serialized: root.replacingOccurrences(of: "group_join_request", with: "arbitrary_action")))
    }
    func testQuoteReferenceSupportsPascalEmbeddedMessageAndOriginalImageURL() throws {
        let quoted: [String: Any] = ["ClientMsgID": "message-1", "SenderNickname": "张三", "ContentType": 102, "PictureElem": ["SourcePicture": ["URL": "https://unknown.invalid/a.jpg?X-Amz-Signature=keep%2Bthis"]]]
        let root: [String: Any] = ["ContentType": 114, "QuoteElem": ["QuoteMessage": String(decoding: try JSONSerialization.data(withJSONObject: quoted), as: UTF8.self)]]
        let quote = try XCTUnwrap(MessageQuoteReference(serialized: String(decoding: try JSONSerialization.data(withJSONObject: root), as: UTF8.self)))
        XCTAssertEqual(quote.id, "message-1"); XCTAssertEqual(quote.sender, "张三"); XCTAssertEqual(quote.summary, "[图片]"); XCTAssertEqual(quote.image, "https://unknown.invalid/a.jpg?X-Amz-Signature=keep%2Bthis")
    }
    func testQuoteReferenceUsesTextAndRejectsMissingIdentity() throws {
        let raw = #"{"contentType":106,"atTextElem":{"quoteMessage":{"clientMsgID":"m1","contentType":101,"content":"{\"content\":\"原文\"}"}}}"#
        XCTAssertEqual(try XCTUnwrap(MessageQuoteReference(serialized: raw)).summary, "原文")
        XCTAssertNil(MessageQuoteReference(serialized: raw.replacingOccurrences(of: "\"m1\"", with: "\"\"")))
    }
    func testLegacyImageWithOnlyBigPictureCanForwardWithoutLocalPath() throws {
        let raw = #"{"ContentType":102,"PictureElem":{"SourcePath":"/sender/private/a.png","SourcePicture":{"URL":""},"BigPicture":{"URL":"https://media.example/a.png?token=A%2BB","Width":1200,"Height":800}}}"#
        let snapshot = try ForwardMessageSnapshot.make(serialized: raw)
        guard case .object(let body) = snapshot.content, let sourceValue = body["sourcePicture"], case .object(let source) = sourceValue else { return XCTFail("必须规范化远程原图") }
        XCTAssertEqual(source["url"], .string("https://media.example/a.png?token=A%2BB"))
        XCTAssertEqual(source["width"], .number(1200)); XCTAssertEqual(body["sourcePath"], .string(""))
        XCTAssertThrowsError(try ForwardMessageSnapshot.make(serialized: raw.replacingOccurrences(of: "https://media.example/a.png?token=A%2BB", with: "file:///sender/a.png")))
    }
    func testMessageMenuUsesMediaTypeAndNeverForwardsUnconfirmedOrRevokedMessage() {
        let image = MessageMenuCapabilities(contentType: 102, status: 2)
        XCTAssertTrue(image.saveImage); XCTAssertTrue(image.addSticker); XCTAssertTrue(image.forward); XCTAssertFalse(image.copyText); XCTAssertFalse(image.saveVideo)
        let text = MessageMenuCapabilities(contentType: 101, status: 2)
        XCTAssertTrue(text.copyText); XCTAssertFalse(text.addSticker); XCTAssertFalse(text.saveImage)
        XCTAssertTrue(MessageMenuCapabilities(contentType: 104, status: 2).saveVideo)
        for status in [0, 1, 3, 4] { XCTAssertFalse(MessageMenuCapabilities(contentType: 102, status: status).forward) }
        XCTAssertFalse(MessageMenuCapabilities(contentType: 102, status: 4).saveImage)
        XCTAssertFalse(MessageMenuCapabilities(contentType: 1501, status: 2).forward)
    }

    func testForwardReadsEncodedContentWhenSDKElementIsEmptyAndUpgradesOnlyKnownLegacyOrigin() throws {
        let raw = #"{"contentType":102,"pictureElem":{},"content":"{\"sourcePicture\":{\"url\":\"http://8.154.44.197/object/old.png\"}}"}"#
        let policy = MediaURLPolicy(businessBaseURL: try XCTUnwrap(URL(string: "https://chat.example/api/v1/")))
        let snapshot = try ForwardMessageSnapshot.make(serialized: raw, mediaPolicy: policy)
        guard case .object(let body) = snapshot.content, let value = body["sourcePicture"], case .object(let picture) = value else { return XCTFail("未读取旧 JSON 内容") }
        XCTAssertEqual(picture["url"], .string("https://chat.example/object/old.png"))
        XCTAssertThrowsError(try ForwardMessageSnapshot.make(serialized: raw.replacingOccurrences(of: "8.154.44.197", with: "unknown.example"), mediaPolicy: policy))
    }

}
