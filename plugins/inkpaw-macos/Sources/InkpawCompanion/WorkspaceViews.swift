#if os(macOS)
import AppKit
import SwiftUI
import InkpawCore

struct PetWidgetView: View {
    @ObservedObject var store: CompanionStore
    let openWorkspace: () -> Void
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var mood: OctopusMood {
        if store.isAnswering { return .think }
        if store.itemCount > 0 && store.completedItemCount == store.itemCount { return .happy }
        if !store.state.documents.isEmpty { return .read }
        return store.timeline?.phase == .active ? .search : .idle
    }

    var body: some View {
        VStack(spacing: 0) {
            if store.state.isCollapsed {
                OctopusView(mood: mood, reduceMotion: reduceMotion)
                    .frame(width: 140, height: 136).allowsHitTesting(false)
                HStack(spacing: 10) {
                    Button(action: openWorkspace) { Image(systemName: "square.grid.2x2") }.help("打开工作台")
                    Button { store.setCollapsed(false) } label: { Image(systemName: "arrow.up.left.and.arrow.down.right") }.help("展开挂件")
                }
                .buttonStyle(.plain).foregroundStyle(InkpawColors.accent)
                .padding(.horizontal, 18).padding(.vertical, 8)
                .background(InkpawColors.surface, in: Capsule())
            } else {
                GeometryReader { proxy in
                    let geometry = PetRailGeometry(width: Double(proxy.size.width), progressFraction: store.timeline?.progressFraction)
                    ZStack(alignment: .topLeading) {
                        if geometry.showsTrack {
                            RoundedRectangle(cornerRadius: 2).fill(InkpawColors.rule)
                                .frame(width: geometry.trackWidth, height: 3)
                                .position(x: geometry.trackStartX + geometry.trackWidth / 2, y: geometry.groundY)
                            RoundedRectangle(cornerRadius: 2).fill(InkpawColors.accent)
                                .frame(width: geometry.filledTrackWidth, height: 3)
                                .position(x: geometry.trackStartX + geometry.filledTrackWidth / 2, y: geometry.groundY)
                        }
                        OctopusView(mood: mood, reduceMotion: reduceMotion)
                            .frame(width: geometry.canvasWidth, height: geometry.canvasHeight)
                            .position(x: geometry.petCenterX, y: geometry.canvasOriginY + geometry.canvasHeight / 2)
                            .allowsHitTesting(false)
                    }.frame(width: proxy.size.width, height: geometry.canvasHeight)
                }
                .frame(height: 140)
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        Text(store.selectedSchedule?.title ?? "Inkpaw 比赛模式")
                            .font(.system(size: 14, weight: .semibold)).lineLimit(1)
                        Spacer(minLength: 8)
                        Button { store.setCollapsed(true) } label: { Image(systemName: "minus") }.help("收起挂件")
                    }
                    HStack(alignment: .firstTextBaseline) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(store.countdownTitle).font(.system(size: 11)).foregroundStyle(InkpawColors.muted)
                            Text(store.countdownText).font(.system(size: 18, weight: .semibold, design: .monospaced))
                        }
                        Spacer()
                        Button(action: openWorkspace) { Image(systemName: "arrow.up.right") }
                            .buttonStyle(InkpawButtonStyle(.primary, size: .small, iconOnly: true)).help("打开工作台")
                    }
                    HStack {
                        Text(store.timeline?.progressFraction.map { "赛程 \(Int($0 * 100))%" } ?? "赛程待核实")
                        Spacer()
                        Text("清单 \(store.completedItemCount)/\(store.itemCount)")
                    }
                    .font(.system(size: 11)).foregroundStyle(InkpawColors.muted)
                }
                .padding(16).frame(height: 120, alignment: .top)
                .background(InkpawColors.surface, in: RoundedRectangle(cornerRadius: 16))
                .overlay(RoundedRectangle(cornerRadius: 16).stroke(InkpawColors.rule, lineWidth: 1))
                .modifier(InkpawPrincipalShadow())
                .padding(.horizontal, 8)
            }
        }
        .frame(width: store.state.isCollapsed ? 156 : 380,
               height: store.state.isCollapsed ? 176 : 260)
        .foregroundStyle(InkpawColors.ink)
        .buttonStyle(.plain)
        .preferredColorScheme(.light)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(store.timeline?.progressFraction == nil ? "Inkpaw 比赛挂件，赛程位置待设置或核实" : "Inkpaw 比赛挂件，章鱼位置表示赛程经过时间")
    }
}

