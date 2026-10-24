#if os(macOS)
import AppKit
import Combine
import Foundation
import InkpawCore
import InkpawInfrastructure
import UserNotifications

@MainActor
final class CompanionStore: ObservableObject {
    @Published private(set) var state = CompanionStore.emptyState()
    @Published private(set) var timeline: TimelineSnapshot?
    @Published private(set) var now = Date()
    @Published private(set) var isLoaded = false
    @Published var errorMessage: String?
    @Published private(set) var passages: [DocumentPassage] = []
    @Published var selectedPassageIDs = Set<String>()
    @Published private(set) var answer: DocumentAnswer?
    @Published private(set) var answerPassages: [DocumentPassage] = []
    @Published private(set) var isAnswering = false
    @Published private(set) var isSigningIn = false
    @Published private(set) var isSigningOut = false
    @Published private(set) var signedInName: String?
    @Published private(set) var serviceAddress = ""
    @Published private(set) var gitSnapshot: GitSnapshot?
    @Published private(set) var isReadingGit = false
    @Published private(set) var pendingReminderCount = 0
    @Published private(set) var notificationStatus = "未启用"
    let stateFileURL: URL

    private let repository: LocalStateRepository
    private let timelineCalculator = TimelineCalculator()
    private let reminderPlanner = ReminderPlanner()
    private let notifications: NotificationScheduler
    private let preferences: UserDefaults
    private let clientFactory: (URL) throws -> DocumentClient
    private let gitReader = GitActivityReader()
    private let importer = DocumentImporter()
    private var client: DocumentClient?
    private var saveTask: Task<Void, Never>?
    private var reminderTask: Task<Void, Never>?
    private var answerTask: Task<Void, Never>?
    private var gitTask: Task<Void, Never>?
    private var timer: Timer?
    private var wakeObserver: NSObjectProtocol?
    private var tickCount = 0
    private var gitRevision = UUID()
    private var sessionRevision = UUID()

    init(stateURL: URL? = nil, notificationScheduler: NotificationScheduler? = nil,
         preferences: UserDefaults = .standard,
         clientFactory: @escaping (URL) throws -> DocumentClient = { try DocumentClient(baseURL: $0) }) {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support")
        stateFileURL = stateURL ?? base.appendingPathComponent("InkpawCompanion/state.json")
        repository = LocalStateRepository(fileURL: stateFileURL)
        notifications = notificationScheduler ?? NotificationScheduler()
        self.preferences = preferences
        self.clientFactory = clientFactory
        serviceAddress = preferences.string(forKey: "InkpawCompanion.serviceAddress") ?? ""
        notifications.onDeliveredReminder = { [weak self] id in
            guard let self, !self.state.deliveredReminderIDs.contains(id) else { return }
            self.replaceState(deliveredReminderIDs: self.state.deliveredReminderIDs + [id])
        }
    }

    var selectedSchedule: CompetitionSchedule? {
        state.schedules.first { $0.id == state.selectedScheduleID } ?? state.schedules.first
    }

    var selectedChecklist: Checklist? {
        state.checklists.first { $0.scheduleID == selectedSchedule?.id }
    }

    var completedItemCount: Int { selectedChecklist?.items.filter(\.isCompleted).count ?? 0 }
    var itemCount: Int { selectedChecklist?.items.count ?? 0 }
    var selectedRepository: GitRepositoryReference? { state.repositories.first }
    var selectedPassages: [DocumentPassage] { passages.filter { selectedPassageIDs.contains($0.id) } }

    var countdownTitle: String {
        guard let timeline else { return "录入比赛，开始冲刺" }
        switch timeline.phase {
        case .upcoming: return "距离开赛"
        case .active: return "距离交付"
        case .completed: return "比赛已结束"
        case .unknown: return "时刻或时区待核实"
        }
    }

    var countdownText: String {
        guard let seconds = timeline?.countdown?.remainingSeconds else {
            return timeline?.phase == .completed ? "收好作品与提交凭证" : "不推测精确倒计时"
        }
        let value = max(0, Int(seconds.rounded(.down)))
        return String(format: "%d天 %02d:%02d:%02d", value / 86400, value / 3600 % 24, value / 60 % 60, value % 60)
    }

