import Foundation
import InkpawCore
#if canImport(Darwin)
import Darwin
#else
import Glibc
#endif

public enum GitActivityReaderError: Error, Equatable, Sendable, LocalizedError {
    case invalidDirectory
    case notRepository
    case selectionMustBeRepositoryRoot
    case commandFailed(command: String, exitCode: Int32)
    case unavailable
    case timedOut
    case outputLimitExceeded
    case invalidOutput
    case unsupportedFilters
    case unsupportedPartialClone
    case unsupportedConfigurationIncludes

    public var errorDescription: String? {
        switch self {
        case .invalidDirectory: return "Select a local repository folder first."
        case .notRepository: return "The selected folder is not a Git working tree."
        case .selectionMustBeRepositoryRoot: return "Select the repository root, not a child folder."
        case .commandFailed(let command, let code): return "Read-only Git \(command) failed (\(code))."
        case .unavailable: return "The system Git executable is unavailable."
        case .timedOut: return "Reading local Git activity timed out."
        case .outputLimitExceeded: return "Git output exceeded the safe local read limit."
        case .invalidOutput: return "Local Git returned an unexpected result."
        case .unsupportedFilters: return "This repository configures external file filters. Git activity is unavailable because even status can execute those filters."
        case .unsupportedPartialClone: return "Partial or promisor repositories are not supported: reading missing objects can fetch and write data. Select a complete local clone."
        case .unsupportedConfigurationIncludes: return "This repository includes other Git configuration files. Git activity is unavailable because their execution and network settings cannot be safely assumed."
        }
    }
}

/// Reads only a repository explicitly selected by the caller. No remote communication,
/// mutation, shell, hooks, shell history, credential helper, or arbitrary flags are used.
public struct GitActivityReader: GitActivityReading {
    public struct Configuration: Sendable {
        public let maximumCommits: Int
        public let maximumPushEvents: Int
        public let maximumTrackingRefs: Int
        public let commandTimeout: TimeInterval
        public let snapshotTimeout: TimeInterval
        public let maximumOutputBytes: Int

        public init(
            maximumCommits: Int = 20,
            maximumPushEvents: Int = 20,
            maximumTrackingRefs: Int = 16,
            commandTimeout: TimeInterval = 4,
            snapshotTimeout: TimeInterval = 20,
            maximumOutputBytes: Int = 1_048_576
        ) {
            self.maximumCommits = max(1, min(maximumCommits, 100))
            self.maximumPushEvents = max(1, min(maximumPushEvents, 100))
            self.maximumTrackingRefs = max(1, min(maximumTrackingRefs, 32))
            self.commandTimeout = commandTimeout.isFinite ? max(0.05, min(commandTimeout, 15)) : 4
            self.snapshotTimeout = snapshotTimeout.isFinite ? max(0.05, min(snapshotTimeout, 60)) : 20
            self.maximumOutputBytes = max(1_024, min(maximumOutputBytes, 8 * 1_048_576))
        }
    }

    public let configuration: Configuration
    private let executableURL: URL

    public init(configuration: Configuration = Configuration()) {
        self.configuration = configuration
        self.executableURL = URL(fileURLWithPath: "/usr/bin/git")
    }

    /// Test-only seam; production callers cannot choose an executable or inject flags.
    internal init(executableURL: URL, configuration: Configuration = Configuration()) {
        self.configuration = configuration
        self.executableURL = executableURL
    }

    public func snapshot(for repository: GitRepositoryReference) async throws -> GitSnapshot {
        try Task.checkCancellation()
        let worker = Task.detached(priority: .utility) {
            try self.readSnapshot(for: repository)
        }
        return try await withTaskCancellationHandler {
            try await worker.value
        } onCancel: {
            worker.cancel()
        }
    }

