#if os(macOS)
import AppKit
import CoreGraphics
import Foundation
import Metal
import RealityKit
import UserNotifications

/// Explicit CI-only launch mode. It exercises the real windows and renderer while
/// replacing persistence, notifications and service access with isolated boundaries.
/// No screen recording, Accessibility, automation, or permission APIs are used.
@MainActor
final class CompanionSmokeRunner {
    private let directory: URL
    private let suiteName: String
    private let preferences: UserDefaults
    private let notificationCenter = SmokeNotificationCenter()
    private let completion: SmokeCompletion
    private weak var coordinator: CompanionCoordinator?
    private var serviceAttempts = 0
    private var snapshotCompleted = false
    private var snapshotImage: NSImage?
    private var report: [String: Any]

    static func prepare(arguments: [String]) throws -> CompanionSmokeRunner? {
        let indexes = arguments.indices.filter { arguments[$0] == "--ui-smoke-output" }
        guard !indexes.isEmpty else { return nil }
        guard indexes.count == 1, let index = indexes.first, index + 1 < arguments.count else {
            throw SmokeFailure("Supply exactly one --ui-smoke-output followed by a fresh absolute directory.")
        }
        guard ProcessInfo.processInfo.environment["GITHUB_ACTIONS"] == "true" else {
            throw SmokeFailure("Native smoke mode is restricted to the disposable GitHub Actions runner.")
        }
        let path = arguments[index + 1]
        guard path.hasPrefix("/"), !path.contains("\0"), path != "/" else {
            throw SmokeFailure("The smoke output directory must be an absolute local path.")
        }
        let directory = URL(fileURLWithPath: path, isDirectory: true).standardizedFileURL
        let manager = FileManager.default
        if manager.fileExists(atPath: directory.path) {
            let attributes = try manager.attributesOfItem(atPath: directory.path)
            guard attributes[.type] as? FileAttributeType == .typeDirectory,
                  try manager.contentsOfDirectory(atPath: directory.path).isEmpty else {
                throw SmokeFailure("Refusing to read or replace a nonempty or symlinked smoke output directory.")
            }
            try manager.setAttributes([.posixPermissions: 0o700], ofItemAtPath: directory.path)
        } else {
            try manager.createDirectory(at: directory, withIntermediateDirectories: false,
                                        attributes: [.posixPermissions: 0o700])
        }
        let suiteName = "org.hackathon-crew.inkpaw.smoke." + UUID().uuidString
        guard let preferences = UserDefaults(suiteName: suiteName) else {
            throw SmokeFailure("Could not create the isolated smoke preferences suite.")
        }
        return try CompanionSmokeRunner(directory: directory, suiteName: suiteName, preferences: preferences)
    }

    private init(directory: URL, suiteName: String, preferences: UserDefaults) throws {
        self.directory = directory
        self.suiteName = suiteName
        self.preferences = preferences
        // Override any global preference with an empty destination in this fresh suite.
        preferences.set("", forKey: "InkpawCompanion.serviceAddress")
        report = [
            "schemaVersion": 1, "status": "running", "phase": "prepared",
            "pid": ProcessInfo.processInfo.processIdentifier,
            "bundleIdentifier": Bundle.main.bundleIdentifier ?? "",
            "captureMethods": ["workspace": "NSView.cacheDisplay", "octopus": "ARView.snapshot"],
            "screenCaptureAttempted": false, "permissionChangesAttempted": false,
            "syntheticStateOnly": true, "survivalSeconds": 3,
            "files": [String](), "checks": [String: Bool]()
        ]
        completion = try SmokeCompletion(directory: directory, initialReport: report)
        completion.startWatchdog(seconds: 55)
    }

    func makeStore() -> CompanionStore {
        CompanionStore(stateURL: directory.appendingPathComponent("state.json"),
                       notificationScheduler: NotificationScheduler(center: notificationCenter),
                       preferences: preferences, clientFactory: { [weak self] _ in
            self?.serviceAttempts += 1
            throw SmokeFailure("Network and model clients are prohibited in native smoke mode.")
        })
    }

