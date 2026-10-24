import Foundation
import XCTest
import InkpawCore
@testable import InkpawInfrastructure
#if canImport(PDFKit)
import PDFKit
import AppKit
#endif

final class DocumentImporterTests: XCTestCase {
    private var directory: URL!
    private let importer = DocumentImporter()

    override func setUpWithError() throws {
        directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    }

    override func tearDownWithError() throws { try FileManager.default.removeItem(at: directory) }

    func testImportPreservesExactTextAndStablePassagesAfterPersistence() throws {
        let original = "# Synthetic rules\r\n  Deadline: 20:00.  \r\n提交前阅读。\n"
        let url = try fixture("rules.md", Data(original.utf8))
        let document = try importer.importDocument(at: url)
        XCTAssertEqual(document.title, "rules.md")
        XCTAssertEqual(document.sourceURL, url)
        XCTAssertEqual(document.text, original)
        let restored = try JSONDecoder().decode(SourceDocument.self, from: JSONEncoder().encode(document))
        let passages = try importer.passages(for: document)
        XCTAssertEqual(passages, try importer.passages(for: restored))
        XCTAssertEqual(passages.map(\.text).joined(), original)
        XCTAssertEqual(passages.first?.locator, "Lines 1–3")
        XCTAssertEqual(passages.first?.id, "\(document.id):chunk-1")
    }

    func testLongLinesSplitWithoutChangingUnicodeOrLosingCharacters() throws {
        let text = String(repeating: "e\u{301}", count: 2_500) + "\nLast line."
        let document = try importer.importDocument(at: fixture("unicode.txt", Data(text.utf8)))
        let passages = try importer.passages(for: document)
        XCTAssertEqual(passages.count, 3)
        XCTAssertEqual(passages.map(\.text).joined(), text)
        XCTAssertEqual(passages[0].locator, "Line 1")
        XCTAssertEqual(passages.last?.locator, "Lines 1–2")
        for passage in passages {
            XCTAssertLessThanOrEqual(passage.text.unicodeScalars.count, DocumentImporter.maximumPassageCharacters)
            XCTAssertNotNil(Data(text.utf8).range(of: Data(passage.text.utf8)))
        }
    }

    func testPDFPageBoundariesRegenerateWithoutPDFKitOrReadingOriginalFile() throws {
        let document = SourceDocument(
            id: "synthetic-pdf", title: "Synthetic PDF", locator: "PDF pages",
            sourceURL: URL(fileURLWithPath: "/synthetic/not-accessed.pdf"),
            text: "First page.\nSecond line.\u{000C}Next page."
        )
        let passages = try importer.passages(for: document)
        XCTAssertEqual(passages.count, 2)
        XCTAssertEqual(passages[0].locator, "Page 1, Lines 1–2")
        XCTAssertEqual(passages[1].locator, "Page 2, Line 1")
        XCTAssertEqual(passages[1].text, "Next page.")
    }

    func testRejectsNetworkURLsUnsupportedFormatsAndDirectories() throws {
        assertImportError(URL(string: "https://example.invalid/rules.md")!, .localFileRequired)
        assertImportError(URL(string: "file://remote.invalid/rules.md")!, .localFileRequired)
        assertImportError(try fixture("rules.rtf", Data("text".utf8)), .unsupportedFormat)
        let folder = directory.appendingPathComponent("folder.txt")
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: false)
        assertImportError(folder, .notRegularFile)
    }

    func testRejectsOversizeInvalidAndEmptyTextWithoutTruncating() throws {
        assertImportError(try fixture("large.txt", Data(repeating: 65, count: DocumentImporter.maximumFileBytes + 1)), .fileTooLarge)
        assertImportError(try fixture("long.txt", Data(repeating: 65, count: 32_001)), .extractedTextTooLong)
        assertImportError(try fixture("invalid.txt", Data([0xFF, 0xFE])), .invalidUTF8)
        assertImportError(try fixture("binary.txt", Data([65, 0, 66])), .invalidUTF8)
        assertImportError(try fixture("empty.txt", Data(" \n\t".utf8)), .emptyDocument)
        assertImportError(directory.appendingPathComponent("missing.txt"), .unreadableFile)
    }

    #if canImport(PDFKit)
    func testExtractsTextPDFWithPageLocatorsOnMacOS() throws {
        let data = NSMutableData()
        var bounds = CGRect(x: 0, y: 0, width: 400, height: 200)
        let consumer = CGDataConsumer(data: data)!
        let context = CGContext(consumer: consumer, mediaBox: &bounds, nil)!
        for value in ["Synthetic page one.", "Synthetic page two."] {
            context.beginPDFPage(nil)
            let graphics = NSGraphicsContext(cgContext: context, flipped: false)
            NSGraphicsContext.saveGraphicsState()
            NSGraphicsContext.current = graphics
            (value as NSString).draw(at: CGPoint(x: 20, y: 100), withAttributes: [.font: NSFont.systemFont(ofSize: 16)])
            NSGraphicsContext.restoreGraphicsState()
            context.endPDFPage()
        }
        context.closePDF()
        let document = try importer.importDocument(at: fixture("text.pdf", data as Data))
        let passages = try importer.passages(for: document)
        XCTAssertEqual(passages.count, 2)
        XCTAssertTrue(passages[0].locator.hasPrefix("Page 1,"))
        XCTAssertTrue(passages[1].text.contains("Synthetic page two."))
    }

    func testRejectsPDFPagesWithoutExtractableTextOnMacOS() throws {
        let pdf = PDFDocument()
        let bitmap = CGContext(
            data: nil, width: 100, height: 100, bitsPerComponent: 8, bytesPerRow: 0,
            space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
        )!
        bitmap.setFillColor(CGColor(gray: 1, alpha: 1))
        bitmap.fill(CGRect(x: 0, y: 0, width: 100, height: 100))
        let image = NSImage(cgImage: bitmap.makeImage()!, size: NSSize(width: 100, height: 100))
        pdf.insert(PDFPage(image: image)!, at: 0)
        assertImportError(try fixture("scan.pdf", pdf.dataRepresentation()!), .unextractablePDFPage(1))
    }
    #else
    func testPDFImportIsExplicitlyUnavailableWithoutPDFKit() throws {
        assertImportError(try fixture("not-extracted.pdf", Data("synthetic".utf8)), .pdfUnavailable)
    }
    #endif

    private func fixture(_ name: String, _ data: Data) throws -> URL {
        let url = directory.appendingPathComponent(name)
        try data.write(to: url)
        return url
    }

    private func assertImportError(_ url: URL, _ error: DocumentImportError, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertThrowsError(try importer.importDocument(at: url), file: file, line: line) {
            XCTAssertEqual($0 as? DocumentImportError, error, file: file, line: line)
        }
    }
}
