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
                    let progress = min(max(store.timeline?.progressFraction ?? 0.5, 0), 1)
                    ZStack(alignment: .bottomLeading) {
                        RoundedRectangle(cornerRadius: 2).fill(InkpawColors.rule).frame(height: 3)
                            .padding(.horizontal, 20).offset(y: -3)
                        if store.timeline?.progressFraction != nil {
                            RoundedRectangle(cornerRadius: 2).fill(InkpawColors.accent)
                                .frame(width: max(0, (proxy.size.width - 40) * progress), height: 3)
                                .padding(.leading, 20).offset(y: -3)
                        }
                        OctopusView(mood: mood, reduceMotion: reduceMotion)
                            .frame(width: 140, height: 140)
                            .offset(x: (proxy.size.width - 140) * progress, y: 0)
                            .allowsHitTesting(false)
                    }
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
                            .buttonStyle(.borderedProminent).tint(InkpawColors.accent).help("打开工作台")
                    }
                    HStack {
                        Text(store.timeline?.progressFraction.map { "赛程 \(Int($0 * 100))%" } ?? "赛程待核实")
                        Spacer()
                        Text("清单 \(store.completedItemCount)/\(store.itemCount)")
                    }
                    .font(.system(size: 11)).foregroundStyle(InkpawColors.muted)
                }
                .padding(16)
                .background(InkpawColors.surface, in: RoundedRectangle(cornerRadius: 16))
                .overlay(RoundedRectangle(cornerRadius: 16).stroke(InkpawColors.rule, lineWidth: 1))
                .shadow(color: .black.opacity(0.06), radius: 12, y: 4)
                .padding(.horizontal, 8)
            }
        }
        .frame(width: store.state.isCollapsed ? 156 : 380,
               height: store.state.isCollapsed ? 176 : 260)
        .foregroundStyle(InkpawColors.ink)
        .buttonStyle(.plain)
        .preferredColorScheme(.light)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Inkpaw 比赛挂件，章鱼位置表示赛程经过时间")
    }
}

private enum WorkspaceTab: String, CaseIterable, Identifiable {
    case schedule = "赛程", documents = "规则问答", checklist = "提交清单", git = "Git 活动", settings = "服务与提醒"
    var id: String { rawValue }
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
            VStack(alignment: .leading, spacing: 6) {
                Text("Inkpaw").font(.system(size: 25, weight: .bold)).padding(.bottom, 2)
                Text("把项目推进到交付").font(.system(size: 12)).foregroundStyle(InkpawColors.muted).padding(.bottom, 22)
                ForEach(WorkspaceTab.allCases) { item in
                    Button { tab = item } label: {
                        Label(item.rawValue, systemImage: item.icon)
                            .font(.system(size: 14, weight: tab == item ? .semibold : .regular))
                            .frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 12).padding(.vertical, 11)
                            .foregroundStyle(tab == item ? InkpawColors.accent : InkpawColors.body)
                            .background(tab == item ? InkpawColors.accentSoft : .clear, in: RoundedRectangle(cornerRadius: 10))
                    }.buttonStyle(.plain)
                }
                Spacer()
                Text("原生桌面插件 · 本地项目只读")
                    .font(.system(size: 10)).foregroundStyle(InkpawColors.faint)
            }
            .padding(20).frame(width: 200).background(InkpawColors.surfaceMuted)
            Rectangle().fill(InkpawColors.rule).frame(width: 1)
            VStack(spacing: 0) {
                if let message = store.errorMessage {
                    HStack(alignment: .top) {
                        Image(systemName: "exclamationmark.circle")
                        Text(message).font(.system(size: 12)).textSelection(.enabled)
                        Spacer(minLength: 8)
                        Button { store.errorMessage = nil } label: { Image(systemName: "xmark") }.buttonStyle(.plain)
                    }
                    .foregroundStyle(InkpawColors.danger).padding(12)
                    .background(InkpawColors.danger.opacity(0.07))
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
        .background(InkpawColors.canvas)
        .foregroundStyle(InkpawColors.ink)
        .preferredColorScheme(.light)
        .frame(minWidth: 780, minHeight: 540)
    }
}

