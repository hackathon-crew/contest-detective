import Foundation
import InkpawCore

/// Pure time arithmetic. Neither device time zone nor checklist completion is consulted.
public struct TimelineCalculator: TimelineCalculating {
    public init() {}

    public func snapshot(for schedule: CompetitionSchedule, at date: Date) throws -> TimelineSnapshot {
        var issues = InstantValidation.issues(for: schedule.start).map {
            TimelineValidationIssue(target: .start, reason: $0)
        }
        issues += InstantValidation.issues(for: schedule.end).map {
            TimelineValidationIssue(target: .end, reason: $0)
        }
        let milestones = schedule.milestones.map { milestone in
            let reasons = InstantValidation.issues(for: milestone.instant)
            issues += reasons.map {
                TimelineValidationIssue(target: .milestone(id: milestone.id), reason: $0)
            }
            let validDate = reasons.isEmpty && date.timeIntervalSince1970.isFinite ? milestone.instant.date : nil
            return MilestoneTimelineSnapshot(
                id: milestone.id,
                title: milestone.title,
                remainingSeconds: validDate.map { max(0, $0.timeIntervalSince(date)) },
                isReached: validDate.map { date >= $0 },
                issues: reasons
            )
        }
        var phase: TimelinePhase = .unknown
        var countdown: TimelineCountdown?
        var progress: Double?
        if !date.timeIntervalSince1970.isFinite {
            issues.append(TimelineValidationIssue(target: nil, reason: .invalidDate))
        } else if InstantValidation.issues(for: schedule.start).isEmpty,
                  InstantValidation.issues(for: schedule.end).isEmpty,
                  let start = schedule.start.date, let end = schedule.end.date {
            let duration = end.timeIntervalSince(start)
            if duration > 0, duration.isFinite {
                progress = min(1, max(0, date.timeIntervalSince(start) / duration))
                if date < start {
                    phase = .upcoming
                    countdown = TimelineCountdown(target: .start, remainingSeconds: start.timeIntervalSince(date))
                } else if date < end {
                    phase = .active
                    countdown = TimelineCountdown(target: .end, remainingSeconds: end.timeIntervalSince(date))
                } else {
                    phase = .completed
                }
            } else {
                issues.append(TimelineValidationIssue(target: nil, reason: .invalidInterval))
            }
        }
        return TimelineSnapshot(
            scheduleID: schedule.id, evaluatedAt: date, phase: phase,
            countdown: countdown, progressFraction: progress,
            issues: issues, milestones: milestones
        )
    }
}

/// Shared strict validation prevents an imprecise or unknown source from becoming a deadline.
internal enum InstantValidation {
    // Foundation may accept abbreviations and GMT offsets. Only actual named database entries
    // (and the IANA UTC alias) are accepted, not the user's current device time zone.
    static let knownZones = Set(TimeZone.knownTimeZoneIdentifiers).union(["UTC", "Etc/UTC", "Etc/GMT", "GMT"])

    static func issues(for instant: ScheduleInstant) -> [ScheduleValidationReason] {
        var issues: [ScheduleValidationReason] = []
        if let date = instant.date {
            if !date.timeIntervalSince1970.isFinite { issues.append(.invalidDate) }
        } else { issues.append(.missingDate) }
        if instant.precision != .exact { issues.append(.insufficientPrecision) }
        if let zone = instant.timeZoneIdentifier, !zone.isEmpty {
            if !knownZones.contains(zone) || TimeZone(identifier: zone) == nil {
                issues.append(.invalidTimeZone)
            }
        } else { issues.append(.missingTimeZone) }
        return issues
    }
}
