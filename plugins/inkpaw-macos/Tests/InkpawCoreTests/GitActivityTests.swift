import Foundation
import XCTest
import InkpawCore
@testable import InkpawInfrastructure
#if canImport(Darwin)
import Darwin
#else
import Glibc
#endif

/// All repositories, commits, and reflog records below are disposable synthetic fixtures.
/// No user project, remote fetch, or actual push is used by these tests.
final class GitActivityTests: XCTestCase {
    func testUnbornRepositoryHasNoCommitsOrInventedPushes() async throws {
        let fixture = try GitFixture()
        defer { fixture.cleanUp() }
        let snapshot = try await GitActivityReader().snapshot(for: fixture.reference)
        XCTAssertEqual(snapshot.workingTree.branchName, "main")
        XCTAssertNil(snapshot.workingTree.headObjectID)
        XCTAssertFalse(snapshot.workingTree.isDetachedHead)
        XCTAssertTrue(snapshot.commits.isEmpty)
        XCTAssertNil(snapshot.upstream)
        XCTAssertTrue(snapshot.evidencedLocalPushes.isEmpty)
    }

    func testCommitsAndNulDelimitedStatusHandleSpacesAndNewlinesWithoutMutatingIndex() async throws {
        let fixture = try GitFixture()
        defer { fixture.cleanUp() }
        try fixture.commit(subject: "first line\nsecond line\n\nA synthetic body.")
        try Data("changed".utf8).write(to: fixture.root.appendingPathComponent("tracked.txt"))
        try Data("new".utf8).write(to: fixture.root.appendingPathComponent("untracked file\nwith newline.txt"))
        let indexURL = fixture.root.appendingPathComponent(".git/index")
        let indexBefore = try Data(contentsOf: indexURL)
        let snapshot = try await GitActivityReader().snapshot(for: fixture.reference)
        XCTAssertEqual(snapshot.commits.count, 1)
        XCTAssertEqual(snapshot.commits[0].subject, "first line second line")
        XCTAssertEqual(snapshot.workingTree.trackedChangeCount, 1)
        XCTAssertEqual(snapshot.workingTree.untrackedFileCount, 1)
        XCTAssertEqual(snapshot.workingTree.headObjectID, snapshot.commits[0].objectID)
        XCTAssertEqual(try Data(contentsOf: indexURL), indexBefore)
        XCTAssertFalse(FileManager.default.fileExists(atPath: fixture.root.appendingPathComponent(".git/index.lock").path))
    }

    func testDetachedHeadAndLinkedWorktreeAreSupported() async throws {
        let fixture = try GitFixture()
        defer { fixture.cleanUp() }
        try fixture.commit()
        let worktree = fixture.container.appendingPathComponent("linked worktree")
        try fixture.git(["worktree", "add", "--detach", worktree.path, "HEAD"])
        let reference = GitRepositoryReference(id: "linked", name: "Linked fixture", directoryURL: worktree)
        let snapshot = try await GitActivityReader().snapshot(for: reference)
        XCTAssertTrue(snapshot.workingTree.isDetachedHead)
        XCTAssertNil(snapshot.workingTree.branchName)
        XCTAssertNotNil(snapshot.workingTree.headObjectID)
        XCTAssertNil(snapshot.upstream)
        XCTAssertEqual(snapshot.commits.count, 1)
    }

    func testNonRepositoryAndNestedSelectionAreExplicitErrors() async throws {
        let fixture = try GitFixture()
        defer { fixture.cleanUp() }
        await assertError(.notRepository) {
            _ = try await GitActivityReader().snapshot(for: .init(id: "outer", name: "Outer", directoryURL: fixture.container))
        }
        let nested = fixture.root.appendingPathComponent("child")
        try FileManager.default.createDirectory(at: nested, withIntermediateDirectories: true)
        await assertError(.selectionMustBeRepositoryRoot) {
            _ = try await GitActivityReader().snapshot(for: .init(id: "nested", name: "Nested", directoryURL: nested))
        }
        await assertError(.invalidDirectory) {
            _ = try await GitActivityReader().snapshot(for: .init(id: "remote", name: "Remote", directoryURL: URL(string: "https://example.com/repository")!))
        }
    }

