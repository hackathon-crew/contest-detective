import Foundation
import InkpawCore
#if canImport(PDFKit)
import PDFKit
#endif

public enum DocumentImportError: Error, Equatable, Sendable, LocalizedError {
    case localFileRequired
    case unsupportedFormat
    case notRegularFile
    case fileTooLarge
    case unreadableFile
    case invalidUTF8
    case emptyDocument
    case extractedTextTooLong
    case pdfUnavailable
    case invalidPDF
    case encryptedPDF
    case unextractablePDFPage(Int)

    public var errorDescription: String? {
        switch self {
        case .localFileRequired: return "请选择本地文件；文档导入不会抓取网络地址。"
        case .unsupportedFormat: return "仅支持 UTF-8 TXT、Markdown 和可提取文字的 PDF。"
        case .notRegularFile: return "请选择普通文件，不能导入文件夹或设备。"
        case .fileTooLarge: return "文件不能超过 2 MiB。"
        case .unreadableFile: return "无法读取所选文件，请重新选择并检查访问权限。"
        case .invalidUTF8: return "文本必须为 UTF-8 编码，且不能包含二进制空字符。"
        case .emptyDocument: return "文档没有可用文字。"
        case .extractedTextTooLong: return "文档文字不能超过 32,000 个字符，请先选择较小的文档。"
        case .pdfUnavailable: return "当前平台无法提取 PDF 文字；请在 macOS 上导入，或选择 UTF-8 文本。"
        case .invalidPDF: return "无法解析这个 PDF。"
        case .encryptedPDF: return "暂不支持加密或锁定的 PDF。"
        case .unextractablePDFPage(let page):
            return "PDF 第 \(page) 页没有可提取文字；扫描件和 OCR 暂不支持，请使用文字版。"
        }
    }
}

/// Reads only a caller-selected local file. Importing and splitting never performs network I/O.
/// PDF page boundaries are retained as form-feed characters in the locally persisted text.
public struct DocumentImporter: Sendable {
    public static let maximumFileBytes = 2 * 1024 * 1024
    public static let maximumTextCharacters = 32_000
    public static let maximumPassageCharacters = 2_000

    public init() {}

    public func importDocument(at url: URL) throws -> SourceDocument {
        guard url.isFileURL, url.host == nil || url.host == "" || url.host == "localhost",
              url.query == nil, url.fragment == nil, url.user == nil, url.password == nil else {
            throw DocumentImportError.localFileRequired
        }
        let format = url.pathExtension.lowercased()
        guard ["txt", "md", "markdown", "pdf"].contains(format) else {
            throw DocumentImportError.unsupportedFormat
        }
        let data = try readBoundedFile(url)
        let text: String
        if format == "pdf" {
            text = try extractPDF(data)
        } else {
            guard let decoded = String(data: data, encoding: .utf8), !decoded.contains("\0") else {
                throw DocumentImportError.invalidUTF8
            }
            text = decoded
        }
        try validateText(text)
        return SourceDocument(
            id: UUID().uuidString.lowercased(),
            title: String(url.lastPathComponent.unicodeScalars.prefix(240)),
            locator: format == "pdf" ? "PDF pages" : "Text lines",
            sourceURL: url,
            text: text
        )
    }

