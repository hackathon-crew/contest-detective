import Foundation

public struct GitRepositoryReference: Codable, Equatable, Sendable, Identifiable {
    public let id: String
    public let name: String
    public let directoryURL: URL

    public init(id: String, name: String, directoryURL: URL) {
        self.id = id
        self.name = name
        self.directoryURL = directoryURL
    }
}

public struct GitCommit: Codable, Equatable, Sendable {
    public let objectID: String
    public let subject: String
    public let authoredAt: Date
    public let committedAt: Date

    public init(objectID: String, subject: String, authoredAt: Date, committedAt: Date) {
        self.objectID = objectID
        self.subject = subject
        self.authoredAt = authoredAt
        self.committedAt = committedAt
    }
}

public struct GitWorkingTreeStatus: Codable, Equatable, Sendable {
    public let branchName: String?
    public let headObjectID: String?
    public let isDetachedHead: Bool
    public let trackedChangeCount: Int
    public let untrackedFileCount: Int

    public init(
        branchName: String?,
        headObjectID: String?,
        isDetachedHead: Bool,
        trackedChangeCount: Int,
        untrackedFileCount: Int
    ) {
        self.branchName = branchName
        self.headObjectID = headObjectID
        self.isDetachedHead = isDetachedHead
        self.trackedChangeCount = trackedChangeCount
        self.untrackedFileCount = untrackedFileCount
    }
}

public enum GitUpstreamCaveat: String, Codable, Equatable, Sendable {
    case localTrackingRefsMayBeStale
}

/// Ahead/behind counts describe local tracking refs, never a newly fetched remote.
public struct GitUpstreamStatus: Codable, Equatable, Sendable {
    public let remoteName: String
    public let branchName: String
    public let trackingObjectID: String?
    public let lastFetchAt: Date?
    public let aheadCount: Int?
    public let behindCount: Int?
    public let caveat: GitUpstreamCaveat

    public init(
        remoteName: String,
        branchName: String,
        trackingObjectID: String?,
        lastFetchAt: Date?,
        aheadCount: Int?,
        behindCount: Int?,
        caveat: GitUpstreamCaveat
    ) {
        self.remoteName = remoteName
        self.branchName = branchName
        self.trackingObjectID = trackingObjectID
        self.lastFetchAt = lastFetchAt
        self.aheadCount = aheadCount
        self.behindCount = behindCount
        self.caveat = caveat
    }
}

public enum GitPushEvidenceKind: String, Codable, Equatable, Sendable {
    case remoteTrackingReflogPushEntry
}

public struct GitPushEvidence: Codable, Equatable, Sendable {
    public let kind: GitPushEvidenceKind
    public let recordID: String
    public let observedAt: Date
    public let detail: String

    public init(kind: GitPushEvidenceKind, recordID: String, observedAt: Date, detail: String) {
        self.kind = kind
        self.recordID = recordID
        self.observedAt = observedAt
        self.detail = detail
    }
}

/// A push entry requires direct local push evidence, not a commit-time inference.
public struct EvidencedLocalPush: Codable, Equatable, Sendable, Identifiable {
    public let id: String
    public let remoteName: String
    public let destinationRef: String
    public let objectID: String
    public let occurredAt: Date?
    public let evidence: GitPushEvidence

    public init(
        id: String,
        remoteName: String,
        destinationRef: String,
        objectID: String,
        occurredAt: Date?,
        evidence: GitPushEvidence
    ) {
        self.id = id
        self.remoteName = remoteName
        self.destinationRef = destinationRef
        self.objectID = objectID
        self.occurredAt = occurredAt
        self.evidence = evidence
    }
}

public struct GitSnapshot: Codable, Equatable, Sendable {
    public let repositoryID: String
    public let observedAt: Date
    public let commits: [GitCommit]
    public let workingTree: GitWorkingTreeStatus
    public let upstream: GitUpstreamStatus?
    public let evidencedLocalPushes: [EvidencedLocalPush]

    public init(
        repositoryID: String,
        observedAt: Date,
        commits: [GitCommit],
        workingTree: GitWorkingTreeStatus,
        upstream: GitUpstreamStatus?,
        evidencedLocalPushes: [EvidencedLocalPush]
    ) {
        self.repositoryID = repositoryID
        self.observedAt = observedAt
        self.commits = commits
        self.workingTree = workingTree
        self.upstream = upstream
        self.evidencedLocalPushes = evidencedLocalPushes
    }
}
