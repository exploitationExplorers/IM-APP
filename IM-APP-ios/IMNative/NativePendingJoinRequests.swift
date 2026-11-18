import UIKit
import IMCore

/// 仅可见页面且 App 活跃时对账，不在后台维持轮询。
@MainActor
final class NativePendingJoinRequests {
    let monitor: PendingJoinRequestMonitor
    private var enabled = false
    private var notifications: [NSObjectProtocol] = []

    init(context: NativeBusinessContext, groupID: String? = nil) {
        let interval: UInt64 = groupID == nil ? 10_000_000_000 : 5_000_000_000
        monitor = PendingJoinRequestMonitor(load: {
            if let groupID = groupID {
                let requests: [NativeJoinRequest] = try await context.request("groups/\(groupID)/join-requests")
                return requests.filter { $0.status == "pending" }.count
            }
            let rows: [PendingGroupJoinCount] = try await context.request("groups/pending-join-requests")
            return PendingGroupJoinCount.badgeTotal(rows)
        }, pause: { try await Task.sleep(nanoseconds: interval) })
        let center = NotificationCenter.default
        notifications.append(center.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor [weak self] in self?.resumeIfVisible() }
        })
        notifications.append(center.addObserver(forName: UIApplication.willResignActiveNotification, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor [weak self] in self?.monitor.stop() }
        })
    }

    deinit {
        for observer in notifications { NotificationCenter.default.removeObserver(observer) }
    }

    func start(onChange: @escaping () -> Void) {
        enabled = true
        monitor.onChange = onChange
        resumeIfVisible()
    }

    func stop() {
        enabled = false
        monitor.stop()
        monitor.onChange = nil
    }

    private func resumeIfVisible() {
        if enabled, UIApplication.shared.applicationState == .active { monitor.start() }
    }
}
