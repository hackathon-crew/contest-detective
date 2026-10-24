import Foundation
import XCTest
import InkpawCore
@testable import InkpawInfrastructure

final class CoreBehaviorTests: XCTestCase {
    private let start = Date(timeIntervalSince1970: 1_800_000_000)
    private let calculator = TimelineCalculator()
    private let planner = ReminderPlanner()

    func testTimelineBoundariesAndClampingAreTimeOnly() throws {
        let schedule = schedule()
        let cases: [(TimeInterval, TimelinePhase, Double, TimelineTarget?, TimeInterval?)] = [
            (-1_000, .upcoming, 0, .start, 1_000),
            (0, .active, 0, .end, 100),
            (25, .active, 0.25, .end, 75),
            (100, .completed, 1, nil, nil),
            (1_000, .completed, 1, nil, nil),
        ]
        for (offset, phase, fraction, target, remaining) in cases {
            let result = try calculator.snapshot(for: schedule, at: start.addingTimeInterval(offset))
            XCTAssertEqual(result.phase, phase)
            XCTAssertEqual(result.progressFraction, fraction)
            XCTAssertEqual(result.countdown?.target, target)
            XCTAssertEqual(result.countdown?.remainingSeconds, remaining)
            XCTAssertTrue(result.issues.isEmpty)
        }
    }

    func testMissingSourceDataNeverUsesDeviceDefaults() throws {
        let unknown = ScheduleInstant(date: nil, precision: .unknown, timeZoneIdentifier: nil, sourceURL: nil)
        let result = try calculator.snapshot(for: schedule(startInstant: unknown), at: start)
        XCTAssertEqual(result.phase, .unknown)
        XCTAssertNil(result.progressFraction)
        XCTAssertNil(result.countdown)
        XCTAssertEqual(result.issues.map(\.reason), [.missingDate, .insufficientPrecision, .missingTimeZone])
    }

    func testDayPrecisionCannotCreateCountdownOrReminder() throws {
        let day = instant(start, precision: .day)
        let schedule = schedule(startInstant: day, endInstant: instant(start.addingTimeInterval(100), precision: .day))
        let result = try calculator.snapshot(for: schedule, at: start)
        XCTAssertEqual(result.phase, .unknown)
        XCTAssertNil(result.countdown)
        let plan = try planner.plan(for: schedule, preferences: enabled([0]), at: start.addingTimeInterval(-10))
        XCTAssertTrue(plan.reminders.isEmpty)
        XCTAssertEqual(plan.issues, [.insufficientPrecision])
    }

    func testInvalidAndMissingZonesAreDistinctWarnings() throws {
        for zone in ["Mars/Olympus", "GMT+08:00", "PST "] {
            let result = try calculator.snapshot(for: schedule(startInstant: instant(start, zone: zone)), at: start)
            XCTAssertEqual(result.phase, .unknown)
            XCTAssertTrue(result.issues.contains { $0.reason == .invalidTimeZone })
        }
        let result = try calculator.snapshot(for: schedule(startInstant: instant(start, zone: nil)), at: start)
        XCTAssertTrue(result.issues.contains { $0.reason == .missingTimeZone })
    }

    func testEqualAndReversedIntervalsAreUnknownAndNotNotified() throws {
        for endOffset: TimeInterval in [0, -100] {
            let value = schedule(endInstant: instant(start.addingTimeInterval(endOffset)))
            let snapshot = try calculator.snapshot(for: value, at: start)
            XCTAssertEqual(snapshot.phase, .unknown)
            XCTAssertNil(snapshot.progressFraction)
            XCTAssertEqual(snapshot.issues.last?.reason, .invalidInterval)
            let plan = try planner.plan(for: value, preferences: enabled([0]), at: start.addingTimeInterval(-1_000))
            XCTAssertTrue(plan.reminders.isEmpty)
            XCTAssertEqual(plan.issues, [.invalidInterval])
        }
    }

    func testMilestonePrecisionAndCountdownAreIndependent() throws {
        let milestones = [
            CompetitionMilestone(id: "past", title: "Past", instant: instant(start.addingTimeInterval(-1))),
            CompetitionMilestone(id: "next", title: "Next", instant: instant(start.addingTimeInterval(50))),
            CompetitionMilestone(id: "unclear", title: "Unclear", instant: instant(start, precision: .day)),
        ]
        let result = try calculator.snapshot(for: schedule(milestones: milestones), at: start)
        XCTAssertEqual(result.countdown?.target, .end)
        XCTAssertEqual(result.milestones[0].remainingSeconds, 0)
        XCTAssertEqual(result.milestones[0].isReached, true)
        XCTAssertEqual(result.milestones[1].remainingSeconds, 50)
        XCTAssertEqual(result.milestones[1].isReached, false)
        XCTAssertNil(result.milestones[2].remainingSeconds)
        XCTAssertNil(result.milestones[2].isReached)
        XCTAssertEqual(result.milestones[2].issues, [.insufficientPrecision])
    }

    func testNonfiniteDatesAreUnknown() throws {
        let result = try calculator.snapshot(for: schedule(startInstant: instant(Date(timeIntervalSince1970: .infinity))), at: start)
        XCTAssertEqual(result.phase, .unknown)
        XCTAssertTrue(result.issues.contains { $0.reason == .invalidDate })
        let now = try calculator.snapshot(for: schedule(), at: Date(timeIntervalSince1970: .nan))
        XCTAssertEqual(now.phase, .unknown)
        XCTAssertNil(now.countdown)
    }