struct InkpawCard<Content: View>: View {
    let content: () -> Content
    init(@ViewBuilder content: @escaping () -> Content) { self.content = content }
    var body: some View {
        VStack(alignment: .leading, spacing: 12, content: content)
            .frame(maxWidth: .infinity, alignment: .leading).padding(18)
            .background(InkpawColors.surface, in: RoundedRectangle(cornerRadius: 14))
            .overlay(RoundedRectangle(cornerRadius: 14).stroke(InkpawColors.rule, lineWidth: 1))
    }
}

struct WorkspaceTitle: View {
    let title: String
    let subtitle: String
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title).font(.system(size: 25, weight: .bold))
            Text(subtitle).font(.system(size: 13)).foregroundStyle(InkpawColors.muted)
        }.frame(maxWidth: .infinity, alignment: .leading)
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
            VStack(alignment: .leading, spacing: 20) {
                HStack(alignment: .top) {
                    WorkspaceTitle(title: "比赛赛程", subtitle: "查看比赛倒计时、赛程节点和提交准备情况。")
                    Button("新建比赛") { createNew = true; editing = true }.buttonStyle(.borderedProminent).tint(InkpawColors.accent)
                }
                if let schedule = store.selectedSchedule {
                    if store.state.schedules.count > 1 {
                        Picker("当前比赛", selection: Binding(get: { schedule.id }, set: { store.selectSchedule($0) })) {
                            ForEach(store.state.schedules) { Text($0.title).tag($0.id) }
                        }
                    }
                    InkpawCard {
                        HStack {
                            Text(schedule.title).font(.system(size: 20, weight: .semibold))
                            Spacer()
                            Button("编辑时间") { createNew = false; editing = true }
                        }
                        Text(store.countdownTitle).font(.system(size: 13)).foregroundStyle(InkpawColors.muted)
                        Text(store.countdownText).font(.system(size: 28, weight: .bold, design: .monospaced))
                        if let progress = store.timeline?.progressFraction {
                            ProgressView(value: progress).tint(InkpawColors.accent)
                            Text("已走过赛程 \(Int(progress * 100))% · 章鱼沿这条时间轨道移动")
                                .font(.system(size: 12)).foregroundStyle(InkpawColors.muted)
                        } else {
                            Label("时间精度或时区不足，暂不显示精确进度。", systemImage: "questionmark.circle")
                                .font(.system(size: 12)).foregroundStyle(InkpawColors.danger)
                        }
                        Divider()
                        dateRow("开始", instant: schedule.start)
                        dateRow("结束", instant: schedule.end)
                        Text("以上时间由你录入，不代表已从官方材料核实。时区变化不会改变保存的绝对时间。")
                            .font(.system(size: 11)).foregroundStyle(InkpawColors.faint)
                    }
                    InkpawCard {
                        Text("赛程节点").font(.system(size: 16, weight: .semibold))
                        ForEach(schedule.milestones.sorted { ($0.instant.date ?? .distantFuture) < ($1.instant.date ?? .distantFuture) }) { milestone in
                            HStack {
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(milestone.title)
                                    Text(formattedInstant(milestone.instant)).font(.system(size: 12)).foregroundStyle(InkpawColors.muted)
                                }
                                Spacer()
                                if let date = milestone.instant.date, date <= store.now {
                                    Text("已到节点").font(.system(size: 11)).foregroundStyle(InkpawColors.muted)
                                }
                                Button { store.removeMilestone(milestone.id) } label: { Image(systemName: "trash") }.help("删除节点")
                            }
                            Divider()
                        }
                        TextField("节点名称，例如作品提交截止", text: $milestoneTitle)
                        HStack {
                            DatePicker("时间", selection: $milestoneDate, displayedComponents: [.date, .hourAndMinute])
                                .environment(\.timeZone, TimeZone(identifier: schedule.end.timeZoneIdentifier ?? "") ?? .current)
                            Button("添加节点") {
                                do { try store.addMilestone(title: milestoneTitle, date: milestoneDate); milestoneTitle = "" }
                                catch { store.errorMessage = error.localizedDescription }
                            }.disabled(milestoneTitle.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                        }
                        Text("节点时区：\(schedule.end.timeZoneIdentifier ?? "待确认")")
                            .font(.system(size: 11)).foregroundStyle(InkpawColors.muted)
                    }
                } else {
                    InkpawCard {
                        Label("先录入起止时间与时区", systemImage: "calendar.badge.plus").font(.system(size: 18, weight: .semibold))
                        Text("录入比赛日期；补充准确时间和时区后显示倒计时。")
                            .foregroundStyle(InkpawColors.muted)
                    }
                }
            }.padding(26)
        }
        .sheet(isPresented: $editing) {
            ScheduleEditor(store: store, existing: createNew ? nil : store.selectedSchedule)
        }
    }

    private func dateRow(_ title: String, instant: ScheduleInstant) -> some View {
        HStack { Text(title).foregroundStyle(InkpawColors.muted); Spacer(); Text(formattedInstant(instant)) }.font(.system(size: 13))
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
            Text(existing == nil ? "录入比赛" : "编辑比赛").font(.title2.bold())
            TextField("比赛名称", text: $title)
            TextField("IANA 时区，例如 Asia/Shanghai", text: $zone)
            Toggle("仅知道日期，准确时刻尚未核实", isOn: $dateOnly)
            DatePicker("开始", selection: $start, displayedComponents: dateOnly ? [.date] : [.date, .hourAndMinute])
            DatePicker("结束", selection: $end, displayedComponents: dateOnly ? [.date] : [.date, .hourAndMinute])
            Text("界面中的时间按上方时区录入。只有准确时间与有效时区齐备时才显示倒计时。")
                .font(.caption).foregroundStyle(InkpawColors.muted)
            if let error { Text(error).font(.caption).foregroundStyle(InkpawColors.danger) }
            HStack {
                Spacer()
                Button("取消") { dismiss() }.keyboardShortcut(.cancelAction)
                Button("保存") {
                    do {
                        try store.saveSchedule(id: existing?.id, title: title, start: start, end: end, zone: zone,
                                               precision: dateOnly ? .day : .exact)
                        dismiss()
                    } catch { self.error = error.localizedDescription }
                }.buttonStyle(.borderedProminent).tint(InkpawColors.accent).keyboardShortcut(.defaultAction)
            }
        }
        .padding(26).frame(width: 470)
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
            VStack(alignment: .leading, spacing: 20) {
                WorkspaceTitle(title: "提交清单", subtitle: "逐项准备真正需要交付的材料。勾选不会改变章鱼的赛程位置。")
                if let checklist = store.selectedChecklist {
                    InkpawCard {
                        HStack {
                            Text(store.selectedSchedule?.title ?? checklist.title).font(.system(size: 18, weight: .semibold))
                            Spacer()
                            Text("\(store.completedItemCount) / \(store.itemCount)").monospacedDigit().foregroundStyle(InkpawColors.accent)
                        }
                        if !checklist.items.isEmpty { ProgressView(value: Double(store.completedItemCount), total: Double(store.itemCount)).tint(InkpawColors.accent) }
                        ForEach(checklist.items) { item in
                            HStack(spacing: 12) {
                                Button { store.toggleChecklistItem(item.id) } label: {
                                    Image(systemName: item.isCompleted ? "checkmark.circle.fill" : "circle")
                                        .font(.system(size: 19)).foregroundStyle(item.isCompleted ? InkpawColors.accent : InkpawColors.faint)
                                }.buttonStyle(.plain).accessibilityLabel(item.isCompleted ? "标记未完成：\(item.title)" : "标记完成：\(item.title)")
                                Text(item.title).strikethrough(item.isCompleted).foregroundStyle(item.isCompleted ? InkpawColors.muted : InkpawColors.body)
                                Spacer()
                                Button { store.removeChecklistItem(item.id) } label: { Image(systemName: "trash") }.help("删除清单项")
                            }.padding(.vertical, 5)
                        }
                        HStack {
                            TextField("新增材料或交付检查项", text: $itemTitle).onSubmit(addItem)
                            Button("添加", action: addItem).disabled(itemTitle.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                        }
                    }
                    Text("清单由你确认。规则问答提供来源参考，不会自动把推断加入清单。")
                        .font(.system(size: 12)).foregroundStyle(InkpawColors.muted)
                } else {
                    InkpawCard { Text("请先在赛程页录入比赛，再建立属于这场比赛的提交清单。") }
                }
            }.padding(26)
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
