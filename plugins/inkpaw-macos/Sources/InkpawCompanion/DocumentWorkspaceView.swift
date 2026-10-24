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
            VStack(alignment: .leading, spacing: 20) {
                HStack(alignment: .top) {
                    WorkspaceTitle(title: "规则文档问答", subtitle: "只根据你选中的原文回答，每条结论都能打开对应出处。")
                    Button("导入文档", action: chooseDocuments).buttonStyle(.borderedProminent).tint(InkpawColors.accent)
                }
                InkpawCard {
                    HStack {
                        Label("本机规则资料", systemImage: "folder")
                            .font(.system(size: 16, weight: .semibold))
                        Spacer()
                        Text("\(store.state.documents.count) 份文档").font(.caption).foregroundStyle(InkpawColors.muted)
                    }
                    if store.state.documents.isEmpty {
                        Text("选择 TXT、Markdown 或有可提取文字的 PDF。导入不会联网，扫描 PDF 暂不支持。")
                            .font(.system(size: 13)).foregroundStyle(InkpawColors.muted)
                    }
                    ForEach(store.state.documents) { document in
                        HStack {
                            Image(systemName: "doc.text").foregroundStyle(InkpawColors.accent)
                            VStack(alignment: .leading, spacing: 3) {
                                Text(document.title).font(.system(size: 13, weight: .medium))
                                Text("本地保存 · \(document.text.count) 字符").font(.system(size: 11)).foregroundStyle(InkpawColors.muted)
                            }
                            Spacer()
                            if let url = document.sourceURL {
                                Button { NSWorkspace.shared.activateFileViewerSelecting([url]) } label: { Image(systemName: "folder") }
                                    .help("在 Finder 中显示原文件")
                            }
                            Button { store.removeDocument(document.id) } label: { Image(systemName: "trash") }
                                .help("从插件移除此文档，不删除原文件")
                        }
                    }
                    if !store.passages.isEmpty {
                        Divider()
                        TextField("原文查找（仅筛选片段，不生成回答）", text: $findText)
                        HStack {
                            Text("选择本次要发送的片段：\(store.selectedPassageIDs.count)/8")
                            Spacer()
                            Button("清空选择") { store.selectedPassageIDs.removeAll() }
                        }.font(.system(size: 12)).foregroundStyle(InkpawColors.muted)
                        ForEach(visiblePassages) { passage in
                            HStack(alignment: .top, spacing: 10) {
                                Toggle("", isOn: Binding(get: { store.selectedPassageIDs.contains(passage.id) },
                                                          set: { _ in store.togglePassage(passage.id) }))
                                    .labelsHidden().toggleStyle(.checkbox)
                                    .accessibilityLabel("选择 \(passage.title)，\(passage.locator)")
                                VStack(alignment: .leading, spacing: 4) {
                                    Text("\(passage.title) · \(passage.locator)").font(.system(size: 12, weight: .semibold))
                                    Text(String(passage.text.prefix(180))).font(.system(size: 12)).foregroundStyle(InkpawColors.muted)
                                        .lineLimit(3)
                                }
                                Spacer(minLength: 4)
                                Button("全文") {
                                    sourceInspection = SourceInspection(passage: passage, quote: "",
                                        localURL: store.state.documents.first { $0.id == passage.documentID }?.sourceURL)
                                }.font(.system(size: 11))
                            }
                            .padding(10).background(InkpawColors.surfaceMuted, in: RoundedRectangle(cornerRadius: 8))
                        }
                    }
                }
                InkpawCard {
                    Text("向规则提问").font(.system(size: 16, weight: .semibold))
                    TextField("例如：必须提交哪些材料？视频最长多久？", text: $question, axis: .vertical)
                        .lineLimit(2...4).textFieldStyle(.roundedBorder)
                    HStack {
                        if store.isAnswering {
                            ProgressView().controlSize(.small)
                            Text("正在核对所选原文…").font(.caption).foregroundStyle(InkpawColors.muted)
                            Spacer()
                            Button("取消请求") { store.cancelQuestion() }
                        } else {
                            Text("\(question.count)/1000 字符 · 最多 24 KiB 请求")
                                .font(.system(size: 11)).foregroundStyle(InkpawColors.faint)
                            Spacer()
                            Button("预览并发送") {
                                preview = PreparedQuestion(question: DocumentQuestion(question: question, passages: store.selectedPassages),
                                                           serviceAddress: store.serviceAddress)
                            }
                            .buttonStyle(.borderedProminent).tint(InkpawColors.accent)
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
                            VStack(alignment: .leading, spacing: 9) {
                                Text("\(index + 1). \(claim.text)").font(.system(size: 14)).textSelection(.enabled)
                                ForEach(Array(claim.citations.enumerated()), id: \.offset) { _, citation in
                                    if let passage = store.answerPassages.first(where: { $0.id == citation.passageID && $0.documentID == citation.documentID }) {
                                        Button {
                                            sourceInspection = SourceInspection(passage: passage, quote: citation.quote,
                                                localURL: store.state.documents.first { $0.id == passage.documentID }?.sourceURL)
                                        } label: {
                                            VStack(alignment: .leading, spacing: 5) {
                                                Label("\(passage.title) · \(passage.locator)", systemImage: "text.quote")
                                                    .font(.system(size: 11, weight: .semibold)).foregroundStyle(InkpawColors.accent)
                                                Text(citation.quote).font(.system(size: 12)).foregroundStyle(InkpawColors.body)
                                                    .lineLimit(4)
                                            }
                                            .frame(maxWidth: .infinity, alignment: .leading).padding(11)
                                            .background(InkpawColors.accentSoft, in: RoundedRectangle(cornerRadius: 8))
                                        }.buttonStyle(.plain)
                                    }
                                }
                            }.padding(.vertical, 5)
                        }
                        Text("引用已经逐字匹配你发送的片段；模型的解释仍需你结合完整规则判断。")
                            .font(.system(size: 11)).foregroundStyle(InkpawColors.muted)
                    }
                }
            }.padding(26)
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
            Text("确认本次文档发送").font(.title2.bold())
            Text("目标服务：\(destination)").font(.system(size: 13, weight: .semibold)).textSelection(.enabled)
            Text("以下问题和片段将交给你配置的 Inkpaw 服务及其模型处理，可能消耗该服务已有模型额度。不会发送其他文件或本地路径；可以取消。")
                .font(.system(size: 12)).foregroundStyle(InkpawColors.muted)
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    Text(question.question).font(.system(size: 15, weight: .medium)).textSelection(.enabled)
                    ForEach(question.passages) { passage in
                        VStack(alignment: .leading, spacing: 6) {
                            Text("\(passage.title) · \(passage.locator)").font(.system(size: 12, weight: .semibold))
                            Text(passage.text).font(.system(size: 12)).textSelection(.enabled)
                        }.padding(14).frame(maxWidth: .infinity, alignment: .leading)
                            .background(InkpawColors.surfaceMuted, in: RoundedRectangle(cornerRadius: 10))
                    }
                }
            }
            HStack {
                Text("\(question.passages.count) 个片段").font(.caption).foregroundStyle(InkpawColors.muted)
                Spacer()
                Button("取消") { dismiss() }.keyboardShortcut(.cancelAction)
                Button("发送这些片段") { sending = true; send(); dismiss() }
                    .buttonStyle(.borderedProminent).tint(InkpawColors.accent).disabled(sending)
            }
        }.padding(24).frame(width: 570, height: 590)
    }
}

private struct SourceInspector: View {
    let passage: DocumentPassage
    let quote: String
    let localURL: URL?
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(passage.title).font(.title2.bold())
            Text(passage.locator).font(.caption).foregroundStyle(InkpawColors.muted)
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
        }.padding(24).frame(width: 570, height: 550)
    }
}
#endif
