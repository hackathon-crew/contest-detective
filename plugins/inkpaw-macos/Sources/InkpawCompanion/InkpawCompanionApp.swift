#if os(macOS)
import AppKit
import Combine
import SwiftUI
import InkpawCore

@main
struct InkpawCompanionApp: App {
    @NSApplicationDelegateAdaptor(CompanionAppDelegate.self) private var delegate
    var body: some SwiftUI.Scene {
        Settings { Text("请从菜单栏打开 Inkpaw 比赛工作台。").padding(24) }
    }
}

@MainActor
final class CompanionAppDelegate: NSObject, NSApplicationDelegate {
    private var coordinator: CompanionCoordinator?
    private var smokeRunner: CompanionSmokeRunner?

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApplication.shared.setActivationPolicy(.accessory)
        do {
            let smoke = try CompanionSmokeRunner.prepare(arguments: CommandLine.arguments)
            smokeRunner = smoke
            let coordinator = CompanionCoordinator(store: smoke?.makeStore() ?? CompanionStore())
            self.coordinator = coordinator
            if let smoke { smoke.start(coordinator: coordinator) }
            else { coordinator.start() }
        } catch {
            CompanionSmokeRunner.failSetup(error)
        }
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        guard let coordinator else { return .terminateNow }
        if let smokeRunner {
            smokeRunner.interrupted()
        }
        Task {
            do { try await coordinator.store.prepareForTermination() }
            catch {
                let alert = NSAlert()
                alert.messageText = "退出前未能完成保存或提醒更新"
                alert.informativeText = "\(error.localizedDescription)\n现有系统提醒可能仍按旧计划触发。"
                alert.addButton(withTitle: "返回应用")
                alert.addButton(withTitle: "仍然退出")
                if alert.runModal() == .alertFirstButtonReturn {
                    sender.reply(toApplicationShouldTerminate: false)
                    return
                }
                coordinator.store.stop()
            }
            sender.reply(toApplicationShouldTerminate: true)
        }
        return .terminateLater
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }
}

@MainActor
final class CompanionCoordinator: NSObject, NSWindowDelegate {
    let store: CompanionStore
    private var panel: NSPanel?
    private var workspace: NSWindow?
    private var statusItem: NSStatusItem?
    private var subscriptions = Set<AnyCancellable>()
    private var applyingGeometry = false
    private var hasRestoredState = false

    init(store: CompanionStore) {
        self.store = store
        super.init()
    }

    // Read-only handles for the explicit, isolated native smoke launch mode.
    var smokePetWindow: NSWindow? { panel }
    var smokeWorkspaceWindow: NSWindow? { workspace }

