#if os(macOS)
import Foundation
import XCTest
import InkpawCore
@testable import InkpawCompanion

final class WorkspacePresentationTests: XCTestCase {
    private var passage: DocumentPassage {
        DocumentPassage(id: "p1", documentID: "d1", title: "Synthetic rules", locator: "Line 1", text: "Submit a demo.")
    }

    @MainActor
    func testDefaultAndRepeatedTabSelectionPreserveCurrentDraft() {
        let presentation = WorkspacePresentation()
        XCTAssertEqual(presentation.selectedTab, .schedule)
        XCTAssertNil(presentation.scheduleEditor)
        XCTAssertNil(presentation.sourceInspection)
        presentation.selectTab(.documents)
        presentation.documentQuestion = "What should we submit?"
        presentation.selectTab(.documents)
        XCTAssertEqual(presentation.documentQuestion, "What should we submit?")
    }

    @MainActor
    func testTabChangeClearsTransientSourceAndDraft() {
        let presentation = WorkspacePresentation()
        presentation.selectTab(.documents)
        presentation.documentQuestion = "What?"
        presentation.inspectSource(passage: passage, quote: "demo", localURL: URL(fileURLWithPath: "/tmp/synthetic.txt"))
        XCTAssertEqual(presentation.sourceInspection?.quote, "demo")
        presentation.selectTab(.git)
        XCTAssertEqual(presentation.selectedTab, .git)
        XCTAssertEqual(presentation.documentQuestion, "")
        XCTAssertNil(presentation.sourceInspection)
        XCTAssertNil(presentation.scheduleEditor)
    }

    @MainActor
    func testWrongTabAndDuplicateOpenCommandsDoNotReplacePresentations() {
        let presentation = WorkspacePresentation()
        presentation.inspectSource(passage: passage)
        XCTAssertNil(presentation.sourceInspection)
        presentation.openScheduleEditor()
        let editorID = presentation.scheduleEditor?.id
        presentation.openScheduleEditor()
        XCTAssertEqual(presentation.scheduleEditor?.id, editorID)
        presentation.selectTab(.documents)
        XCTAssertNil(presentation.scheduleEditor)
        presentation.openScheduleEditor()
        XCTAssertNil(presentation.scheduleEditor)
        presentation.inspectSource(passage: passage, quote: "first")
        let sourceID = presentation.sourceInspection?.id
        presentation.inspectSource(passage: passage, quote: "second")
        XCTAssertEqual(presentation.sourceInspection?.id, sourceID)
        XCTAssertEqual(presentation.sourceInspection?.quote, "first")
    }

    @MainActor
    func testSourceCanCloseAndReopenWithoutChangingInput() {
        let presentation = WorkspacePresentation()
        presentation.selectTab(.documents)
        for _ in 0..<2 {
            presentation.inspectSource(passage: passage)
            XCTAssertEqual(presentation.sourceInspection?.passage, passage)
            presentation.closeSourceInspection()
            XCTAssertNil(presentation.sourceInspection)
        }
        presentation.selectTab(.schedule)
        for _ in 0..<2 {
            presentation.openScheduleEditor()
            XCTAssertNotNil(presentation.scheduleEditor)
            XCTAssertNil(presentation.scheduleEditor?.existing)
            presentation.closeScheduleEditor()
            XCTAssertNil(presentation.scheduleEditor)
        }
    }

    @MainActor
    func testPopulatedQuestionCannotPreviewWhileSignedOut() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let suite = "InkpawPresentationTests." + UUID().uuidString
        let preferences = try XCTUnwrap(UserDefaults(suiteName: suite))
        let store = CompanionStore(stateURL: directory.appendingPathComponent("state.json"), preferences: preferences)
        defer {
            store.stop(); UserDefaults.standard.removePersistentDomain(forName: suite)
            try? FileManager.default.removeItem(at: directory)
        }
        store.start()
        for _ in 0..<100 where !store.isLoaded { try await Task.sleep(nanoseconds: 10_000_000) }
        XCTAssertTrue(store.isLoaded)
        let source = directory.appendingPathComponent("synthetic.md")
        try "Submit a demo.".write(to: source, atomically: true, encoding: .utf8)
        store.importDocuments([source])
        for _ in 0..<100 where store.passages.isEmpty && store.errorMessage == nil {
            try await Task.sleep(nanoseconds: 10_000_000)
        }
        XCTAssertNil(store.errorMessage)
        XCTAssertFalse(store.selectedPassages.isEmpty)
        let presentation = WorkspacePresentation()
        presentation.selectTab(.documents)
        presentation.documentQuestion = "What should we submit?"
        XCTAssertNil(store.signedInName)
        XCTAssertFalse(presentation.canPreviewQuestion(in: store))
    }
}
#endif