    func testDSTAndDifferentSourceZonesUseAbsoluteTime() throws {
        // New York spring-forward: 01:30 EST to 03:30 EDT is one elapsed hour.
        let formatter = ISO8601DateFormatter()
        let start = formatter.date(from: "2026-03-08T06:30:00Z")!
        let end = formatter.date(from: "2026-03-08T07:30:00Z")!
        let value = schedule(startInstant: instant(start, zone: "America/New_York"), endInstant: instant(end, zone: "America/New_York"))
        let result = try calculator.snapshot(for: value, at: start.addingTimeInterval(1_800))
        XCTAssertEqual(result.progressFraction, 0.5)
        XCTAssertEqual(result.countdown?.remainingSeconds, 1_800)
    }

    func testReminderDisabledIsAnEmptyPlanWithoutSideEffects() throws {
        let plan = try planner.plan(for: schedule(), preferences: .init(isEnabled: false, leadTimes: [0]), at: start)
        XCTAssertTrue(plan.reminders.isEmpty)
        XCTAssertTrue(plan.issues.isEmpty)
    }

    func testReminderPlansStartEndAndMilestonesAtAbsoluteFireTimes() throws {
        let value = schedule(milestones: [.init(id: "submission", title: "Submission", instant: instant(start.addingTimeInterval(50)))])
        let plan = try planner.plan(for: value, preferences: enabled([0, 10]), at: start.addingTimeInterval(-20))
        XCTAssertEqual(plan.reminders.count, 6)
        XCTAssertEqual(plan.reminders.map(\.fireAt), [-10.0, 0, 40, 50, 90, 100].map { start.addingTimeInterval($0) })
        XCTAssertEqual(plan.reminders.first?.target, .start)
        XCTAssertEqual(plan.reminders.last?.target, .end)
    }

    func testReminderIDsAreStableDeduplicatedAndDeadlineSensitive() throws {
        let first = try planner.plan(for: schedule(), preferences: enabled([10, 10, 0, -0]), at: start.addingTimeInterval(-100))
        let second = try planner.plan(for: schedule(), preferences: enabled([0, 10]), at: start.addingTimeInterval(-99))
        XCTAssertEqual(first.reminders.map(\.id), second.reminders.map(\.id))
        XCTAssertEqual(Set(first.reminders.map(\.id)).count, 4)
        let changed = try planner.plan(for: schedule(endInstant: instant(start.addingTimeInterval(101))), preferences: enabled([0, 10]), at: start.addingTimeInterval(-100))
        let oldEnd = Set(first.reminders.filter { $0.target == .end }.map(\.id))
        let newEnd = Set(changed.reminders.filter { $0.target == .end }.map(\.id))
        XCTAssertTrue(oldEnd.isDisjoint(with: newEnd))
    }

    func testReminderPastAndDueNowAreNotRescheduled() throws {
        let plan = try planner.plan(for: schedule(), preferences: enabled([0, 10, 100]), at: start)
        XCTAssertEqual(plan.reminders.map(\.fireAt), [start.addingTimeInterval(90), start.addingTimeInterval(100)])
        XCTAssertTrue(plan.reminders.allSatisfy { $0.fireAt > start })
    }

    func testReminderInvalidLeadTimesAreBoundedAndReported() throws {
        let leads: [Double] = [-1, .infinity, .nan, ReminderPlanner.maximumLeadTime + 1] + Array(0..<30).map(Double.init)
        let plan = try planner.plan(for: schedule(), preferences: enabled(leads), at: start.addingTimeInterval(-100))
        XCTAssertEqual(plan.issues, [.invalidLeadTime])
        XCTAssertEqual(plan.reminders.count, 2 * ReminderPlanner.maximumLeadTimeCount)
    }

    func testReminderKeepsUncertainValuesUnknownButAllowsKnownMilestone() throws {
        let unclear = ScheduleInstant(date: nil, precision: .unknown, timeZoneIdentifier: nil, sourceURL: nil)
        let value = schedule(startInstant: unclear, endInstant: unclear, milestones: [.init(id: "known", title: "Known", instant: instant(start))])
        let plan = try planner.plan(for: value, preferences: enabled([0]), at: start.addingTimeInterval(-1))
        XCTAssertEqual(plan.reminders.count, 1)
        XCTAssertEqual(plan.reminders[0].target, .milestone(id: "known"))
        XCTAssertEqual(plan.issues, [.missingDate, .insufficientPrecision, .missingTimeZone])
    }

    private func instant(_ date: Date, precision: SchedulePrecision = .exact, zone: String? = "Etc/UTC") -> ScheduleInstant {
        .init(date: date, precision: precision, timeZoneIdentifier: zone, sourceURL: nil)
    }
    private func enabled(_ leads: [TimeInterval]) -> ReminderPreferences { .init(isEnabled: true, leadTimes: leads) }
    private func schedule(startInstant: ScheduleInstant? = nil, endInstant: ScheduleInstant? = nil, milestones: [CompetitionMilestone] = []) -> CompetitionSchedule {
        .init(id: "synthetic", title: "Synthetic competition", start: startInstant ?? instant(start), end: endInstant ?? instant(start.addingTimeInterval(100)), milestones: milestones)
    }
}