    func start() {
        let menu = NSMenu()
        menu.addItem(withTitle: "显示桌面章鱼", action: #selector(showPet), keyEquivalent: "")
        menu.addItem(withTitle: "打开比赛工作台", action: #selector(showWorkspace), keyEquivalent: "")
        menu.addItem(withTitle: "隐藏挂件", action: #selector(hidePet), keyEquivalent: "")
        menu.addItem(.separator())
        menu.addItem(withTitle: "退出 Inkpaw", action: #selector(quit), keyEquivalent: "q")
        for item in menu.items { item.target = self }
        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        item.button?.image = NSImage(systemSymbolName: "timer", accessibilityDescription: "Inkpaw 比赛助手")
        item.button?.toolTip = "Inkpaw · 比赛冲刺助手"
        item.menu = menu
        statusItem = item

        store.$state.map(\.isCollapsed).removeDuplicates().sink { [weak self] _ in
            Task { @MainActor in
                guard let self, self.hasRestoredState, self.store.isLoaded else { return }
                self.resizePanel()
            }
        }.store(in: &subscriptions)
        store.$isLoaded.filter { $0 }.first().sink { [weak self] _ in
            Task { @MainActor in
                self?.restorePanelPosition()
                self?.hasRestoredState = true
            }
        }.store(in: &subscriptions)
        store.start()
        showPet()
    }

    @objc func showPet() {
        if panel == nil {
            let panel = CompanionPanel(contentRect: NSRect(x: 0, y: 0, width: 380, height: 260),
                styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
            panel.title = "Inkpaw 比赛挂件"
            panel.isOpaque = false
            panel.backgroundColor = .clear
            panel.hasShadow = false
            panel.level = .floating
            panel.isFloatingPanel = true
            panel.hidesOnDeactivate = false
            panel.isMovableByWindowBackground = true
            panel.becomesKeyOnlyIfNeeded = true
            panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
            panel.delegate = self
            panel.contentView = DraggableHostingView(rootView: PetWidgetView(store: store,
                openWorkspace: { [weak self] in self?.showWorkspace() }))
            self.panel = panel
            restorePanelPosition()
        }
        panel?.orderFrontRegardless()
    }

    @objc func hidePet() { panel?.orderOut(nil) }

    @objc func showWorkspace() {
        if workspace == nil {
            let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 900, height: 680),
                styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
            window.title = "Inkpaw · 比赛工作台"
            window.minSize = NSSize(width: 780, height: 560)
            window.isReleasedWhenClosed = false
            window.contentView = NSHostingView(rootView: CompanionWorkspaceView(store: store))
            window.center()
            workspace = window
        }
        NSApplication.shared.activate(ignoringOtherApps: true)
        workspace?.makeKeyAndOrderFront(nil)
    }

    @objc private func quit() { NSApplication.shared.terminate(nil) }

    private func resizePanel() {
        guard let panel else { return }
        applyingGeometry = true
        let size = store.state.isCollapsed ? NSSize(width: 156, height: 176) : NSSize(width: 380, height: 260)
        var frame = panel.frame
        frame.origin.y += frame.height - size.height
        frame.size = size
        panel.setFrame(clamped(frame), display: true, animate: false)
        applyingGeometry = false
        persistPanelGeometry()
    }

    private func restorePanelPosition() {
        guard let panel else { return }
        applyingGeometry = true
        defer { applyingGeometry = false }
        let size = store.state.isCollapsed ? NSSize(width: 156, height: 176) : NSSize(width: 380, height: 260)
        let frame: NSRect
        if let saved = store.state.windowGeometry {
            frame = NSRect(x: saved.x, y: saved.y, width: size.width, height: size.height)
        } else {
            let screen = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1200, height: 800)
            frame = NSRect(x: screen.maxX - size.width - 24, y: screen.minY + 24, width: size.width, height: size.height)
        }
        panel.setFrame(clamped(frame), display: true)
    }

    private func clamped(_ frame: NSRect) -> NSRect {
        let screen = NSScreen.screens.first { $0.visibleFrame.intersects(frame) } ?? NSScreen.main
        guard let visible = screen?.visibleFrame else { return frame }
        var result = frame
        result.origin.x = min(max(frame.minX, visible.minX), visible.maxX - frame.width)
        result.origin.y = min(max(frame.minY, visible.minY), visible.maxY - frame.height)
        return result
    }

    func windowDidMove(_ notification: Notification) {
        guard hasRestoredState, !applyingGeometry, let panel, notification.object as? NSWindow === panel else { return }
        persistPanelGeometry()
    }

    private func persistPanelGeometry() {
        guard hasRestoredState, let panel else { return }
        let frame = panel.frame
        store.saveWindowGeometry(WindowGeometry(x: frame.minX, y: frame.minY, width: frame.width, height: frame.height,
            displayIdentifier: panel.screen?.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")].map { String(describing: $0) }))
    }
}

final class CompanionPanel: NSPanel {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }
}

final class DraggableHostingView<Content: View>: NSHostingView<Content> {
    override var mouseDownCanMoveWindow: Bool { true }
}
#else
import Foundation
@main
struct InkpawCompanionApp {
    static func main() {
        print("Inkpaw Companion requires macOS 15 or later. Run the platform-independent tests with swift test.")
    }
}
#endif