    func start(coordinator: CompanionCoordinator) {
        self.coordinator = coordinator
        Task { @MainActor in
            do { try await run(coordinator: coordinator) }
            catch let problem as SmokeUnsupported { finish(status: "unsupported", reason: problem.message, code: 77) }
            catch { finish(status: "failed", reason: error.localizedDescription, code: 1) }
        }
    }

    func interrupted() -> Never {
        finish(status: "failed", reason: "The smoke application was asked to terminate before completion.", code: 1)
    }

    static func failSetup(_ error: Error) -> Never {
        fputs("Inkpaw native smoke setup failed: \(error.localizedDescription)\n", stderr)
        exit(64)
    }

    private func run(coordinator: CompanionCoordinator) async throws {
        guard Bundle.main.bundleURL.pathExtension == "app",
              Bundle.main.bundleIdentifier == "org.hackathon-crew.inkpaw.companion" else {
            throw SmokeFailure("Launch the packaged InkpawCompanion.app executable, not the raw SwiftPM binary.")
        }
        report["phase"] = "capability-check"
        try checkpoint()
        guard !NSScreen.screens.isEmpty,
              CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) != nil else {
            throw SmokeUnsupported("No usable GUI security session or display is available on this runner.")
        }
        guard let device = MTLCreateSystemDefaultDevice() else {
            report["metalAvailable"] = false
            throw SmokeUnsupported("No Metal device is available; the real RealityKit renderer was not replaced or bypassed.")
        }
        report["metalAvailable"] = true
        report["metalDevice"] = device.name
        coordinator.start()
        coordinator.showWorkspace()
        report["phase"] = "waiting-for-windows"
        try checkpoint()
        let readyDeadline = ProcessInfo.processInfo.systemUptime + 15
        while ProcessInfo.processInfo.systemUptime < readyDeadline {
            if coordinator.store.isLoaded,
               let pet = coordinator.smokePetWindow, let workspace = coordinator.smokeWorkspaceWindow,
               pet.isVisible, workspace.isVisible,
               let petContent = pet.contentView, let workspaceContent = workspace.contentView,
               petContent.bounds.width > 0, workspaceContent.bounds.width > 0 {
                break
            }
            try await Task.sleep(nanoseconds: 100_000_000)
        }
        guard coordinator.store.isLoaded,
              let pet = coordinator.smokePetWindow, let workspace = coordinator.smokeWorkspaceWindow,
              pet.isVisible, workspace.isVisible,
              let petContent = pet.contentView, let workspaceContent = workspace.contentView else {
            throw SmokeFailure("The real pet and workspace windows did not become ready within 15 seconds.")
        }
        petContent.layoutSubtreeIfNeeded()
        workspaceContent.layoutSubtreeIfNeeded()
        pet.displayIfNeeded()
        workspace.displayIfNeeded()
        // Keep the actual run loop and renderer alive; a successful launch is not enough.
        try await Task.sleep(nanoseconds: 3_000_000_000)
        try require(coordinator.store.errorMessage == nil, "The app reported an error during empty-state startup.")
        try require(pet.isVisible && workspace.isVisible, "A window disappeared during the survival interval.")
        let state = coordinator.store.state
        try require(state.schedules.isEmpty && state.checklists.isEmpty && state.documents.isEmpty &&
                    state.repositories.isEmpty && !state.reminderPreferences.isEnabled && !state.isCollapsed &&
                    coordinator.store.serviceAddress.isEmpty, "The smoke app did not retain isolated empty state.")
        setCheck("emptyState", true)
        setCheck("processAndWindowsSurvived", true)

