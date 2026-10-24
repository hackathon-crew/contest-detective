import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
import XCTest
import InkpawCore
@testable import InkpawInfrastructure

final class DocumentClientTests: XCTestCase {
    override func tearDown() {
        DocumentProtocolStub.handler = nil
        StreamingDocumentProtocol.plan = nil
    }

    func testServiceURLPolicyRejectsLeaksAndRemotePlaintext() throws {
        for raw in [
            "http://example.invalid/api", "https://user:pass@example.invalid/api",
            "https://example.invalid/api?key=secret", "https://example.invalid/api#fragment",
            "ftp://example.invalid/api", "file:///tmp/api", "http://192.168.1.5/api",
            "http://localhost.example.invalid/api", "https://example.invalid:0/api",
        ] {
            XCTAssertThrowsError(try DocumentClient(baseURL: URL(string: raw)!)) {
                XCTAssertEqual($0 as? DocumentClientError, .invalidServiceURL, raw)
            }
        }
        for raw in ["https://example.invalid/api", "http://localhost:8000/api", "http://127.0.0.1/api", "http://[::1]/api"] {
            XCTAssertNoThrow(try DocumentClient(baseURL: URL(string: raw)!))
        }
    }

    func testConfigurationUsesIsolatedMemoryOnlyCookiesAndNoCredentialOrCacheStore() {
        let first = DocumentClient.sessionConfiguration(timeout: 150, protocolClasses: [DocumentProtocolStub.self])
        let second = DocumentClient.sessionConfiguration(timeout: 150, protocolClasses: nil)
        XCTAssertNil(first.urlCredentialStorage)
        XCTAssertNil(first.urlCache)
        XCTAssertNotNil(first.httpCookieStorage)
        XCTAssertFalse(first.httpCookieStorage === HTTPCookieStorage.shared)
        XCTAssertFalse(first.httpCookieStorage === second.httpCookieStorage)
        XCTAssertEqual(first.timeoutIntervalForResource, 150)
        let cookie = HTTPCookie(properties: [.name: "synthetic", .value: "memory-only", .domain: "example.invalid", .path: "/"])!
        first.httpCookieStorage?.setCookie(cookie)
        XCTAssertEqual(first.httpCookieStorage?.cookies?.count, 1)
        XCTAssertEqual(second.httpCookieStorage?.cookies?.count ?? 0, 0)
    }