    private func readSnapshot(for repository: GitRepositoryReference) throws -> GitSnapshot {
        let directory = repository.directoryURL
        var isDirectory: ObjCBool = false
        guard directory.isFileURL, directory.path.hasPrefix("/"),
              directory.user == nil, directory.password == nil,
              directory.host == nil || directory.host == "" || directory.host == "localhost",
              FileManager.default.fileExists(atPath: directory.path, isDirectory: &isDirectory),
              isDirectory.boolValue else { throw GitActivityReaderError.invalidDirectory }
        let deadline = ProcessInfo.processInfo.systemUptime + configuration.snapshotTimeout
        func read(_ command: ReadCommand, allowFailure: Bool = false) throws -> GitProcessResult {
            let remaining = deadline - ProcessInfo.processInfo.systemUptime
            guard remaining > 0 else { throw GitActivityReaderError.timedOut }
            let result = try GitProcess.run(
                executable: executableURL, directory: directory, command: command,
                timeout: min(configuration.commandTimeout, remaining),
                maximumOutputBytes: configuration.maximumOutputBytes
            )
            if !allowFailure, result.exitCode != 0 {
                throw GitActivityReaderError.commandFailed(command: command.name, exitCode: result.exitCode)
            }
            return result
        }
        // The first command reads configuration names only, without following includes.
        // `status` can execute clean/process filters; object reads in partial clones can
        // invoke a remote helper and write downloaded packs. Fail closed before either.
        // Conditional/worktree includes are rejected rather than opening arbitrary files.
        let safety = try read(.safetyConfiguration, allowFailure: true)
        guard safety.exitCode == 0 || (safety.exitCode == 1 && safety.stderr.isEmpty) else {
            throw GitActivityReaderError.commandFailed(command: "config", exitCode: safety.exitCode)
        }
        try Self.validateSafetyConfiguration(safety.stdout)
        let inside = try read(.insideWorkTree, allowFailure: true)
        if inside.exitCode != 0 {
            if inside.stderr.contains("not a git repository") { throw GitActivityReaderError.notRepository }
            throw GitActivityReaderError.commandFailed(command: "rev-parse", exitCode: inside.exitCode)
        }
        guard inside.stdout.trimmingCharacters(in: .whitespacesAndNewlines) == "true" else {
            throw GitActivityReaderError.notRepository
        }
        // Git normally discovers an ancestor repository. Requiring an empty prefix avoids
        // silently expanding a user's folder selection to a different root.
        let prefix = try read(.prefix).stdout
        guard prefix == "\n" || prefix.isEmpty else {
            throw GitActivityReaderError.selectionMustBeRepositoryRoot
        }
        let workingTree = try Self.parseStatus(try read(.status).stdout)
        let commits: [GitCommit]
        if workingTree.headObjectID == nil {
            commits = [] // An unborn branch is a valid repository, not a command failure.
        } else {
            commits = try Self.parseCommits(try read(.log(limit: configuration.maximumCommits)).stdout)
        }
        let mappingResult = try read(.remoteFetchMappings, allowFailure: true)
        guard mappingResult.exitCode == 0 || mappingResult.exitCode == 1 else {
            throw GitActivityReaderError.commandFailed(command: "config", exitCode: mappingResult.exitCode)
        }
        let mappings = Self.parseFetchMappings(mappingResult.stdout)
        var upstream: GitUpstreamStatus?
        if !workingTree.isDetachedHead, workingTree.headObjectID != nil {
            let upstreamResult = try read(.upstreamName, allowFailure: true)
            if upstreamResult.exitCode == 0 {
                let reference = upstreamResult.stdout.trimmingCharacters(in: .newlines)
                if let destination = Self.destination(for: reference, mappings: mappings, allowLocal: true) {
                    let objectResult = try read(.upstreamObject, allowFailure: true)
                    let object = objectResult.stdout.trimmingCharacters(in: .newlines)
                    let countsResult = try read(.aheadBehind, allowFailure: true)
                    let counts = countsResult.stdout.split(whereSeparator: \.isWhitespace).compactMap { Int($0) }
                    upstream = GitUpstreamStatus(
                        remoteName: destination.remote, branchName: destination.branch,
                        trackingObjectID: objectResult.exitCode == 0 && Self.isObjectID(object) ? object : nil,
                        lastFetchAt: nil,
                        aheadCount: countsResult.exitCode == 0 && counts.count == 2 ? counts[0] : nil,
                        behindCount: countsResult.exitCode == 0 && counts.count == 2 ? counts[1] : nil,
                        caveat: .localTrackingRefsMayBeStale
                    )
                }
            }
        }
        let observedAt = Date()
        let references = try read(.remoteTrackingRefs).stdout.split(separator: "\n").map(String.init)
            .filter { $0.hasPrefix("refs/remotes/") && !$0.hasSuffix("/HEAD") }
            .sorted().prefix(configuration.maximumTrackingRefs)
        var pushes: [EvidencedLocalPush] = []
        var evidenceIDs = Set<String>()
        for reference in references {
            guard let destination = Self.destination(for: reference, mappings: mappings, allowLocal: false) else { continue }
            let result = try read(.reflog(reference: reference, limit: configuration.maximumPushEvents), allowFailure: true)
            // A repository may intentionally disable reflogs. Absence is not evidence of no push.
            guard result.exitCode == 0 else { continue }
            for push in try Self.parsePushes(
                result.stdout, reference: reference, remote: destination.remote,
                branch: destination.branch, observedAt: observedAt
            ) where evidenceIDs.insert(push.id).inserted {
                pushes.append(push)
            }
        }
        pushes.sort {
            let left = $0.occurredAt ?? .distantPast
            let right = $1.occurredAt ?? .distantPast
            return left == right ? $0.id < $1.id : left > right
        }
        try Task.checkCancellation()
        return GitSnapshot(
            repositoryID: repository.id, observedAt: observedAt, commits: commits,
            workingTree: workingTree, upstream: upstream,
            evidencedLocalPushes: Array(pushes.prefix(configuration.maximumPushEvents))
        )
    }