        report["phase"] = "geometry"
        report["windows"] = [windowDescription(pet, role: "pet"), windowDescription(workspace, role: "workspace")]
        let serverWindows = try ownWindowDescriptions()
        try writeJSON(serverWindows, filename: "windows.json")
        addFile("windows.json")
        guard let workspaceScreen = workspace.screen else {
            throw SmokeUnsupported("The visible workspace has no associated screen.")
        }
        // AppKit may fit a newly opened titled window to the visible screen. Derive
        // the content budget from that screen and the window's real decorations,
        // never from its observed content bounds (which are the value under test).
        let requestedWorkspaceSize = NSSize(width: 900, height: 680)
        let availableWorkspaceSize = workspace.contentRect(forFrameRect: workspaceScreen.visibleFrame).size
        let expectedWorkspaceSize = NSSize(width: min(requestedWorkspaceSize.width, availableWorkspaceSize.width),
                                           height: min(requestedWorkspaceSize.height, availableWorkspaceSize.height))
        let workspaceSizing: [String: Any] = [
            "requestedContentSize": ["width": Double(requestedWorkspaceSize.width), "height": Double(requestedWorkspaceSize.height)],
            "screenContentBudget": ["width": Double(availableWorkspaceSize.width), "height": Double(availableWorkspaceSize.height)],
            "effectiveExpectedContentSize": ["width": Double(expectedWorkspaceSize.width), "height": Double(expectedWorkspaceSize.height)],
            "minimumUsableContentSize": ["width": 780, "height": 560],
            "rule": "min(requested content size, contentRect(forFrameRect: screen.visibleFrame).size)"
        ]
        report["workspaceSizing"] = workspaceSizing
        try checkpoint()
        try require(matches(petContent.bounds.size, width: 380, height: 260), "Expanded pet content is not 380 by 260 points.")
        guard expectedWorkspaceSize.width >= 780, expectedWorkspaceSize.height >= 560 else {
            throw SmokeUnsupported("The runner display cannot fit the minimum usable workspace content of 780 by 560 points.")
        }
        try require(matches(workspaceContent.bounds.size, width: expectedWorkspaceSize.width, height: expectedWorkspaceSize.height),
                    "Workspace content does not match the requested size bounded by the screen's content budget.")
        try require(workspaceContent.bounds.width >= 780, workspaceContent.bounds.height >= 560,
                    "Workspace content is smaller than the minimum usable 780 by 560 points.")
        setCheck("expandedPetSize", true)
        setCheck("workspaceContentSize", true)
        setCheck("workspaceMinimumUsableSize", true)
        var unsupportedContainment: [String] = []
        for window in [pet, workspace] {
            guard let screen = window.screen else { throw SmokeUnsupported("A visible window has no associated screen.") }
            if screen.visibleFrame.width >= window.frame.width, screen.visibleFrame.height >= window.frame.height {
                try require(screen.visibleFrame.insetBy(dx: -1, dy: -1).contains(window.frame),
                            "An actual app window extends outside the screen's visible frame.")
            } else {
                let role = window === pet ? "expanded pet" : "workspace"
                unsupportedContainment.append("The runner display is too small for complete \(role) containment.")
            }
            guard let server = serverWindows.first(where: { ($0["windowID"] as? Int) == window.windowNumber }),
                  let bounds = server["bounds"] as? [String: Double],
                  let width = bounds["Width"], let height = bounds["Height"] else {
                throw SmokeFailure("A real visible app window is missing from the PID-filtered window-server list.")
            }
            try require(abs(width - window.frame.width) <= 1 && abs(height - window.frame.height) <= 1,
                        "AppKit and the window server disagree about an app window's dimensions.")
        }
        report["unsupportedChecks"] = unsupportedContainment
        setCheck("screenContainment", unsupportedContainment.isEmpty)
        setCheck("windowServerGeometry", true)

        report["phase"] = "workspace-pixels"
        try checkpoint()
        workspaceContent.layoutSubtreeIfNeeded()
        guard let workspaceBitmap = workspaceContent.bitmapImageRepForCachingDisplay(in: workspaceContent.bounds) else {
            throw SmokeUnsupported("AppKit could not allocate a bitmap for the actual workspace content.")
        }
        workspaceContent.cacheDisplay(in: workspaceContent.bounds, to: workspaceBitmap)
        report["workspacePixels"] = try saveBitmap(workspaceBitmap, filename: "workspace-content.png")
        setCheck("workspacePixelExport", true)