    func testLoginSessionAndLogoutUseDedicatedAuthEnvelopeAndMinimalUser() async throws {
        let client = try makeClient()
        DocumentProtocolStub.handler = { request in
            XCTAssertEqual(request.url?.path, "/api/auth/login")
            XCTAssertEqual(request.httpMethod, "POST")
            XCTAssertEqual(request.timeoutInterval, 30)
            let data = try Self.requestBody(request)
            let json = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: String])
            XCTAssertEqual(json, ["email": "synthetic@example.invalid", "password": "synthetic-password"])
            return Self.response(request, #"{"code":200,"data":{"id":"user-1","username":"Synthetic","profile":{"ignored":"yes"}}}"#)
        }
        let user = try await client.login(email: "synthetic@example.invalid", password: "synthetic-password")
        XCTAssertEqual(user, CompanionUser(id: "user-1", username: "Synthetic"))
        DocumentProtocolStub.handler = { request in
            XCTAssertEqual(request.url?.path, "/api/auth/me")
            XCTAssertEqual(request.httpMethod, "GET")
            XCTAssertNil(request.httpBody)
            return Self.response(request, #"{"code":200,"data":null}"#)
        }
        let absentUser = try await client.checkSession()
        XCTAssertNil(absentUser)
        DocumentProtocolStub.handler = { request in
            XCTAssertEqual(request.url?.path, "/api/auth/logout")
            XCTAssertEqual(request.httpMethod, "POST")
            return Self.response(request, #"{"code":200,"data":null}"#)
        }
        try await client.logout()
    }

    func testAnswerWirePathPayloadAndCitationsArePreserved() async throws {
        let client = try makeClient()
        let question = fixtureQuestion()
        let answer = fixtureAnswer()
        DocumentProtocolStub.handler = { request in
            XCTAssertEqual(request.url?.path, "/api/companion/documents/ask")
            XCTAssertEqual(request.httpMethod, "POST")
            XCTAssertEqual(request.timeoutInterval, 150)
            XCTAssertEqual(request.value(forHTTPHeaderField: "Content-Type"), "application/json")
            XCTAssertNil(request.value(forHTTPHeaderField: "Authorization"))
            let body = try Self.requestBody(request)
            let decoded = try JSONDecoder().decode(DocumentQuestion.self, from: body)
            XCTAssertEqual(decoded, question)
            XCTAssertFalse(String(data: body, encoding: .utf8)!.contains("sourceURL"))
            return try Self.answerResponse(request, answer)
        }
        let actual = try await client.answer(question)
        XCTAssertEqual(actual, answer)
    }

    func testInsufficientEvidenceIsNotFabricatedAnswer() async throws {
        DocumentProtocolStub.handler = { request in
            return Self.response(request, #"{"code":200,"data":{"status":"insufficient_evidence","claims":[]}}"#)
        }
        let answer = try await makeClient().answer(fixtureQuestion())
        XCTAssertEqual(answer, DocumentAnswer(status: .insufficientEvidence, claims: []))
    }

    func testRejectsInvalidInputBeforeAnyNetworkRequest() async throws {
        DocumentProtocolStub.handler = { _ in XCTFail("Invalid inputs must not make a request."); return nil }
        let client = try makeClient()
        let passage = fixtureQuestion().passages[0]
        let invalid = [
            DocumentQuestion(question: " ", passages: [passage]),
            DocumentQuestion(question: String(repeating: "a", count: 1001), passages: [passage]),
            DocumentQuestion(question: "Question?", passages: []),
            DocumentQuestion(question: "Question?", passages: [passage, passage]),
            DocumentQuestion(question: "Question?", passages: [DocumentPassage(id: "p", documentID: "d", title: "T", locator: "L", text: String(repeating: "a", count: 4001))]),
        ]
        for question in invalid { await assertClientError(.invalidRequest) { try await client.answer(question) } }
        let large = (1...8).map { index in
            DocumentPassage(id: "p-\(index)", documentID: "d", title: "T", locator: "L", text: String(repeating: "中", count: 4000))
        }
        await assertClientError(.requestTooLarge) { try await client.answer(DocumentQuestion(question: "Question?", passages: large)) }
    }

    func testRejectsMissingUnknownAndInexactCitations() async throws {
        let good = SourceCitation(documentID: "doc-1", passageID: "passage-1", quote: "Submit by Friday.")
        let invalid = [
            DocumentAnswer(status: .answered, claims: []),
            DocumentAnswer(status: .answered, claims: [GroundedClaim(text: "Claim", citations: [])]),
            DocumentAnswer(status: .insufficientEvidence, claims: [GroundedClaim(text: "Claim", citations: [good])]),
            DocumentAnswer(status: .answered, claims: [GroundedClaim(text: "Claim", citations: [SourceCitation(documentID: "other", passageID: "passage-1", quote: good.quote)])]),
            DocumentAnswer(status: .answered, claims: [GroundedClaim(text: "Claim", citations: [SourceCitation(documentID: "doc-1", passageID: "passage-1", quote: "Submit on Monday.")])]),
        ]
        let client = try makeClient()
        for answer in invalid {
            DocumentProtocolStub.handler = { try Self.answerResponse($0, answer) }
            await assertClientError(.ungroundedAnswer) { try await client.answer(self.fixtureQuestion()) }
        }
    }

    func testAllowsMultipleExactExcerptsFromSamePassageLikeBackend() async throws {
        let first = SourceCitation(documentID: "doc-1", passageID: "passage-1", quote: "Submit")
        let second = SourceCitation(documentID: "doc-1", passageID: "passage-1", quote: "by Friday.")
        let client = try makeClient()
        for citations in [[first, second], [first, first]] {
            let answer = DocumentAnswer(status: .answered, claims: [GroundedClaim(text: "Submission is due Friday.", citations: citations)])
            DocumentProtocolStub.handler = { try Self.answerResponse($0, answer) }
            let actual = try await client.answer(fixtureQuestion())
            XCTAssertEqual(actual, answer)
        }
    }

    func testQuoteMatchingIsByteExactNotUnicodeNormalized() async throws {
        let question = DocumentQuestion(question: "Accent?", passages: [DocumentPassage(
            id: "p", documentID: "d", title: "T", locator: "Line 1", text: "cafe\u{301}"
        )])
        let answer = DocumentAnswer(status: .answered, claims: [GroundedClaim(
            text: "Accent", citations: [SourceCitation(documentID: "d", passageID: "p", quote: "caf\u{E9}")]
        )])
        DocumentProtocolStub.handler = { try Self.answerResponse($0, answer) }
        await assertClientError(.ungroundedAnswer) { try await self.makeClient().answer(question) }
    }

    func testBusinessAndHTTPFailuresRemainDistinctFromSuccess() async throws {
        let pairs: [(Int, DocumentClientError)] = [(401, .authenticationRequired), (403, .forbidden), (404, .backendNotDeployed), (429, .rateLimited), (503, .modelUnavailable), (500, .rejected(code: 500))]
        let client = try makeClient()
        for (code, expected) in pairs {
            DocumentProtocolStub.handler = { Self.response($0, "{\"code\":\(code),\"message\":\"synthetic failure\",\"data\":null}") }
            await assertClientError(expected) { try await client.answer(self.fixtureQuestion()) }
            DocumentProtocolStub.handler = { Self.response($0, "not JSON", status: code) }
            await assertClientError(expected) { try await client.answer(self.fixtureQuestion()) }
        }
        DocumentProtocolStub.handler = { Self.response($0, #"{"code":401,"data":null}"#) }
        await assertClientError(.invalidCredentials) { try await client.login(email: "synthetic@example.invalid", password: "synthetic") }
    }

    func testMalformedUnknownStatusAndOversizedResponsesAreRejected() async throws {
        let client = try makeClient()
        for payload in ["<html>not API</html>", #"{"code":200,"data":{"status":"guessed","claims":[]}}"#, #"{"code":200,"data":null}"#] {
            DocumentProtocolStub.handler = { Self.response($0, payload) }
            await assertClientError(.invalidResponse) { try await client.answer(self.fixtureQuestion()) }
        }
        DocumentProtocolStub.handler = { Self.response($0, String(repeating: "x", count: DocumentClient.maximumResponseBytes + 1)) }
        await assertClientError(.responseTooLarge) { try await client.answer(self.fixtureQuestion()) }
    }

    func testRedirectDelegateNeverForwardsCredentialsOrDocuments() throws {
        let session = URLSession(configuration: .ephemeral)
        defer { session.invalidateAndCancel() }
        let original = URLRequest(url: URL(string: "https://example.invalid/api/auth/login")!)
        let task = session.dataTask(with: original)
        let response = HTTPURLResponse(url: original.url!, statusCode: 307, httpVersion: nil, headerFields: nil)!
        for destination in ["https://attacker.invalid/collect", "http://example.invalid/insecure", "https://example.invalid/other"] {
            var forwarded = URLRequest(url: URL(string: destination)!)
            forwarded.httpBody = Data("synthetic-private-content".utf8)
            DocumentResponseCollector(maximumBytes: DocumentClient.maximumResponseBytes).urlSession(session, task: task, willPerformHTTPRedirection: response, newRequest: forwarded) {
                XCTAssertNil($0)
            }
        }
    }

    func testRedirectStatusNetworkTimeoutAndCancellationErrors() async throws {
        let client = try makeClient()
        DocumentProtocolStub.handler = { Self.response($0, "", status: 307) }
        await assertClientError(.redirectNotAllowed) { try await client.answer(self.fixtureQuestion()) }
        DocumentProtocolStub.handler = { _ in throw URLError(.notConnectedToInternet) }
        await assertClientError(.network(code: URLError.notConnectedToInternet.rawValue)) { try await client.answer(self.fixtureQuestion()) }
        DocumentProtocolStub.handler = { _ in throw URLError(.timedOut) }
        await assertClientError(.timedOut) { try await client.answer(self.fixtureQuestion()) }

        let started = expectation(description: "in-flight synthetic request")
        DocumentProtocolStub.handler = { _ in started.fulfill(); return nil }
        let question = fixtureQuestion()
        let task = Task { try await client.answer(question) }
        await fulfillment(of: [started], timeout: 5)
        task.cancel()
        await assertClientError(.cancelled) { try await task.value }
    }

    func testStreamLimitCancelsUnknownAndDishonestLengthBeforeWholeBodyArrives() async throws {
        let chunkSize = 8 * 1024
        let totalChunks = 512 // A synthetic 4 MiB stream, never materialized as one Data value.
        for declaredLength: String? in [nil, "1"] {
            let stopped = expectation(description: "oversized stream cancelled: \(declaredLength ?? "unknown")")
            let metrics = DocumentStreamMetrics()
            StreamingDocumentProtocol.plan = { request in
                var headers = ["Content-Type": "application/json"]
                if let declaredLength { headers["Content-Length"] = declaredLength }
                return StreamingDocumentProtocol.Plan(
                    response: HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: headers)!,
                    chunk: Data(repeating: 120, count: chunkSize), count: totalChunks,
                    onStop: { bytes in metrics.record(bytes: bytes); stopped.fulfill() }
                )
            }
            let client = try DocumentClient(
                baseURL: URL(string: "https://example.invalid/api")!, protocolClasses: [StreamingDocumentProtocol.self]
            )
            await assertClientError(.responseTooLarge) { try await client.answer(self.fixtureQuestion()) }
            await fulfillment(of: [stopped], timeout: 5)
            XCTAssertGreaterThan(metrics.bytes, DocumentClient.maximumResponseBytes)
            XCTAssertLessThan(metrics.bytes, totalChunks * chunkSize)
            // Cancellation occurs near the limit, rather than after exhausting the producer.
            XCTAssertLessThanOrEqual(metrics.bytes, DocumentClient.maximumResponseBytes + 8 * chunkSize)
        }
    }

    func testOversizedContentLengthPromptlyStopsAsynchronousProducer() async throws {
        let stopped = expectation(description: "header-only rejection")
        let metrics = DocumentStreamMetrics()
        StreamingDocumentProtocol.plan = { request in
            StreamingDocumentProtocol.Plan(
                response: HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil,
                    headerFields: ["Content-Length": "4194304"])!,
                chunk: Data(repeating: 120, count: 8192), count: 512,
                onStop: { bytes in metrics.record(bytes: bytes); stopped.fulfill() }
            )
        }
        let client = try DocumentClient(
            baseURL: URL(string: "https://example.invalid/api")!, protocolClasses: [StreamingDocumentProtocol.self]
        )
        await assertClientError(.responseTooLarge) { try await client.answer(self.fixtureQuestion()) }
        await fulfillment(of: [stopped], timeout: 5)
        // Darwin may queue the response callback until a body chunk is emitted. Producer bytes
        // are not accepted collector bytes: verify bounded prompt cancellation here, and verify
        // the header disposition before any body delivery in the direct-delegate test below.
        XCTAssertLessThanOrEqual(metrics.bytes, 8192)
    }

    func testCollectorRejectsOversizedHeaderBeforeBodyAndIgnoresLateCallbacks() async throws {
        let started = expectation(description: "registered request without response delivery")
        DocumentProtocolStub.handler = { _ in started.fulfill(); return nil }
        let collector = DocumentResponseCollector(maximumBytes: DocumentClient.maximumResponseBytes)
        let session = URLSession(
            configuration: DocumentClient.sessionConfiguration(timeout: 150, protocolClasses: [DocumentProtocolStub.self]),
            delegate: collector, delegateQueue: nil
        )
        defer { session.invalidateAndCancel() }
        let url = URL(string: "https://example.invalid/api/auth/me")!
        let result = Task { try await collector.data(for: URLRequest(url: url), session: session) }
        await fulfillment(of: [started], timeout: 5)
        let tasks: [URLSessionTask] = await withCheckedContinuation { continuation in
            session.getAllTasks { continuation.resume(returning: $0) }
        }
        let task = try XCTUnwrap(tasks.first as? URLSessionDataTask)
        let response = HTTPURLResponse(
            url: url, statusCode: 200, httpVersion: nil, headerFields: ["Content-Length": "4194304"]
        )!
        XCTAssertGreaterThan(response.expectedContentLength, Int64(DocumentClient.maximumResponseBytes))
        var disposition: URLSession.ResponseDisposition?
        collector.urlSession(session, dataTask: task, didReceive: response) { disposition = $0 }
        XCTAssertEqual(disposition, .cancel)
        // The request terminates with the size error before this test has supplied any body.
        await assertClientError(.responseTooLarge) { try await result.value }
        // Late queued callbacks must neither revive the request nor append rejected bytes to
        // a live response. Replaying completion also guards against a double-resume race.
        collector.urlSession(session, dataTask: task, didReceive: Data(repeating: 120, count: 8192))
        collector.urlSession(session, task: task, didCompleteWithError: nil)
        await assertClientError(.responseTooLarge) { try await result.value }
    }

    func testCollectorCancellationBeforeTaskInstallationNeverStartsTransport() async throws {
        DocumentProtocolStub.handler = { _ in XCTFail("A pre-cancelled request must not start."); return nil }
        let collector = DocumentResponseCollector(maximumBytes: DocumentClient.maximumResponseBytes)
        let session = URLSession(
            configuration: DocumentClient.sessionConfiguration(timeout: 150, protocolClasses: [DocumentProtocolStub.self]),
            delegate: collector, delegateQueue: nil
        )
        defer { session.invalidateAndCancel() }
        let request = URLRequest(url: URL(string: "https://example.invalid/api/auth/me")!)
        let task = Task {
            withUnsafeCurrentTask { $0?.cancel() }
            return try await collector.data(for: request, session: session)
        }
        await assertClientError(.cancelled) { try await task.value }
    }

    func testConcurrentRequestsKeepResponsesAndCancellationSeparate() async throws {
        let waitingStarted = expectation(description: "waiting request started")
        DocumentProtocolStub.handler = { request in
            let question = try JSONDecoder().decode(DocumentQuestion.self, from: Self.requestBody(request))
            if question.question == "Waiting?" { waitingStarted.fulfill(); return nil }
            let answer = DocumentAnswer(status: .answered, claims: [GroundedClaim(
                text: question.question,
                citations: [SourceCitation(documentID: "doc-1", passageID: "passage-1", quote: "Submit by Friday.")]
            )])
            return try Self.answerResponse(request, answer)
        }
        let client = try makeClient()
        let passages = fixtureQuestion().passages
        let waiting = Task { try await client.answer(DocumentQuestion(question: "Waiting?", passages: passages)) }
        await fulfillment(of: [waitingStarted], timeout: 5)
        let results = try await withThrowingTaskGroup(of: String.self) { group in
            for index in 0..<32 {
                group.addTask {
                    let answer = try await client.answer(DocumentQuestion(question: "Question \(index)?", passages: passages))
                    return answer.claims[0].text
                }
            }
            waiting.cancel()
            var values = Set<String>()
            for try await value in group { values.insert(value) }
            return values
        }
        XCTAssertEqual(results, Set((0..<32).map { "Question \($0)?" }))
        await assertClientError(.cancelled) { try await waiting.value }
    }

    func testRequestBodyHarnessHandlesBoundedDataAndInputStreams() throws {
        let payload = Data(#"{"question":"Synthetic?","passages":[]}"#.utf8)
        var request = URLRequest(url: URL(string: "https://example.invalid/api/companion/documents/ask")!)
        request.httpBody = payload
        XCTAssertEqual(try Self.requestBody(request), payload)

        let stream = InputStream(data: payload)
        request.httpBody = nil
        request.httpBodyStream = stream
        XCTAssertNil(request.httpBody)
        XCTAssertEqual(try Self.requestBody(request), payload)
        XCTAssertEqual(stream.streamStatus, .closed)

        let boundary = Data(repeating: 120, count: DocumentClient.maximumRequestBytes)
        request.httpBodyStream = InputStream(data: boundary)
        XCTAssertEqual(try Self.requestBody(request), boundary)

        let oversized = InputStream(data: boundary + Data([120]))
        request.httpBodyStream = oversized
        XCTAssertThrowsError(try Self.requestBody(request)) {
            XCTAssertEqual($0 as? BodyReadError, .tooLarge)
        }
        XCTAssertEqual(oversized.streamStatus, .closed)
        request.httpBodyStream = nil
        request.httpBody = boundary + Data([120])
        XCTAssertThrowsError(try Self.requestBody(request)) {
            XCTAssertEqual($0 as? BodyReadError, .tooLarge)
        }
    }

    private enum BodyReadError: Error, Equatable {
        case missingBody
        case tooLarge
        case streamReadFailed
    }

    /// URLProtocol sees httpBody on FoundationNetworking, but Darwin can supply the same
    /// request through httpBodyStream. Consume that stream exactly once, with a hard read cap.
    private static func requestBody(_ request: URLRequest) throws -> Data {
        let maximumBytes = DocumentClient.maximumRequestBytes
        if let data = request.httpBody {
            guard data.count <= maximumBytes else { throw BodyReadError.tooLarge }
            return data
        }
        guard let stream = request.httpBodyStream else { throw BodyReadError.missingBody }
        stream.open()
        defer { stream.close() }
        var data = Data()
        var chunk = [UInt8](repeating: 0, count: 4096)
        while true {
            let remaining = maximumBytes - data.count
            let count = stream.read(&chunk, maxLength: min(chunk.count, remaining + 1))
            guard count >= 0 else { throw BodyReadError.streamReadFailed }
            if count == 0 { return data }
            guard count <= remaining else { throw BodyReadError.tooLarge }
            data.append(contentsOf: chunk.prefix(count))
        }
    }

    private func makeClient() throws -> DocumentClient {
        try DocumentClient(baseURL: URL(string: "https://example.invalid/api/")!, protocolClasses: [DocumentProtocolStub.self])
    }

    private func fixtureQuestion() -> DocumentQuestion {
        DocumentQuestion(question: "When is submission?", passages: [DocumentPassage(
            id: "passage-1", documentID: "doc-1", title: "Synthetic rules", locator: "Line 1", text: "Submit by Friday."
        )])
    }

    private func fixtureAnswer() -> DocumentAnswer {
        DocumentAnswer(status: .answered, claims: [GroundedClaim(text: "Submission is due Friday.", citations: [
            SourceCitation(documentID: "doc-1", passageID: "passage-1", quote: "Submit by Friday.")
        ])])
    }

    private static func response(_ request: URLRequest, _ body: String, status: Int = 200) -> (HTTPURLResponse, Data) {
        (HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!, Data(body.utf8))
    }

    private static func answerResponse(_ request: URLRequest, _ answer: DocumentAnswer) throws -> (HTTPURLResponse, Data) {
        struct Envelope: Encodable { let code = 200; let data: DocumentAnswer }
        return (HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!, try JSONEncoder().encode(Envelope(data: answer)))
    }

    private func assertClientError<Value>(_ expected: DocumentClientError, file: StaticString = #filePath, line: UInt = #line, operation: () async throws -> Value) async {
        do { _ = try await operation(); XCTFail("Expected \(expected)", file: file, line: line) }
        catch { XCTAssertEqual(error as? DocumentClientError, expected, file: file, line: line) }
    }
}

private final class DocumentProtocolStub: URLProtocol {
    static var handler: ((URLRequest) throws -> (HTTPURLResponse, Data)?)?

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        do {
            guard let handler = Self.handler else { throw URLError(.unsupportedURL) }
            guard let (response, data) = try handler(request) else { return }
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        } catch { client?.urlProtocol(self, didFailWithError: error) }
    }
    override func stopLoading() {}
}

/// Delivers one small chunk at a time and stops producing when URLSession cancels.
/// This catches post-hoc size checks that silently read the entire response first.
private final class StreamingDocumentProtocol: URLProtocol {
    struct Plan {
        let response: HTTPURLResponse
        let chunk: Data
        let count: Int
        let onStop: (Int) -> Void
    }
    static var plan: ((URLRequest) -> Plan)?
    private let lock = NSRecursiveLock()
    private let queue = DispatchQueue(label: "synthetic-document-stream")
    private var activePlan: Plan?
    private var sent = 0
    private var stopped = false

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        guard let plan = Self.plan?(request) else {
            client?.urlProtocol(self, didFailWithError: URLError(.unsupportedURL))
            return
        }
        lock.lock()
        guard !stopped else { lock.unlock(); return }
        activePlan = plan
        client?.urlProtocol(self, didReceive: plan.response, cacheStoragePolicy: .notAllowed)
        lock.unlock()
        queue.asyncAfter(deadline: .now() + 0.1, execute: DispatchWorkItem { self.emitChunk() })
    }

    private func emitChunk() {
        lock.lock()
        guard !stopped, let plan = activePlan else { lock.unlock(); return }
        guard sent < plan.count else {
            client?.urlProtocolDidFinishLoading(self)
            lock.unlock()
            return
        }
        sent += 1
        client?.urlProtocol(self, didLoad: plan.chunk)
        lock.unlock()
        queue.asyncAfter(deadline: .now() + 0.002, execute: DispatchWorkItem { self.emitChunk() })
    }

    override func stopLoading() {
        lock.lock()
        guard !stopped else { lock.unlock(); return }
        stopped = true
        let plan = activePlan
        let bytes = sent * (plan?.chunk.count ?? 0)
        activePlan = nil
        lock.unlock()
        plan?.onStop(bytes)
    }
}

private final class DocumentStreamMetrics: @unchecked Sendable {
    private let lock = NSLock()
    private var storedBytes = 0
    var bytes: Int { lock.lock(); defer { lock.unlock() }; return storedBytes }
    func record(bytes: Int) { lock.lock(); storedBytes = bytes; lock.unlock() }
}