    func testUpstreamAheadBehindUsesStaleLocalRefsAndNeverFetches() async throws {
        let fixture = try GitFixture()
        defer { fixture.cleanUp() }
        try fixture.commit()
        try fixture.git(["remote", "add", "origin", fixture.container.appendingPathComponent("does-not-exist.git").path])
        try fixture.git(["update-ref", "refs/remotes/origin/feature/nested", "HEAD"])
        try fixture.git(["branch", "--set-upstream-to=origin/feature/nested", "main"])
        try fixture.commit(subject: "second commit")
        let snapshot = try await GitActivityReader().snapshot(for: fixture.reference)
        XCTAssertEqual(snapshot.upstream?.remoteName, "origin")
        XCTAssertEqual(snapshot.upstream?.branchName, "feature/nested")
        XCTAssertEqual(snapshot.upstream?.aheadCount, 1)
        XCTAssertEqual(snapshot.upstream?.behindCount, 0)
        XCTAssertNil(snapshot.upstream?.lastFetchAt)
        XCTAssertEqual(snapshot.upstream?.caveat, .localTrackingRefsMayBeStale)
        XCTAssertTrue(snapshot.evidencedLocalPushes.isEmpty)
    }

    func testPushHistoryRequiresExactRemoteTrackingReflogEvidenceNotCommitTime() async throws {
        let fixture = try GitFixture()
        defer { fixture.cleanUp() }
        try fixture.commit(subject: "update by push", timestamp: "2001-01-01T00:00:00+0000")
        try fixture.git(["remote", "add", "origin", fixture.container.appendingPathComponent("synthetic-remote.git").path])
        try fixture.git(["update-ref", "--create-reflog", "-m", "update by push", "refs/remotes/origin/main", "HEAD"])
        try fixture.git(["update-ref", "--create-reflog", "-m", "fetch origin: fast-forward", "refs/remotes/origin/fetched", "HEAD"])
        try fixture.git(["update-ref", "--create-reflog", "-m", "not update by push", "refs/remotes/origin/not-push", "HEAD"])
        try fixture.git(["update-ref", "--create-reflog", "-m", "update by push", "refs/heads/local-only", "HEAD"])
        let snapshot = try await GitActivityReader().snapshot(for: fixture.reference)
        XCTAssertEqual(snapshot.evidencedLocalPushes.count, 1)
        let push = try XCTUnwrap(snapshot.evidencedLocalPushes.first)
        XCTAssertEqual(push.remoteName, "origin")
        XCTAssertEqual(push.destinationRef, "refs/heads/main")
        XCTAssertEqual(push.evidence.kind, .remoteTrackingReflogPushEntry)
        XCTAssertTrue(push.evidence.recordID.hasPrefix("refs/remotes/origin/main@{"))
        XCTAssertGreaterThan(try XCTUnwrap(push.occurredAt).timeIntervalSince(snapshot.commits[0].committedAt), 1_000_000)
        let again = try await GitActivityReader().snapshot(for: fixture.reference)
        XCTAssertEqual(push.id, again.evidencedLocalPushes.first?.id)
    }

    func testSlashContainingRemoteAndNestedBranchResolveFromActualRefspec() async throws {
        let fixture = try GitFixture()
        defer { fixture.cleanUp() }
        try fixture.commit()
        try fixture.git(["remote", "add", "team/origin", fixture.container.appendingPathComponent("synthetic-remote.git").path])
        try fixture.git(["update-ref", "--create-reflog", "-m", "update by push", "refs/remotes/team/origin/feature/nested", "HEAD"])
        try fixture.git(["branch", "--set-upstream-to=team/origin/feature/nested", "main"])
        let snapshot = try await GitActivityReader().snapshot(for: fixture.reference)
        XCTAssertEqual(snapshot.upstream?.remoteName, "team/origin")
        XCTAssertEqual(snapshot.upstream?.branchName, "feature/nested")
        XCTAssertEqual(snapshot.evidencedLocalPushes.first?.remoteName, "team/origin")
        XCTAssertEqual(snapshot.evidencedLocalPushes.first?.destinationRef, "refs/heads/feature/nested")
    }

