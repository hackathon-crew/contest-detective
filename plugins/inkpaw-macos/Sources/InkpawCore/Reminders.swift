import Foundation

public struct ReminderPreferences: Codable, Equatable, Sendable {
    public let isEnabled: Bool
    public let leadTimes: [TimeInterval]

    public init(isEnabled: Bool, leadTimes: [TimeInterval]) {
        self.isEnabled = isEnabled
        self.leadTimes = leadTimes
    }
}

public struct PlannedReminder: Codable, Equatable, Sendable, Identifiable {
    public let id: String
    public let scheduleID: String
    public let target: TimelineTarget
    public let title: String
    public let body: String
    public let fireAt: Date
    public let sourceInstant: ScheduleInstant

    public init(
        id: String,
        scheduleID: String,
        target: TimelineTarget,
        title: String,
        body: String,
        fireAt: Date,
        sourceInstant: ScheduleInstant
    ) {
        self.id = id
        self.scheduleID = scheduleID
        self.target = target
        self.title = title
        self.body = body
        self.fireAt = fireAt
        self.sourceInstant = sourceInstant
    }
}

public enum ReminderPlanningIssue: String, Codable, Equatable, Sendable {
    case missingDate
    case insufficientPrecision
    case missingTimeZone
    case invalidTimeZone
    case invalidDate
    case invalidInterval
    case invalidLeadTime
}

/// A plan is data only; planning neither requests permission nor sends notifications.
public struct ReminderPlan: Codable, Equatable, Sendable {
    public let scheduleID: String
    public let plannedAt: Date
    public let reminders: [PlannedReminder]
    public let issues: [ReminderPlanningIssue]

    public init(
        scheduleID: String,
        plannedAt: Date,
        reminders: [PlannedReminder],
        issues: [ReminderPlanningIssue]
    ) {
        self.scheduleID = scheduleID
        self.plannedAt = plannedAt
        self.reminders = reminders
        self.issues = issues
    }
}
