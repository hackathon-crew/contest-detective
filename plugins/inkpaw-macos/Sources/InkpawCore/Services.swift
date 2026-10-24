import Foundation

public protocol TimelineCalculating: Sendable {
    func snapshot(for schedule: CompetitionSchedule, at date: Date) throws -> TimelineSnapshot
}

public protocol StateRepository: Sendable {
    func load() async throws -> CompanionState?
    func save(_ state: CompanionState) async throws
}

/// Read local Git data only. Fetch, push, checkout, and worktree edits are outside this contract.
public protocol GitActivityReading: Sendable {
    func snapshot(for repository: GitRepositoryReference) async throws -> GitSnapshot
}

public protocol DocumentAnswering: Sendable {
    func answer(_ question: DocumentQuestion) async throws -> DocumentAnswer
}

public protocol ReminderPlanning: Sendable {
    func plan(
        for schedule: CompetitionSchedule,
        preferences: ReminderPreferences,
        at date: Date
    ) throws -> ReminderPlan
}
