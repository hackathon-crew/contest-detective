#if os(macOS)
import AppKit
import CoreGraphics
import Foundation
import InkpawCore
import Metal
import RealityKit
import ScreenCaptureKit
import UserNotifications

/// Explicit CI-only launch mode. It exercises the real windows and renderer while
/// replacing persistence, notifications and service access with isolated boundaries.
/// Captures only this process's own windows, without Accessibility, automation,
/// desktop capture, or permission-request APIs.
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
            "operatingSystem": ProcessInfo.processInfo.operatingSystemVersionString,
            "bundleIdentifier": Bundle.main.bundleIdentifier ?? "",
            "captureMethods": ["workspace": "NSView.cacheDisplay", "octopus": "ARView.snapshot",
                               "widget": "ScreenCaptureKit.currentProcess exact own window"],
            "desktopCaptureAttempted": false, "otherProcessCaptureAttempted": false,
            "permissionChangesAttempted": false,
            "ownProcessWindowCaptureAttempted": false,
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
        try require(workspaceContent.bounds.width >= 780 && workspaceContent.bounds.height >= 560,
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
        let bitmap = try await captureSnapshot(from: arView)
        report["octopusPixels"] = try saveBitmap(bitmap, filename: "native-octopus.png")
        setCheck("realityKitPixelExport", true)
        guard let pixelRenderer = arView as? any InkpawPixelRenderingDiagnostics else {
            throw SmokeFailure("The actual ARView does not expose the native pixel renderer diagnostics.")
        }
        let firstDiagnostics = pixelRenderer.pixelRenderDiagnostics
        report["pixelRenderer"] = firstDiagnostics
        try verifyPixelGrid(bitmap, diagnostics: firstDiagnostics)
        setCheck("nearestPixelGrid", true)
        guard let span = firstDiagnostics["inferredVerticalSpan"] as? Double else {
            throw SmokeFailure("The renderer did not report its actual projection matrix span.")
        }
        try require(abs(span - Double(OctopusPoseModel.verticalSpan)) < 0.02,
                    "The real camera projection does not match the tested pose-model frustum.")
        setCheck("cameraProjectionMatchesFrustum", true)
        try checkpoint()

        // Two exports of the same live view verify that the pixel output is not a
        // frozen bitmap. Never recolor or rescale a snapshot to manufacture pixels.
        try await Task.sleep(nanoseconds: 1_200_000_000)
        let laterBitmap = try await captureSnapshot(from: arView)
        _ = try saveBitmap(laterBitmap, filename: "native-octopus-later.png")
        let laterDiagnostics = pixelRenderer.pixelRenderDiagnostics
        report["pixelRendererLater"] = laterDiagnostics
        try verifyPixelGrid(laterBitmap, diagnostics: laterDiagnostics)
        try require(bitmap.pixelsWide == laterBitmap.pixelsWide && bitmap.pixelsHigh == laterBitmap.pixelsHigh,
                    "The live renderer changed snapshot dimensions during motion verification.")
        let changedPixels = changedVisiblePixels(bitmap, laterBitmap)
        report["animatedPixelDifference"] = changedPixels
        if NSWorkspace.shared.accessibilityDisplayShouldReduceMotion {
            report["motionVerification"] = "System Reduce Motion is enabled; animated-pixel comparison is intentionally unsupported."
            report["skippedChecks"] = ["livePixelAnimation": "System Reduce Motion is enabled; continuing animation was not runtime-validated."]
            try require(changedPixels == 0, "The real companion animated despite the system Reduce Motion preference.")
            setCheck("reducedMotionStaticPose", true)
        } else {
            try require(changedPixels >= 4, "Two actual pixel-rendered scene frames did not demonstrate continuing animation.")
            setCheck("livePixelAnimation", true)
        }
        if let gridEvidence = report["pixelGridEvidence"] as? [String: Any],
           let shadowBottom = gridEvidence["shadowBottomPixels"] as? Int {
            let viewFrame = arView.convert(arView.bounds, to: petContent)
            let top = petContent.isFlipped ? viewFrame.minY : petContent.bounds.height - viewFrame.maxY
            let shadowGround = Double(top) + Double(shadowBottom + 1) * Double(arView.bounds.height) / Double(laterBitmap.pixelsHigh)
            let expectedGround = PetRailGeometry(width: Double(petContent.bounds.width), progressFraction: 0).groundY
            report["groundAlignment"] = ["actualShadowBottomY": shadowGround, "trackGroundY": expectedGround,
                                         "allowedAnimatedVariationPoints": 6]
            try require(abs(shadowGround - expectedGround) <= 6,
                        "The visible native shadow does not meet the shared track baseline within its animated tolerance.")
            setCheck("pixelShadowGroundAlignment", true)
        } else {
            throw SmokeFailure("The native shadow had no measured grounding evidence.")
        }

        report["phase"] = "whole-widget-pixels"
        try checkpoint()
        let widgetBitmap = try await captureOwnWindow(pet)
        _ = try saveBitmap(widgetBitmap, filename: "native-widget.png")
        setCheck("wholeNativeWidgetExport", true)
        try await captureTimelinePositions(coordinator: coordinator, pet: pet)

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
        let collapsedBitmap = try await captureOwnWindow(pet)
        _ = try saveBitmap(collapsedBitmap, filename: "native-widget-collapsed.png")
        setCheck("wholeCollapsedWidgetExport", true)

        try await exerciseWorkspace(coordinator: coordinator, window: workspace)

        try require(serviceAttempts == 0 && notificationCenter.prohibitedAttempts == 0,
                    "The smoke app attempted a prohibited service or notification operation.")
        setCheck("noExternalServicesOrNotificationRequests", true)
        report["phase"] = "complete"
        report["visualReview"] = "Native pixel exports are nonblank; appearance still requires inspection of the PNG files."
        if !unsupportedContainment.isEmpty {
            report["unsupportedChecks"] = unsupportedContainment
            finish(status: "unsupported", reason: unsupportedContainment.joined(separator: " "), code: 77)
        }
        finish(status: "passed", reason: "Applicable real-window, native geometry and pixel-export checks passed; inspect skippedChecks for explicitly unvalidated capabilities.", code: 0)
    }

    /// Dispatches only public accessibility methods on objects already owned by
    /// this process. No AXUIElement, event injection, or OS accessibility access.
    private func accessibleElements(in root: NSView) -> [any NSAccessibilityProtocol] {
        var queue: [Any] = [root]
        var seen = Set<ObjectIdentifier>()
        var result: [any NSAccessibilityProtocol] = []
        var index = 0
        while index < queue.count && index < 2_000 {
            let item = queue[index]
            index += 1
            let identity = ObjectIdentifier(item as AnyObject)
            guard seen.insert(identity).inserted else { continue }
            if let view = item as? NSView { queue.append(contentsOf: view.subviews) }
            if let element = item as? any NSAccessibilityProtocol {
                result.append(element)
                queue.append(contentsOf: element.accessibilityChildren() ?? [])
            }
        }
        return result
    }

    private func control(_ identifier: String, in root: NSView) throws -> any NSAccessibilityProtocol {
        let elements = accessibleElements(in: root)
        if let match = elements.first(where: { $0.accessibilityIdentifier() == identifier }) { return match }
        let evidence = elements.map { ["identifier": $0.accessibilityIdentifier() ?? "",
                                       "role": $0.accessibilityRole()?.rawValue ?? "",
                                       "label": $0.accessibilityLabel() ?? ""] }
        try writeJSON(evidence, filename: "workspace-accessibility-missing.json")
        addFile("workspace-accessibility-missing.json")
        throw SmokeFailure("The real workspace did not expose expected control \(identifier).")
    }

    private func press(_ identifier: String, in root: NSView) async throws {
        let element = try control(identifier, in: root)
        try require(element.isAccessibilityEnabled(), "Expected enabled control \(identifier) is disabled.")
        try require(element.accessibilityPerformPress(), "The real control did not accept press: \(identifier).")
        try await Task.sleep(nanoseconds: 300_000_000)
        root.layoutSubtreeIfNeeded()
    }

    private func exportWorkspace(_ window: NSWindow, filename: String) throws {
        guard let content = window.contentView else { throw SmokeFailure("A real workspace or sheet lost its content.") }
        content.layoutSubtreeIfNeeded()
        window.displayIfNeeded()
        guard let bitmap = content.bitmapImageRepForCachingDisplay(in: content.bounds) else {
            throw SmokeFailure("Could not allocate a bitmap for the actual visible workspace flow.")
        }
        content.cacheDisplay(in: content.bounds, to: bitmap)
        _ = try saveBitmap(bitmap, filename: filename)
    }

    private func waitForSheet(_ window: NSWindow, present: Bool) async throws {
        let deadline = ProcessInfo.processInfo.systemUptime + 4
        while (window.attachedSheet != nil) != present && ProcessInfo.processInfo.systemUptime < deadline {
            try await Task.sleep(nanoseconds: 100_000_000)
        }
        try require((window.attachedSheet != nil) == present, "The actual workspace sheet did not reach its expected open/closed state.")
    }

    private func exerciseWorkspace(coordinator: CompanionCoordinator, window: NSWindow) async throws {
        report["phase"] = "workspace-interactive-flows"
        report["workspaceActionScope"] = "public NSAccessibilityProtocol on this process's own views only"
        try checkpoint()
        guard let root = window.contentView else { throw SmokeFailure("Workspace content is unavailable.") }
        let store = coordinator.store
        let now = Date()
        try store.saveSchedule(id: store.selectedSchedule?.id, title: "示例赛程（验证用）",
                               start: now.addingTimeInterval(-3600), end: now.addingTimeInterval(86400),
                               zone: "Asia/Shanghai", precision: .exact)
        try store.addMilestone(title: "提交演示视频", date: now.addingTimeInterval(3600))
        store.addChecklistItem("演示视频")
        store.addChecklistItem("项目说明")
        try await Task.sleep(nanoseconds: 300_000_000)
        _ = try control("workspace.heading.schedule", in: root)
        try exportWorkspace(window, filename: "workspace-schedule-populated.png")
        let scheduleBeforeEdit = store.selectedSchedule
        for iteration in 0..<2 {
            try await press("schedule.edit", in: root)
            try await waitForSheet(window, present: true)
            guard let sheet = window.attachedSheet, let sheetRoot = sheet.contentView else {
                throw SmokeFailure("The real schedule editor was not presented as a sheet.")
            }
            let title = try control("schedule.editor.title", in: sheetRoot).accessibilityValue() as? String
            try require(title == "示例赛程（验证用）", "The real editor did not load the selected schedule title.")
            if iteration == 0 { try exportWorkspace(sheet, filename: "workspace-schedule-editor.png") }
            try await press("schedule.editor.cancel", in: sheetRoot)
            try await waitForSheet(window, present: false)
            try require(store.selectedSchedule == scheduleBeforeEdit, "Cancelling the editor mutated the schedule.")
        }
        setCheck("scheduleEditorRepeatedOpenCancel", true)

        try await press("workspace.tab.checklist", in: root)
        _ = try control("workspace.heading.checklist", in: root)
        guard let item = store.selectedChecklist?.items.first else { throw SmokeFailure("Synthetic checklist item is missing.") }
        let timeBefore = store.timeline?.progressFraction
        try await press("checklist.toggle." + item.id, in: root)
        try require(store.completedItemCount == 1 && store.itemCount == 2, "The real checklist toggle did not update its bound item.")
        if let before = timeBefore, let after = store.timeline?.progressFraction {
            try require(abs(after - before) < 0.001, "Checklist completion changed the contest-time position.")
        } else { throw SmokeFailure("The exact synthetic schedule lost its time progress.") }
        try exportWorkspace(window, filename: "workspace-checklist.png")
        setCheck("realChecklistToggleKeepsTimeSeparate", true)

        let document = directory.appendingPathComponent("synthetic-rules.md")
        try "示例规则（仅用于界面验证）\n请提交项目说明与演示视频。\n演示视频不超过三分钟。".write(to: document, atomically: true, encoding: .utf8)
        store.importDocuments([document])
        let importDeadline = ProcessInfo.processInfo.systemUptime + 5
        while store.state.documents.isEmpty && store.errorMessage == nil && ProcessInfo.processInfo.systemUptime < importDeadline {
            try await Task.sleep(nanoseconds: 100_000_000)
        }
        try require(store.state.documents.count == 1 && store.errorMessage == nil && !store.passages.isEmpty,
                    "The real local Markdown importer did not produce source passages.")
        try await press("workspace.tab.documents", in: root)
        _ = try control("workspace.heading.documents", in: root)
        let questionField = try control("documents.question", in: root)
        questionField.setAccessibilityValue("需要提交哪些材料？")
        try await Task.sleep(nanoseconds: 300_000_000)
        try require(questionField.accessibilityValue() as? String == "需要提交哪些材料？" && !store.selectedPassages.isEmpty,
                    "The real document form did not retain its synthetic question and selected passages.")
        try exportWorkspace(window, filename: "workspace-documents.png")
        try require(!control("documents.preview", in: root).isAccessibilityEnabled(),
                    "The document send-preview control was enabled without signing in.")
        guard let passage = store.passages.first else { throw SmokeFailure("Imported source passage is missing.") }
        try await press("documents.source." + passage.id, in: root)
        try await waitForSheet(window, present: true)
        guard let sourceSheet = window.attachedSheet, let sourceRoot = sourceSheet.contentView else {
            throw SmokeFailure("The real local source inspector did not appear.")
        }
        try exportWorkspace(sourceSheet, filename: "workspace-document-source.png")
        try await press("documents.source.close", in: sourceRoot)
        try await waitForSheet(window, present: false)
        store.sendQuestion(DocumentQuestion(question: "需要提交哪些材料？", passages: store.selectedPassages),
                           confirmedServiceAddress: store.serviceAddress)
        try require(store.errorMessage != nil && !store.isAnswering && store.answer == nil,
                    "The unsigned-in document request did not fail closed before networking.")
        try await Task.sleep(nanoseconds: 300_000_000)
        try exportWorkspace(window, filename: "workspace-documents-auth-boundary.png")
        try await press("workspace.error.dismiss", in: root)
        try require(store.errorMessage == nil, "The real error dismiss button did not clear the banner.")
        let empty = directory.appendingPathComponent("synthetic-empty.txt")
        try "".write(to: empty, atomically: true, encoding: .utf8)
        store.importDocuments([empty])
        let errorDeadline = ProcessInfo.processInfo.systemUptime + 5
        while store.errorMessage == nil && ProcessInfo.processInfo.systemUptime < errorDeadline {
            try await Task.sleep(nanoseconds: 100_000_000)
        }
        try require(store.errorMessage != nil && store.state.documents.count == 1,
                    "An empty document was accepted or did not surface an import error.")
        try await Task.sleep(nanoseconds: 300_000_000)
        try exportWorkspace(window, filename: "workspace-document-import-error.png")
        try await press("workspace.error.dismiss", in: root)
        setCheck("localDocumentImportSourceAndErrorBoundaries", true)

        try await press("workspace.tab.git", in: root)
        _ = try control("workspace.heading.git", in: root)
        try require(store.selectedRepository == nil && !store.isReadingGit, "The empty Git tab unexpectedly selected or read a repository.")
        try exportWorkspace(window, filename: "workspace-git.png")
        try await press("workspace.tab.settings", in: root)
        _ = try control("workspace.heading.settings", in: root)
        try require(store.serviceAddress.isEmpty && store.signedInName == nil && !store.state.reminderPreferences.isEnabled,
                    "Viewing settings changed service, sign-in or reminder state.")
        try exportWorkspace(window, filename: "workspace-settings.png")
        try await press("workspace.tab.schedule", in: root)
        _ = try control("workspace.heading.schedule", in: root)
        setCheck("allFiveWorkspaceTabsAndReturn", true)
        report["workspaceFlowLimitations"] = [
            "Sidebar, editor cancel, checklist toggle, source close and banner dismiss use real same-process accessible controls, not pointer/keyboard event injection.",
            "No authenticated upload confirmation or live AI answer was exercised; the unsigned-in path remained disabled and rejected requests.",
            "No real repository, Finder, notification authorization, credentials, external network or model request was used."
        ]
        try checkpoint()
    }

    private func captureSnapshot(from view: ARView) async throws -> NSBitmapImageRep {
        snapshotCompleted = false
        snapshotImage = nil
        view.snapshot(saveToHDR: false) { [weak self] image in
            Task { @MainActor [weak self] in
                self?.snapshotImage = image
                self?.snapshotCompleted = true
            }
        }
        let deadline = ProcessInfo.processInfo.systemUptime + 10
        while !snapshotCompleted && ProcessInfo.processInfo.systemUptime < deadline {
            try await Task.sleep(nanoseconds: 100_000_000)
        }
        guard snapshotCompleted else { throw SmokeUnsupported("The real ARView snapshot callback timed out after 10 seconds.") }
        guard let image = snapshotImage, let tiff = image.tiffRepresentation,
              let bitmap = NSBitmapImageRep(data: tiff) else {
            throw SmokeUnsupported("RealityKit returned no usable native scene image on this runner.")
        }
        return bitmap
    }

    private func captureOwnWindow(_ window: NSWindow) async throws -> NSBitmapImageRep {
        // currentProcess is the permission-free, redacted own-application API.
        // Never substitute SCShareableContent.current or a desktop capture.
        report["ownProcessWindowCaptureAttempted"] = true
        report["captureStage"] = "enumerating-own-process"
        try checkpoint()
        let content: SCShareableContent
        do { content = try await SCShareableContent.currentProcess }
        catch { throw SmokeUnsupported("The runner could not provide this process's own capturable windows: \(error.localizedDescription)") }
        report["captureStage"] = "matching-own-window"
        report["ownProcessCaptureWindowCount"] = content.windows.count
        try checkpoint()
        let pid = ProcessInfo.processInfo.processIdentifier
        guard let own = content.windows.first(where: {
            $0.windowID == CGWindowID(window.windowNumber) && $0.owningApplication?.processID == pid
        }) else {
            throw SmokeUnsupported("The exact own-process widget window is not available for native capture.")
        }
        let configuration = SCStreamConfiguration()
        configuration.width = Int((window.frame.width * window.backingScaleFactor).rounded())
        configuration.height = Int((window.frame.height * window.backingScaleFactor).rounded())
        configuration.showsCursor = false
        configuration.capturesAudio = false
        configuration.includeChildWindows = false
        configuration.ignoreShadowsSingleWindow = true
        configuration.shouldBeOpaque = false
        // ScreenCaptureKit declares this property unowned(unsafe). The color
        // must outlive the asynchronous capture, not just this assignment.
        let captureBackground = NSColor.clear.cgColor
        defer { withExtendedLifetime(captureBackground) {} }
        configuration.backgroundColor = captureBackground
        let filter = SCContentFilter(desktopIndependentWindow: own)
        report["captureStage"] = "capturing-matched-own-window"
        report["captureWindowID"] = Int(own.windowID)
        try checkpoint()
        do {
            let image = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: configuration)
            report["captureStage"] = "own-window-image-returned"
            try checkpoint()
            return NSBitmapImageRep(cgImage: image)
        } catch {
            throw SmokeUnsupported("The runner could not capture the exact own-process widget window: \(error.localizedDescription)")
        }
    }

    private func captureTimelinePositions(coordinator: CompanionCoordinator, pet: NSWindow) async throws {
        report["phase"] = "time-rail-positions"
        report["syntheticScenario"] = "Empty startup followed by an isolated synthetic contest at 0%, 50%, and 100%; no user contest data."
        var positions: [[String: Any]] = []
        for (expected, name) in [(0.0, "start"), (0.5, "middle"), (1.0, "end")] {
            let anchor = Date()
            let start: Date, end: Date
            if expected == 0 { start = anchor.addingTimeInterval(3600); end = anchor.addingTimeInterval(7200) }
            else if expected == 1 { start = anchor.addingTimeInterval(-7200); end = anchor.addingTimeInterval(-3600) }
            else { start = anchor.addingTimeInterval(-86400); end = anchor.addingTimeInterval(86400) }
            try coordinator.store.saveSchedule(id: "native-smoke-time-rail", title: "示例赛程（验证用）",
                                               start: start, end: end, zone: "UTC", precision: .exact)
            try await Task.sleep(nanoseconds: 400_000_000)
            guard let content = pet.contentView, let view = findARView(in: content),
                  let progress = coordinator.store.timeline?.progressFraction else {
                throw SmokeFailure("The actual synthetic schedule did not produce a visible time-positioned renderer.")
            }
            content.layoutSubtreeIfNeeded()
            let geometry = PetRailGeometry(width: Double(content.bounds.width), progressFraction: progress)
            let frame = view.convert(view.bounds, to: content)
            try require(abs(progress - expected) < 0.001, "The synthetic contest did not reach its expected time fraction.")
            try require(abs(Double(frame.midX) - geometry.petCenterX) <= 1,
                        "The real pet center does not match its shared time-rail coordinate.")
            positions.append(["scenario": name, "progress": progress, "actualPetCenterX": Double(frame.midX),
                              "expectedPetCenterX": geometry.petCenterX, "trackStartX": geometry.trackStartX,
                              "trackEndX": geometry.trackEndX, "groundY": geometry.groundY,
                              "nativeViewFrame": rectDescription(frame)])
            let bitmap = try await captureOwnWindow(pet)
            _ = try saveBitmap(bitmap, filename: "native-widget-" + name + ".png")
        }
        report["timeRailPositions"] = positions
        setCheck("timeRailPositionsMatchActualView", true)
    }

    private func channels(_ bitmap: NSBitmapImageRep, x: Int, y: Int) -> [Int] {
        guard let color = bitmap.colorAt(x: x, y: y)?.usingColorSpace(.deviceRGB) else { return [0, 0, 0, 0] }
        let values = [color.redComponent, color.greenComponent, color.blueComponent, color.alphaComponent]
        return values.map { Int(max(0, min(255, ($0 * 255).rounded()))) }
    }

    private func verifyPixelGrid(_ bitmap: NSBitmapImageRep, diagnostics: [String: Any]) throws {
        guard diagnostics["activePipeline"] as? Bool == true,
              diagnostics["failureReason"] as? String == "",
              let completed = diagnostics["completedFrameCount"] as? Int, completed > 0,
              let outputWidth = diagnostics["outputWidth"] as? Int, outputWidth > 0,
              let outputHeight = diagnostics["outputHeight"] as? Int, outputHeight > 0,
              let scale = diagnostics["integerScale"] as? Int, scale >= 2,
              let offsetX = diagnostics["gridOffsetX"] as? Int,
              let offsetY = diagnostics["gridOffsetY"] as? Int,
              let gridWidth = diagnostics["lowResolutionWidth"] as? Int, gridWidth > 0,
              let gridHeight = diagnostics["lowResolutionHeight"] as? Int, gridHeight > 0 else {
            throw SmokeFailure("The live native pixel pipeline was not successfully completed with valid grid diagnostics.")
        }
        let ratioX = Double(bitmap.pixelsWide) / Double(outputWidth)
        let ratioY = Double(bitmap.pixelsHigh) / Double(outputHeight)
        let scaledCell = Double(scale) * ratioX
        let cell = Int(scaledCell.rounded())
        let originX = Int((Double(offsetX) * ratioX).rounded())
        let originY = Int((Double(offsetY) * ratioY).rounded())
        try require(abs(ratioX - ratioY) < 0.001 && abs(Double(cell) - scaledCell) < 0.001 && cell >= 2,
                    "The native snapshot did not preserve an integer pixel enlargement.")
        try require(originX >= 0 && originY >= 0 && originX + gridWidth * cell <= bitmap.pixelsWide &&
                    originY + gridHeight * cell <= bitmap.pixelsHigh, "The reported pixel grid lies outside the actual image.")
        for (x, y) in [(0, 0), (bitmap.pixelsWide - 1, 0),
                       (0, bitmap.pixelsHigh - 1), (bitmap.pixelsWide - 1, bitmap.pixelsHigh - 1)] {
            try require(channels(bitmap, x: x, y: y)[3] <= 1,
                        "The actual pixel scene lost its transparent background.")
        }
        var occupiedCells = 0
        var shadowCells = 0
        var shadowBottom = -1
        var minX = bitmap.pixelsWide, minY = bitmap.pixelsHigh, maxX = -1, maxY = -1
        for gy in 0..<gridHeight {
            for gx in 0..<gridWidth {
                let x = originX + gx * cell, y = originY + gy * cell
                let first = channels(bitmap, x: x, y: y)
                if first[3] >= 40 && first[3] <= 150 && first[0] < 40 && first[1] < 40 && first[2] < 40 {
                    shadowCells += 1
                    shadowBottom = max(shadowBottom, y + cell - 1)
                }
                if first[3] >= 128 {
                    occupiedCells += 1
                    minX = min(minX, x); minY = min(minY, y)
                    maxX = max(maxX, x + cell - 1); maxY = max(maxY, y + cell - 1)
                }
                for dy in 0..<cell {
                    for dx in 0..<cell {
                        let value = channels(bitmap, x: x + dx, y: y + dy)
                        try require(zip(first, value).allSatisfy { abs($0.0 - $0.1) <= 1 },
                                    "The actual ARView image contains smoothing inside a declared nearest-neighbor pixel cell.")
                    }
                }
            }
        }
        try require(occupiedCells >= 32, "The pixel renderer did not produce a recognizable occupied scene.")
        try require(shadowCells >= 4, "The actual native pixel scene did not include its translucent dotted shadow.")
        try require(Double(maxX - minX + 1) >= Double(bitmap.pixelsWide) * 0.5 &&
                    Double(maxY - minY + 1) >= Double(bitmap.pixelsHigh) * 0.4,
                    "The real octopus is too small in the native frame to read at widget size.")
        report["pixelGridEvidence"] = ["cellPixels": cell, "gridWidth": gridWidth, "gridHeight": gridHeight,
            "occupiedCells": occupiedCells, "shadowCells": shadowCells,
            "shadowBottomPixels": shadowBottom,
            "occupiedWidth": maxX - minX + 1, "occupiedHeight": maxY - minY + 1]
    }

    private func changedVisiblePixels(_ first: NSBitmapImageRep, _ second: NSBitmapImageRep) -> Int {
        guard first.pixelsWide == second.pixelsWide, first.pixelsHigh == second.pixelsHigh else { return 0 }
        var changed = 0
        for y in 0..<first.pixelsHigh {
            for x in 0..<first.pixelsWide {
                let a = channels(first, x: x, y: y), b = channels(second, x: x, y: y)
                if max(a[3], b[3]) > 0 && zip(a, b).contains(where: { abs($0.0 - $0.1) > 2 }) { changed += 1 }
            }
        }
        return changed
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
        if filename == "workspace-content.png" { report["workspacePixels"] = metrics }
        else if filename == "native-octopus.png" { report["octopusPixels"] = metrics }
        else { report[filename + "Metrics"] = metrics }
        let minimumColors = filename.hasPrefix("native-octopus") ? 4 : 8
        guard visible >= 8, colors.count >= minimumColors else {
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
