import Foundation
import XCTest
@testable import IMCore

final class RecentChatMediaTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_800_000_000)
    private let base = URL(string: "https://business.example.test")!

    private func item(_ media: ChatMedia, daysAgo: Int = 0, status: Int = 2, inMilliseconds: Bool = true) -> ChatTextItem {
        let seconds = Int64(now.timeIntervalSince1970) - Int64(daysAgo) * 86_400
        return ChatTextItem(id: media.url, senderID: "peer", text: "", timestamp: inMilliseconds ? seconds * 1000 : seconds,
                            status: status, contentType: media.kind, media: media)
    }

    func testUsesMessageLifetimeAndSkipsIneligibleMessages() {
        let media = ChatMedia(kind: 102, url: "https://cdn.example.test/image.jpg")
        let older = item(media, daysAgo: 8, inMilliseconds: false)
        let items = [older, item(media, status: 4), item(media, status: 1)]
        let policy = MediaURLPolicy(businessBaseURL: base, accountScope: "user-a")
        XCTAssertTrue(RecentChatMediaResource.prefetch(items, policy: policy, scope: .group, now: now).isEmpty)
        let direct = RecentChatMediaResource.prefetch(items, policy: policy, scope: .direct, now: now)
        XCTAssertEqual(direct.map(\.resource.url.absoluteString), [media.url])
        XCTAssertEqual(direct.first?.expiresAt, now.addingTimeInterval(6 * 86_400))
    }

    func testLimitsDownloadSizeAndStillSchedulesVideoCover() {
        let cover = "https://cdn.example.test/cover.jpg"
        let voice = "https://cdn.example.test/voice.m4a"
        let document = "https://cdn.example.test/document.pdf"
        let mega: Int64 = 1_024 * 1_024
        let items = [
            item(ChatMedia(kind: 103, url: voice)),
            item(ChatMedia(kind: 104, url: "https://cdn.example.test/large.mp4", thumbnail: cover, byteCount: 20 * mega + 1)),
            item(ChatMedia(kind: 105, url: "https://cdn.example.test/unknown.pdf")),
            item(ChatMedia(kind: 105, url: document, byteCount: 5 * mega))
        ]
        let jobs = RecentChatMediaResource.prefetch(items, policy: MediaURLPolicy(businessBaseURL: base), scope: .direct, now: now)
        XCTAssertEqual(jobs.map(\.resource.url.absoluteString), [document, cover, voice])
        XCTAssertEqual(jobs.map(\.resource.limit), [5 * mega, 16 * mega, 32 * mega])
    }

    func testThirdPartyObjectRouteRetainsOpaqueQuery() {
        let raw = "https://cdn.example.test/object/voice.m4a?type=audio&format=source&auth=a%2Bb"
        let policy = MediaURLPolicy(businessBaseURL: base)
        XCTAssertEqual(RecentChatMediaResource.attachment(ChatMedia(kind: 103, url: raw), policy: policy)?.url.absoluteString, raw)
    }

    func testPreservesUnknownSignedURLAndIsolatesAccounts() {
        let url = "https://cdn.example.test/clip.mp4?Signature=a%2Bb&Expires=19"
        let video = ChatMedia(kind: 104, url: url, byteCount: 512)
        let a = MediaURLPolicy(businessBaseURL: base, accountScope: "user-a")
        let b = MediaURLPolicy(businessBaseURL: base, accountScope: "user-b")
        let jobs = RecentChatMediaResource.prefetch([item(video), item(video)], policy: a, scope: .direct, now: now)
        XCTAssertEqual(jobs.map(\.resource.url.absoluteString), [url])
        XCTAssertEqual(jobs.first?.resource, RecentChatMediaResource.attachment(video, policy: a))
        XCTAssertNotEqual(jobs.first?.resource.identity, RecentChatMediaResource.attachment(video, policy: b)?.identity)
    }
}