private enum WorkspaceTab: String, CaseIterable, Identifiable {
    case schedule = "赛程", documents = "规则问答", checklist = "提交清单", git = "Git 活动", settings = "服务与提醒"
    var id: String { rawValue }
    var accessibilityID: String {
        switch self {
        case .schedule: return "workspace.tab.schedule"
        case .documents: return "workspace.tab.documents"
        case .checklist: return "workspace.tab.checklist"
        case .git: return "workspace.tab.git"
        case .settings: return "workspace.tab.settings"
        }
    }
    var icon: String {
        switch self {
        case .schedule: return "clock"
        case .documents: return "doc.text.magnifyingglass"
        case .checklist: return "checklist"
        case .git: return "point.3.connected.trianglepath.dotted"
        case .settings: return "slider.horizontal.3"
        }
    }
}

struct CompanionWorkspaceView: View {
    @ObservedObject var store: CompanionStore
    @State private var tab: WorkspaceTab = .schedule

    var body: some View {
        HStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 8) {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Inkpaw").font(.system(size: 24, weight: .bold))
                    Text("把项目推进到交付").font(InkpawType.metadata).foregroundStyle(InkpawColors.muted)
                }.padding(.horizontal, 12).padding(.top, 8).padding(.bottom, 24)
                ForEach(WorkspaceTab.allCases) { item in
                    Button { tab = item } label: {
                        HStack(spacing: 12) {
                            Image(systemName: item.icon).font(.system(size: 16, weight: .medium)).frame(width: 20)
                            Text(item.rawValue).font(InkpawType.control)
                            Spacer(minLength: 0)
                        }
                    }
                    .buttonStyle(InkpawNavigationStyle(isSelected: tab == item))
                    .accessibilityLabel(item.rawValue)
                    .accessibilityIdentifier(item.accessibilityID)
                    .accessibilityAddTraits(tab == item ? .isSelected : [])
                }
                Spacer(minLength: 24)
                VStack(alignment: .leading, spacing: 8) {
                    Label("本地优先", systemImage: "externaldrive")
                    Text("文档发送前由你确认")
                }.font(InkpawType.metadata).foregroundStyle(InkpawColors.muted)
                    .padding(.horizontal, 12).padding(.bottom, 8)
            }
            .padding(16).frame(width: InkpawLayout.sidebarWidth).background(InkpawColors.surfaceMuted)
            Rectangle().fill(InkpawColors.rule).frame(width: 1)
            VStack(spacing: 0) {
                if let message = store.errorMessage {
                    HStack(alignment: .top, spacing: 12) {
                        Image(systemName: "exclamationmark.circle").padding(.top, 8)
                        Text(message).font(InkpawType.metadata).textSelection(.enabled).padding(.vertical, 8)
                        Spacer(minLength: 8)
                        Button { store.errorMessage = nil } label: { Image(systemName: "xmark") }
                            .buttonStyle(InkpawButtonStyle(.danger, size: .small, iconOnly: true)).help("关闭提示")
                            .accessibilityLabel("关闭提示").accessibilityIdentifier("workspace.error.dismiss")
                    }
                    .foregroundStyle(InkpawColors.danger).padding(.horizontal, 24).padding(.vertical, 8)
                    .background(InkpawColors.dangerSoft)
                }
                Group {
                    switch tab {
                    case .schedule: ScheduleWorkspaceView(store: store)
                    case .documents: DocumentWorkspaceView(store: store)
                    case .checklist: ChecklistWorkspaceView(store: store)
                    case .git: GitWorkspaceView(store: store)
                    case .settings: SettingsWorkspaceView(store: store)
                    }
                }
                .disabled(!store.isLoaded)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .background(InkpawColors.canvas).foregroundStyle(InkpawColors.ink)
        .font(InkpawType.body).lineSpacing(4)
        .buttonStyle(InkpawButtonStyle())
        .textFieldStyle(InkpawTextFieldStyle())
        .preferredColorScheme(.light)
        .frame(minWidth: 780, minHeight: 540)
    }
}

