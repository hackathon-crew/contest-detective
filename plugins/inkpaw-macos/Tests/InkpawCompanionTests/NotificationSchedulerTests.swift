import XCTest
#if os(macOS)
import Foundation
import InkpawCore
import UserNotifications
@testable import InkpawCompanion

@MainActor
final class NotificationSchedulerTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_800_000_000)

    func testUnbundledExecutableDoesNotTouchSystemNotificationCenter() async throws {
        guard Bundle.main.bundleURL.pathExtension != "app" else {
            throw XCTSkip("This safety path specifically covers unbundled SwiftPM processes.")
        }
        let scheduler = NotificationScheduler()
        do {
            _ = try await scheduler.requestAuthorization()
            XCTFail("Unbundled executables must report a packaging error instead of requesting permission")
        } catch NotificationSchedulerError.appBundleRequired { }
        do {
            _ = try await scheduler.reconcile(plans: [], enabled: true, deliveredReminderIDs: [], now: now)
            XCTFail("Unbundled scheduling must report a packaging error")
        } catch NotificationSchedulerError.appBundleRequired { }
    }

    func testInitializationAndReconciliationNeverRequestPermission() async throws {
        let center = FakeNotificationCenter()
        center.status = .notDetermined
        let scheduler = NotificationScheduler(center: center)
        let result = try await scheduler.reconcile(plans: [plan([reminder("a")])], enabled: true, deliveredReminderIDs: [], now: now)
        XCTAssertEqual(center.authorizationRequests, 0)
        XCTAssertEqual(center.addCount, 0)
        XCTAssertEqual(result.authorizationStatus, .notDetermined)
        let granted = try await scheduler.requestAuthorization()
        XCTAssertTrue(granted)
        XCTAssertEqual(center.authorizationRequests, 1)
    }

    func testRepeatPlanIsIdempotentAndEditedDateReplacesSameIdentifier() async throws {
        let center = FakeNotificationCenter()
        let scheduler = NotificationScheduler(center: center)
        for _ in 0..<2 {
            _ = try await scheduler.reconcile(plans: [plan([reminder("a")])], enabled: true, deliveredReminderIDs: [], now: now)
        }
        XCTAssertEqual(center.addCount, 1)
        _ = try await scheduler.reconcile(plans: [plan([reminder("a", offset: 120)])], enabled: true, deliveredReminderIDs: [], now: now)
        XCTAssertEqual(center.addCount, 2)
        XCTAssertEqual(center.requests.count, 1)
        let request = try XCTUnwrap(center.requests[NotificationScheduler.identifierPrefix + "a"])
        let trigger = try XCTUnwrap(request.trigger as? UNCalendarNotificationTrigger)
        XCTAssertEqual(trigger.dateComponents.timeZone?.secondsFromGMT(), 0)
        XCTAssertEqual(trigger.dateComponents.date, now.addingTimeInterval(120))
    }

    func testPersistentAndNativeDeliveredIDsAndOverdueItemsAreNotRescheduled() async throws {
        let center = FakeNotificationCenter()
        center.delivered = [NotificationScheduler.identifierPrefix + "native", "another.feature"]
        let scheduler = NotificationScheduler(center: center)
        let result = try await scheduler.reconcile(
            plans: [plan([reminder("saved"), reminder("native"), reminder("past", offset: -1), reminder("fresh")])],
            enabled: true, deliveredReminderIDs: ["saved"], now: now
        )
        XCTAssertEqual(result.deliveredReminderIDs, ["saved", "native"])
        XCTAssertEqual(result.pendingCount, 1)
        XCTAssertEqual(Set(center.requests.keys), [NotificationScheduler.identifierPrefix + "fresh"])
    }

    func testDisableAndDeniedPermissionRemoveOnlyInkpawPendingRequests() async throws {
        for status in [UNAuthorizationStatus.authorized, .denied] {
            let center = FakeNotificationCenter()
            center.status = status
            center.requests["other.feature"] = request("other.feature")
            center.requests[NotificationScheduler.identifierPrefix + "old"] = request(NotificationScheduler.identifierPrefix + "old")
            let scheduler = NotificationScheduler(center: center)
            let result = try await scheduler.reconcile(plans: [plan([reminder("a")])], enabled: status == .denied, deliveredReminderIDs: [], now: now)
            XCTAssertEqual(Set(center.requests.keys), ["other.feature"])
            XCTAssertEqual(result.pendingCount, 0)
            XCTAssertEqual(center.authorizationRequests, 0)
        }
    }

    func testExplicitCancelIsNamespaceScoped() async throws {
        let center = FakeNotificationCenter()
        center.requests["other.feature"] = request("other.feature")
        center.requests[NotificationScheduler.identifierPrefix + "old"] = request(NotificationScheduler.identifierPrefix + "old")
        let scheduler = NotificationScheduler(center: center)
        await scheduler.cancelPending()
        XCTAssertEqual(Set(center.requests.keys), ["other.feature"])
    }

    func testPendingLimitKeepsEarliestAndReservesOtherRequests() async throws {
        let center = FakeNotificationCenter()
        center.requests["other.1"] = request("other.1")
        center.requests["other.2"] = request("other.2")
        let scheduler = NotificationScheduler(center: center)
        let reminders = (0..<80).reversed().map { reminder("item-\($0)", offset: Double($0 + 1) * 60) }
        let result = try await scheduler.reconcile(plans: [plan(reminders + [reminders[0]])], enabled: true, deliveredReminderIDs: [], now: now)
        XCTAssertEqual(result.pendingCount, 62)
        XCTAssertEqual(center.requests.count, 64)
        XCTAssertNotNil(center.requests[NotificationScheduler.identifierPrefix + "item-0"])
        XCTAssertNotNil(center.requests[NotificationScheduler.identifierPrefix + "item-61"])
        XCTAssertNil(center.requests[NotificationScheduler.identifierPrefix + "item-62"])
    }

    func testNewerPlanWaitsForStaleInFlightNativeAddThenRemovesIt() async throws {
        let center = FakeNotificationCenter()
        center.pauseNextAdd = true
        let addStarted = expectation(description: "old native add started")
        center.onAdd = { addStarted.fulfill() }
        let scheduler = NotificationScheduler(center: center)
        let oldPlan = plan([reminder("old")])
        let newPlan = plan([reminder("new")])
        let oldWork = Task { try await scheduler.reconcile(plans: [oldPlan], enabled: true, deliveredReminderIDs: [], now: now) }
        await fulfillment(of: [addStarted], timeout: 2)
        center.onAdd = nil
        let newWork = Task { try await scheduler.reconcile(plans: [newPlan], enabled: true, deliveredReminderIDs: [], now: now) }
        // Observe the actual generation, not an assumed number of executor yields.
        await waitForGeneration(2, scheduler: scheduler)
        center.resumeAdd()
        _ = try await newWork.value
        do {
            _ = try await oldWork.value
            XCTFail("Superseded reconciliation must report cancellation")
        } catch is CancellationError { }
        XCTAssertEqual(Set(center.requests.keys), [NotificationScheduler.identifierPrefix + "new"])
    }

    func testDisableWaitsForInFlightAddBeforeRemovingOwnedRequests() async throws {
        let center = FakeNotificationCenter()
        center.pauseNextAdd = true
        center.requests["other.feature"] = request("other.feature")
        let addStarted = expectation(description: "native add started before disable")
        center.onAdd = { addStarted.fulfill() }
        let scheduler = NotificationScheduler(center: center)
        let work = Task { try await scheduler.reconcile(plans: [plan([reminder("old")])], enabled: true, deliveredReminderIDs: [], now: now) }
        await fulfillment(of: [addStarted], timeout: 2)
        let disable = Task { await scheduler.cancelPending() }
        await waitForGeneration(2, scheduler: scheduler)
        center.resumeAdd()
        await disable.value
        _ = await work.result
        XCTAssertEqual(Set(center.requests.keys), ["other.feature"])
    }

    func testCancellationBeforeMutationDoesNotSchedule() async throws {
        let center = FakeNotificationCenter()
        let scheduler = NotificationScheduler(center: center)
        let work = Task { try await scheduler.reconcile(plans: [plan([reminder("a")])], enabled: true, deliveredReminderIDs: [], now: now) }
        work.cancel()
        do {
            _ = try await work.value
            XCTFail("Canceled reconciliation must throw")
        } catch is CancellationError { }
        XCTAssertEqual(center.addCount, 0)
    }

    private func waitForGeneration(_ generation: UInt64, scheduler: NotificationScheduler) async {
        let deadline = Date.now.addingTimeInterval(2)
        while scheduler.generation < generation && Date.now < deadline { await Task.yield() }
        XCTAssertEqual(scheduler.generation, generation)
    }

    private func reminder(_ id: String, offset: TimeInterval = 60) -> PlannedReminder {
        let date = now.addingTimeInterval(offset)
        return PlannedReminder(id: id, scheduleID: "schedule", target: .end, title: "Deadline", body: "Prepare submission", fireAt: date, sourceInstant: ScheduleInstant(date: date, precision: .exact, timeZoneIdentifier: "Etc/UTC", sourceURL: nil))
    }

    private func plan(_ reminders: [PlannedReminder]) -> ReminderPlan {
        ReminderPlan(scheduleID: "schedule", plannedAt: now, reminders: reminders, issues: [])
    }

    private func request(_ id: String) -> UNNotificationRequest {
        UNNotificationRequest(identifier: id, content: UNMutableNotificationContent(), trigger: nil)
    }
}

@MainActor
private final class FakeNotificationCenter: InkpawNotificationCenter {
    var status = UNAuthorizationStatus.authorized
    var authorizationRequests = 0
    var requests: [String: UNNotificationRequest] = [:]
    var delivered: [String] = []
    var addCount = 0
    var pauseNextAdd = false
    var onAdd: (() -> Void)?
    private var addContinuation: CheckedContinuation<Void, Never>?

    func authorizationStatus() async -> UNAuthorizationStatus { status }
    func requestAuthorization() async throws -> Bool { authorizationRequests += 1; return true }
    func pendingRequests() async -> [UNNotificationRequest] { Array(requests.values) }
    func deliveredRequestIDs() async -> [String] { delivered }
    func removePending(identifiers: [String]) { identifiers.forEach { requests.removeValue(forKey: $0) } }
    func add(_ request: UNNotificationRequest) async throws {
        addCount += 1
        if pauseNextAdd {
            pauseNextAdd = false
            await withCheckedContinuation { continuation in
                addContinuation = continuation
                onAdd?()
            }
        } else {
            onAdd?()
        }
        requests[request.identifier] = request
    }
    func resumeAdd() { addContinuation?.resume(); addContinuation = nil }
}
#endif
