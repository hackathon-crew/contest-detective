import Foundation

public enum SchedulePrecision: String, Codable, Equatable, Sendable {
    case exact
    case day
    case unknown
}

/// A source's date precision and zone are preserved, not inferred from the device.
public struct ScheduleInstant: Codable, Equatable, Sendable {
    public let date: Date?
    public let precision: SchedulePrecision
    /// IANA time-zone identifier, or nil when the source does not supply one.
    public let timeZoneIdentifier: String?
    public let sourceURL: URL?

    public init(
        date: Date?,
        precision: SchedulePrecision,
        timeZoneIdentifier: String?,
        sourceURL: URL?
    ) {
        self.date = date
        self.precision = precision
        self.timeZoneIdentifier = timeZoneIdentifier
        self.sourceURL = sourceURL
    }
}

public struct CompetitionMilestone: Codable, Equatable, Sendable, Identifiable {
    public let id: String
    public let title: String
    public let instant: ScheduleInstant

    public init(id: String, title: String, instant: ScheduleInstant) {
        self.id = id
        self.title = title
        self.instant = instant
    }
}

public struct CompetitionSchedule: Codable, Equatable, Sendable, Identifiable {
    public let id: String
    public let title: String
    public let start: ScheduleInstant
    public let end: ScheduleInstant
    public let milestones: [CompetitionMilestone]

    public init(
        id: String,
        title: String,
        start: ScheduleInstant,
        end: ScheduleInstant,
        milestones: [CompetitionMilestone]
    ) {
        self.id = id
        self.title = title
        self.start = start
        self.end = end
        self.milestones = milestones
    }
}

public enum TimelinePhase: String, Codable, Equatable, Sendable {
    case upcoming
    case active
    case completed
    case unknown
}

public enum TimelineTarget: Codable, Equatable, Sendable {
    case start
    case end
    case milestone(id: String)
}

public struct TimelineCountdown: Codable, Equatable, Sendable {
    public let target: TimelineTarget
    public let remainingSeconds: TimeInterval

    public init(target: TimelineTarget, remainingSeconds: TimeInterval) {
        self.target = target
        self.remainingSeconds = remainingSeconds
    }
}

public enum ScheduleValidationReason: String, Codable, Equatable, Sendable {
    case missingDate
    case insufficientPrecision
    case missingTimeZone
    case invalidTimeZone
    case invalidDate
    case invalidInterval
}

public struct TimelineValidationIssue: Codable, Equatable, Sendable {
    /// nil describes the interval or evaluation time rather than one endpoint.
    public let target: TimelineTarget?
    public let reason: ScheduleValidationReason

    public init(target: TimelineTarget?, reason: ScheduleValidationReason) {
        self.target = target
        self.reason = reason
    }
}

public struct MilestoneTimelineSnapshot: Codable, Equatable, Sendable, Identifiable {
    public let id: String
    public let title: String
    public let remainingSeconds: TimeInterval?
    public let isReached: Bool?
    public let issues: [ScheduleValidationReason]

    public init(
        id: String, title: String, remainingSeconds: TimeInterval?,
        isReached: Bool?, issues: [ScheduleValidationReason]
    ) {
        self.id = id
        self.title = title
        self.remainingSeconds = remainingSeconds
        self.isReached = isReached
        self.issues = issues
    }
}

/// Time progress is separate from checklist completion; uncertain values stay absent.
public struct TimelineSnapshot: Codable, Equatable, Sendable {
    public let scheduleID: String
    public let evaluatedAt: Date
    public let phase: TimelinePhase
    public let countdown: TimelineCountdown?
    public let progressFraction: Double?
    public let issues: [TimelineValidationIssue]
    public let milestones: [MilestoneTimelineSnapshot]

    public init(
        scheduleID: String,
        evaluatedAt: Date,
        phase: TimelinePhase,
        countdown: TimelineCountdown?,
        progressFraction: Double?,
        issues: [TimelineValidationIssue] = [],
        milestones: [MilestoneTimelineSnapshot] = []
    ) {
        self.scheduleID = scheduleID
        self.evaluatedAt = evaluatedAt
        self.phase = phase
        self.countdown = countdown
        self.progressFraction = progressFraction
        self.issues = issues
        self.milestones = milestones
    }
}