struct InkpawCard<Content: View>: View {
    let elevated: Bool
    let content: () -> Content
    init(elevated: Bool = false, @ViewBuilder content: @escaping () -> Content) {
        self.elevated = elevated; self.content = content
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 16, content: content)
            .frame(maxWidth: .infinity, alignment: .leading).padding(InkpawLayout.cardPadding)
            .background(InkpawColors.surface, in: RoundedRectangle(cornerRadius: InkpawLayout.cardRadius, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: InkpawLayout.cardRadius, style: .continuous).stroke(InkpawColors.rule, lineWidth: 1))
            .shadow(color: InkpawColors.ink.opacity(elevated ? 0.04 : 0), radius: 1, x: 0, y: 1)
            .shadow(color: InkpawColors.ink.opacity(elevated ? 0.06 : 0), radius: 16, x: 0, y: 12)
    }
}

struct WorkspaceTitle: View {
    let title: String
    let subtitle: String
    var identifier: String? = nil
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let identifier {
                Text(title).font(InkpawType.pageTitle).accessibilityIdentifier(identifier)
            } else {
                Text(title).font(InkpawType.pageTitle)
            }
            Text(subtitle).font(InkpawType.body).foregroundStyle(InkpawColors.muted)
                .fixedSize(horizontal: false, vertical: true)
        }.frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// Real empty state, with a working action and no sample dates, progress, or account status.
struct InkpawEmptyState<Action: View>: View {
    let symbol: String
    let title: String
    let detail: String
    let note: String
    let action: () -> Action
    init(symbol: String, title: String, detail: String, note: String = "", @ViewBuilder action: @escaping () -> Action) {
        self.symbol = symbol; self.title = title; self.detail = detail; self.note = note; self.action = action
    }
    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: symbol).font(.system(size: 32, weight: .light)).foregroundStyle(InkpawColors.accent)
                .frame(width: 80, height: 80)
                .background(InkpawColors.accentSoft, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
                .accessibilityHidden(true)
            VStack(spacing: 8) {
                Text(title).font(InkpawType.section).foregroundStyle(InkpawColors.ink)
                Text(detail).font(InkpawType.body).foregroundStyle(InkpawColors.muted)
                    .multilineTextAlignment(.center).lineSpacing(4).frame(maxWidth: 360)
            }
            action()
            if !note.isEmpty {
                Text(note).font(InkpawType.metadata).foregroundStyle(InkpawColors.muted)
                    .multilineTextAlignment(.center).frame(maxWidth: 400)
            }
        }.frame(maxWidth: .infinity).padding(.vertical, 16)
    }
}