    /// Stable IDs and line/page locators can be reconstructed after a state round-trip.
    /// Every passage is an exact substring of the persisted source, never a summary.
    public func passages(for document: SourceDocument) throws -> [DocumentPassage] {
        try validateText(document.text)
        let isPDF = document.locator == "PDF pages" && document.sourceURL?.pathExtension.lowercased() == "pdf"
        let pages = isPDF ? document.text.components(separatedBy: "\u{000C}") : [document.text]
        var result: [DocumentPassage] = []
        for (pageIndex, page) in pages.enumerated() {
            var pending = ""
            var pendingStart = 1
            var pendingEnd = 1
            func emit() {
                guard !pending.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
                    pending = ""
                    return
                }
                let lines = pendingStart == pendingEnd ? "Line \(pendingStart)" : "Lines \(pendingStart)–\(pendingEnd)"
                result.append(DocumentPassage(
                    id: "\(document.id):chunk-\(result.count + 1)",
                    documentID: document.id,
                    title: document.title,
                    locator: isPDF ? "Page \(pageIndex + 1), \(lines)" : lines,
                    text: pending
                ))
                pending = ""
            }
            for (offset, line) in Self.linesPreservingEndings(page).enumerated() {
                var remaining = line.unicodeScalars[...]
                while !remaining.isEmpty {
                    if pending.unicodeScalars.count == Self.maximumPassageCharacters { emit() }
                    let capacity = Self.maximumPassageCharacters - pending.unicodeScalars.count
                    let part = remaining.prefix(capacity)
                    if pending.isEmpty { pendingStart = offset + 1 }
                    pendingEnd = offset + 1
                    pending += String(String.UnicodeScalarView(part))
                    remaining = remaining.dropFirst(part.count)
                }
            }
            emit()
        }
        return result
    }

    private func readBoundedFile(_ url: URL) throws -> Data {
        do {
            let attributes = try url.resourceValues(forKeys: [.isRegularFileKey, .fileSizeKey])
            guard attributes.isRegularFile == true else { throw DocumentImportError.notRegularFile }
            guard (attributes.fileSize ?? 0) <= Self.maximumFileBytes else {
                throw DocumentImportError.fileTooLarge
            }
            let file = try FileHandle(forReadingFrom: url)
            defer { try? file.close() }
            // Bound the actual read as well as metadata, including if the file changes after inspection.
            var data = Data()
            while data.count <= Self.maximumFileBytes {
                let remaining = Self.maximumFileBytes + 1 - data.count
                let part = try file.read(upToCount: min(64 * 1024, remaining)) ?? Data()
                if part.isEmpty { break }
                data.append(part)
            }
            guard data.count <= Self.maximumFileBytes else { throw DocumentImportError.fileTooLarge }
            return data
        } catch let error as DocumentImportError {
            throw error
        } catch {
            throw DocumentImportError.unreadableFile
        }
    }

    private func validateText(_ text: String) throws {
        guard text.unicodeScalars.count <= Self.maximumTextCharacters else {
            throw DocumentImportError.extractedTextTooLong
        }
        guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw DocumentImportError.emptyDocument
        }
    }

    private func extractPDF(_ data: Data) throws -> String {
        #if canImport(PDFKit)
        guard let pdf = PDFDocument(data: data) else { throw DocumentImportError.invalidPDF }
        guard !pdf.isEncrypted, !pdf.isLocked else { throw DocumentImportError.encryptedPDF }
        guard pdf.pageCount > 0 else { throw DocumentImportError.emptyDocument }
        guard pdf.pageCount <= 256 else { throw DocumentImportError.extractedTextTooLong }
        var pages: [String] = []
        var scalarCount = 0
        for pageIndex in 0..<pdf.pageCount {
            guard let text = pdf.page(at: pageIndex)?.string,
                  !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
                // Reject partial extraction rather than silently representing an image page as read.
                throw DocumentImportError.unextractablePDFPage(pageIndex + 1)
            }
            scalarCount += text.unicodeScalars.count + (pageIndex == 0 ? 0 : 1)
            guard scalarCount <= Self.maximumTextCharacters else {
                throw DocumentImportError.extractedTextTooLong
            }
            pages.append(text)
        }
        return pages.joined(separator: "\u{000C}")
        #else
        throw DocumentImportError.pdfUnavailable
        #endif
    }

    private static func linesPreservingEndings(_ text: String) -> [String] {
        var result: [String] = []
        var line = ""
        for character in text {
            line.append(character)
            if character.isNewline { result.append(line); line = "" }
        }
        if !line.isEmpty { result.append(line) }
        return result
    }
}
