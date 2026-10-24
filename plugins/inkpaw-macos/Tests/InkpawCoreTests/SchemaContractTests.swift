import Foundation
import XCTest
@testable import InkpawCore

final class SchemaContractTests: XCTestCase {
    private let date = Date(timeIntervalSince1970: 1_780_000_000)
    private let sourceURL = URL(string: "https://example.com/synthetic-competition/rules")!

    func testSchedulePrecisionAndMissingValuesRoundTrip() throws {
        let instants = [
            ScheduleInstant(date: nil, precision: .unknown, timeZoneIdentifier: nil, sourceURL: nil),
            ScheduleInstant(date: date, precision: .day, timeZoneIdentifier: nil, sourceURL: sourceURL),
            ScheduleInstant(
                date: date,
                precision: .exact,
                timeZoneIdentifier: "Asia/Shanghai",
                sourceURL: sourceURL
            ),
        ]

        try assertRoundTrip(instants)
        XCTAssertNil(instants[0].date)
        XCTAssertNil(instants[1].timeZoneIdentifier)
    }

    func testScheduleAndTimeOnlyTimelineRoundTrip() throws {
        try assertRoundTrip(schedule())
        try assertRoundTrip(TimelineSnapshot(
            scheduleID: "competition-1",
            evaluatedAt: date,
            phase: .unknown,
            countdown: nil,
            progressFraction: nil
        ))
        try assertRoundTrip(TimelineSnapshot(
            scheduleID: "competition-1",
            evaluatedAt: date,
            phase: .active,
            countdown: TimelineCountdown(target: .milestone(id: "submission"), remainingSeconds: 3600),
            progressFraction: 0.5
        ))
    }

    func testCompanionStateRoundTripPreservesStableIDsAndWindowGeometry() throws {
        let document = SourceDocument(
            id: "document-1",
            title: "Synthetic rules",
            locator: "Rules document",
            sourceURL: sourceURL,
            text: "A synthetic source document for schema testing."
        )
        let state = CompanionState(
            schemaVersion: 1,
            selectedScheduleID: "competition-1",
            schedules: [schedule()],
            checklists: [Checklist(
                id: "checklist-1",
                scheduleID: "competition-1",
                title: "Submission preparation",
                items: [ChecklistItem(id: "item-1", title: "Read rules", isCompleted: false)]
            )],
            documents: [document],
            repositories: [GitRepositoryReference(
                id: "repository-1",
                name: "Synthetic repository",
                directoryURL: URL(fileURLWithPath: "/synthetic/repository", isDirectory: true)
            )],
            windowGeometry: WindowGeometry(
                x: -400, y: 80, width: 320, height: 240, displayIdentifier: "synthetic-display"
            ),
            isCollapsed: true,
            reminderPreferences: ReminderPreferences(isEnabled: false, leadTimes: [3600]),
            deliveredReminderIDs: ["competition-1-submission-3600"]
        )

        try assertRoundTrip(state)
    }

    func testDocumentQuestionMatchesBackendWireContract() throws {
        let fixture = """
        {
          "question": "When is the submission due?",
          "passages": [{
            "document_id": "document-1",
            "passage_id": "passage-1",
            "title": "Synthetic rules",
            "locator": "Page 2, Submission",
            "text": "Submit before the published deadline."
          }]
        }
        """
        let data = Data(fixture.utf8)
        let request = try JSONDecoder().decode(DocumentQuestion.self, from: data)

        XCTAssertEqual(request.passages[0].id, "passage-1")
        XCTAssertEqual(request.passages[0].documentID, "document-1")
        try assertRoundTrip(request)
        try assertJSONEqual(JSONEncoder().encode(request), data)
    }

    func testDocumentAnswersMatchBackendWireContract() throws {
        let fixtures = [
            """
            {
              "status": "answered",
              "claims": [{
                "text": "The document requires submission before its published deadline.",
                "citations": [{
                  "document_id": "document-1",
                  "passage_id": "passage-1",
                  "quote": "Submit before the published deadline."
                }]
              }]
            }
            """,
            """
            {"status": "insufficient_evidence", "claims": []}
            """,
        ]

        for fixture in fixtures {
            let data = Data(fixture.utf8)
            let answer = try JSONDecoder().decode(DocumentAnswer.self, from: data)
            try assertRoundTrip(answer)
            try assertJSONEqual(JSONEncoder().encode(answer), data)
        }
    }