    func testCustomFetchMappingResolvesDestinationWithoutGuessingNamespace() async throws {
        let fixture = try GitFixture()
        defer { fixture.cleanUp() }
        try fixture.commit()
        try fixture.git(["remote", "add", "actual-remote", fixture.container.appendingPathComponent("synthetic-remote.git").path])
        try fixture.git(["config", "remote.actual-remote.fetch", "+refs/heads/release/*:refs/remotes/cache/*"])
        try fixture.git(["update-ref", "--create-reflog", "-m", "update by push", "refs/remotes/cache/2026", "HEAD"])
        let snapshot = try await GitActivityReader().snapshot(for: fixture.reference)
        XCTAssertEqual(snapshot.evidencedLocalPushes.first?.remoteName, "actual-remote")
        XCTAssertEqual(snapshot.evidencedLocalPushes.first?.destinationRef, "refs/heads/release/2026")
    }

    func testAmbiguousAndUnconfiguredRemoteTrackingRefsDoNotInventDestinations() async throws {
        let fixture = try GitFixture()
        defer { fixture.cleanUp() }
        try fixture.commit()
        try fixture.git(["config", "remote.first.fetch", "+refs/heads/*:refs/remotes/shared/*"])
        try fixture.git(["config", "remote.second.fetch", "+refs/heads/*:refs/remotes/shared/*"])
        try fixture.git(["update-ref", "--create-reflog", "-m", "update by push", "refs/remotes/shared/main", "HEAD"])
        try fixture.git(["update-ref", "--create-reflog", "-m", "update by push", "refs/remotes/unconfigured/main", "HEAD"])
        let snapshot = try await GitActivityReader().snapshot(for: fixture.reference)
        XCTAssertTrue(snapshot.evidencedLocalPushes.isEmpty)
    }

    func testCommitHistoryLimitAndNoUpstreamDoNotBecomeErrors() async throws {
        let fixture = try GitFixture()
        defer { fixture.cleanUp() }
        try fixture.commit(subject: "first")
        try fixture.commit(subject: "second")
        try fixture.commit(subject: "third")
        let snapshot = try await GitActivityReader(configuration: .init(maximumCommits: 2)).snapshot(for: fixture.reference)
        XCTAssertEqual(snapshot.commits.map(\.subject), ["third", "second"])
        XCTAssertNil(snapshot.upstream)
        XCTAssertTrue(snapshot.evidencedLocalPushes.isEmpty)
    }

    func testConfiguredFsmonitorIsNotExecuted() async throws {
        let fixture = try GitFixture()
        defer { fixture.cleanUp() }
        try fixture.commit()
        let marker = fixture.container.appendingPathComponent("fsmonitor-ran")
        let hook = try fixture.script("touch '\(marker.path)'\nexit 0")
        try fixture.git(["config", "core.fsmonitor", hook.path])
        _ = try await GitActivityReader().snapshot(for: fixture.reference)
        XCTAssertFalse(FileManager.default.fileExists(atPath: marker.path))
    }

    func testTimestampDirtyCleanFilterIsRejectedBeforeItCanExecute() async throws {
        let fixture = try GitFixture()
        defer { fixture.cleanUp() }
        let marker = fixture.container.appendingPathComponent("clean-filter-ran")
        try fixture.git(["config", "filter.review.clean", "touch '\(marker.path)'; cat"])
        try Data("*.txt filter=review\n".utf8).write(to: fixture.root.appendingPathComponent(".gitattributes"))
        try fixture.git(["add", "--", ".gitattributes"])
        try fixture.commit()
        try FileManager.default.removeItem(at: marker)
        // Preserve size/content but change mtime so Git must rehash through the filter.
        try FileManager.default.setAttributes([.modificationDate: Date().addingTimeInterval(5)], ofItemAtPath: fixture.root.appendingPathComponent("tracked.txt").path)
        await assertError(.unsupportedFilters) {
            _ = try await GitActivityReader().snapshot(for: fixture.reference)
        }
        XCTAssertFalse(FileManager.default.fileExists(atPath: marker.path))
        // Trusted fixture-only positive control proves an unguarded status triggers it.
        try fixture.git(["status", "--porcelain=v2", "--ignore-submodules=all"])
        XCTAssertTrue(FileManager.default.fileExists(atPath: marker.path))
    }

