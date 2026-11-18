import UIKit
import IMCore

/// 仅可见页面且 App 活跃时对账，不在后台维持轮询。
@MainActor
final class NativePendingJoinRequests {
    let monitor: PendingJoinRequestMonitor
    private weak var service: NativeIMService?
    private var serviceObserver: UUID?
    private var lastRevision: UUID?
    private var enabled = false
    private var notifications: [NSObjectProtocol] = []

    init(service: NativeIMService, groupID: String? = nil) {
        self.service = service
        let context = service.business
        let interval: UInt64 = groupID == nil ? 10_000_000_000 : 5_000_000_000
        monitor = PendingJoinRequestMonitor(loadSnapshot: {
            if let groupID = groupID {
                let requests: [NativeJoinRequest] = try await context.request("groups/\(groupID)/join-requests")
                return PendingJoinRequestSnapshot(count: requests.filter { $0.status == "pending" }.count)
            }
            let rows: [PendingGroupJoinCount] = try await context.request("groups/pending-join-requests")
            return PendingJoinRequestSnapshot(rows: rows)
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
        if serviceObserver == nil, let service = service {
            lastRevision = service.groupJoinRequestsRevision
            serviceObserver = service.observe { [weak self] in self?.serviceDidChange() }
        }
        resumeIfVisible()
    }

    func stop() {
        enabled = false
        if let observer = serviceObserver { service?.removeObserver(observer) }
        serviceObserver = nil
        monitor.stop()
        monitor.onChange = nil
    }

    private func serviceDidChange() {
        guard let service = service, service.isActive else { stop(); return }
        guard lastRevision != service.groupJoinRequestsRevision else { return }
        lastRevision = service.groupJoinRequestsRevision
        if enabled, UIApplication.shared.applicationState == .active { monitor.refresh() }
    }

    private func resumeIfVisible() {
        if enabled, service?.isActive == true, UIApplication.shared.applicationState == .active { monitor.start() }
    }
}