        report["phase"] = "realitykit-pixels"
        try checkpoint()
        guard let arView = findARView(in: petContent), arView.window === pet,
              arView.bounds.width > 0, arView.bounds.height > 0 else {
            throw SmokeFailure("The visible pet does not contain a laid-out native ARView.")
        }
        report["octopusViewBounds"] = rectDescription(arView.bounds)
        snapshotCompleted = false
        snapshotImage = nil
        arView.snapshot(saveToHDR: false) { [weak self] image in
            Task { @MainActor [weak self] in
                self?.snapshotImage = image
                self?.snapshotCompleted = true
            }
        }
        let snapshotDeadline = ProcessInfo.processInfo.systemUptime + 10
        while !snapshotCompleted && ProcessInfo.processInfo.systemUptime < snapshotDeadline {
            try await Task.sleep(nanoseconds: 100_000_000)
        }
        guard snapshotCompleted else { throw SmokeUnsupported("The real ARView snapshot callback timed out after 10 seconds.") }
        guard let image = snapshotImage, let tiff = image.tiffRepresentation,
              let bitmap = NSBitmapImageRep(data: tiff) else {
            throw SmokeUnsupported("RealityKit returned no usable native scene image on this runner.")
        }
        report["octopusPixels"] = try saveBitmap(bitmap, filename: "native-octopus.png")
        setCheck("realityKitPixelExport", true)

        // Exercise the real published-state resize path, without synthesizing input
        // or creating a second window. The synthetic state is safe to leave collapsed.
        report["phase"] = "collapsed-geometry"
        try checkpoint()
        coordinator.store.setCollapsed(true)
        let collapseDeadline = ProcessInfo.processInfo.systemUptime + 5
        while ProcessInfo.processInfo.systemUptime < collapseDeadline {
            if let content = pet.contentView, matches(content.bounds.size, width: 156, height: 176),
               let entry = try ownWindowDescriptions().first(where: { ($0["windowID"] as? Int) == pet.windowNumber }),
               let bounds = entry["bounds"] as? [String: Double],
               let width = bounds["Width"], let height = bounds["Height"],
               abs(width - 156) <= 1, abs(height - 176) <= 1 { break }
            try await Task.sleep(nanoseconds: 100_000_000)
        }
        guard let collapsedContent = pet.contentView else { throw SmokeFailure("The pet lost its content after collapse.") }
        collapsedContent.layoutSubtreeIfNeeded()
        report["collapsedWindow"] = windowDescription(pet, role: "collapsedPet")
        let collapsedServerWindows = try ownWindowDescriptions()
        report["collapsedWindowServer"] = collapsedServerWindows
        try require(coordinator.store.state.isCollapsed && coordinator.smokePetWindow === pet && pet.isVisible &&
                    matches(collapsedContent.bounds.size, width: 156, height: 176),
                    "The real pet did not collapse to 156 by 176 points while retaining its visible window.")
        guard let collapsedScreen = pet.screen else { throw SmokeUnsupported("The collapsed pet has no associated screen.") }
        let collapsedCanFit = collapsedScreen.visibleFrame.width >= pet.frame.width && collapsedScreen.visibleFrame.height >= pet.frame.height
        if collapsedCanFit {
            try require(collapsedScreen.visibleFrame.insetBy(dx: -1, dy: -1).contains(pet.frame),
                        "The collapsed pet extends outside its screen's visible frame.")
        } else {
            unsupportedContainment.append("The runner display is too small for complete collapsed pet containment.")
        }
        guard let collapsedServer = collapsedServerWindows.first(where: { ($0["windowID"] as? Int) == pet.windowNumber }),
              let collapsedBounds = collapsedServer["bounds"] as? [String: Double],
              let collapsedWidth = collapsedBounds["Width"], let collapsedHeight = collapsedBounds["Height"] else {
            throw SmokeFailure("The collapsed pet is missing from the PID-filtered window-server list.")
        }
        try require(abs(collapsedWidth - 156) <= 1 && abs(collapsedHeight - 176) <= 1,
                    "The window server did not confirm the actual collapsed pet size.")
        setCheck("collapsedPetSizeAndContainment", collapsedCanFit)

