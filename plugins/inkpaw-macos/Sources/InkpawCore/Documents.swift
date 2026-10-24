import Foundation

/// IDs are stable caller-supplied identifiers, not titles or array positions.
/// A source URL may point to a user-selected local file.
public struct SourceDocument: Codable, Equatable, Sendable, Identifiable {
    public let id: String
    public let title: String
    public let locator: String
    public let sourceURL: URL?
    public let text: String

    public init(id: String, title: String, locator: String, sourceURL: URL?, text: String) {
        self.id = id
        self.title = title
        self.locator = locator
        self.sourceURL = sourceURL
        self.text = text
    }
}

/// This record is also the bounded document-answer service's passage wire contract.
public struct DocumentPassage: Codable, Equatable, Sendable, Identifiable {
    public let id: String
    public let documentID: String
    public let title: String
    public let locator: String
    public let text: String

    public init(id: String, documentID: String, title: String, locator: String, text: String) {
        self.id = id
        self.documentID = documentID
        self.title = title
        self.locator = locator
        self.text = text
    }

    private enum CodingKeys: String, CodingKey {
        case id = "passage_id"
        case documentID = "document_id"
        case title
        case locator
        case text
    }
}

/// A citation resolves through stable document/passage IDs; quotes remain verbatim.
public struct SourceCitation: Codable, Equatable, Sendable {
    public let documentID: String
    public let passageID: String
    public let quote: String

    public init(documentID: String, passageID: String, quote: String) {
        self.documentID = documentID
        self.passageID = passageID
        self.quote = quote
    }

    private enum CodingKeys: String, CodingKey {
        case documentID = "document_id"
        case passageID = "passage_id"
        case quote
    }
}

public struct GroundedClaim: Codable, Equatable, Sendable {
    public let text: String
    public let citations: [SourceCitation]

    public init(text: String, citations: [SourceCitation]) {
        self.text = text
        self.citations = citations
    }
}

public struct DocumentQuestion: Codable, Equatable, Sendable {
    public let question: String
    public let passages: [DocumentPassage]

    public init(question: String, passages: [DocumentPassage]) {
        self.question = question
        self.passages = passages
    }
}

public enum DocumentAnswerStatus: String, Codable, Equatable, Sendable {
    case answered
    case insufficientEvidence = "insufficient_evidence"
}

public struct DocumentAnswer: Codable, Equatable, Sendable {
    public let status: DocumentAnswerStatus
    public let claims: [GroundedClaim]

    public init(status: DocumentAnswerStatus, claims: [GroundedClaim]) {
        self.status = status
        self.claims = claims
    }
}