    private static func validateSafetyConfiguration(_ output: String) throws {
        let names = output.split(separator: "\0", omittingEmptySubsequences: true)
        if names.contains(where: { $0.hasPrefix("include.") || $0.hasPrefix("includeif.") }) {
            throw GitActivityReaderError.unsupportedConfigurationIncludes
        }
        if names.contains(where: { $0.hasPrefix("filter.") }) {
            // Even an empty command or required=false is conservatively unsupported.
            // No filter command strings or arbitrary source file contents are read here.
            throw GitActivityReaderError.unsupportedFilters
        }
        if !names.isEmpty { throw GitActivityReaderError.unsupportedPartialClone }
    }

    private static func parseStatus(_ output: String) throws -> GitWorkingTreeStatus {
        var head: String?
        var branch: String?
        var detached = false
        var tracked = 0
        var untracked = 0
        var sawHead = false
        var sawBranch = false
        for record in output.split(separator: "\0", omittingEmptySubsequences: true) {
            if record.hasPrefix("# branch.oid ") {
                sawHead = true
                let value = String(record.dropFirst("# branch.oid ".count))
                if value != "(initial)" {
                    guard isObjectID(value) else { throw GitActivityReaderError.invalidOutput }
                    head = value
                }
            } else if record.hasPrefix("# branch.head ") {
                sawBranch = true
                let value = String(record.dropFirst("# branch.head ".count))
                detached = value == "(detached)"
                branch = detached ? nil : value
            } else if record.hasPrefix("1 ") || record.hasPrefix("2 ") || record.hasPrefix("u ") {
                tracked += 1
            } else if record.hasPrefix("? ") {
                untracked += 1
            }
        }
        guard sawHead && sawBranch else { throw GitActivityReaderError.invalidOutput }
        return GitWorkingTreeStatus(
            branchName: branch, headObjectID: head, isDetachedHead: detached,
            trackedChangeCount: tracked, untrackedFileCount: untracked
        )
    }

    private static func parseCommits(_ output: String) throws -> [GitCommit] {
        if output.isEmpty { return [] }
        var fields = output.split(separator: "\0", omittingEmptySubsequences: false).map(String.init)
        if fields.last == "" { fields.removeLast() }
        guard fields.count.isMultiple(of: 4) else { throw GitActivityReaderError.invalidOutput }
        return try stride(from: 0, to: fields.count, by: 4).map { index in
            guard isObjectID(fields[index]),
                  let authored = TimeInterval(fields[index + 1]), authored.isFinite,
                  let committed = TimeInterval(fields[index + 2]), committed.isFinite else {
                throw GitActivityReaderError.invalidOutput
            }
            return GitCommit(objectID: fields[index], subject: fields[index + 3],
                             authoredAt: Date(timeIntervalSince1970: authored),
                             committedAt: Date(timeIntervalSince1970: committed))
        }
    }