    func testEveryExecutableFilterCategoryAndWorktreeConfigurationIsRejected() async throws {
        for key in ["clean", "smudge", "process", "required"] {
            let fixture = try GitFixture()
            defer { fixture.cleanUp() }
            try fixture.git(["config", "filter.review.\(key)", key == "required" ? "false" : "untrusted-command"])
            await assertError(.unsupportedFilters) {
                _ = try await GitActivityReader().snapshot(for: fixture.reference)
            }
        }
        let fixture = try GitFixture()
        defer { fixture.cleanUp() }
        try fixture.git(["config", "extensions.worktreeConfig", "true"])
        try fixture.git(["config", "--worktree", "filter.worktree.process", "untrusted-command"])
        await assertError(.unsupportedFilters) {
            _ = try await GitActivityReader().snapshot(for: fixture.reference)
        }
    }

    func testIncludesAndConditionalIncludesAreRejectedWithoutOpeningTargets() async throws {
        for key in ["include.path", "includeIf.gitdir:*/.path"] {
            let fixture = try GitFixture()
            defer { fixture.cleanUp() }
            let included = fixture.container.appendingPathComponent("included-config")
            // Invalid syntax would fail if Git followed the include. The name-only
            // preflight must instead return our explicit include safety error.
            try Data("[invalid syntax\n".utf8).write(to: included)
            try fixture.git(["config", key, included.path])
            await assertError(.unsupportedConfigurationIncludes) {
                _ = try await GitActivityReader().snapshot(for: fixture.reference)
            }
        }
    }

    func testPartialAndPromisorRepositoriesAreRejectedBeforeObjectReadsOrRemoteContact() async throws {
        for key in ["extensions.partialClone", "remote.origin.promisor", "remote.origin.partialCloneFilter"] {
            let fixture = try GitFixture()
            defer { fixture.cleanUp() }
            try fixture.commit()
            let objectID = try fixture.git(["rev-parse", "HEAD^{tree}"]).trimmingCharacters(in: .whitespacesAndNewlines)
            let missingTree = fixture.root.appendingPathComponent(".git/objects/\(objectID.prefix(2))/\(objectID.dropFirst(2))")
            try FileManager.default.removeItem(at: missingTree)
            let marker = fixture.container.appendingPathComponent("remote-contacted")
            let helper = try fixture.script("touch '\(marker.path)'\nexit 1")
            try fixture.git(["config", "remote.origin.url", "ext::\(helper.path)"])
            try fixture.git(["config", "protocol.ext.allow", "always"])
            try fixture.git(["config", key, key.hasSuffix("promisor") ? "true" : key.hasSuffix("partialCloneFilter") ? "blob:none" : "origin"])
            let objectDirectory = fixture.root.appendingPathComponent(".git/objects")
            let before = try FileManager.default.subpathsOfDirectory(atPath: objectDirectory.path).sorted()
            let trace = fixture.container.appendingPathComponent("preflight-arguments.txt")
            let executable = try fixture.script("printf '%s\\n' \"$@\" >> '\(trace.path)'\nexec /usr/bin/git \"$@\"")
            await assertError(.unsupportedPartialClone) {
                _ = try await GitActivityReader(executableURL: executable).snapshot(for: fixture.reference)
            }
            XCTAssertFalse(FileManager.default.fileExists(atPath: marker.path))
            XCTAssertEqual(try FileManager.default.subpathsOfDirectory(atPath: objectDirectory.path).sorted(), before)
            let arguments = try String(contentsOf: trace, encoding: .utf8).split(separator: "\n")
            XCTAssertTrue(arguments.contains("config"))
            for forbidden in ["status", "log", "rev-parse", "rev-list", "reflog", "fetch"] {
                XCTAssertFalse(arguments.contains(Substring(forbidden)))
            }
        }
    }

