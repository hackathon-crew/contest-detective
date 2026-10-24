import Foundation

public struct ChecklistItem: Codable, Equatable, Sendable, Identifiable {
    public let id: String
    public let title: String
    public let isCompleted: Bool

    public init(id: String, title: String, isCompleted: Bool) {
        self.id = id
        self.title = title
        self.isCompleted = isCompleted
    }
}

public struct Checklist: Codable, Equatable, Sendable, Identifiable {
    public let id: String
    public let scheduleID: String?
    public let title: String
    public let items: [ChecklistItem]

    public init(id: String, scheduleID: String?, title: String, items: [ChecklistItem]) {
        self.id = id
        self.scheduleID = scheduleID
        self.title = title
        self.items = items
    }
}