    private struct FetchMapping {
        let remote: String
        let source: String
        let destination: String
    }

    private static func parseFetchMappings(_ output: String) -> [FetchMapping] {
        output.split(separator: "\0", omittingEmptySubsequences: true).compactMap { record in
            guard let separator = record.firstIndex(of: "\n") else { return nil }
            let key = record[..<separator]
            guard key.hasPrefix("remote."), key.hasSuffix(".fetch") else { return nil }
            let remote = String(key.dropFirst("remote.".count).dropLast(".fetch".count))
            guard !remote.isEmpty else { return nil }
            var value = record[record.index(after: separator)...]
            if value.hasPrefix("+") { value = value.dropFirst() }
            let parts = value.split(separator: ":", maxSplits: 1, omittingEmptySubsequences: false)
            guard parts.count == 2, parts[0].hasPrefix("refs/heads/"),
                  parts[1].hasPrefix("refs/remotes/") else { return nil }
            let source = String(parts[0]), destination = String(parts[1])
            let sourceWildcards = source.filter { $0 == "*" }.count
            let destinationWildcards = destination.filter { $0 == "*" }.count
            guard sourceWildcards <= 1, sourceWildcards == destinationWildcards else { return nil }
            return FetchMapping(remote: remote, source: source, destination: destination)
        }
    }

    private static func destination(
        for reference: String, mappings: [FetchMapping], allowLocal: Bool
    ) -> (remote: String, branch: String)? {
        if allowLocal, reference.hasPrefix("refs/heads/") {
            return (".", String(reference.dropFirst("refs/heads/".count)))
        }
        var candidates: [(remote: String, branch: String)] = []
        for mapping in mappings {
            let source: String
            if let wildcard = mapping.destination.firstIndex(of: "*") {
                let prefix = String(mapping.destination[..<wildcard])
                let suffix = String(mapping.destination[mapping.destination.index(after: wildcard)...])
                guard reference.hasPrefix(prefix), reference.hasSuffix(suffix),
                      reference.count >= prefix.count + suffix.count else { continue }
                let match = String(reference.dropFirst(prefix.count).dropLast(suffix.count))
                source = mapping.source.replacingOccurrences(of: "*", with: match)
            } else {
                guard reference == mapping.destination else { continue }
                source = mapping.source
            }
            let branch = String(source.dropFirst("refs/heads/".count))
            guard !branch.isEmpty else { continue }
            if !candidates.contains(where: { $0.remote == mapping.remote && $0.branch == branch }) {
                candidates.append((mapping.remote, branch))
            }
        }
        // Overlapping custom refspecs can map one tracking ref to multiple remotes.
        // A reflog alone cannot resolve that ambiguity, so never guess a destination.
        return candidates.count == 1 ? candidates[0] : nil
    }

    private static func parsePushes(
        _ output: String, reference: String, remote: String, branch: String, observedAt: Date
    ) throws -> [EvidencedLocalPush] {
        if output.isEmpty { return [] }
        var fields = output.split(separator: "\0", omittingEmptySubsequences: false).map(String.init)
        if fields.last == "" { fields.removeLast() }
        guard fields.count.isMultiple(of: 3) else { throw GitActivityReaderError.invalidOutput }
        var pushes: [EvidencedLocalPush] = []
        for index in stride(from: 0, to: fields.count, by: 3) {
            // Exact reflog evidence only. A commit message, fetch, or similar phrase is insufficient.
            guard fields[index + 2] == "update by push", isObjectID(fields[index]) else { continue }
            let selector = fields[index + 1]
            guard selector.hasPrefix(reference + "@{"), selector.hasSuffix("}") else { continue }
            let rawDate = selector.dropFirst(reference.count + 2).dropLast()
            let pieces = rawDate.split(separator: " ")
            guard pieces.count == 2, let seconds = TimeInterval(pieces[0]), seconds.isFinite else { continue }
            let recordID = "\(selector):\(fields[index])"
            pushes.append(EvidencedLocalPush(
                id: recordID, remoteName: remote, destinationRef: "refs/heads/" + branch,
                objectID: fields[index], occurredAt: Date(timeIntervalSince1970: seconds),
                evidence: GitPushEvidence(
                    kind: .remoteTrackingReflogPushEntry, recordID: recordID,
                    observedAt: observedAt, detail: "update by push (local remote-tracking reflog)"
                )
            ))
        }
        return pushes
    }

