#if os(macOS)
import AppKit
import SwiftUI
import InkpawCore

struct GitWorkspaceView: View {
    @ObservedObject var store: CompanionStore
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: InkpawLayout.sectionGap) {
                HStack(alignment: .top) {
                    WorkspaceTitle(title: "Git 活动", subtitle: "只读取你选定的本地项目。不会提交、推送、拉取或修改文件。")
                    Button { chooseRepository() } label: { Label("选择项目", systemImage: "folder.badge.plus") }
                        .buttonStyle(InkpawButtonStyle(store.selectedRepository == nil ? .secondary : .primary))
                }
                if let repository = store.selectedRepository {
                    InkpawCard {
                        HStack {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(repository.name).font(.system(size: 18, weight: .semibold))
                                Text(repository.directoryURL.path).font(InkpawType.metadata).foregroundStyle(InkpawColors.muted).textSelection(.enabled).lineLimit(2).truncationMode(.middle)
                            }
                            Spacer()
                            if store.isReadingGit { ProgressView().controlSize(.small) }
                            Button { store.refreshGit() } label: { Label("刷新", systemImage: "arrow.clockwise") }
                                .buttonStyle(InkpawButtonStyle(.secondary, size: .small)).disabled(store.isReadingGit)
                        }
                        if let snapshot = store.gitSnapshot {
                            Divider()
                            HStack {
                                metric("分支", snapshot.workingTree.isDetachedHead ? "Detached HEAD" : snapshot.workingTree.branchName ?? "尚无提交")
                                Spacer()
                                metric("已跟踪变更", "\(snapshot.workingTree.trackedChangeCount)")
                                Spacer()
                                metric("未跟踪文件", "\(snapshot.workingTree.untrackedFileCount)")
                            }
                            if let upstream = snapshot.upstream {
                                Text("相对本地 tracking ref：领先 \(upstream.aheadCount.map(String.init) ?? "未知") · 落后 \(upstream.behindCount.map(String.init) ?? "未知")")
                                    .font(.system(size: 13, weight: .medium))
                                Text("\(upstream.remoteName)/\(upstream.branchName) 可能已陈旧。本插件不会 fetch，不能把这个比较当作刚核验的远端状态。")
                                    .font(.system(size: 12)).foregroundStyle(InkpawColors.muted)
                            } else {
                                Text("没有可用的 upstream 跟踪信息；未推送数量未知。")
                                    .font(.system(size: 12)).foregroundStyle(InkpawColors.muted)
                            }
                            Text("读取于 \(snapshot.observedAt.formatted(date: .omitted, time: .standard))")
                                .font(.system(size: 12)).foregroundStyle(InkpawColors.faint)
                        } else if !store.isReadingGit {
                            Text("还没有可用快照。请确认目录是 Git 仓库，然后刷新。")
                                .font(.system(size: 12)).foregroundStyle(InkpawColors.muted)
                        }
                    }
                    if let snapshot = store.gitSnapshot {
                        InkpawCard {
                            Text("近期 Commit").font(.system(size: 16, weight: .semibold))
                            if snapshot.commits.isEmpty { Text("这是一个尚无提交的仓库。").foregroundStyle(InkpawColors.muted) }
                            ForEach(snapshot.commits, id: \.objectID) { commit in
                                VStack(alignment: .leading, spacing: 8) {
                                    HStack(alignment: .top) {
                                        Text(String(commit.objectID.prefix(8))).font(.system(size: 12, design: .monospaced)).foregroundStyle(InkpawColors.accent)
                                        Text(commit.subject).font(InkpawType.body).textSelection(.enabled)
                                    }
                                    Text("提交时间 \(commit.committedAt.formatted(date: .abbreviated, time: .shortened)) · 作者时间 \(commit.authoredAt.formatted(date: .abbreviated, time: .shortened))")
                                        .font(.system(size: 12)).foregroundStyle(InkpawColors.muted)
                                }.padding(.vertical, 12)
                            }
                        }
                        InkpawCard {
                            Text("有证据的本机 Push 记录").font(.system(size: 16, weight: .semibold))
                            Text("仅展示本地 remote-tracking reflog 明确标记为“update by push”的条目。不是完整远端历史，也不从 commit 时间推测推送。")
                                .font(.system(size: 12)).foregroundStyle(InkpawColors.muted)
                            if snapshot.evidencedLocalPushes.isEmpty {
                                Label("本机没有可用推送证据，推送过程未知。", systemImage: "questionmark.circle")
                                    .font(.system(size: 13)).foregroundStyle(InkpawColors.muted)
                            }
                            ForEach(snapshot.evidencedLocalPushes) { push in
                                VStack(alignment: .leading, spacing: 8) {
                                    HStack {
                                        Text(push.destinationRef).font(.system(size: 13, weight: .medium))
                                        Spacer()
                                        Text(String(push.objectID.prefix(8))).font(.system(size: 12, design: .monospaced))
                                    }
                                    Text(push.occurredAt?.formatted(date: .abbreviated, time: .shortened) ?? "记录时间未知")
                                        .font(.system(size: 12)).foregroundStyle(InkpawColors.muted)
                                    Text("证据：\(push.evidence.detail)").font(.system(size: 12)).textSelection(.enabled)
                                }.padding(12).background(InkpawColors.surfaceMuted, in: RoundedRectangle(cornerRadius: 8))
                            }
                        }
                    }
                } else {
                    InkpawCard {
                        InkpawEmptyState(symbol: "folder.badge.plus", title: "把项目的进展看清楚",
                            detail: "选择一个本地 Git 仓库，查看提交、工作区状态与有证据的本机推送记录。",
                            note: "只读取你选择的项目，不扫描其他目录，也不把 Git 数据发送到问答服务。") {
                            Button("选择本地项目", action: chooseRepository).buttonStyle(InkpawButtonStyle(.primary))
                        }
                    }
                }
            }.frame(maxWidth: InkpawLayout.contentMeasure).padding(InkpawLayout.pagePadding).frame(maxWidth: .infinity)
        }
    }
    private func metric(_ title: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).font(.system(size: 12)).foregroundStyle(InkpawColors.muted)
            Text(value).font(.system(size: 20, weight: .semibold)).lineLimit(1).minimumScaleFactor(0.8)
        }
    }
    private func chooseRepository() {
        let panel = NSOpenPanel()
        panel.title = "选择一个仅供读取的 Git 项目"
        panel.message = "只读取状态、提交和本机推送证据；不会 fetch、commit 或 push。"
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = false
        if panel.runModal() == .OK, let url = panel.url { store.selectRepository(url) }
    }
}

