import Foundation
import InkpawCore

/// Produces absolute fire dates only. Permissions and delivery belong to the app layer.
public struct ReminderPlanner: ReminderPlanning {
    public static let maximumLeadTime: TimeInterval = 366 * 24 * 60 * 60
    public static let maximumLeadTimeCount = 16
    public init() {}

    public func plan(
        for schedule: CompetitionSchedule,
        preferences: ReminderPreferences,
        at date: Date
    ) throws -> ReminderPlan {
        guard preferences.isEnabled else {
            return ReminderPlan(scheduleID: schedule.id, plannedAt: date, reminders: [], issues: [])
        }
        var issues: [ReminderPlanningIssue] = []
        func appendIssue(_ issue: ReminderPlanningIssue) {
            if !issues.contains(issue) { issues.append(issue) }
        }
        guard date.timeIntervalSince1970.isFinite else {
            return ReminderPlan(scheduleID: schedule.id, plannedAt: date, reminders: [], issues: [.invalidDate])
        }
        var leadTimes: [TimeInterval] = []
        for lead in preferences.leadTimes {
            guard lead.isFinite, lead >= 0, lead <= Self.maximumLeadTime else {
                appendIssue(.invalidLeadTime)
                continue
            }
            if !leadTimes.contains(lead) { leadTimes.append(lead == 0 ? 0 : lead) }
        }
        leadTimes.sort()
        if leadTimes.count > Self.maximumLeadTimeCount {
            appendIssue(.invalidLeadTime)
            leadTimes = Array(leadTimes.prefix(Self.maximumLeadTimeCount))
        }
        let endpointsValid = InstantValidation.issues(for: schedule.start).isEmpty
            && InstantValidation.issues(for: schedule.end).isEmpty
        let invalidInterval = endpointsValid && schedule.end.date! <= schedule.start.date!
        if invalidInterval { appendIssue(.invalidInterval) }
        var targets: [(TimelineTarget, String, ScheduleInstant)] = []
        // Contradictory bounds are not turned into actionable competition reminders.
        if !invalidInterval {
            targets = [(.start, "Starts: \(schedule.title)", schedule.start),
                       (.end, "Deadline: \(schedule.title)", schedule.end)]
        }
        targets += schedule.milestones.map { (.milestone(id: $0.id), $0.title, $0.instant) }
        var reminders: [PlannedReminder] = []
        var identifiers = Set<String>()
        for (target, title, instant) in targets {
            let reasons = InstantValidation.issues(for: instant)
            for reason in reasons {
                if let issue = ReminderPlanningIssue(rawValue: reason.rawValue) { appendIssue(issue) }
            }
            guard reasons.isEmpty, let deadline = instant.date else { continue }
            for lead in leadTimes {
                let fireAt = deadline.addingTimeInterval(-lead)
                guard fireAt > date else { continue }
                let targetKey: String
                switch target {
                case .start: targetKey = "start"
                case .end: targetKey = "end"
                case .milestone(let id): targetKey = "milestone:\(id)"
                }
                // Length-prefixed UTF-8 components cannot collide through delimiter injection.
                // Date/lead bit patterns preserve exact changes without locale or process hashing.
                let parts = [schedule.id, targetKey,
                             String(deadline.timeIntervalSince1970.bitPattern, radix: 16),
                             instant.timeZoneIdentifier!, String(lead.bitPattern, radix: 16)]
                let id = "inkpaw.v1." + parts.map { "\($0.utf8.count):\($0)" }.joined()
                guard identifiers.insert(id).inserted else { continue }
                reminders.append(PlannedReminder(
                    id: id, scheduleID: schedule.id, target: target, title: title,
                    body: "\(schedule.title) · \(instant.timeZoneIdentifier!)",
                    fireAt: fireAt, sourceInstant: instant
                ))
            }
        }
        reminders.sort { $0.fireAt == $1.fireAt ? $0.id < $1.id : $0.fireAt < $1.fireAt }
        return ReminderPlan(scheduleID: schedule.id, plannedAt: date, reminders: reminders, issues: issues)
    }
}