    private static func isObjectID(_ value: String) -> Bool {
        (value.utf8.count == 40 || value.utf8.count == 64)
            && value.utf8.allSatisfy { (48...57).contains($0) || (97...102).contains($0) }
    }
}

/// An exhaustive command enum is the production mutation/network boundary.
internal enum ReadCommand {
    case safetyConfiguration, insideWorkTree, prefix, status, upstreamName, upstreamObject, aheadBehind, remoteTrackingRefs, remoteFetchMappings
    case log(limit: Int)
    case reflog(reference: String, limit: Int)

    var arguments: [String] {
        switch self {
        case .safetyConfiguration:
            // Git canonicalizes section/variable names to lowercase. --no-includes
            // still reads config.worktree when enabled, but does not follow include paths.
            return ["config", "--no-includes", "--null", "--name-only", "--get-regexp",
                    "^(filter\\..*\\.(clean|smudge|process|required)|extensions\\.partialclone|remote\\..*\\.(promisor|partialclonefilter)|include\\.path|includeif\\..*\\.path)$"]
        case .insideWorkTree: return ["rev-parse", "--is-inside-work-tree"]
        case .prefix: return ["rev-parse", "--show-prefix"]
        case .status:
            return ["status", "--porcelain=v2", "--branch", "-z", "--untracked-files=all", "--ignore-submodules=all", "--no-renames"]
        case .log(let limit):
            return ["log", "-n", String(limit), "--format=%H%x00%at%x00%ct%x00%s", "-z", "--no-show-signature", "HEAD", "--"]
        case .upstreamName: return ["rev-parse", "--symbolic-full-name", "@{upstream}"]
        case .upstreamObject: return ["rev-parse", "--verify", "@{upstream}"]
        case .aheadBehind: return ["rev-list", "--left-right", "--count", "HEAD...@{upstream}", "--"]
        case .remoteTrackingRefs: return ["rev-parse", "--symbolic-full-name", "--remotes"]
        case .remoteFetchMappings:
            // Fixed read-only key category. Values are refspecs, never remote URLs or credentials.
            return ["config", "--no-includes", "--null", "--get-regexp", "^remote\\..*\\.fetch$"]
        case .reflog(let reference, let limit):
            return ["reflog", "show", "-n", String(limit), "--date=raw", "--format=%H%x00%gD%x00%gs", "-z", reference, "--"]
        }
    }
    var name: String { arguments[0] }
}

internal struct GitProcessResult {
    let stdout: String
    let stderr: String
    let exitCode: Int32
}

private enum GitProcess {
    static let fixedOptions = [
        "--no-optional-locks", "-c", "core.fsmonitor=false", "--no-pager",
        "-c", "core.untrackedCache=false", "-c", "gc.auto=0", "-c", "maintenance.auto=false",
        "-c", "core.hooksPath=/dev/null", "-c", "protocol.allow=never",
    ]

