import XCTest
@testable import IMCore

final class GroupJoinRequestParityTests: XCTestCase {
    private let first = "sg_" + String(repeating: "a", count: 32)
    private let second = "sg_" + String(repeating: "b", count: 32)

    private func snapshot(_ rows: [[String: Any]]) throws -> PendingJoinRequestSnapshot {
        let data = try JSONSerialization.data(withJSONObject: rows)
        return PendingJoinRequestSnapshot(rows: try JSONDecoder().decode([PendingGroupJoinCount].self, from: data))
    }

    func testServerRowsKeepConversationIDsAndLastDuplicateWins() throws {
        let value = try snapshot([
            ["groupId": "public-a", "groupConversationId": first, "count": 2],
            ["groupId": "public-b", "groupConversationId": second, "count": 3],
            ["groupId": "public-a", "groupConversationId": first, "count": 0]
        ])
        XCTAssertEqual(value.count, 3)
        XCTAssertEqual(value.conversationIDs, [second])
    }

    func testOldServerAndInvalidConversationKeepTotalWithoutFalseHighlights() throws {
        let value = try snapshot([
            ["groupId": "old", "count": 1],
            ["groupId": "bad", "groupConversationId": "qun_123456", "count": 2],
            ["groupId": "valid", "groupConversationId": first, "count": 200]
        ])
        XCTAssertEqual(value.count, 100)
        XCTAssertEqual(value.conversationIDs, [first])
    }

    func testNoticeAcceptsDictionaryJSONStringAndSDKFieldAliases() throws {
        for key in ["groupConversationId", "groupConversationID", "GroupConversationId", "GroupConversationID"] {
            let data = [key: first]
            let json = String(decoding: try JSONSerialization.data(withJSONObject: data), as: UTF8.self)
            XCTAssertEqual(GroupJoinRequestNotice(payload: ["key": "group_join_request", "data": data])?.conversationID, first)
            XCTAssertEqual(GroupJoinRequestNotice(payload: ["Key": "group_join_request", "Data": json])?.conversationID, first)
        }
    }

    func testNoticeRejectsUnrelatedMalformedOrMissingTargets() {
        for payload: [String: Any] in [
            ["key": "other", "data": ["groupConversationId": first]],
            ["key": "group_join_request", "data": "not json"],
            ["key": "group_join_request", "data": ["groupId": "public-a"]],
            ["key": "group_join_request", "data": ["groupConversationId": "si_" + String(repeating: "a", count: 32)]],
            ["key": "group_join_request", "data": ["groupConversationId": first + "/path"]],
            ["key": "group_join_request", "data": NSNull()]
        ] {
            XCTAssertNil(GroupJoinRequestNotice(payload: payload))
        }
    }
}