        try require(serviceAttempts == 0 && notificationCenter.prohibitedAttempts == 0,
                    "The smoke app attempted a prohibited service or notification operation.")
        setCheck("noExternalServicesOrNotificationRequests", true)
        report["phase"] = "complete"
        report["visualReview"] = "Native pixel exports are nonblank; appearance still requires inspection of the PNG files."
        if !unsupportedContainment.isEmpty {
            report["unsupportedChecks"] = unsupportedContainment
            finish(status: "unsupported", reason: unsupportedContainment.joined(separator: " "), code: 77)
        }
        finish(status: "passed", reason: "Real app windows, native geometry and separate native pixel exports passed the smoke checks.", code: 0)
    }

    private func findARView(in view: NSView) -> ARView? {
        if let arView = view as? ARView { return arView }
        for child in view.subviews { if let result = findARView(in: child) { return result } }
        return nil
    }

    private func windowDescription(_ window: NSWindow, role: String) -> [String: Any] {
        var value: [String: Any] = ["role": role, "windowID": window.windowNumber, "visible": window.isVisible,
                                    "frame": rectDescription(window.frame), "backingScale": window.backingScaleFactor,
                                    "coordinateSystem": "AppKit screen points, bottom-left origin"]
        if let content = window.contentView { value["contentBounds"] = rectDescription(content.bounds) }
        if let screen = window.screen {
            value["screenFrame"] = rectDescription(screen.frame)
            value["screenVisibleFrame"] = rectDescription(screen.visibleFrame)
        }
        return value
    }

    private func ownWindowDescriptions() throws -> [[String: Any]] {
        guard let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] else {
            throw SmokeUnsupported("The window server did not return window metadata for this GUI session.")
        }
        let pid = ProcessInfo.processInfo.processIdentifier
        return windows.filter { ($0[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value == pid }.map { window in
            var value: [String: Any] = ["pid": pid, "coordinateSystem": "Core Graphics global screen points, top-left origin"]
            for (source, target) in [(kCGWindowNumber, "windowID"), (kCGWindowBounds, "bounds"),
                                     (kCGWindowLayer, "layer"), (kCGWindowAlpha, "alpha"), (kCGWindowIsOnscreen, "onScreen")] {
                if let item = window[source as String] { value[target] = item }
            }
            return value
        }
    }

    private func saveBitmap(_ bitmap: NSBitmapImageRep, filename: String) throws -> [String: Any] {
        guard bitmap.pixelsWide > 0, bitmap.pixelsHigh > 0,
              let png = bitmap.representation(using: .png, properties: [:]) else {
            throw SmokeUnsupported("Native image encoding failed for \(filename).")
        }
        // Preserve even a blank native export as diagnostic evidence, never as a pass.
        try png.write(to: directory.appendingPathComponent(filename), options: .withoutOverwriting)
        addFile(filename)
        var colors = Set<UInt32>()
        var visible = 0
        var sampled = 0
        for y in stride(from: 0, to: bitmap.pixelsHigh, by: max(1, bitmap.pixelsHigh / 64)) {
            for x in stride(from: 0, to: bitmap.pixelsWide, by: max(1, bitmap.pixelsWide / 64)) {
                guard let color = bitmap.colorAt(x: x, y: y)?.usingColorSpace(.deviceRGB) else { continue }
                sampled += 1
                guard color.alphaComponent > 0.05 else { continue }
                visible += 1
                func channel(_ value: CGFloat) -> UInt32 { UInt32(max(0, min(255, (value * 255).rounded()))) }
                colors.insert(channel(color.redComponent) << 16 | channel(color.greenComponent) << 8 | channel(color.blueComponent))
            }
        }
        let metrics: [String: Any] = ["widthPixels": bitmap.pixelsWide, "heightPixels": bitmap.pixelsHigh,
                                      "sampledPixels": sampled, "nonTransparentSamples": visible,
                                      "distinctSampledColors": colors.count, "file": filename]
        report[filename == "native-octopus.png" ? "octopusPixels" : "workspacePixels"] = metrics
        guard visible >= 8, colors.count >= 8 else {
            throw SmokeUnsupported("\(filename) contains insufficient nonblank native pixels; rendering was not verified.")
        }
        return metrics
    }

    private func rectDescription(_ rect: NSRect) -> [String: Double] {
        ["x": rect.minX, "y": rect.minY, "width": rect.width, "height": rect.height]
    }

    private func matches(_ size: NSSize, width: CGFloat, height: CGFloat) -> Bool {
        abs(size.width - width) <= 1 && abs(size.height - height) <= 1
    }

    private func require(_ condition: Bool, _ message: String) throws {
        if !condition { throw SmokeFailure(message) }
    }

    private func setCheck(_ name: String, _ passed: Bool) {
        var checks = report["checks"] as? [String: Bool] ?? [:]
        checks[name] = passed
        report["checks"] = checks
    }

    private func addFile(_ filename: String) {
        var files = report["files"] as? [String] ?? []
        if !files.contains(filename) { files.append(filename) }
        report["files"] = files
    }

    private func writeJSON(_ value: Any, filename: String) throws {
        let data = try JSONSerialization.data(withJSONObject: value, options: [.prettyPrinted, .sortedKeys])
        try data.write(to: directory.appendingPathComponent(filename), options: .withoutOverwriting)
    }

    private func checkpoint() throws { try completion.update(report) }

    private func finish(status: String, reason: String, code: Int32) -> Never {
        coordinator?.store.stop()
        preferences.removePersistentDomain(forName: suiteName)
        report["status"] = status
        report["reason"] = reason
        report["exitCode"] = code
        report["serviceAttempts"] = serviceAttempts
        report["notificationAttempts"] = notificationCenter.prohibitedAttempts
        completion.finish(report, code: code)
    }
}