    func testProductionCommandEnumContainsOnlyReadOnlyOperationsAndFixedOptions() async throws {
        let commands: [ReadCommand] = [.safetyConfiguration, .insideWorkTree, .prefix, .status, .upstreamName, .upstreamObject, .aheadBehind, .remoteTrackingRefs, .remoteFetchMappings, .log(limit: 20), .reflog(reference: "refs/remotes/origin/main", limit: 20)]
        XCTAssertEqual(Set(commands.map(\.name)), Set(["rev-parse", "status", "log", "rev-list", "reflog", "config"]))
        for command in commands {
            XCTAssertTrue(Set(["rev-parse", "status", "log", "rev-list", "reflog", "config"]).contains(command.arguments[0]))
        }
        XCTAssertEqual(ReadCommand.remoteFetchMappings.arguments, ["config", "--no-includes", "--null", "--get-regexp", "^remote\\..*\\.fetch$"])
        XCTAssertEqual(ReadCommand.safetyConfiguration.arguments, ["config", "--no-includes", "--null", "--name-only", "--get-regexp", "^(filter\\..*\\.(clean|smudge|process|required)|extensions\\.partialclone|remote\\..*\\.(promisor|partialclonefilter)|include\\.path|includeif\\..*\\.path)$"])
        let fixture = try GitFixture()
        defer { fixture.cleanUp() }
        let trace = fixture.container.appendingPathComponent("arguments.txt")
        let environment = fixture.container.appendingPathComponent("environment.txt")
        let executable = try fixture.script("printf '%s\\n' \"$@\" >> '\(trace.path)'\n/usr/bin/env > '\(environment.path)'\nexec /usr/bin/git \"$@\"")
        _ = try await GitActivityReader(executableURL: executable).snapshot(for: fixture.reference)
        let arguments = try String(contentsOf: trace, encoding: .utf8)
        XCTAssertTrue(arguments.hasPrefix("--no-optional-locks\n-c\ncore.fsmonitor=false\n--no-pager\n"))
        XCTAssertFalse(arguments.split(separator: "\n").contains("fetch"))
        XCTAssertFalse(arguments.split(separator: "\n").contains("push"))
        let env = try String(contentsOf: environment, encoding: .utf8)
        XCTAssertTrue(env.contains("GIT_CONFIG_GLOBAL=/dev/null"))
        XCTAssertTrue(env.contains("GIT_TERMINAL_PROMPT=0"))
        XCTAssertTrue(env.contains("GIT_NO_LAZY_FETCH=1"))
        XCTAssertTrue(env.split(separator: "\n").contains("GIT_ALLOW_PROTOCOL="))
        XCTAssertTrue(arguments.contains("core.hooksPath=/dev/null"))
        XCTAssertTrue(arguments.contains("protocol.allow=never"))
        XCTAssertFalse(env.contains("GIT_DIR="))
        XCTAssertFalse(env.contains("GIT_CONFIG_COUNT="))
    }

    func testTimeoutTerminatesChildWithoutBlockingCaller() async throws {
        let fixture = try GitFixture()
        defer { fixture.cleanUp() }
        let executable = try fixture.script("exec /bin/sleep 20")
        let reader = GitActivityReader(executableURL: executable, configuration: .init(commandTimeout: 0.1))
        let begin = ProcessInfo.processInfo.systemUptime
        await assertError(.timedOut) { _ = try await reader.snapshot(for: fixture.reference) }
        XCTAssertLessThan(ProcessInfo.processInfo.systemUptime - begin, 2)
    }

