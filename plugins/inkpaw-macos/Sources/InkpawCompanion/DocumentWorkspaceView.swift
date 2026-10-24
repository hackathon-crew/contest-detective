#if os(macOS)
import AppKit
import SwiftUI
import UniformTypeIdentifiers
import InkpawCore

private struct PreparedQuestion: Identifiable {
    let id = UUID()
    let question: DocumentQuestion
    let serviceAddress: String
}

private struct SourceInspection: Identifiable {
    let id = UUID()
    let passage: DocumentPassage
    let quote: String
    let localURL: URL?
}

struct DocumentWorkspaceView: View {
    @ObservedObject var store: CompanionStore
    @State private var question = ""
    @State private var findText = ""
    @State private var preview: PreparedQuestion?
    @State private var sourceInspection: SourceInspection?

    private var visiblePassages: [DocumentPassage] {
        let needle = findText.trimmingCharacters(in: .whitespacesAndNewlines)
        return needle.isEmpty ? store.passages : store.passages.filter {
            $0.text.localizedCaseInsensitiveContains(needle) || $0.title.localizedCaseInsensitiveContains(needle)
        }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: InkpawLayout.sectionGap) {
                HStack(alignment: .top) {
                    WorkspaceTitle(title: "规则文档问答", subtitle: "只根据你选中的原文回答，每条结论都能打开对应出处。")
                    Button { chooseDocuments() } label: { Label("导入文档", systemImage: "plus") }
                        .buttonStyle(InkpawButtonStyle(store.state.documents.isEmpty ? .secondary : .primary))
                }
                InkpawCard {
                    HStack {
                        Label("本机规则资料", systemImage: "folder")
                            .font(.system(size: 16, weight: .semibold))
                        Spacer()
                        InkpawTag(title: "\(store.state.documents.count) 份文档")
                    }
                    if store.state.documents.isEmpty {
                        InkpawEmptyState(symbol: "doc.text", title: "把规则放在手边",
                            detail: "导入 TXT、Markdown 或有文字层的 PDF，先在本机查找、选择需要核对的原文。",
                            note: "导入不会联网。扫描 PDF 暂不支持；问答发送前会单独预览。") {
                            Button("导入规则文档", action: chooseDocuments).buttonStyle(InkpawButtonStyle(.primary))
                        }
                    }
                    ForEach(store.state.documents) { document in
                        HStack {
                            Image(systemName: "doc.text").foregroundStyle(InkpawColors.accent)
                            VStack(alignment: .leading, spacing: 4) {
                                Text(document.title).font(InkpawType.control)
                                Text("本地保存 · \(document.text.count) 字符").font(.system(size: 12)).foregroundStyle(InkpawColors.muted)
                            }
                            Spacer()
                            if let url = document.sourceURL {
                                Button { NSWorkspace.shared.activateFileViewerSelecting([url]) } label: { Image(systemName: "folder") }
                                    .buttonStyle(InkpawButtonStyle(.ghost, size: .small, iconOnly: true)).help("在 Finder 中显示原文件")
                            }
                            Button { store.removeDocument(document.id) } label: { Image(systemName: "trash") }
                                .buttonStyle(InkpawButtonStyle(.ghost, size: .small, iconOnly: true)).help("从插件移除此文档，不删除原文件")
                        }
                    }
                    if !store.passages.isEmpty {
                        Divider()
                        InkpawFieldLabel("查找原文")
                        TextField("输入关键词，仅筛选片段", text: $findText).accessibilityLabel("查找原文")
                        HStack {
                            Text("选择本次要发送的片段：\(store.selectedPassageIDs.count)/8")
                            Spacer()
                            Button("清空选择") { store.selectedPassageIDs.removeAll() }
                                .buttonStyle(InkpawButtonStyle(.ghost, size: .small))
                        }.font(.system(size: 12)).foregroundStyle(InkpawColors.muted)
                        ForEach(visiblePassages) { passage in
                            HStack(alignment: .top, spacing: 12) {
                                Toggle("", isOn: Binding(get: { store.selectedPassageIDs.contains(passage.id) },
                                                          set: { _ in store.togglePassage(passage.id) }))
                                    .labelsHidden().toggleStyle(.checkbox).frame(width: 32, height: 32, alignment: .topLeading)
                                    .accessibilityLabel("选择 \(passage.title)，\(passage.locator)")
                                VStack(alignment: .leading, spacing: 4) {
                                    Text("\(passage.title) · \(passage.locator)").font(.system(size: 12, weight: .semibold))
                                    Text(String(passage.text.prefix(180))).font(.system(size: 13)).foregroundStyle(InkpawColors.muted)
                                        .lineLimit(3)
                                }
                                Spacer(minLength: 4)
                                Button("全文") {
                                    sourceInspection = SourceInspection(passage: passage, quote: "",
                                        localURL: store.state.documents.first { $0.id == passage.documentID }?.sourceURL)
                                }.buttonStyle(InkpawButtonStyle(.ghost, size: .small))
                            }
                            .padding(12).background(InkpawColors.surfaceMuted, in: RoundedRectangle(cornerRadius: InkpawLayout.controlRadius))
                        }
                    }
                }
                InkpawCard {
                    Text("向规则提问").font(.system(size: 16, weight: .semibold))
                    TextField("例如：必须提交哪些材料？视频最长多久？", text: $question, axis: .vertical)
                        .lineLimit(3...5).textFieldStyle(InkpawTextFieldStyle(minimumHeight: 96))
                        .accessibilityLabel("向所选规则片段提问")
                    HStack {
                        if store.isAnswering {
                            ProgressView().controlSize(.small)
                            Text("正在核对所选原文…").font(InkpawType.metadata).foregroundStyle(InkpawColors.muted)
                            Spacer()
                            Button("取消请求") { store.cancelQuestion() }
                        } else {
                            Text("\(question.count)/1000 字符 · 最多 24 KiB 请求")
                                .font(.system(size: 12)).foregroundStyle(InkpawColors.faint)
                            Spacer()
                            Button("预览并发送") {
                                preview = PreparedQuestion(question: DocumentQuestion(question: question, passages: store.selectedPassages),
                                                           serviceAddress: store.serviceAddress)
                            }
                            .buttonStyle(InkpawButtonStyle(.primary))
                            .disabled(question.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || question.count > 1000 || store.selectedPassages.isEmpty || store.signedInName == nil)
                        }
                    }
                    if store.signedInName == nil {
                        Text("请先在“服务与提醒”中配置并登录自己的 Inkpaw 服务。未上线专用问答接口的旧服务会明确报错，不会偷偷改用侦探工具。")
                            .font(.system(size: 12)).foregroundStyle(InkpawColors.muted)
                    }
                }
                if let answer = store.answer {
                    InkpawCard {
                        Label("依据原文的回答", systemImage: "checkmark.shield").font(.system(size: 16, weight: .semibold))
                        if answer.status == .insufficientEvidence {
                            Text("所选片段不足以回答这个问题。请补充相关规则或换一个更具体的问题。")
                                .foregroundStyle(InkpawColors.muted)
                        }
                        ForEach(Array(answer.claims.enumerated()), id: \.offset) { index, claim in
                            VStack(alignment: .leading, spacing: 12) {
                                Text("\(index + 1). \(claim.text)").font(.system(size: 14)).textSelection(.enabled)
                                ForEach(Array(claim.citations.enumerated()), id: \.offset) { _, citation in
                                    if let passage = store.answerPassages.first(where: { $0.id == citation.passageID && $0.documentID == citation.documentID }) {
                                        Button {
                                            sourceInspection = SourceInspection(passage: passage, quote: citation.quote,
                                                localURL: store.state.documents.first { $0.id == passage.documentID }?.sourceURL)
                                        } label: {
                                            VStack(alignment: .leading, spacing: 8) {
                                                Label("\(passage.title) · \(passage.locator)", systemImage: "text.quote")
                                                    .font(.system(size: 12, weight: .semibold)).foregroundStyle(InkpawColors.accent)
                                                Text(citation.quote).font(.system(size: 13)).lineSpacing(4).foregroundStyle(InkpawColors.body)
                                                    .lineLimit(4)
                                            }
                                            .frame(maxWidth: .infinity, alignment: .leading).padding(12)
                                            .background(InkpawColors.accentSoft, in: RoundedRectangle(cornerRadius: 8))
                                        }.buttonStyle(.plain)
                                    }
                                }
                            }.padding(.vertical, 8)
                        }
                        Text("引用已经逐字匹配你发送的片段；模型的解释仍需你结合完整规则判断。")
                            .font(.system(size: 12)).foregroundStyle(InkpawColors.muted)
                    }
                }
            }.frame(maxWidth: InkpawLayout.contentMeasure).padding(InkpawLayout.pagePadding).frame(maxWidth: .infinity)
        }
        .sheet(item: $preview) { prepared in
            QuestionPreview(question: prepared.question, destination: prepared.serviceAddress) {
                store.sendQuestion(prepared.question, confirmedServiceAddress: prepared.serviceAddress)
            }
        }
        .sheet(item: $sourceInspection) { source in
            SourceInspector(passage: source.passage, quote: source.quote, localURL: source.localURL)
        }
    }

    private func chooseDocuments() {
        let panel = NSOpenPanel()
        panel.title = "选择要在本机导入的比赛规则"
        panel.message = "只读取你选择的文件。模型问答需在之后单独预览并确认发送。"
        panel.allowedContentTypes = [.plainText, .pdf, UTType(filenameExtension: "md") ?? .plainText]
        panel.allowsMultipleSelection = true
        panel.canChooseDirectories = false
        if panel.runModal() == .OK { store.importDocuments(panel.urls) }
    }
}