struct SettingsWorkspaceView: View {
    @ObservedObject var store: CompanionStore
    @State private var address = ""
    @State private var email = ""
    @State private var password = ""
    @State private var configurationMessage: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: InkpawLayout.sectionGap) {
                WorkspaceTitle(title: "服务与提醒", subtitle: "默认本地运行。登录与通知都由你主动开启。")
                InkpawCard {
                    Text("节点提醒").font(.system(size: 16, weight: .semibold))
                    HStack {
                        Label(store.notificationStatus, systemImage: store.state.reminderPreferences.isEnabled ? "bell.badge" : "bell.slash")
                        Spacer()
                        if store.state.reminderPreferences.isEnabled {
                            Button("关闭并清理待发提醒") { store.disableReminders() }
                        } else {
                            Button("启用系统通知") { store.enableReminders() }.buttonStyle(InkpawButtonStyle(.primary))
                        }
                    }
                    Text("对准确时间的赛程节点，在提前 1 小时、15 分钟及到点时提醒。旧截止时间会被替换，同一提醒不会因重复刷新或重启反复出现。系统限制下只安排最近的 64 条。")
                        .font(.system(size: 12)).foregroundStyle(InkpawColors.muted)
                    Text("日期或时区待核实的节点不会安排精确提醒。关闭插件后，已经排入系统的通知仍可触发；关闭上方开关会取消本插件待发提醒。")
                        .font(.system(size: 12)).foregroundStyle(InkpawColors.muted)
                }
                InkpawCard {
                    Text("你的 Inkpaw 问答服务").font(.system(size: 16, weight: .semibold))
                    InkpawFieldLabel("服务地址")
                    TextField("https://你的域名/api 或 http://127.0.0.1:8000", text: $address)
                        .textFieldStyle(InkpawTextFieldStyle()).accessibilityLabel("服务地址").disabled(store.isAnswering || store.isSigningIn || store.isSigningOut)
                    VStack(alignment: .leading, spacing: 12) {
                        Button("保存服务地址") {
                            do { try store.configureService(address); configurationMessage = "地址已保存，尚未发送文档或登录凭据。" }
                            catch { store.errorMessage = error.localizedDescription }
                        }.disabled(store.isAnswering || store.isSigningIn || store.isSigningOut)
                        if let configurationMessage { Text(configurationMessage).font(.system(size: 12)).foregroundStyle(InkpawColors.muted) }
                    }
                    Text("远程地址必须使用 HTTPS。仅允许明确的本机 loopback HTTP 用于开发服务；不接受 URL 中的密码、查询串或跨站跳转。")
                        .font(.system(size: 12)).foregroundStyle(InkpawColors.muted)
                    Divider()
                    InkpawFieldLabel("账户会话")
                    VStack(alignment: .leading, spacing: 8) {
                        Text("当前登录目标").font(InkpawType.metadata).foregroundStyle(InkpawColors.muted)
                        Text(store.serviceAddress.isEmpty ? "尚未保存服务地址" : store.serviceAddress)
                            .font(.system(size: 13, weight: .medium)).textSelection(.enabled)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    if address.trimmingCharacters(in: .whitespacesAndNewlines) != store.serviceAddress {
                        Text("地址草稿尚未保存。先确认并保存上方地址，才能发送登录凭据。")
                            .font(.system(size: 12)).foregroundStyle(InkpawColors.danger)
                    }
                    if let name = store.signedInName {
                        HStack {
                            Label("已登录：\(name)", systemImage: "person.crop.circle.badge.checkmark")
                            Spacer()
                            Button("退出此会话") { store.signOut() }.disabled(store.isAnswering)
                        }
                    } else {
                        VStack(alignment: .leading, spacing: 8) {
                            InkpawFieldLabel("已有账号邮箱")
                            TextField("name@example.com", text: $email).textFieldStyle(InkpawTextFieldStyle()).accessibilityLabel("已有账号邮箱")
                        }
                        VStack(alignment: .leading, spacing: 8) {
                            InkpawFieldLabel("密码")
                            SecureField("仅用于本次登录，不保存", text: $password).textFieldStyle(InkpawTextFieldStyle()).accessibilityLabel("密码，不保存")
                        }
                        HStack {
                            Text("凭据只发送到上方已保存的服务地址。会话与浏览器隔离，重启后需要重新登录。")
                                .font(.system(size: 12)).foregroundStyle(InkpawColors.muted)
                            Spacer()
                            if store.isSigningIn { ProgressView().controlSize(.small) }
                            Button("登录") {
                                store.signIn(email: email, password: password, confirmedServiceAddress: address.trimmingCharacters(in: .whitespacesAndNewlines))
                                password = ""
                            }.buttonStyle(InkpawButtonStyle(.primary))
                                .disabled(store.isSigningIn || store.isSigningOut || email.isEmpty || password.isEmpty || store.serviceAddress.isEmpty || address.trimmingCharacters(in: .whitespacesAndNewlines) != store.serviceAddress)
                        }
                    }
                    Text("文档问答需要服务端包含专用 /companion/documents/ask 接口并已配置模型预算。本插件不会部署或修改你的服务，不会绕过预算，也不会改用可写赛事库的侦探接口。")
                        .font(.system(size: 12)).foregroundStyle(InkpawColors.muted)
                }
                InkpawCard {
                    Text("本地与隐私").font(.system(size: 16, weight: .semibold))
                    Text("赛程、清单、导入规则和窗口位置保存在此 Mac 的应用支持目录。导入文件与 Git 项目仅在本地读取；每次模型问答都先预览实际发送的片段。通知默认关闭，未使用屏幕录制或辅助功能权限。")
                        .font(.system(size: 12)).foregroundStyle(InkpawColors.muted)
                    Button("在 Finder 中显示本地状态文件") {
                        NSWorkspace.shared.activateFileViewerSelecting([store.stateFileURL])
                    }.buttonStyle(InkpawButtonStyle(.ghost, size: .small))
                    Text("这个版本没有签名、公证或自动更新。需要 macOS 15 或更高版本。")
                        .font(.system(size: 12)).foregroundStyle(InkpawColors.faint)
                }
            }.frame(maxWidth: InkpawLayout.contentMeasure).padding(InkpawLayout.pagePadding).frame(maxWidth: .infinity)
        }
        .onAppear { address = store.serviceAddress }
    }
}
#endif