struct ScheduleWorkspaceView: View {
    @ObservedObject var store: CompanionStore
    @State private var editing = false
    @State private var createNew = false
    @State private var milestoneTitle = ""
    @State private var milestoneDate = Date()

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: InkpawLayout.sectionGap) {
                HStack(alignment: .top) {
                    WorkspaceTitle(title: "比赛赛程", subtitle: "查看比赛倒计时、赛程节点和提交准备情况。", identifier: "workspace.heading.schedule")
                    Button { createNew = true; editing = true } label: { Label("新建比赛", systemImage: "plus") }
                        .buttonStyle(InkpawButtonStyle(store.selectedSchedule == nil ? .secondary : .primary))
                        .accessibilityIdentifier("schedule.create.header")
                }
                if let schedule = store.selectedSchedule {
                    if store.state.schedules.count > 1 {
                        Picker("当前比赛", selection: Binding(get: { schedule.id }, set: { store.selectSchedule($0) })) {
                            ForEach(store.state.schedules) { Text($0.title).tag($0.id) }
                        }
                    }
                    InkpawCard(elevated: true) {
                        HStack(alignment: .top, spacing: 12) {
                            VStack(alignment: .leading, spacing: 8) {
                                Text(schedule.title).font(InkpawType.section)
                                InkpawTag(title: phaseTitle, accented: store.timeline?.phase == .active)
                            }
                            Spacer(minLength: 8)
                            Button("编辑时间") { createNew = false; editing = true }
                                .buttonStyle(InkpawButtonStyle(.secondary, size: .small))
                                .accessibilityIdentifier("schedule.edit")
                        }
                        Text(store.countdownTitle).font(.system(size: 13)).foregroundStyle(InkpawColors.muted)
                        Text(store.countdownText).font(.system(size: 32, weight: .semibold)).monospacedDigit().minimumScaleFactor(0.75)
                        if let progress = store.timeline?.progressFraction {
                            InkpawProgressTrack(value: progress)
                            Text("已走过赛程 \(Int(progress * 100))% · 章鱼沿这条时间轨道移动")
                                .font(.system(size: 12)).foregroundStyle(InkpawColors.muted)
                        } else {
                            Label("时间精度或时区不足，暂不显示精确进度。", systemImage: "questionmark.circle")
                                .font(InkpawType.metadata).foregroundStyle(InkpawColors.muted)
                        }
                        Divider()
                        HStack(alignment: .top, spacing: 24) {
                            dateRow("开始", instant: schedule.start)
                            dateRow("结束", instant: schedule.end)
                        }
                        Text("以上时间由你录入，不代表已从官方材料核实。时区变化不会改变保存的绝对时间。")
                            .font(InkpawType.metadata).foregroundStyle(InkpawColors.muted)
                    }
                    InkpawCard {
                        HStack {
                            Text("赛程节点").font(InkpawType.cardTitle)
                            Spacer()
                            InkpawTag(title: "\(schedule.milestones.count) 个节点")
                        }
                        if schedule.milestones.isEmpty {
                            Text("还没有节点。把报名、作品提交或答辩时间放在这里。")
                                .font(InkpawType.body).foregroundStyle(InkpawColors.muted).padding(.vertical, 8)
                        }
                        ForEach(schedule.milestones.sorted { ($0.instant.date ?? .distantFuture) < ($1.instant.date ?? .distantFuture) }) { milestone in
                            HStack {
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(milestone.title)
                                    Text(formattedInstant(milestone.instant)).font(.system(size: 12)).foregroundStyle(InkpawColors.muted)
                                }
                                Spacer()
                                if let date = milestone.instant.date, date <= store.now {
                                    InkpawTag(title: "已到节点")
                                }
                                Button { store.removeMilestone(milestone.id) } label: { Image(systemName: "trash") }
                                    .buttonStyle(InkpawButtonStyle(.ghost, size: .small, iconOnly: true)).help("删除节点")
                            }.padding(.vertical, 8)
                        }
                        Divider()
                        InkpawFieldLabel("新增节点")
                        TextField("例如作品提交截止", text: $milestoneTitle).accessibilityLabel("节点名称")
                        HStack(alignment: .bottom, spacing: 16) {
                            DatePicker("时间", selection: $milestoneDate, displayedComponents: [.date, .hourAndMinute])
                                .environment(\.timeZone, TimeZone(identifier: schedule.end.timeZoneIdentifier ?? "") ?? .current)
                                .controlSize(.large).frame(minHeight: 40)
                            Button("添加节点") {
                                do { try store.addMilestone(title: milestoneTitle, date: milestoneDate); milestoneTitle = "" }
                                catch { store.errorMessage = error.localizedDescription }
                            }.buttonStyle(InkpawButtonStyle(.primary, size: .compact))
                                .disabled(milestoneTitle.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                        }
                        Text("节点时区：\(schedule.end.timeZoneIdentifier ?? "待确认")")
                            .font(InkpawType.metadata).foregroundStyle(InkpawColors.muted)
                    }
                } else {
                    InkpawCard(elevated: true) {
                        InkpawEmptyState(symbol: "calendar.badge.plus", title: "从一场比赛开始",
                            detail: "记下比赛的起止日期与时区，让每一个重要节点都清晰可见。",
                            note: "还不确定准确时刻？可以先保存日期，核实后再开启精确倒计时。") {
                            Button { createNew = true; editing = true } label: { Label("新建比赛", systemImage: "plus") }
                                .buttonStyle(InkpawButtonStyle(.primary))
                                .accessibilityIdentifier("schedule.create.empty")
                        }.frame(minHeight: 272)
                    }
                    HStack(alignment: .top, spacing: 24) {
                        setupStep("01", title: "录入时间", detail: "保留日期精度与时区")
                        setupStep("02", title: "整理材料", detail: "规则与清单各有出处")
                        setupStep("03", title: "按时提醒", detail: "确认节点后自主开启")
                    }.padding(.horizontal, 8).padding(.top, 8)
                }
            }.frame(maxWidth: InkpawLayout.contentMeasure).padding(InkpawLayout.pagePadding).frame(maxWidth: .infinity)
        }
        .sheet(isPresented: $editing) {
            ScheduleEditor(store: store, existing: createNew ? nil : store.selectedSchedule)
        }
    }

    private var phaseTitle: String {
        switch store.timeline?.phase {
        case .upcoming: return "尚未开赛"
        case .active: return "进行中"
        case .completed: return "已结束"
        case .unknown, .none: return "时间待核实"
        }
    }
    private func dateRow(_ title: String, instant: ScheduleInstant) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).font(InkpawType.metadata).foregroundStyle(InkpawColors.muted)
            Text(formattedInstant(instant)).font(.system(size: 13)).fixedSize(horizontal: false, vertical: true)
        }.frame(maxWidth: .infinity, alignment: .leading)
    }
    private func setupStep(_ number: String, title: String, detail: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(number).font(.system(size: 12, weight: .medium, design: .monospaced)).foregroundStyle(InkpawColors.accent)
            Text(title).font(InkpawType.control)
            Text(detail).font(InkpawType.metadata).foregroundStyle(InkpawColors.muted)
        }.frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct ScheduleEditor: View {
    @ObservedObject var store: CompanionStore
    let existing: CompetitionSchedule?
    @Environment(\.dismiss) private var dismiss
    @State private var title = ""
    @State private var start = Date()
    @State private var end = Date().addingTimeInterval(48 * 3600)
    @State private var zone = TimeZone.current.identifier
    @State private var dateOnly = false
    @State private var error: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text(existing == nil ? "录入比赛" : "编辑比赛").font(InkpawType.dialogTitle)
            VStack(alignment: .leading, spacing: 8) {
                InkpawFieldLabel("比赛名称")
                TextField("输入这场比赛的名称", text: $title).accessibilityLabel("比赛名称")
                    .accessibilityIdentifier("schedule.editor.title")
            }
            VStack(alignment: .leading, spacing: 8) {
                InkpawFieldLabel("IANA 时区")
                TextField("例如 Asia/Shanghai", text: $zone).accessibilityLabel("IANA 时区")
            }
            Toggle("仅知道日期，准确时刻尚未核实", isOn: $dateOnly)
            DatePicker("开始", selection: $start, displayedComponents: dateOnly ? [.date] : [.date, .hourAndMinute])
                .controlSize(.large).frame(minHeight: 40)
            DatePicker("结束", selection: $end, displayedComponents: dateOnly ? [.date] : [.date, .hourAndMinute])
                .controlSize(.large).frame(minHeight: 40)
            Text("界面中的时间按上方时区录入。只有准确时间与有效时区齐备时才显示倒计时。")
                .font(InkpawType.metadata).foregroundStyle(InkpawColors.muted)
            if let error { Text(error).font(InkpawType.metadata).foregroundStyle(InkpawColors.danger) }
            HStack {
                Spacer()
                Button("取消") { dismiss() }.keyboardShortcut(.cancelAction)
                    .accessibilityIdentifier("schedule.editor.cancel")
                Button("保存") {
                    do {
                        try store.saveSchedule(id: existing?.id, title: title, start: start, end: end, zone: zone,
                                               precision: dateOnly ? .day : .exact)
                        dismiss()
                    } catch { self.error = error.localizedDescription }
                }.buttonStyle(InkpawButtonStyle(.primary)).keyboardShortcut(.defaultAction)
                    .accessibilityIdentifier("schedule.editor.save")
            }
        }
        .modifier(InkpawDialogChrome()).frame(width: 500)
        .environment(\.timeZone, TimeZone(identifier: zone) ?? .current)
        .onAppear {
            if let existing {
                title = existing.title; start = existing.start.date ?? Date(); end = existing.end.date ?? Date()
                zone = existing.end.timeZoneIdentifier ?? TimeZone.current.identifier
                dateOnly = existing.start.precision != .exact || existing.end.precision != .exact
            }
        }
    }
}

