import Foundation

/// Geometry is expressed in native screen points, not device pixels.
public struct WindowGeometry: Codable, Equatable, Sendable {
    public let x: Double
    public let y: Double
    public let width: Double
    public let height: Double
    public let displayIdentifier: String?

    public init(x: Double, y: Double, width: Double, height: Double, displayIdentifier: String?) {
        self.x = x
        self.y = y
        self.width = width
        self.height = height
        self.displayIdentifier = displayIdentifier
    }
}

public struct CompanionState: Codable, Equatable, Sendable {
    public let schemaVersion: Int
    public let selectedScheduleID: String?
    public let schedules: [CompetitionSchedule]
    public let checklists: [Checklist]
    public let documents: [SourceDocument]
    public let repositories: [GitRepositoryReference]
    public let windowGeometry: WindowGeometry?
    public let isCollapsed: Bool
    public let reminderPreferences: ReminderPreferences
    public let deliveredReminderIDs: [String]

    public init(
        schemaVersion: Int,
        selectedScheduleID: String?,
        schedules: [CompetitionSchedule],
        checklists: [Checklist],
        documents: [SourceDocument],
        repositories: [GitRepositoryReference],
        windowGeometry: WindowGeometry?,
        isCollapsed: Bool,
        reminderPreferences: ReminderPreferences,
        deliveredReminderIDs: [String]
    ) {
        self.schemaVersion = schemaVersion
        self.selectedScheduleID = selectedScheduleID
        self.schedules = schedules
        self.checklists = checklists
        self.documents = documents
        self.repositories = repositories
        self.windowGeometry = windowGeometry
        self.isCollapsed = isCollapsed
        self.reminderPreferences = reminderPreferences
        self.deliveredReminderIDs = deliveredReminderIDs
    }
}