private struct QuestionPreview: View {
    let question: DocumentQuestion
    let destination: String
    let send: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var sending = false

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("确认本次文档发送").font(InkpawType.dialogTitle)
            Text("目标服务：\(destination)").font(.system(size: 13, weight: .semibold)).textSelection(.enabled)
            Text("以下问题和片段将交给你配置的 Inkpaw 服务及其模型处理，可能消耗该服务已有模型额度。不会发送其他文件或本地路径；可以取消。")
                .font(.system(size: 12)).foregroundStyle(InkpawColors.muted)
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    Text(question.question).font(.system(size: 15, weight: .medium)).textSelection(.enabled)
                    ForEach(question.passages) { passage in
                        VStack(alignment: .leading, spacing: 6) {
                            Text("\(passage.title) · \(passage.locator)").font(.system(size: 12, weight: .semibold))
                            Text(passage.text).font(.system(size: 13)).textSelection(.enabled)
                        }.padding(16).frame(maxWidth: .infinity, alignment: .leading)
                            .background(InkpawColors.surfaceMuted, in: RoundedRectangle(cornerRadius: InkpawLayout.controlRadius))
                    }
                }
            }
            HStack {
                Text("\(question.passages.count) 个片段").font(InkpawType.metadata).foregroundStyle(InkpawColors.muted)
                Spacer()
                Button("取消") { dismiss() }.keyboardShortcut(.cancelAction)
                Button("发送这些片段") { sending = true; send(); dismiss() }
                    .buttonStyle(InkpawButtonStyle(.primary)).disabled(sending)
            }
        }.modifier(InkpawDialogChrome()).frame(width: 600, height: 620)
    }
}

private struct SourceInspector: View {
    let passage: DocumentPassage
    let quote: String
    let localURL: URL?
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text(passage.title).font(InkpawType.dialogTitle)
            Text(passage.locator).font(InkpawType.metadata).foregroundStyle(InkpawColors.muted)
            if !quote.isEmpty {
                Text("引用原句").font(.system(size: 12, weight: .semibold))
                Text(quote).font(.system(size: 13)).textSelection(.enabled).padding(12)
                    .background(InkpawColors.accentSoft, in: RoundedRectangle(cornerRadius: 8))
            }
            Text("完整来源片段").font(.system(size: 12, weight: .semibold))
            ScrollView { Text(passage.text).font(.system(size: 13)).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading) }
            HStack {
                if let localURL {
                    Button("在 Finder 中显示原文件") { NSWorkspace.shared.activateFileViewerSelecting([localURL]) }
                }
                Spacer()
                Button("完成") { dismiss() }.keyboardShortcut(.defaultAction)
            }
        }.modifier(InkpawDialogChrome()).frame(width: 600, height: 580)
    }
}
#endif
