#if os(macOS)
import Foundation
import XCTest
import UserNotifications
import InkpawCore
import InkpawInfrastructure
@testable import InkpawCompanion

private final class SessionStubProtocol: URLProtocol, @unchecked Sendable {
    private static let lock = NSLock()
    private static var paths: [String] = []
    private var stopped = false
    private let stopLock = NSLock()
    static func reset() { lock.lock(); paths = []; lock.unlock() }
    static var requestCount: Int { lock.lock(); defer { lock.unlock() }; return paths.count }
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let path = request.url!.path
        Self.lock.lock(); Self.paths.append(path); Self.lock.unlock()
        DispatchQueue.global().asyncAfter(deadline: .now() + 0.03) { [self] in
            stopLock.lock(); let isStopped = stopped; stopLock.unlock()
            guard !isStopped else { return }
            let body: String
            if path.hasSuffix("auth/login") {
                body = #"{"code":200,"data":{"id":"synthetic-user","username":"synthetic@example.test"}}"#
            } else if path.hasSuffix("auth/logout") {
                body = #"{"code":503,"data":null}"#
            } else {
                body = #"{"code":401,"data":null}"#
            }
            let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil,
                headerFields: ["Content-Type": "application/json"])!
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: Data(body.utf8))
            client?.urlProtocolDidFinishLoading(self)
        }
    }
    override func stopLoading() { stopLock.lock(); stopped = true; stopLock.unlock() }
}

@MainActor
private final class StoreNotificationCenter: InkpawNotificationCenter {
    var pending: [UNNotificationRequest] = []
    func authorizationStatus() async -> UNAuthorizationStatus { .authorized }
    func requestAuthorization() async throws -> Bool { true }
    func pendingRequests() async -> [UNNotificationRequest] { pending }
    func deliveredRequestIDs() async -> [String] { [] }
    func add(_ request: UNNotificationRequest) async throws {
        pending.removeAll { $0.identifier == request.identifier }; pending.append(request)
    }
    func removePending(identifiers: [String]) { pending.removeAll { identifiers.contains($0.identifier) } }
}

final class CompanionStoreSessionTests: XCTestCase {
    @MainActor
    private func waitUntil(_ condition: () -> Bool) async throws {
        for _ in 0..<200 where !condition() { try await Task.sleep(nanoseconds: 10_000_000) }
        XCTAssertTrue(condition())
    }

    @MainActor
    private func sessionStore() throws -> (CompanionStore, String) {
        SessionStubProtocol.reset()
        let suite = "InkpawStoreTests." + UUID().uuidString
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        let store = CompanionStore(preferences: defaults, clientFactory: {
            try DocumentClient(baseURL: $0, protocolClasses: [SessionStubProtocol.self])
        })
        try store.configureService("https://synthetic.example.test/api")
        return (store, suite)
    }

    @MainActor
    func testUnconfirmedLoginDestinationMakesNoRequest() throws {
        let (store, suite) = try sessionStore()
        defer { store.stop(); UserDefaults.standard.removePersistentDomain(forName: suite) }
        store.signIn(email: "synthetic@example.test", password: "synthetic", confirmedServiceAddress: "https://different.example.test/api")
        XCTAssertFalse(store.isSigningIn)
        XCTAssertEqual(SessionStubProtocol.requestCount, 0)
        XCTAssertNotNil(store.errorMessage)
    }

    @MainActor
    func testFailedLogoutClearsIdentityAndBlocksConcurrentReconfiguration() async throws {
        let (store, suite) = try sessionStore()
        defer { store.stop(); UserDefaults.standard.removePersistentDomain(forName: suite) }
        store.signIn(email: "synthetic@example.test", password: "synthetic", confirmedServiceAddress: store.serviceAddress)
        try await waitUntil { !store.isSigningIn }
        XCTAssertNotNil(store.signedInName)
        store.signOut()
        XCTAssertNil(store.signedInName)
        XCTAssertThrowsError(try store.configureService("https://different.example.test/api"))
        try await waitUntil { !store.isSigningOut }
        XCTAssertNil(store.signedInName)
        XCTAssertNotNil(store.errorMessage)
        store.signIn(email: "synthetic@example.test", password: "synthetic", confirmedServiceAddress: store.serviceAddress)
        try await waitUntil { !store.isSigningIn }
        XCTAssertNotNil(store.signedInName)
    }

    @MainActor
    func testExpiredQuestionSessionReturnsToLoggedOutState() async throws {
        let (store, suite) = try sessionStore()
        defer { store.stop(); UserDefaults.standard.removePersistentDomain(forName: suite) }
        store.signIn(email: "synthetic@example.test", password: "synthetic", confirmedServiceAddress: store.serviceAddress)
        try await waitUntil { !store.isSigningIn }
        let passage = DocumentPassage(id: "p1", documentID: "d1", title: "Synthetic rules", locator: "Line 1", text: "Submit a demo.")
        store.sendQuestion(DocumentQuestion(question: "What?", passages: [passage]), confirmedServiceAddress: store.serviceAddress)
        try await waitUntil { !store.isAnswering }
        XCTAssertNil(store.signedInName)
        XCTAssertNil(store.answer)
    }

    @MainActor
    func testDisableThenImmediateQuitCancelsSystemRequests() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let center = StoreNotificationCenter()
        let store = CompanionStore(stateURL: directory.appendingPathComponent("state.json"), notificationScheduler: NotificationScheduler(center: center))
        defer { store.stop(); try? FileManager.default.removeItem(at: directory) }
        store.start(); try await waitUntil { store.isLoaded }
        try store.saveSchedule(id: nil, title: "Synthetic sprint", start: Date().addingTimeInterval(7200), end: Date().addingTimeInterval(21600), zone: "UTC", precision: .exact)
        store.enableReminders(); try await waitUntil { store.state.reminderPreferences.isEnabled }
        try await store.flushReminders()
        XCTAssertFalse(center.pending.isEmpty)
        store.disableReminders()
        try await store.prepareForTermination()
        XCTAssertTrue(center.pending.isEmpty)
    }

    @MainActor
    func testDeadlineEditThenImmediateQuitReplacesOldPlan() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let center = StoreNotificationCenter()
        let store = CompanionStore(stateURL: directory.appendingPathComponent("state.json"), notificationScheduler: NotificationScheduler(center: center))
        defer { store.stop(); try? FileManager.default.removeItem(at: directory) }
        store.start(); try await waitUntil { store.isLoaded }
        let start = Date().addingTimeInterval(7200)
        try store.saveSchedule(id: nil, title: "Synthetic sprint", start: start, end: start.addingTimeInterval(14400), zone: "UTC", precision: .exact)
        store.enableReminders(); try await waitUntil { store.state.reminderPreferences.isEnabled }
        try await store.flushReminders()
        let oldDeadlineIDs = Set(center.pending.filter { $0.content.title.hasPrefix("Deadline:") }.map(\.identifier))
        let scheduleID = try XCTUnwrap(store.selectedSchedule?.id)
        try store.saveSchedule(id: scheduleID, title: "Synthetic sprint", start: start, end: start.addingTimeInterval(28800), zone: "UTC", precision: .exact)
        try await store.prepareForTermination()
        XCTAssertTrue(Set(center.pending.map(\.identifier)).isDisjoint(with: oldDeadlineIDs))
        XCTAssertFalse(center.pending.isEmpty)
    }
}
#endif