private struct SmokeFailure: LocalizedError {
    let message: String
    init(_ message: String) { self.message = message }
    var errorDescription: String? { message }
}

private struct SmokeUnsupported: LocalizedError {
    let message: String
    init(_ message: String) { self.message = message }
    var errorDescription: String? { message }
}

@MainActor
private final class SmokeNotificationCenter: InkpawNotificationCenter {
    private(set) var prohibitedAttempts = 0
    func authorizationStatus() async -> UNAuthorizationStatus { .denied }
    func pendingRequests() async -> [UNNotificationRequest] { [] }
    func deliveredRequestIDs() async -> [String] { [] }
    func requestAuthorization() async throws -> Bool {
        prohibitedAttempts += 1
        throw SmokeFailure("Notification permission requests are prohibited in native smoke mode.")
    }
    func add(_ request: UNNotificationRequest) async throws {
        prohibitedAttempts += 1
        throw SmokeFailure("Notification scheduling is prohibited in native smoke mode.")
    }
    func removePending(identifiers: [String]) { if !identifiers.isEmpty { prohibitedAttempts += 1 } }
}

/// The independent watchdog still writes a terminal report if the main run loop hangs.
/// Only this class touches smoke.json; its lock prevents timeout/final-report races.
private final class SmokeCompletion: @unchecked Sendable {
    private let lock = NSLock()
    private let reportURL: URL
    private var latest: [String: Any]
    private var finished = false

    init(directory: URL, initialReport: [String: Any]) throws {
        reportURL = directory.appendingPathComponent("smoke.json")
        latest = initialReport
        let data = try JSONSerialization.data(withJSONObject: initialReport, options: [.prettyPrinted, .sortedKeys])
        try data.write(to: reportURL, options: .withoutOverwriting)
    }

    func startWatchdog(seconds: Double) {
        DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + seconds) { [self] in
            lock.lock()
            guard !finished else { lock.unlock(); return }
            finished = true
            var report = latest
            report["status"] = "failed"
            report["reason"] = "Native smoke exceeded its 55-second overall deadline."
            report["exitCode"] = 124
            writeTerminal(report, code: 124)
        }
    }

    func update(_ report: [String: Any]) throws {
        lock.lock()
        defer { lock.unlock() }
        guard !finished else { return }
        latest = report
        let data = try JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys])
        try data.write(to: reportURL, options: .atomic)
    }

    func finish(_ report: [String: Any], code: Int32) -> Never {
        lock.lock()
        if finished { lock.unlock(); exit(code == 0 ? 1 : code) }
        finished = true
        writeTerminal(report, code: code)
    }

    private func writeTerminal(_ report: [String: Any], code: Int32) -> Never {
        do {
            let data = try JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys])
            try data.write(to: reportURL, options: .atomic)
        } catch {
            fputs("Could not write terminal native smoke report: \(error.localizedDescription)\n", stderr)
            exit(74)
        }
        let status = report["status"] as? String ?? "failed"
        let reason = report["reason"] as? String ?? ""
        print("Inkpaw native smoke: \(status). \(reason)")
        fflush(stdout)
        exit(code)
    }
}
#endif
