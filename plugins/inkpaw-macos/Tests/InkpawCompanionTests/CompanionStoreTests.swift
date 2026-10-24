#if os(macOS)
import Foundation
import XCTest
import InkpawCore
@testable import InkpawCompanion

final class CompanionStoreTests: XCTestCase {
    @MainActor
    private func loadedStore() async throws -> (CompanionStore, URL) {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let store = CompanionStore(stateURL: directory.appendingPathComponent("state.json"))
        store.start()
        for _ in 0..<100 where !store.isLoaded { try await Task.sleep(nanoseconds: 10_000_000) }
        XCTAssertTrue(store.isLoaded)
        return (store, directory)
    }

    @MainActor
    func testScheduleAndChecklistMutationKeepTimeSeparate() async throws {
        let (store, directory) = try await loadedStore()
        defer { store.stop(); try? FileManager.default.removeItem(at: directory) }
        let start = Date().addingTimeInterval(-3600)
        let end = Date().addingTimeInterval(3600)
        try store.saveSchedule(id: nil, title: "Synthetic sprint", start: start, end: end, zone: "UTC", precision: .exact)
        XCTAssertNotNil(store.timeline?.progressFraction)
        let progress = store.timeline?.progressFraction
        store.addChecklistItem("Synthetic demo")
        let item = try XCTUnwrap(store.selectedChecklist?.items.first)
        store.toggleChecklistItem(item.id)
        XCTAssertEqual(store.completedItemCount, 1)
        XCTAssertEqual(store.timeline?.progressFraction, progress)
        store.removeChecklistItem(item.id)
        XCTAssertEqual(store.itemCount, 0)
    }

    @MainActor
    func testDateOnlyScheduleDoesNotInventCountdown() async throws {
        let (store, directory) = try await loadedStore()
        defer { store.stop(); try? FileManager.default.removeItem(at: directory) }
        try store.saveSchedule(id: nil, title: "Date only", start: Date(), end: Date().addingTimeInterval(86400), zone: "Asia/Shanghai", precision: .day)
        XCTAssertEqual(store.timeline?.phase, .unknown)
        XCTAssertNil(store.timeline?.countdown)
        XCTAssertNil(store.timeline?.progressFraction)
    }

    @MainActor
    func testInvalidScheduleDoesNotMutateState() async throws {
        let (store, directory) = try await loadedStore()
        defer { store.stop(); try? FileManager.default.removeItem(at: directory) }
        XCTAssertThrowsError(try store.saveSchedule(id: nil, title: "Bad", start: Date(), end: Date(), zone: "Not/AZone", precision: .exact))
        XCTAssertTrue(store.state.schedules.isEmpty)
    }

    @MainActor
    func testStatePersistsMilestonesChecklistAndCollapsedFlag() async throws {
        let (store, directory) = try await loadedStore()
        defer { store.stop(); try? FileManager.default.removeItem(at: directory) }
        try store.saveSchedule(id: nil, title: "Persistence", start: Date(), end: Date().addingTimeInterval(86400), zone: "UTC", precision: .exact)
        try store.addMilestone(title: "Demo", date: Date().addingTimeInterval(7200))
        store.addChecklistItem("Video")
        store.setCollapsed(true)
        await store.flushPersistence()
        store.stop()
        let restored = CompanionStore(stateURL: store.stateFileURL)
        defer { restored.stop() }
        restored.start()
        for _ in 0..<100 where !restored.isLoaded { try await Task.sleep(nanoseconds: 10_000_000) }
        XCTAssertEqual(restored.selectedSchedule?.title, "Persistence")
        XCTAssertEqual(restored.selectedSchedule?.milestones.first?.title, "Demo")
        XCTAssertEqual(restored.selectedChecklist?.items.first?.title, "Video")
        XCTAssertTrue(restored.state.isCollapsed)
        XCTAssertFalse(restored.state.reminderPreferences.isEnabled)
    }
}
#endif