struct ChecklistWorkspaceView: View {
    @ObservedObject var store: CompanionStore
    @State private var itemTitle = ""
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: InkpawLayout.sectionGap) {
                WorkspaceTitle(title: "提交清单", subtitle: "整理提交材料，逐项检查交付准备情况。", identifier: "workspace.heading.checklist")
                if let checklist = store.selectedChecklist {
                    InkpawCard {
                        HStack {
                            Text(store.selectedSchedule?.title ?? checklist.title).font(.system(size: 18, weight: .semibold))
                            Spacer()
                            InkpawTag(title: "\(store.completedItemCount) / \(store.itemCount)", accented: true)
                        }
                        if !checklist.items.isEmpty { InkpawProgressTrack(value: Double(store.completedItemCount) / Double(store.itemCount)) }
                        ForEach(checklist.items) { item in
                            HStack(spacing: 12) {
                                Button { store.toggleChecklistItem(item.id) } label: {
                                    Image(systemName: item.isCompleted ? "checkmark.circle.fill" : "circle")
                                        .font(.system(size: 19)).foregroundStyle(item.isCompleted ? InkpawColors.accent : InkpawColors.faint)
                                }.buttonStyle(InkpawButtonStyle(.ghost, size: .small, iconOnly: true)).accessibilityLabel(item.isCompleted ? "标记未完成：\(item.title)" : "标记完成：\(item.title)")
                                    .accessibilityIdentifier("checklist.toggle.\(item.id)")
                                Text(item.title).strikethrough(item.isCompleted).foregroundStyle(item.isCompleted ? InkpawColors.muted : InkpawColors.body)
                                Spacer()
                                Button { store.removeChecklistItem(item.id) } label: { Image(systemName: "trash") }
                                    .buttonStyle(InkpawButtonStyle(.ghost, size: .small, iconOnly: true)).help("删除清单项")
                            }.frame(minHeight: 48).padding(.vertical, 4)
                        }
                        Divider()
                        InkpawFieldLabel("新增检查项")
                        HStack(spacing: 12) {
                            TextField("需要准备的材料或交付检查项", text: $itemTitle).onSubmit(addItem).accessibilityLabel("新增检查项")
                                .accessibilityIdentifier("checklist.field")
                            Button("添加", action: addItem).buttonStyle(InkpawButtonStyle(.primary)).disabled(itemTitle.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                                .accessibilityIdentifier("checklist.add")
                        }
                    }
                    Text("清单由你确认。规则问答提供来源参考，不会自动把推断加入清单。")
                        .font(.system(size: 12)).foregroundStyle(InkpawColors.muted)
                } else {
                    InkpawCard {
                        InkpawEmptyState(symbol: "checklist", title: "为交付留一张清单",
                            detail: "请先在赛程页录入比赛，再把需要提交的材料逐项记在这里。",
                            note: "清单完成度与时间进度分别记录，不会互相替代。") { EmptyView() }
                    }
                }
            }.frame(maxWidth: InkpawLayout.contentMeasure).padding(InkpawLayout.pagePadding).frame(maxWidth: .infinity)
        }
    }
    private func addItem() { store.addChecklistItem(itemTitle); itemTitle = "" }
}

func formattedInstant(_ instant: ScheduleInstant) -> String {
    guard let date = instant.date else { return "日期待确认" }
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "zh_CN")
    formatter.timeZone = TimeZone(identifier: instant.timeZoneIdentifier ?? "UTC") ?? TimeZone(secondsFromGMT: 0)
    formatter.dateFormat = instant.precision == .exact ? "yyyy-MM-dd HH:mm" : "yyyy-MM-dd"
    let suffix = instant.precision == .exact ? (instant.timeZoneIdentifier ?? "时区待核实") : "时刻未核实"
    return "\(formatter.string(from: date)) · \(suffix)"
}
#endif