    func testCancellationTerminatesSpawnedProcess() async throws {
        let fixture = try GitFixture()
        defer { fixture.cleanUp() }
        let pidURL = fixture.container.appendingPathComponent("child.pid")
        let executable = try fixture.script("echo $$ > '\(pidURL.path)'\nexec /bin/sleep 20")
        let reader = GitActivityReader(executableURL: executable, configuration: .init(commandTimeout: 10))
        let task = Task { try await reader.snapshot(for: fixture.reference) }
        for _ in 0..<100 where !FileManager.default.fileExists(atPath: pidURL.path) {
            try await Task.sleep(nanoseconds: 5_000_000)
        }
        task.cancel()
        do { _ = try await task.value; XCTFail("Cancellation must propagate") }
        catch { XCTAssertTrue(error is CancellationError) }
        let pid = Int32(try String(contentsOf: pidURL, encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines))!
        XCTAssertEqual(kill(pid, 0), -1)
        XCTAssertEqual(errno, ESRCH)
    }

    func testSimultaneousStdoutStderrAreBoundedWithoutPipeDeadlock() async throws {
        let fixture = try GitFixture()
        defer { fixture.cleanUp() }
        let executable = try fixture.script("while :; do printf '01234567890123456789012345678901234567890123456789'; printf '01234567890123456789012345678901234567890123456789' >&2; done")
        let reader = GitActivityReader(executableURL: executable, configuration: .init(commandTimeout: 1, maximumOutputBytes: 1_024))
        let begin = ProcessInfo.processInfo.systemUptime
        await assertError(.outputLimitExceeded) { _ = try await reader.snapshot(for: fixture.reference) }
        XCTAssertLessThan(ProcessInfo.processInfo.systemUptime - begin, 2)
    }

    private func assertError(_ expected: GitActivityReaderError, operation: () async throws -> Void, file: StaticString = #filePath, line: UInt = #line) async {
        do { try await operation(); XCTFail("Expected \(expected)", file: file, line: line) }
        catch { XCTAssertEqual(error as? GitActivityReaderError, expected, file: file, line: line) }
    }
}

private struct GitFixture {
    let container: URL
    let root: URL
    var reference: GitRepositoryReference { .init(id: "fixture", name: "Synthetic repository", directoryURL: root) }

    init() throws {
        container = FileManager.default.temporaryDirectory.appendingPathComponent("inkpaw-git-tests-\(UUID().uuidString)")
        root = container.appendingPathComponent("selected repo")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        try git(["init", "--initial-branch=main"])
    }

    func cleanUp() { try? FileManager.default.removeItem(at: container) }

    @discardableResult
    func git(_ arguments: [String], timestamp: String? = nil) throws -> String {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/git")
        process.currentDirectoryURL = root
        process.arguments = ["-c", "user.name=Synthetic Fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null"] + arguments
        var environment = ["PATH": "/usr/bin:/bin", "GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": "/dev/null", "LANG": "C", "LC_ALL": "C"]
        if let timestamp { environment["GIT_AUTHOR_DATE"] = timestamp; environment["GIT_COMMITTER_DATE"] = timestamp }
        process.environment = environment
        let output = Pipe()
        process.standardOutput = output
        process.standardError = output
        try process.run()
        let data = output.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()
        let result = String(decoding: data, as: UTF8.self)
        guard process.terminationStatus == 0 else {
            throw NSError(domain: "SyntheticGitFixture", code: Int(process.terminationStatus), userInfo: [NSLocalizedDescriptionKey: result])
        }
        return result
    }

    func commit(subject: String = "synthetic commit", timestamp: String? = nil) throws {
        try Data(UUID().uuidString.utf8).write(to: root.appendingPathComponent("tracked.txt"))
        try git(["add", "--", "tracked.txt"])
        try git(["commit", "-m", subject], timestamp: timestamp)
    }

    func script(_ contents: String) throws -> URL {
        let url = container.appendingPathComponent("fixture-\(UUID().uuidString).sh")
        try Data(("#!/bin/sh\n" + contents + "\n").utf8).write(to: url)
        try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: url.path)
        return url
    }
}
