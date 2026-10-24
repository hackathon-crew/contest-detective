import Foundation
import XCTest
import InkpawCore
import InkpawInfrastructure

final class StateRepositoryTests: XCTestCase {
    func testMissingFileReturnsNilAndRoundTripPreservesReminderDelivery() async throws {
        let directory = try temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let url = directory.appendingPathComponent("private/state.json")
        let repository = LocalStateRepository(fileURL: url)
        let empty = try await repository.load()
        XCTAssertNil(empty)
        let original = state(delivered: ["stable-reminder-id"])
        try await repository.save(original)
        let reopened = try await LocalStateRepository(fileURL: url).load()
        XCTAssertEqual(reopened, original)
        let permissions = try FileManager.default.attributesOfItem(atPath: url.path)[.posixPermissions] as? NSNumber
        XCTAssertEqual(permissions?.intValue, 0o600)
    }

    func testAtomicReplacementPreservesLatestStateAndLeavesNoTemporaryFiles() async throws {
        let directory = try temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let repository = LocalStateRepository(fileURL: directory.appendingPathComponent("state.json"))
        try await repository.save(state(delivered: ["first"]))
        try await repository.save(state(delivered: ["second", "third"]))
        let loaded = try await repository.load()
        XCTAssertEqual(loaded?.deliveredReminderIDs, ["second", "third"])
        XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: directory.path), ["state.json"])
    }

    func testCorruptStateBlocksLoadAndAutosaveWithoutChangingBytes() async throws {
        let directory = try temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let url = directory.appendingPathComponent("state.json")
        let corrupt = Data("{broken-private-state".utf8)
        try corrupt.write(to: url)
        let repository = LocalStateRepository(fileURL: url)
        await assertError(.corruptState) { _ = try await repository.load() }
        await assertError(.corruptState) { try await repository.save(self.state()) }
        XCTAssertEqual(try Data(contentsOf: url), corrupt)
        // A fresh process cannot bypass the preservation gate by saving before loading.
        await assertError(.corruptState) { try await LocalStateRepository(fileURL: url).save(self.state()) }
        XCTAssertEqual(try Data(contentsOf: url), corrupt)
    }

    func testNewerVersionBlocksLoadAndAutosave() async throws {
        let directory = try temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let url = directory.appendingPathComponent("state.json")
        let newer = Data("{\"schemaVersion\":99,\"futureField\":\"preserve\"}".utf8)
        try newer.write(to: url)
        let repository = LocalStateRepository(fileURL: url)
        await assertError(.unsupportedVersion(99)) { _ = try await repository.load() }
        await assertError(.unsupportedVersion(99)) { try await repository.save(self.state()) }
        XCTAssertEqual(try Data(contentsOf: url), newer)
    }

    func testOversizedReadAndWriteAreRejectedWithoutTruncation() async throws {
        let directory = try temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let url = directory.appendingPathComponent("state.json")
        let large = Data(repeating: 65, count: 129)
        try large.write(to: url)
        let repository = LocalStateRepository(fileURL: url, maximumFileSize: 128)
        await assertError(.fileTooLarge(limit: 128)) { _ = try await repository.load() }
        await assertError(.fileTooLarge(limit: 128)) { try await repository.save(self.state()) }
        XCTAssertEqual(try Data(contentsOf: url), large)
        let fresh = LocalStateRepository(fileURL: directory.appendingPathComponent("new.json"), maximumFileSize: 1)
        await assertError(.fileTooLarge(limit: 1)) { try await fresh.save(self.state()) }
        XCTAssertFalse(FileManager.default.fileExists(atPath: directory.appendingPathComponent("new.json").path))
    }

    func testInvalidStateDoesNotReplaceValidState() async throws {
        let directory = try temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let url = directory.appendingPathComponent("state.json")
        let repository = LocalStateRepository(fileURL: url)
        try await repository.save(state())
        let before = try Data(contentsOf: url)
        await assertError(.unsupportedVersion(2)) { try await repository.save(self.state(version: 2)) }
        XCTAssertEqual(try Data(contentsOf: url), before)
    }

    func testSymlinkStateIsRejectedRatherThanReadingOrReplacingItsTarget() async throws {
        let directory = try temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let target = directory.appendingPathComponent("source.json")
        try JSONEncoder().encode(state()).write(to: target)
        let link = directory.appendingPathComponent("state.json")
        try FileManager.default.createSymbolicLink(at: link, withDestinationURL: target)
        let repository = LocalStateRepository(fileURL: link)
        await assertError(.invalidLocation) { _ = try await repository.load() }
        await assertError(.invalidLocation) { try await repository.save(self.state()) }
    }

    func testExplicitUserRecoveryByMovingBadFileUnblocksSaving() async throws {
        let directory = try temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let url = directory.appendingPathComponent("state.json")
        try Data("broken".utf8).write(to: url)
        let repository = LocalStateRepository(fileURL: url)
        await assertError(.corruptState) { _ = try await repository.load() }
        try FileManager.default.moveItem(at: url, to: directory.appendingPathComponent("state.backup"))
        try await repository.save(state())
        let restored = try await repository.load()
        XCTAssertEqual(restored, state())
    }

    private func temporaryDirectory() throws -> URL {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("inkpaw-state-tests-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }
    private func state(version: Int = 1, delivered: [String] = []) -> CompanionState {
        .init(schemaVersion: version, selectedScheduleID: nil, schedules: [], checklists: [], documents: [], repositories: [], windowGeometry: nil, isCollapsed: false, reminderPreferences: .init(isEnabled: false, leadTimes: []), deliveredReminderIDs: delivered)
    }
    private func assertError(_ expected: LocalStateRepositoryError, operation: () async throws -> Void, file: StaticString = #filePath, line: UInt = #line) async {
        do { try await operation(); XCTFail("Expected \(expected)", file: file, line: line) }
        catch { XCTAssertEqual(error as? LocalStateRepositoryError, expected, file: file, line: line) }
    }
}
