import Foundation
import IMCore

/// A short-lived display cache for cold group opens. OpenIM remains the source of history and cursors.
@MainActor
final class NativeRecentHistory {
    static let warmLimit = 8
    static let messageLimit = 20
    private let lifetime: TimeInterval = 45

    private struct Cached {
        let seq: Int
        let expires: TimeInterval
        let messages: [ChatTextItem]
    }
    private var cache: [String: Cached] = [:]
    private var warm: Task<Void, Never>?
    private var current: Task<Void, Never>?
    private var currentID: String?
    private var warmedIDs = Set<String>()
    private var warmStarted = false

    func warmUp(_ conversations: [NativeConversation], context: NativeBusinessContext) {
        guard !warmStarted else { return }
        let candidates = Array(conversations.lazy.filter(Self.eligible).prefix(Self.warmLimit))
        guard !candidates.isEmpty else { return }
        warmStarted = true
        warmedIDs = Set(candidates.map(\.id))
        warm = Task(priority: .utility) { [weak self] in
            guard let self else { return }
            await load(candidates, context: context)
            guard !Task.isCancelled else { return }
            warmedIDs.removeAll(); warm = nil
            onUpdate?()
        }
    }

    var onUpdate: (() -> Void)?

    func open(_ conversation: NativeConversation, context: NativeBusinessContext) {
        guard Self.eligible(conversation), currentID != conversation.id else { return }
        current?.cancel()
        currentID = conversation.id
        guard cached(conversation) == nil else { return }
        current = Task { [weak self] in
            guard let self else { return }
            await load([conversation], context: context)
            if !Task.isCancelled { onUpdate?() }
        }
    }

    func close(_ id: String) {
        guard currentID == id else { return }
        current?.cancel(); current = nil; currentID = nil
    }

    func discard(_ id: String) {
        close(id)
        if warmedIDs.contains(id) {
            warm?.cancel(); warm = nil; warmedIDs.removeAll()
        }
        cache[id] = nil
    }

    func stop() {
        warm?.cancel(); current?.cancel()
        warm = nil; current = nil; currentID = nil
        warmedIDs.removeAll(); cache.removeAll(); warmStarted = false
    }

    func cached(_ conversation: NativeConversation) -> [ChatTextItem]? {
        guard let entry = cache[conversation.id], entry.seq == conversation.latestSeq,
              entry.expires > ProcessInfo.processInfo.systemUptime else { return nil }
        return entry.messages
    }

    private static func eligible(_ conversation: NativeConversation) -> Bool {
        conversation.canOpen && conversation.type == 3 && conversation.latestSeq > 0
    }

    private func load(_ conversations: [NativeConversation], context: NativeBusinessContext) async {
        let query = conversations.map {
            URLQueryItem(name: "item", value: "\($0.id):\($0.latestSeq)")
        }
        do {
            let reply: GroupHistoryPreviewReply = try await context.request("im/group-history-previews", query: query)
            try Task.checkCancellation()
            let now = ProcessInfo.processInfo.systemUptime
            let pages = reply.pages(for: Dictionary(uniqueKeysWithValues: conversations.map { ($0.id, $0.latestSeq) }),
                                   limit: Self.messageLimit)
            for (id, items) in pages {
                guard let candidate = conversations.first(where: { $0.id == id }), (cache[id]?.seq ?? 0) <= candidate.latestSeq else { continue }
                cache[id] = Cached(seq: candidate.latestSeq, expires: now + lifetime, messages: items)
            }
            cache = Dictionary(uniqueKeysWithValues: cache.filter { $0.value.expires > now }
                .sorted { $0.value.expires > $1.value.expires }.prefix(Self.warmLimit + 4).map { ($0.key, $0.value) })
        } catch {
            // Optional network preview. The independently running SDK history request handles recovery and the UI state.
        }
    }
}
