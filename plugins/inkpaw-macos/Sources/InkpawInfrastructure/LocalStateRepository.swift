import Foundation
import InkpawCore
#if canImport(Darwin)
import Darwin
#else
import Glibc
#endif

public enum LocalStateRepositoryError: Error, Equatable, Sendable, LocalizedError {
    case invalidLocation
    case unsupportedVersion(Int)
    case fileTooLarge(limit: Int)
    case corruptState
    case invalidState
    case ioFailure(operation: String, code: Int32)

    public var errorDescription: String? {
        switch self {
        case .invalidLocation: return "State storage must be a local regular file."
        case .unsupportedVersion(let version): return "State version \(version) is not supported. The file was not changed."
        case .fileTooLarge(let limit): return "State exceeds the \(limit)-byte storage limit. The file was not changed."
        case .corruptState: return "Saved state could not be read. The original file was preserved."
        case .invalidState: return "State contains invalid identifiers, dates, or geometry."
        case .ioFailure(let operation, _): return "Local state \(operation) failed."
        }
    }
}

/// Stores only the typed CompanionState. Credentials, API tokens, and authentication
/// headers are deliberately not part of that schema. Access is serialized by the actor.
public actor LocalStateRepository: StateRepository {
    public static let currentSchemaVersion = 1
    public let fileURL: URL
    public let maximumFileSize: Int

    public init(fileURL: URL, maximumFileSize: Int = 8 * 1_024 * 1_024) {
        self.fileURL = fileURL
        self.maximumFileSize = max(1, min(maximumFileSize, 64 * 1_024 * 1_024))
    }

    public func load() async throws -> CompanionState? {
        try readExistingState()
    }

    private func readExistingState() throws -> CompanionState? {
        try validateLocation()
        try Task.checkCancellation()
        var metadata = stat()
        let inspected = fileURL.path.withCString { lstat($0, &metadata) }
        if inspected != 0 {
            if errno == ENOENT { return nil }
            throw LocalStateRepositoryError.ioFailure(operation: "inspection", code: errno)
        }
        guard metadata.st_mode & mode_t(S_IFMT) == mode_t(S_IFREG) else {
            throw LocalStateRepositoryError.invalidLocation
        }
        // O_NOFOLLOW closes a symlink-swap race; O_NONBLOCK prevents a swapped FIFO
        // from hanging the actor before the opened descriptor is checked again.
        let descriptor = fileURL.path.withCString { open($0, O_RDONLY | O_CLOEXEC | O_NOFOLLOW | O_NONBLOCK) }
        guard descriptor >= 0 else {
            throw LocalStateRepositoryError.ioFailure(operation: "read", code: errno)
        }
        let handle = FileHandle(fileDescriptor: descriptor, closeOnDealloc: true)
        guard fstat(descriptor, &metadata) == 0,
              metadata.st_mode & mode_t(S_IFMT) == mode_t(S_IFREG) else {
            try? handle.close()
            throw LocalStateRepositoryError.invalidLocation
        }
        guard metadata.st_size <= Int64(maximumFileSize) else {
            try? handle.close()
            throw LocalStateRepositoryError.fileTooLarge(limit: maximumFileSize)
        }
        defer { try? handle.close() }
        let data: Data
        do { data = try handle.read(upToCount: maximumFileSize + 1) ?? Data() }
        catch { throw LocalStateRepositoryError.ioFailure(operation: "read", code: errno) }
        guard data.count <= maximumFileSize else {
            throw LocalStateRepositoryError.fileTooLarge(limit: maximumFileSize)
        }
        try Task.checkCancellation()
        struct VersionEnvelope: Decodable { let schemaVersion: Int }
        let decoder = JSONDecoder()
        guard let envelope = try? decoder.decode(VersionEnvelope.self, from: data) else {
            throw LocalStateRepositoryError.corruptState
        }
        guard envelope.schemaVersion == Self.currentSchemaVersion else {
            throw LocalStateRepositoryError.unsupportedVersion(envelope.schemaVersion)
        }
        guard let state = try? decoder.decode(CompanionState.self, from: data) else {
            throw LocalStateRepositoryError.corruptState
        }
        do { try validate(state) }
        catch { throw LocalStateRepositoryError.corruptState }
        return state
    }

    public func save(_ state: CompanionState) async throws {
        try validateLocation()
        try validate(state)
        // Autosaves must never erase an unreadable or newer-version state. The user
        // must restore or move that file explicitly before saving can resume.
        _ = try readExistingState()
        try Task.checkCancellation()
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        let data: Data
        do { data = try encoder.encode(state) }
        catch { throw LocalStateRepositoryError.invalidState }
        guard data.count <= maximumFileSize else {
            throw LocalStateRepositoryError.fileTooLarge(limit: maximumFileSize)
        }
        let parent = fileURL.deletingLastPathComponent()
        do {
            try FileManager.default.createDirectory(
                at: parent, withIntermediateDirectories: true,
                attributes: [.posixPermissions: 0o700]
            )
        } catch { throw LocalStateRepositoryError.ioFailure(operation: "directory creation", code: errno) }
        // Create a private sibling before writing any bytes, then atomically rename it.
        // A failed encode/write never truncates the last successful state.
        let temporary = parent.appendingPathComponent(".inkpaw-state-\(UUID().uuidString).tmp")
        let descriptor = temporary.path.withCString { open($0, O_WRONLY | O_CREAT | O_EXCL | O_CLOEXEC, mode_t(0o600)) }
        guard descriptor >= 0 else {
            throw LocalStateRepositoryError.ioFailure(operation: "temporary file creation", code: errno)
        }
        var isOpen = true
        defer {
            if isOpen { _ = close(descriptor) }
            _ = temporary.path.withCString { unlink($0) }
        }
        try data.withUnsafeBytes { buffer in
            var offset = 0
            while offset < buffer.count {
                try Task.checkCancellation()
                let written = write(descriptor, buffer.baseAddress!.advanced(by: offset), buffer.count - offset)
                if written < 0 {
                    if errno == EINTR { continue }
                    throw LocalStateRepositoryError.ioFailure(operation: "write", code: errno)
                }
                guard written > 0 else {
                    throw LocalStateRepositoryError.ioFailure(operation: "write", code: EIO)
                }
                offset += written
            }
        }
        guard fsync(descriptor) == 0 else {
            throw LocalStateRepositoryError.ioFailure(operation: "synchronization", code: errno)
        }
        let closeResult = close(descriptor)
        isOpen = false
        guard closeResult == 0 else {
            throw LocalStateRepositoryError.ioFailure(operation: "close", code: errno)
        }
        try Task.checkCancellation()
        let renamed = temporary.path.withCString { source in
            fileURL.path.withCString { destination in rename(source, destination) }
        }
        guard renamed == 0 else {
            throw LocalStateRepositoryError.ioFailure(operation: "atomic replacement", code: errno)
        }
    }

    private func validateLocation() throws {
        guard fileURL.isFileURL, fileURL.path.hasPrefix("/"), !fileURL.lastPathComponent.isEmpty,
              fileURL.user == nil, fileURL.password == nil,
              fileURL.host == nil || fileURL.host == "" || fileURL.host == "localhost" else {
            throw LocalStateRepositoryError.invalidLocation
        }
    }

    private func validate(_ state: CompanionState) throws {
        guard state.schemaVersion == Self.currentSchemaVersion else {
            throw LocalStateRepositoryError.unsupportedVersion(state.schemaVersion)
        }
        func uniqueIDs(_ ids: [String]) -> Bool {
            ids.allSatisfy { !$0.isEmpty } && Set(ids).count == ids.count
        }
        guard uniqueIDs(state.schedules.map(\.id)), uniqueIDs(state.checklists.map(\.id)),
              uniqueIDs(state.documents.map(\.id)), uniqueIDs(state.repositories.map(\.id)),
              state.schedules.allSatisfy({ uniqueIDs($0.milestones.map(\.id)) }),
              state.checklists.allSatisfy({ uniqueIDs($0.items.map(\.id)) }),
              state.reminderPreferences.leadTimes.allSatisfy({ $0.isFinite && $0 >= 0 }),
              state.deliveredReminderIDs.allSatisfy({ !$0.isEmpty }) else {
            throw LocalStateRepositoryError.invalidState
        }
        // Reject credential-bearing source URLs rather than persisting them accidentally.
        let urls = state.documents.compactMap(\.sourceURL)
            + state.schedules.flatMap { [$0.start, $0.end] + $0.milestones.map(\.instant) }.compactMap(\.sourceURL)
        guard urls.allSatisfy({ $0.user == nil && $0.password == nil }),
              state.repositories.allSatisfy({ $0.directoryURL.isFileURL && $0.directoryURL.user == nil && $0.directoryURL.password == nil }) else {
            throw LocalStateRepositoryError.invalidState
        }
        if let geometry = state.windowGeometry {
            guard [geometry.x, geometry.y, geometry.width, geometry.height].allSatisfy(\.isFinite),
                  geometry.width > 0, geometry.height > 0 else {
                throw LocalStateRepositoryError.invalidState
            }
        }
    }
}
