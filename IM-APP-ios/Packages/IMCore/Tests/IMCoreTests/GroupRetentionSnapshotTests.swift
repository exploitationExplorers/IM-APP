import Foundation
import XCTest
@testable import IMCore

final class GroupRetentionSnapshotTests: XCTestCase {
    private let group = "sg_77ac113a99c94ed381c08dd30e106592"
    private let other = "sg_0123456789abcdef0123456789abcdef"

    private func withLedger(_ test: (GroupVisibilityLedger, URL) async throws -> Void) async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let file = directory.appendingPathComponent("visibility.json")
        try await test(GroupVisibilityLedger(file: file, owner: "test-owner"), file)
    }

    func testEmptySnapshotRequiresIndependentPurgeConfirmationAndSurvivesRestart() async throws {
        try await withLedger { ledger, file in
            let checked = try await ledger.applyRetentionSnapshot([], requested: [group])
            XCTAssertFalse(checked.hasConfirmedBoundary(group))
            XCTAssertNil(checked.floors[group], "Do not fabricate a published watermark")
            let confirmed = try await ledger.applyPurges([], conversationID: group)
            XCTAssertTrue(confirmed.hasConfirmedBoundary(group))
            XCTAssertEqual(confirmed.confirmedBoundaryIDs, [group])
            XCTAssertFalse(confirmed.hasConfirmedBoundary(other))
            let restored = try GroupVisibilityLedger(file: file, owner: "test-owner")
            let snapshot = await restored.snapshot()
            XCTAssertEqual(snapshot, confirmed)
        }
    }

    func testGroupBadgeUsesRetentionWithoutOpeningHistory() async throws {
        try await withLedger { ledger, _ in
            let latest = ChatTextItem(id: "latest", senderID: "", text: "", timestamp: 1, status: 2, seq: 120)
            let unchecked = await ledger.snapshot()
            XCTAssertEqual(unchecked.groupUnreadCount(87, latest: latest, conversationID: group), 0)
            let checked = try await ledger.applyRetentionSnapshot([], requested: [group])
            XCTAssertFalse(checked.hasConfirmedBoundary(group))
            XCTAssertEqual(checked.groupUnreadCount(87, latest: latest, conversationID: group), 87)
            let limited = try await ledger.applyRetentionSnapshot([
                GroupRetentionState(conversationId: group, minVisibleSeq: 100, revision: 1)
            ], requested: [group])
            XCTAssertEqual(limited.groupUnreadCount(87, latest: latest, conversationID: group), 21)
            let hidden = try await ledger.hide([latest.id])
            XCTAssertEqual(hidden.groupUnreadCount(87, latest: latest, conversationID: group), 0)
        }
    }

    func testEmptySnapshotNeverResetsExistingFloorPurgesOrHiddenMessages() async throws {
        try await withLedger { ledger, _ in
            _ = try await ledger.apply([GroupRetentionState(conversationId: group, minVisibleSeq: 50, revision: 3)])
            let sender = "01234567-89ab-cdef-0123-456789abcdef"
            _ = try await ledger.applyPurges([GroupMessagePurge(userId: sender, purgedAt: "2026-01-01T00:00:00Z")], conversationID: group)
            _ = try await ledger.hide(["hidden"])
            let state = try await ledger.applyRetentionSnapshot([], requested: [group])
            XCTAssertEqual(state.floors[group]?.minVisibleSeq, 50)
            XCTAssertEqual(state.floors[group]?.revision, 3)
            XCTAssertEqual(state.purges[group]?[sender], 1767225600000)
            XCTAssertTrue(state.hiddenMessageIDs.contains("hidden"))
            XCTAssertFalse(state.permits(ChatTextItem(id: "old", senderID: "", text: "", timestamp: 0, status: 2, seq: 49), conversationID: group))
        }
    }

    func testInvalidResponseIsRejectedAtomically() async throws {
        try await withLedger { ledger, _ in
            _ = try await ledger.applyPurges([], conversationID: group)
            let before = await ledger.snapshot()
            let row = GroupRetentionState(conversationId: group, minVisibleSeq: 10, revision: 1)
            let invalid = [
                [row, row],
                [GroupRetentionState(conversationId: other, minVisibleSeq: 1, revision: 1)],
                [GroupRetentionState(conversationId: group, minVisibleSeq: -1, revision: 1)],
                [GroupRetentionState(conversationId: group, minVisibleSeq: 1, revision: -1)]
            ]
            for rows in invalid {
                do {
                    _ = try await ledger.applyRetentionSnapshot(rows, requested: [group])
                    XCTFail("Invalid snapshot must not confirm a boundary")
                } catch GroupRetentionSnapshotError.invalidResponse { }
                let after = await ledger.snapshot()
                XCTAssertEqual(after, before)
            }
        }
    }

    func testPartialBatchConfirmsOnlyRequestedGroupsWithoutWeakeningFloors() async throws {
        try await withLedger { ledger, _ in
            _ = try await ledger.applyPurges([], conversationID: group)
            _ = try await ledger.applyPurges([], conversationID: other)
            let result = try await ledger.applyRetentionSnapshot([
                GroupRetentionState(conversationId: group, minVisibleSeq: 50, revision: 3)
            ], requested: [group, other])
            XCTAssertEqual(result.confirmedBoundaryIDs, [group, other])
            XCTAssertNil(result.floors[other])
            let later = try await ledger.applyRetentionSnapshot([
                GroupRetentionState(conversationId: group, minVisibleSeq: 1, revision: 2)
            ], requested: [group])
            XCTAssertEqual(later.floors[group], result.floors[group])
        }
    }

    func testLegacyArchiveStillLoadsWithoutAssumingUnseenGroupsAreChecked() async throws {
        try await withLedger { _, file in
            let document: [String: Any] = ["owner": "test-owner", "visibility": [
                "floors": [group: ["conversationId": group, "minVisibleSeq": 10, "revision": 1]],
                "purges": [group: [:], other: [:]], "hiddenMessageIDs": []
            ]]
            try JSONSerialization.data(withJSONObject: document).write(to: file)
            let restored = try GroupVisibilityLedger(file: file, owner: "test-owner")
            let state = await restored.snapshot()
            XCTAssertTrue(state.hasConfirmedBoundary(group))
            XCTAssertFalse(state.hasConfirmedBoundary(other))
        }
    }

    func testFailedPersistenceDoesNotConfirmAnEmptySnapshot() async throws {
        try await withLedger { ledger, file in
            _ = try await ledger.applyPurges([], conversationID: group)
            let before = await ledger.snapshot()
            try FileManager.default.removeItem(at: file)
            try FileManager.default.createDirectory(at: file, withIntermediateDirectories: false)
            do {
                _ = try await ledger.applyRetentionSnapshot([], requested: [group])
                XCTFail("Disk failure must propagate")
            } catch { }
            let after = await ledger.snapshot()
            XCTAssertEqual(after, before)
        }
    }
}
