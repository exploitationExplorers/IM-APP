import Foundation
import XCTest
@testable import IMCore

final class GroupHistoryPreviewTests: XCTestCase {
    func testOlderServerPayloadCannotBecomePreview() throws {
        let payload = Data(#"{"items":[{"conversationId":"sg_a","messages":[{"clientMsgId":"m1","sendId":"u1","senderNickname":"Name","contentType":101,"sendTime":1000,"seq":9,"preview":"old payload"}]}]}"#.utf8)
        let reply = try JSONDecoder().decode(GroupHistoryPreviewReply.self, from: payload)
        XCTAssertTrue(reply.pages(for: ["sg_a": 9], limit: 20).isEmpty)
    }

    func testPreviewOnlyAdmitsRequestedRoomAndSequenceWindow() throws {
        let payload = Data(#"""
        {"previewOnly":true,"items":[
          {"conversationId":"sg_a","messages":[
            {"clientMsgId":"too-old","sendId":"u1","senderNickname":"Name","contentType":101,"sendTime":1000,"seq":80,"preview":"old"},
            {"clientMsgId":"valid","sendId":"u1","senderNickname":"Name","contentType":101,"sendTime":1100,"seq":81,"preview":"new"},
            {"clientMsgId":"valid","sendId":"u1","senderNickname":"Name","contentType":101,"sendTime":1100,"seq":81,"preview":"duplicate"},
            {"clientMsgId":"future","sendId":"u1","senderNickname":"Name","contentType":101,"sendTime":1200,"seq":101,"preview":"future"},
            {"clientMsgId":"image","sendId":"u1","senderNickname":"Name","contentType":102,"sendTime":1300,"seq":99,"preview":"image"}]},
          {"conversationId":"sg_wrong","messages":[
            {"clientMsgId":"other","sendId":"u1","senderNickname":"Name","contentType":101,"sendTime":1000,"seq":90,"preview":"other room"}]}
        ]}
        """#.utf8)
        let reply = try JSONDecoder().decode(GroupHistoryPreviewReply.self, from: payload)
        let pages = reply.pages(for: ["sg_a": 100], limit: 20)
        XCTAssertEqual(Set(pages.keys), ["sg_a"])
        XCTAssertEqual(pages["sg_a"]?.map(\.text), ["new"])
        XCTAssertEqual(pages["sg_a"]?.first?.serialized, "")
    }
}
