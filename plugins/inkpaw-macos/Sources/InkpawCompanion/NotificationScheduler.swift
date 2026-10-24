#if os(macOS)
import Foundation
import InkpawCore
import UserNotifications

enum NotificationSchedulerError: LocalizedError {
    case appBundleRequired

    var errorDescription: String? {
        "系统通知需要从打包后的 Inkpaw Companion.app 启动。请先运行 scripts/package-app.sh，再打开生成的应用。"
    }
}

struct NotificationSyncResult {
    let deliveredReminderIDs: Set<String>
    let pendingCount: Int
    let authorizationStatus: UNAuthorizationStatus
}

/// Injectable boundary keeps tests away from the user's actual notification center.
@MainActor
protocol InkpawNotificationCenter: AnyObject {
    func authorizationStatus() async -> UNAuthorizationStatus
    func requestAuthorization() async throws -> Bool
    func pendingRequests() async -> [UNNotificationRequest]
    func deliveredRequestIDs() async -> [String]
    func add(_ request: UNNotificationRequest) async throws
    func removePending(identifiers: [String])
}

@MainActor
private final class SystemNotificationCenter: InkpawNotificationCenter {
    private let center: UNUserNotificationCenter
    init(_ center: UNUserNotificationCenter) { self.center = center }

    func authorizationStatus() async -> UNAuthorizationStatus {
        await center.notificationSettings().authorizationStatus
    }

    func requestAuthorization() async throws -> Bool {
        try await center.requestAuthorization(options: [.alert, .sound])
    }

    func pendingRequests() async -> [UNNotificationRequest] { await center.pendingNotificationRequests() }
    func deliveredRequestIDs() async -> [String] { await center.deliveredNotifications().map(\.request.identifier) }
    func add(_ request: UNNotificationRequest) async throws { try await center.add(request) }
    func removePending(identifiers: [String]) { center.removePendingNotificationRequests(withIdentifiers: identifiers) }
}

/// Safe placeholder for swift run and test executables without an application bundle.
/// UNUserNotificationCenter.current() can assert in those processes, even before a prompt.
@MainActor
private final class UnavailableNotificationCenter: InkpawNotificationCenter {
    func authorizationStatus() async -> UNAuthorizationStatus { .notDetermined }
    func requestAuthorization() async throws -> Bool { throw NotificationSchedulerError.appBundleRequired }
    func pendingRequests() async -> [UNNotificationRequest] { [] }
    func deliveredRequestIDs() async -> [String] { [] }
    func add(_ request: UNNotificationRequest) async throws { throw NotificationSchedulerError.appBundleRequired }
    func removePending(identifiers: [String]) { }
}

/// Permission is requested only by the explicit enable-reminders UI action.
/// Reconciliation is idempotent, namespace-scoped, and serialized across actor suspension.
@MainActor
final class NotificationScheduler: NSObject, UNUserNotificationCenterDelegate {
    nonisolated static let identifierPrefix = "inkpaw.reminder."
    private static let fireAtKey = "inkpaw.fireAt"
    private static let maximumPending = 64
    private let center: any InkpawNotificationCenter
    private let unavailableReason: NotificationSchedulerError?
    private var mutationTail: Task<Void, Never>?
    private(set) var generation: UInt64 = 0
    private var recentlyDeliveredIDs = Set<String>()

    /// Persist this ID when a reminder is observed while the app is in the foreground.
    /// reconcile also returns all delivered IDs observed in Notification Center.
    var onDeliveredReminder: ((String) -> Void)?

    override init() {
        // A SwiftPM executable is not an app bundle. Do not call the native center
        // until an actual .app with a bundle identifier is the launched process.
        if Bundle.main.bundleURL.pathExtension == "app", let identifier = Bundle.main.bundleIdentifier, !identifier.isEmpty {
            let nativeCenter = UNUserNotificationCenter.current()
            center = SystemNotificationCenter(nativeCenter)
            unavailableReason = nil
            super.init()
            nativeCenter.delegate = self
        } else {
            center = UnavailableNotificationCenter()
            unavailableReason = .appBundleRequired
            super.init()
        }
    }

    init(center: any InkpawNotificationCenter) {
        self.center = center
        unavailableReason = nil
        super.init()
    }

    func requestAuthorization() async throws -> Bool {
        try await center.requestAuthorization()
    }

    func authorizationStatus() async -> UNAuthorizationStatus {
        await center.authorizationStatus()
    }

    func reconcile(
        plans: [ReminderPlan],
        enabled: Bool,
        deliveredReminderIDs: Set<String>,
        now: Date = .now
    ) async throws -> NotificationSyncResult {
        if enabled, let unavailableReason { throw unavailableReason }
        generation &+= 1
        let requestedGeneration = generation
        let previous = mutationTail
        let work = Task { @MainActor [self] in
            // An older native add can finish after cancellation. Wait for its outcome,
            // then read pending requests afresh, so it cannot resurrect an old plan.
            await previous?.value
            try checkCurrent(requestedGeneration)
            return try await synchronize(
                plans: plans, enabled: enabled, deliveredReminderIDs: deliveredReminderIDs,
                now: now, requestedGeneration: requestedGeneration
            )
        }
        mutationTail = Task { _ = await work.result }
        return try await withTaskCancellationHandler {
            try await work.value
        } onCancel: {
            work.cancel()
        }
    }