    func start() {
        guard timer == nil else { return }
        Task {
            do { if let saved = try await repository.load() { state = saved } }
            catch { errorMessage = "无法读取本地状态，原文件不会被覆盖。请在“服务与提醒”打开数据位置，恢复或移走损坏文件后重启。\(error.localizedDescription)" }
            isLoaded = true
            rebuildPassages()
            tick()
            syncReminders()
            if selectedRepository != nil { refreshGit() }
        }
        timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.tick() }
        }
        wakeObserver = NSWorkspace.shared.notificationCenter.addObserver(
            forName: NSWorkspace.didWakeNotification, object: nil, queue: .main
        ) { [weak self] _ in Task { @MainActor in self?.tick(); self?.syncReminders() } }
    }

    func tick() {
        now = Date()
        if let schedule = selectedSchedule { timeline = try? timelineCalculator.snapshot(for: schedule, at: now) }
        else { timeline = nil }
        tickCount += 1
        if tickCount % 60 == 0 { syncReminders() }
    }

    func selectSchedule(_ id: String) {
        replaceState(selectedScheduleID: id)
        tick()
    }

    func saveSchedule(id: String?, title: String, start: Date, end: Date, zone: String, precision: SchedulePrecision) throws {
        guard !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { throw AppInputError("请填写比赛名称") }
        guard TimeZone(identifier: zone) != nil else { throw AppInputError("请填写有效的 IANA 时区，如 Asia/Shanghai") }
        guard end > start else { throw AppInputError("结束时间必须晚于开始时间") }
        let identifier = id ?? UUID().uuidString
        let old = state.schedules.first { $0.id == identifier }
        let schedule = CompetitionSchedule(
            id: identifier, title: title.trimmingCharacters(in: .whitespacesAndNewlines),
            start: ScheduleInstant(date: start, precision: precision, timeZoneIdentifier: zone, sourceURL: nil),
            end: ScheduleInstant(date: end, precision: precision, timeZoneIdentifier: zone, sourceURL: nil),
            milestones: old?.milestones ?? []
        )
        var schedules = state.schedules.filter { $0.id != identifier }
        schedules.append(schedule)
        var lists = state.checklists
        if !lists.contains(where: { $0.scheduleID == identifier }) {
            lists.append(Checklist(id: UUID().uuidString, scheduleID: identifier, title: "提交清单", items: []))
        }
        replaceState(selectedScheduleID: identifier, schedules: schedules, checklists: lists)
        tick(); syncReminders()
    }

    func addMilestone(title: String, date: Date) throws {
        guard let schedule = selectedSchedule else { throw AppInputError("请先录入比赛") }
        let title = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !title.isEmpty else { throw AppInputError("请填写节点名称") }
        let milestone = CompetitionMilestone(id: UUID().uuidString, title: title,
            instant: ScheduleInstant(date: date, precision: .exact,
                timeZoneIdentifier: schedule.end.timeZoneIdentifier, sourceURL: nil))
        replaceSchedule(schedule, milestones: schedule.milestones + [milestone])
    }

    func removeMilestone(_ id: String) {
        guard let schedule = selectedSchedule else { return }
        replaceSchedule(schedule, milestones: schedule.milestones.filter { $0.id != id })
    }

    private func replaceSchedule(_ schedule: CompetitionSchedule, milestones: [CompetitionMilestone]) {
        let updated = CompetitionSchedule(id: schedule.id, title: schedule.title, start: schedule.start,
                                          end: schedule.end, milestones: milestones)
        replaceState(schedules: state.schedules.map { $0.id == updated.id ? updated : $0 })
        tick(); syncReminders()
    }

    func addChecklistItem(_ title: String) {
        let title = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !title.isEmpty, let list = selectedChecklist else { return }
        updateChecklist(list, items: list.items + [ChecklistItem(id: UUID().uuidString, title: title, isCompleted: false)])
    }

    func toggleChecklistItem(_ id: String) {
        guard let list = selectedChecklist else { return }
        updateChecklist(list, items: list.items.map {
            $0.id == id ? ChecklistItem(id: $0.id, title: $0.title, isCompleted: !$0.isCompleted) : $0
        })
    }

    func removeChecklistItem(_ id: String) {
        guard let list = selectedChecklist else { return }
        updateChecklist(list, items: list.items.filter { $0.id != id })
    }

    private func updateChecklist(_ list: Checklist, items: [ChecklistItem]) {
        let updated = Checklist(id: list.id, scheduleID: list.scheduleID, title: list.title, items: items)
        replaceState(checklists: state.checklists.map { $0.id == list.id ? updated : $0 })
    }

    func setCollapsed(_ value: Bool) { replaceState(isCollapsed: value) }
    func saveWindowGeometry(_ geometry: WindowGeometry) { replaceState(windowGeometry: geometry) }

    func enableReminders() {
        Task {
            do {
                guard try await notifications.requestAuthorization() else {
                    notificationStatus = "系统通知未授权"
                    errorMessage = "通知未开启。可在系统设置的“通知”中允许 Inkpaw，之后再次点击启用。"
                    return
                }
                replaceState(reminderPreferences: ReminderPreferences(isEnabled: true, leadTimes: [3600, 900, 0]))
                syncReminders()
            } catch { errorMessage = "无法开启通知：\(error.localizedDescription)" }
        }
    }

    func disableReminders() {
        replaceState(reminderPreferences: ReminderPreferences(isEnabled: false, leadTimes: state.reminderPreferences.leadTimes))
        syncReminders()
    }

    private func syncReminders() {
        guard isLoaded else { return }
        reminderTask?.cancel()
        reminderTask = Task {
            do {
                try await Task.sleep(nanoseconds: 300_000_000)
                try Task.checkCancellation()
                try await performReminderReconciliation()
            } catch is CancellationError { }
            catch { errorMessage = "提醒计划未更新：\(error.localizedDescription)" }
        }
    }

    private func performReminderReconciliation() async throws {
        let plans = try state.schedules.map { try reminderPlanner.plan(for: $0, preferences: state.reminderPreferences, at: Date()) }
        let result = try await notifications.reconcile(plans: plans, enabled: state.reminderPreferences.isEnabled,
            deliveredReminderIDs: Set(state.deliveredReminderIDs), now: Date())
        try Task.checkCancellation()
        pendingReminderCount = result.pendingCount
        notificationStatus = state.reminderPreferences.isEnabled
            ? (result.authorizationStatus == .authorized || result.authorizationStatus == .provisional
                ? "已启用 · \(result.pendingCount) 条待提醒" : "系统通知未授权")
            : "未启用"
        let delivered = Set(state.deliveredReminderIDs).union(result.deliveredReminderIDs)
        if delivered != Set(state.deliveredReminderIDs) { replaceState(deliveredReminderIDs: Array(delivered).sorted()) }
    }

    func flushReminders() async throws {
        reminderTask?.cancel()
        guard isLoaded else { return }
        try await performReminderReconciliation()
    }

    func importDocuments(_ urls: [URL]) {
        Task {
            for url in urls.prefix(8) {
                do {
                    let imported = try await Task.detached(priority: .userInitiated) { try DocumentImporter().importDocument(at: url) }.value
                    replaceState(documents: state.documents + [imported])
                    rebuildPassages()
                    let fresh = passages.filter { $0.documentID == imported.id }.prefix(2)
                    selectedPassageIDs = Set(fresh.map(\.id))
                } catch { errorMessage = "导入 \(url.lastPathComponent) 失败：\(error.localizedDescription)" }
            }
        }
    }

    func removeDocument(_ id: String) {
        if answerPassages.contains(where: { $0.documentID == id }) { cancelQuestion() }
        replaceState(documents: state.documents.filter { $0.id != id })
        rebuildPassages()
        answer = nil; answerPassages = []
    }

    private func rebuildPassages() {
        var result: [DocumentPassage] = []
        for document in state.documents {
            do { result += try importer.passages(for: document) }
            catch { errorMessage = "文档分段失败：\(error.localizedDescription)" }
        }
        passages = result
        selectedPassageIDs.formIntersection(Set(result.map(\.id)))
    }

    func togglePassage(_ id: String) {
        if selectedPassageIDs.contains(id) { selectedPassageIDs.remove(id) }
        else if selectedPassageIDs.count < 8 { selectedPassageIDs.insert(id) }
        else { errorMessage = "每次最多选择 8 个原文片段" }
    }

    func configureService(_ address: String) throws {
        guard !isAnswering, !isSigningIn, !isSigningOut else { throw AppInputError("请先等待或取消当前请求") }
        guard let url = URL(string: address.trimmingCharacters(in: .whitespacesAndNewlines)) else { throw AppInputError("服务地址无效") }
        client = try clientFactory(url)
        sessionRevision = UUID()
        serviceAddress = url.absoluteString
        preferences.set(serviceAddress, forKey: "InkpawCompanion.serviceAddress")
        signedInName = nil; answer = nil
    }

    func signIn(email: String, password: String, confirmedServiceAddress: String) {
        guard !isSigningIn, !isSigningOut else { return }
        guard confirmedServiceAddress == serviceAddress else { errorMessage = "登录目标已变化，请重新核对服务地址"; return }
        do {
            if client == nil { try configureService(serviceAddress) }
        } catch { errorMessage = error.localizedDescription; return }
        guard let client else { return }
        let revision = sessionRevision
        isSigningIn = true
        Task {
            defer { if revision == sessionRevision { isSigningIn = false } }
            do {
                let user = try await client.login(email: email, password: password)
                if revision == sessionRevision { signedInName = user.username }
            } catch {
                if revision == sessionRevision { signedInName = nil; errorMessage = "登录失败：\(error.localizedDescription)" }
            }
        }
    }

    func signOut() {
        guard let client, !isAnswering, !isSigningIn, !isSigningOut else { return }
        let revision = sessionRevision
        isSigningOut = true
        signedInName = nil; answer = nil; answerPassages = []
        Task {
            defer {
                if revision == sessionRevision { isSigningOut = false; signedInName = nil; answer = nil; answerPassages = [] }
            }
            do { try await client.logout() }
            catch { errorMessage = "退出失败：\(error.localizedDescription)" }
        }
    }

    func sendQuestion(_ request: DocumentQuestion, confirmedServiceAddress: String) {
        guard !isAnswering, let client, signedInName != nil else { errorMessage = "请先登录你的 Inkpaw 服务"; return }
        guard confirmedServiceAddress == serviceAddress else { errorMessage = "服务地址已变化，请重新检查发送预览"; return }
        isAnswering = true; answer = nil; answerPassages = request.passages
        answerTask = Task {
            defer { isAnswering = false }
            do {
                let result = try await client.answer(request)
                try Task.checkCancellation()
                answer = result
            } catch is CancellationError { }
            catch DocumentClientError.cancelled { }
            catch DocumentClientError.authenticationRequired {
                signedInName = nil
                errorMessage = "问答会话已失效，请重新登录。"
            }
            catch { errorMessage = "文档问答未完成：\(error.localizedDescription)" }
        }
    }

    func cancelQuestion() { answerTask?.cancel() }

    func selectRepository(_ directory: URL) {
        let ref = GitRepositoryReference(id: UUID().uuidString, name: directory.lastPathComponent, directoryURL: directory)
        replaceState(repositories: [ref])
        gitSnapshot = nil
        refreshGit()
    }

    func refreshGit() {
        guard let selected = selectedRepository else { return }
        gitTask?.cancel()
        gitRevision = UUID()
        let revision = gitRevision
        isReadingGit = true
        gitTask = Task {
            defer { if revision == gitRevision { isReadingGit = false } }
            do {
                let result = try await gitReader.snapshot(for: selected)
                try Task.checkCancellation()
                if revision == gitRevision { gitSnapshot = result }
            } catch is CancellationError { }
            catch { if revision == gitRevision { gitSnapshot = nil; errorMessage = "读取 Git 失败：\(error.localizedDescription)" } }
        }
    }

    func flushPersistence() async {
        saveTask?.cancel()
        guard isLoaded else { return }
        do { try await repository.save(state) }
        catch { errorMessage = "本地状态未保存：\(error.localizedDescription)" }
    }

    func stop() {
        timer?.invalidate(); timer = nil
        if let wakeObserver { NSWorkspace.shared.notificationCenter.removeObserver(wakeObserver) }
        wakeObserver = nil
        answerTask?.cancel(); gitTask?.cancel(); reminderTask?.cancel(); saveTask?.cancel()
    }

    func prepareForTermination() async throws {
        saveTask?.cancel()
        try await flushReminders()
        if isLoaded { try await repository.save(state) }
        stop()
    }

    private func replaceState(
        selectedScheduleID: String? = nil, schedules: [CompetitionSchedule]? = nil,
        checklists: [Checklist]? = nil, documents: [SourceDocument]? = nil,
        repositories: [GitRepositoryReference]? = nil, windowGeometry: WindowGeometry? = nil,
        isCollapsed: Bool? = nil, reminderPreferences: ReminderPreferences? = nil,
        deliveredReminderIDs: [String]? = nil
    ) {
        state = CompanionState(schemaVersion: 1,
            selectedScheduleID: selectedScheduleID ?? state.selectedScheduleID,
            schedules: schedules ?? state.schedules, checklists: checklists ?? state.checklists,
            documents: documents ?? state.documents, repositories: repositories ?? state.repositories,
            windowGeometry: windowGeometry ?? state.windowGeometry, isCollapsed: isCollapsed ?? state.isCollapsed,
            reminderPreferences: reminderPreferences ?? state.reminderPreferences,
            deliveredReminderIDs: deliveredReminderIDs ?? state.deliveredReminderIDs)
        guard isLoaded else { return }
        saveTask?.cancel()
        saveTask = Task {
            do {
                try await Task.sleep(nanoseconds: 250_000_000)
                try Task.checkCancellation()
                try await repository.save(state)
            } catch is CancellationError { }
            catch { errorMessage = "本地状态未保存：\(error.localizedDescription)" }
        }
    }

    static func emptyState() -> CompanionState {
        CompanionState(schemaVersion: 1, selectedScheduleID: nil, schedules: [], checklists: [],
            documents: [], repositories: [], windowGeometry: nil, isCollapsed: false,
            reminderPreferences: ReminderPreferences(isEnabled: false, leadTimes: [3600, 900, 0]), deliveredReminderIDs: [])
    }
}

struct AppInputError: LocalizedError {
    let message: String
    init(_ message: String) { self.message = message }
    var errorDescription: String? { message }
}
#endif