    static func run(
        executable: URL, directory: URL, command: ReadCommand,
        timeout: TimeInterval, maximumOutputBytes: Int
    ) throws -> GitProcessResult {
        try Task.checkCancellation()
        let process = Process()
        process.executableURL = executable
        process.currentDirectoryURL = directory
        process.arguments = fixedOptions + command.arguments
        // Deliberately do not inherit credentials, GIT_DIR, GIT_WORK_TREE, external config,
        // injected config variables, locale-dependent output, or terminal prompts.
        process.environment = [
            "PATH": "/usr/bin:/bin", "LANG": "C", "LC_ALL": "C",
            "GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_SYSTEM": "/dev/null",
            "GIT_CONFIG_GLOBAL": "/dev/null", "GIT_TERMINAL_PROMPT": "0",
            "GIT_OPTIONAL_LOCKS": "0", "GIT_NO_REPLACE_OBJECTS": "1",
            "GIT_NO_LAZY_FETCH": "1", "GIT_ALLOW_PROTOCOL": "",
            "GIT_ATTR_NOSYSTEM": "1", "GIT_PAGER": "cat", "PAGER": "cat",
        ]
        process.standardInput = FileHandle.nullDevice
        let output = Pipe()
        let errors = Pipe()
        process.standardOutput = output
        process.standardError = errors
        let outFD = output.fileHandleForReading.fileDescriptor
        let errFD = errors.fileHandleForReading.fileDescriptor
        guard fcntl(outFD, F_SETFL, fcntl(outFD, F_GETFL) | O_NONBLOCK) >= 0,
              fcntl(errFD, F_SETFL, fcntl(errFD, F_GETFL) | O_NONBLOCK) >= 0 else {
            throw GitActivityReaderError.unavailable
        }
        defer {
            try? output.fileHandleForReading.close()
            try? output.fileHandleForWriting.close()
            try? errors.fileHandleForReading.close()
            try? errors.fileHandleForWriting.close()
        }
        do { try process.run() }
        catch { throw GitActivityReaderError.unavailable }
        // Only the child owns the write sides after launch, so EOF is observable.
        try? output.fileHandleForWriting.close()
        try? errors.fileHandleForWriting.close()
        var stdout = Data()
        var stderr = Data()
        let deadline = ProcessInfo.processInfo.systemUptime + timeout
        do {
            while true {
                try Task.checkCancellation()
                guard ProcessInfo.processInfo.systemUptime < deadline else { throw GitActivityReaderError.timedOut }
                try drain(outFD, into: &stdout, otherByteCount: stderr.count, maximum: maximumOutputBytes)
                try drain(errFD, into: &stderr, otherByteCount: stdout.count, maximum: maximumOutputBytes)
                if !process.isRunning {
                    // Drain both pipes once more after exit, without waiting on inherited
                    // descriptors held open by another process. All reads are nonblocking.
                    try drain(outFD, into: &stdout, otherByteCount: stderr.count, maximum: maximumOutputBytes)
                    try drain(errFD, into: &stderr, otherByteCount: stdout.count, maximum: maximumOutputBytes)
                    process.waitUntilExit()
                    break
                }
                Thread.sleep(forTimeInterval: 0.005)
            }
        } catch {
            stop(process)
            throw error
        }
        return GitProcessResult(
            stdout: String(decoding: stdout, as: UTF8.self),
            stderr: String(decoding: stderr, as: UTF8.self), exitCode: process.terminationStatus
        )
    }

    private static func drain(_ descriptor: Int32, into data: inout Data, otherByteCount: Int, maximum: Int) throws {
        var buffer = [UInt8](repeating: 0, count: 16_384)
        // Bounded rounds prevent a continuously writing stream from starving cancellation,
        // timeout checks, or draining the other pipe.
        for _ in 0..<16 {
            let count = buffer.withUnsafeMutableBytes { read(descriptor, $0.baseAddress, $0.count) }
            if count == 0 { return }
            if count < 0 {
                if errno == EINTR { continue }
                if errno == EAGAIN || errno == EWOULDBLOCK { return }
                throw GitActivityReaderError.invalidOutput
            }
            guard data.count + otherByteCount + count <= maximum else {
                throw GitActivityReaderError.outputLimitExceeded
            }
            data.append(contentsOf: buffer.prefix(count))
        }
    }

    private static func stop(_ process: Process) {
        guard process.isRunning else { return }
        process.terminate()
        let deadline = ProcessInfo.processInfo.systemUptime + 0.2
        while process.isRunning && ProcessInfo.processInfo.systemUptime < deadline {
            Thread.sleep(forTimeInterval: 0.005)
        }
        if process.isRunning { _ = kill(process.processIdentifier, SIGKILL) }
        let killDeadline = ProcessInfo.processInfo.systemUptime + 1
        while process.isRunning && ProcessInfo.processInfo.systemUptime < killDeadline {
            Thread.sleep(forTimeInterval: 0.005)
        }
        if !process.isRunning { process.waitUntilExit() }
    }
}