    func cancelPending() async {
        generation &+= 1
        let requestedGeneration = generation
        let previous = mutationTail
        let work = Task { @MainActor [self] in
            await previous?.value
            guard generation == requestedGeneration else { return }
            let requests = await center.pendingRequests()
            guard generation == requestedGeneration else { return }
            let identifiers = requests.map(\.identifier).filter { $0.hasPrefix(Self.identifierPrefix) }
            if !identifiers.isEmpty { center.removePending(identifiers: identifiers) }
        }
        mutationTail = work
        await work.value
    }

    private func synchronize(
        plans: [ReminderPlan], enabled: Bool, deliveredReminderIDs: Set<String>,
        now: Date, requestedGeneration: UInt64
    ) async throws -> NotificationSyncResult {
        let status = await center.authorizationStatus()
        try checkCurrent(requestedGeneration)
        let nativeDeliveredIDs = await center.deliveredRequestIDs()
        try checkCurrent(requestedGeneration)
        var delivered = deliveredReminderIDs.union(recentlyDeliveredIDs)
        delivered.formUnion(nativeDeliveredIDs.compactMap(Self.reminderID(from:)))
        let pending = await center.pendingRequests()
        try checkCurrent(requestedGeneration)
        let owned = pending.filter { $0.identifier.hasPrefix(Self.identifierPrefix) }
        guard enabled && (status == .authorized || status == .provisional) else {
            if !owned.isEmpty {
                try checkCurrent(requestedGeneration)
                center.removePending(identifiers: owned.map(\.identifier))
            }
            return NotificationSyncResult(deliveredReminderIDs: delivered, pendingCount: 0, authorizationStatus: status)
        }

        // Keep the earliest reminders and leave room for unrelated requests. Never
        // schedule overdue items again after relaunch, even if their banner was dismissed.
        let capacity = max(0, Self.maximumPending - (pending.count - owned.count))
        let candidates = plans.flatMap(\.reminders).filter {
            !$0.id.isEmpty && $0.fireAt.timeIntervalSince1970.isFinite && $0.fireAt > now && !delivered.contains($0.id)
        }.sorted { lhs, rhs in
            lhs.fireAt == rhs.fireAt ? lhs.id < rhs.id : lhs.fireAt < rhs.fireAt
        }
        var seen = Set<String>()
        let desired = Array(candidates.filter { seen.insert($0.id).inserted }.prefix(capacity))
        let desiredIDs = Set(desired.map { Self.identifierPrefix + $0.id })
        let obsolete = owned.map(\.identifier).filter { !desiredIDs.contains($0) }
        if !obsolete.isEmpty {
            try checkCurrent(requestedGeneration)
            center.removePending(identifiers: obsolete)
        }
        let existing = Dictionary(owned.map { ($0.identifier, $0) }, uniquingKeysWith: { first, _ in first })
        for reminder in desired {
            try checkCurrent(requestedGeneration)
            let identifier = Self.identifierPrefix + reminder.id
            if let request = existing[identifier], matches(request, reminder: reminder) { continue }
            let content = UNMutableNotificationContent()
            content.title = reminder.title
            content.body = reminder.body
            content.sound = .default
            content.threadIdentifier = "inkpaw.schedule." + reminder.scheduleID
            content.userInfo = [Self.fireAtKey: reminder.fireAt.timeIntervalSince1970, "inkpaw.scheduleID": reminder.scheduleID]
            // UTC components pin the absolute instant when the user's display time zone
            // changes. Round upward so a fractional future second cannot become overdue.
            var calendar = Calendar(identifier: .gregorian)
            calendar.timeZone = TimeZone(secondsFromGMT: 0)!
            let rounded = Date(timeIntervalSince1970: ceil(reminder.fireAt.timeIntervalSince1970))
            var components = calendar.dateComponents([.year, .month, .day, .hour, .minute, .second], from: rounded)
            components.calendar = calendar
            components.timeZone = calendar.timeZone
            let trigger = UNCalendarNotificationTrigger(dateMatching: components, repeats: false)
            try await center.add(UNNotificationRequest(identifier: identifier, content: content, trigger: trigger))
            try checkCurrent(requestedGeneration)
        }
        return NotificationSyncResult(deliveredReminderIDs: delivered, pendingCount: desired.count, authorizationStatus: status)
    }

    private func checkCurrent(_ requestedGeneration: UInt64) throws {
        try Task.checkCancellation()
        guard generation == requestedGeneration else { throw CancellationError() }
    }

    private func matches(_ request: UNNotificationRequest, reminder: PlannedReminder) -> Bool {
        request.content.title == reminder.title && request.content.body == reminder.body &&
        request.content.threadIdentifier == "inkpaw.schedule." + reminder.scheduleID &&
        (request.content.userInfo[Self.fireAtKey] as? Double) == reminder.fireAt.timeIntervalSince1970
    }

    private nonisolated static func reminderID(from identifier: String) -> String? {
        guard identifier.hasPrefix(identifierPrefix) else { return nil }
        let id = String(identifier.dropFirst(identifierPrefix.count))
        return id.isEmpty ? nil : id
    }

    private func recordDelivered(_ id: String) {
        guard recentlyDeliveredIDs.insert(id).inserted else { return }
        onDeliveredReminder?(id)
    }

    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        guard let id = Self.reminderID(from: notification.request.identifier) else {
            completionHandler([])
            return
        }
        Task { @MainActor [weak self] in self?.recordDelivered(id) }
        completionHandler([.banner, .sound])
    }

    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        if let id = Self.reminderID(from: response.notification.request.identifier) {
            Task { @MainActor [weak self] in self?.recordDelivered(id) }
        }
        completionHandler()
    }
}
#endif