    func testGitSnapshotRoundTripPreservesPushEvidenceAndUpstreamCaveat() throws {
        let snapshot = GitSnapshot(
            repositoryID: "repository-1",
            observedAt: date,
            commits: [GitCommit(
                objectID: "synthetic-commit-object-id",
                subject: "test: add synthetic fixture",
                authoredAt: date,
                committedAt: date
            )],
            workingTree: GitWorkingTreeStatus(
                branchName: "main",
                headObjectID: "synthetic-commit-object-id",
                isDetachedHead: false,
                trackedChangeCount: 2,
                untrackedFileCount: 1
            ),
            upstream: GitUpstreamStatus(
                remoteName: "origin",
                branchName: "main",
                trackingObjectID: "synthetic-commit-object-id",
                lastFetchAt: nil,
                aheadCount: 0,
                behindCount: 0,
                caveat: .localTrackingRefsMayBeStale
            ),
            evidencedLocalPushes: [EvidencedLocalPush(
                id: "push-1",
                remoteName: "origin",
                destinationRef: "refs/heads/main",
                objectID: "synthetic-commit-object-id",
                occurredAt: nil,
                evidence: GitPushEvidence(
                    kind: .remoteTrackingReflogPushEntry,
                    recordID: "synthetic-reflog-record-1",
                    observedAt: date,
                    detail: "Synthetic push-marked reflog record; no real push was performed."
                )
            )]
        )

        try assertRoundTrip(snapshot)
        XCTAssertNil(snapshot.evidencedLocalPushes[0].occurredAt)
        XCTAssertEqual(snapshot.upstream?.caveat, .localTrackingRefsMayBeStale)
    }

    func testReminderPlanSchemaRoundTrip() throws {
        let instant = ScheduleInstant(
            date: date,
            precision: .exact,
            timeZoneIdentifier: "Etc/UTC",
            sourceURL: sourceURL
        )
        let plan = ReminderPlan(
            scheduleID: "competition-1",
            plannedAt: date,
            reminders: [PlannedReminder(
                id: "reminder-1",
                scheduleID: "competition-1",
                target: .end,
                title: "Synthetic reminder",
                body: "Schema fixture only.",
                fireAt: date,
                sourceInstant: instant
            )],
            issues: [.insufficientPrecision, .missingTimeZone]
        )

        try assertRoundTrip(plan)
    }

    private func schedule() -> CompetitionSchedule {
        CompetitionSchedule(
            id: "competition-1",
            title: "Synthetic competition",
            start: ScheduleInstant(
                date: date,
                precision: .exact,
                timeZoneIdentifier: "Etc/UTC",
                sourceURL: sourceURL
            ),
            end: ScheduleInstant(date: nil, precision: .unknown, timeZoneIdentifier: nil, sourceURL: nil),
            milestones: [CompetitionMilestone(
                id: "submission",
                title: "Submission",
                instant: ScheduleInstant(
                    date: date, precision: .day, timeZoneIdentifier: nil, sourceURL: sourceURL
                )
            )]
        )
    }

    private func assertRoundTrip<Value: Codable & Equatable>(
        _ value: Value,
        file: StaticString = #filePath,
        line: UInt = #line
    ) throws {
        let data = try JSONEncoder().encode(value)
        let decoded = try JSONDecoder().decode(Value.self, from: data)
        XCTAssertEqual(decoded, value, file: file, line: line)
    }

    private func assertJSONEqual(
        _ actual: Data,
        _ expected: Data,
        file: StaticString = #filePath,
        line: UInt = #line
    ) throws {
        let actualObject = try JSONSerialization.jsonObject(with: actual) as? NSDictionary
        let expectedObject = try JSONSerialization.jsonObject(with: expected) as? NSDictionary
        XCTAssertNotNil(actualObject, file: file, line: line)
        XCTAssertEqual(actualObject, expectedObject, file: file, line: line)
    }
}
