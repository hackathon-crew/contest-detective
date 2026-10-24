import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
import InkpawCore

/// Deliberately excludes profile data, credentials, and cookies from the app's public user model.
public struct CompanionUser: Codable, Equatable, Sendable {
    public let id: String
    public let username: String

    public init(id: String, username: String) {
        self.id = id
        self.username = username
    }
}

public enum DocumentClientError: Error, Equatable, Sendable, LocalizedError {
    case invalidServiceURL
    case invalidRequest
    case requestTooLarge
    case responseTooLarge
    case invalidResponse
    case authenticationRequired
    case invalidCredentials
    case forbidden
    case backendNotDeployed
    case modelUnavailable
    case rateLimited
    case rejected(code: Int)
    case redirectNotAllowed
    case ungroundedAnswer
    case timedOut
    case cancelled
    case network(code: Int)

    public var errorDescription: String? {
        switch self {
        case .invalidServiceURL: return "服务地址必须为 HTTPS，或本机回环 HTTP；不能包含账号、查询参数或片段。"
        case .invalidRequest: return "问题或所选片段不符合限制：问题最多 1,000 字，选择 1–8 个片段。"
        case .requestTooLarge: return "问题与所选片段超过 24 KiB，请减少片段。"
        case .responseTooLarge: return "服务返回的数据过大，已拒绝读取答案。"
        case .invalidResponse: return "服务未返回有效的预期 JSON；请核对 API 地址。"
        case .authenticationRequired: return "请先登录问答服务。"
        case .invalidCredentials: return "登录失败，请检查邮箱和密码。"
        case .forbidden: return "当前账户没有执行此操作的权限。"
        case .backendNotDeployed: return "该服务尚未部署此接口，或 API 地址不正确。"
        case .modelUnavailable: return "问答模型当前未启用或不可用。"
        case .rateLimited: return "服务请求过于频繁，请稍后重试。"
        case .rejected(let code): return "服务拒绝了请求（状态码 \(code)）。"
        case .redirectNotAllowed: return "已阻止服务重定向，避免登录信息或文档发往其他地址。"
        case .ungroundedAnswer: return "答案引用与所选原文不一致，已拒绝显示。"
        case .timedOut: return "服务请求超时，可以稍后手动重试。"
        case .cancelled: return "请求已取消。"
        case .network: return "无法连接问答服务，请检查网络与服务地址。"
        }
    }
}

/// An explicit-call-only adapter. Creating it, importing documents, and restoring state never asks a question.
/// The caller must disclose the destination and selected passages before calling `answer`.
public actor DocumentClient: DocumentAnswering {
    public static let maximumRequestBytes = 24 * 1024
    public static let maximumResponseBytes = 128 * 1024
    public nonisolated let baseURL: URL
    private let timeout: TimeInterval
    private let session: URLSession
    private let responseCollector: DocumentResponseCollector

    public init(baseURL: URL, timeout: TimeInterval = 150, protocolClasses: [AnyClass]? = nil) throws {
        guard Self.isAllowedBaseURL(baseURL), timeout.isFinite, timeout > 0 else {
            throw DocumentClientError.invalidServiceURL
        }
        self.baseURL = baseURL
        self.timeout = timeout
        let responseCollector = DocumentResponseCollector(maximumBytes: Self.maximumResponseBytes)
        self.responseCollector = responseCollector
        session = URLSession(
            configuration: Self.sessionConfiguration(timeout: timeout, protocolClasses: protocolClasses),
            delegate: responseCollector,
            delegateQueue: nil
        )
    }

    deinit { session.invalidateAndCancel() }

    public func login(email: String, password: String) async throws -> CompanionUser {
        guard !email.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              email.unicodeScalars.count <= 320,
              !password.isEmpty, password.unicodeScalars.count <= 128 else {
            throw DocumentClientError.invalidRequest
        }
        clearCookies()
        struct Credentials: Encodable { let email: String; let password: String }
        let body = try JSONEncoder().encode(Credentials(email: email, password: password))
        do {
            let data = try await request(path: "auth/login", method: "POST", body: body)
            let envelope = try decode(Envelope<CompanionUser>.self, data)
            guard let user = envelope.data, !user.id.isEmpty, !user.username.isEmpty else {
                throw DocumentClientError.invalidResponse
            }
            return user
        } catch {
            clearCookies()
            if error as? DocumentClientError == .authenticationRequired {
                throw DocumentClientError.invalidCredentials
            }
            throw error
        }
    }

    /// Clears the local ephemeral login even if server logout fails; the caller still receives the failure.
    public func logout() async throws {
        defer { clearCookies() }
        _ = try await request(path: "auth/logout", method: "POST", body: nil)
    }

    public func checkSession() async throws -> CompanionUser? {
        do {
            let data = try await request(path: "auth/me", method: "GET", body: nil)
            let user = try decode(Envelope<CompanionUser>.self, data).data
            if let user, user.id.isEmpty || user.username.isEmpty { throw DocumentClientError.invalidResponse }
            return user
        } catch DocumentClientError.authenticationRequired {
            clearCookies()
            return nil
        }
    }

    public func answer(_ question: DocumentQuestion) async throws -> DocumentAnswer {
        try Self.validate(question)
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        let body = try encoder.encode(question)
        guard body.count <= Self.maximumRequestBytes else { throw DocumentClientError.requestTooLarge }
        let data = try await request(path: "companion/documents/ask", method: "POST", body: body)
        guard let answer = try decode(Envelope<DocumentAnswer>.self, data).data else {
            throw DocumentClientError.invalidResponse
        }
        try Self.validate(answer, against: question.passages)
        return answer
    }

    static func sessionConfiguration(timeout: TimeInterval, protocolClasses: [AnyClass]?) -> URLSessionConfiguration {
        let configuration = URLSessionConfiguration.ephemeral
        // Ephemeral supplies a private in-memory cookie store, not HTTPCookieStorage.shared.
        configuration.urlCredentialStorage = nil
        configuration.urlCache = nil
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.timeoutIntervalForRequest = timeout
        configuration.timeoutIntervalForResource = timeout
        configuration.httpShouldSetCookies = true
        configuration.httpCookieAcceptPolicy = .always
        if let protocolClasses { configuration.protocolClasses = protocolClasses }
        return configuration
    }

    private func request(path: String, method: String, body: Data?) async throws -> Data {
        if Task.isCancelled { throw DocumentClientError.cancelled }
        let url = baseURL.appendingPathComponent(path)
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.timeoutInterval = path == "companion/documents/ask" ? timeout : min(timeout, 30)
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("no-store", forHTTPHeaderField: "Cache-Control")
        if let body {
            guard body.count <= Self.maximumRequestBytes else { throw DocumentClientError.requestTooLarge }
            request.httpBody = body
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        do {
            let (data, response) = try await responseCollector.data(for: request, session: session)
            if Task.isCancelled { throw DocumentClientError.cancelled }
            if (300..<400).contains(response.statusCode) { throw DocumentClientError.redirectNotAllowed }
            guard (200..<300).contains(response.statusCode) else { throw Self.error(for: response.statusCode) }
            let header = try decode(EnvelopeHeader.self, data)
            guard header.code == 200 else { throw Self.error(for: header.code) }
            return data
        } catch let error as DocumentClientError {
            throw error
        } catch let error as URLError {
            if Task.isCancelled || error.code == .cancelled { throw DocumentClientError.cancelled }
            if error.code == .timedOut { throw DocumentClientError.timedOut }
            throw DocumentClientError.network(code: error.code.rawValue)
        } catch is CancellationError {
            throw DocumentClientError.cancelled
        } catch {
            throw DocumentClientError.network(code: URLError.unknown.rawValue)
        }
    }

    private func clearCookies() {
        guard let storage = session.configuration.httpCookieStorage else { return }
        for cookie in storage.cookies ?? [] { storage.deleteCookie(cookie) }
    }

    private func decode<Value: Decodable>(_ type: Value.Type, _ data: Data) throws -> Value {
        do { return try JSONDecoder().decode(type, from: data) }
        catch { throw DocumentClientError.invalidResponse }
    }

    private struct EnvelopeHeader: Decodable { let code: Int }
    private struct Envelope<Value: Decodable>: Decodable { let code: Int; let data: Value? }
    private struct PassageKey: Hashable { let documentID: String; let passageID: String }

    private static func isAllowedBaseURL(_ url: URL) -> Bool {
        guard let parts = URLComponents(url: url, resolvingAgainstBaseURL: false),
              let host = parts.host?.lowercased(), !host.isEmpty,
              parts.user == nil, parts.password == nil, parts.query == nil, parts.fragment == nil,
              url.baseURL == nil else { return false }
        if let port = parts.port, !(1...65535).contains(port) { return false }
        if parts.scheme?.lowercased() == "https" { return true }
        // No DNS-based LAN/private-network exception; only these explicit loopback hosts use HTTP.
        return parts.scheme?.lowercased() == "http" && ["localhost", "127.0.0.1", "[::1]", "::1"].contains(host)
    }

    private static func validate(_ question: DocumentQuestion) throws {
        guard isNonempty(question.question, maximum: 1000), (1...8).contains(question.passages.count) else {
            throw DocumentClientError.invalidRequest
        }
        var keys = Set<PassageKey>()
        for passage in question.passages {
            guard isNonempty(passage.documentID, maximum: 100), isNonempty(passage.id, maximum: 100),
                  isNonempty(passage.title, maximum: 240), isNonempty(passage.locator, maximum: 120),
                  isNonempty(passage.text, maximum: 4000),
                  keys.insert(PassageKey(documentID: passage.documentID, passageID: passage.id)).inserted else {
                throw DocumentClientError.invalidRequest
            }
        }
    }

    private static func validate(_ answer: DocumentAnswer, against passages: [DocumentPassage]) throws {
        if answer.status == .insufficientEvidence {
            guard answer.claims.isEmpty else { throw DocumentClientError.ungroundedAnswer }
            return
        }
        guard (1...8).contains(answer.claims.count) else { throw DocumentClientError.ungroundedAnswer }
        let lookup = Dictionary(uniqueKeysWithValues: passages.map {
            (PassageKey(documentID: $0.documentID, passageID: $0.id), $0)
        })
        for claim in answer.claims {
            guard isNonempty(claim.text, maximum: 1200), (1...4).contains(claim.citations.count) else {
                throw DocumentClientError.ungroundedAnswer
            }
            for citation in claim.citations {
                let key = PassageKey(documentID: citation.documentID, passageID: citation.passageID)
                // Multiple exact excerpts from the same passage are valid in the service contract.
                guard let source = lookup[key],
                      isNonempty(citation.quote, maximum: 1200),
                      Data(source.text.utf8).range(of: Data(citation.quote.utf8)) != nil else {
                    throw DocumentClientError.ungroundedAnswer
                }
            }
        }
    }

    private static func isNonempty(_ value: String, maximum: Int) -> Bool {
        !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && value.unicodeScalars.count <= maximum
    }

    private static func error(for code: Int) -> DocumentClientError {
        switch code {
        case 401: return .authenticationRequired
        case 403: return .forbidden
        case 404: return .backendNotDeployed
        case 429: return .rateLimited
        case 503: return .modelUnavailable
        default: return .rejected(code: code)
        }
    }
}

/// Uses delegate delivery, not `data(for:)` or a completion-handler data task: those buffer an
/// entire response inside URLSession before the caller can enforce a byte limit.
/// The registry handles simultaneous actor-reentrant requests without sharing their buffers.
final class DocumentResponseCollector: NSObject, URLSessionDataDelegate, @unchecked Sendable {
    private let maximumBytes: Int
    private let lock = NSLock()
    private var requests: [Int: BoundedDocumentResponse] = [:]

    init(maximumBytes: Int) { self.maximumBytes = maximumBytes }

    func data(for request: URLRequest, session: URLSession) async throws -> (Data, HTTPURLResponse) {
        let pending = BoundedDocumentResponse(maximumBytes: maximumBytes)
        return try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { continuation in
                let task = session.dataTask(with: request)
                register(pending, taskID: task.taskIdentifier)
                // Register before resuming so no delegate callback can precede its state.
                pending.start(task: task, continuation: continuation) { [weak self] in
                    self?.remove(taskID: task.taskIdentifier)
                }
            }
        } onCancel: {
            // This can run before the continuation installs its task, or during any callback.
            pending.cancel()
        }
    }

    private func register(_ request: BoundedDocumentResponse, taskID: Int) {
        lock.lock()
        requests[taskID] = request
        lock.unlock()
    }

    private func pending(for task: URLSessionTask) -> BoundedDocumentResponse? {
        lock.lock()
        defer { lock.unlock() }
        return requests[task.taskIdentifier]
    }

    private func remove(taskID: Int) {
        lock.lock()
        requests.removeValue(forKey: taskID)
        lock.unlock()
    }

    func urlSession(
        _ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse,
        completionHandler: @escaping (URLSession.ResponseDisposition) -> Void
    ) {
        let allowed = pending(for: dataTask)?.receive(response: response) ?? false
        completionHandler(allowed ? .allow : .cancel)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        pending(for: dataTask)?.receive(data: data)
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        pending(for: task)?.complete(error: error)
    }

    /// Deny all redirects so credentials and documents never change destinations implicitly.
    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        willPerformHTTPRedirection response: HTTPURLResponse,
        newRequest request: URLRequest,
        completionHandler: @escaping (URLRequest?) -> Void
    ) {
        completionHandler(nil)
    }
}

/// A single request's state. Terminal transitions resume a continuation at most once.
/// Cancellation before `start` is retained, and the later task is cancelled without resuming.
private final class BoundedDocumentResponse: @unchecked Sendable {
    private typealias Response = (Data, HTTPURLResponse)
    private let maximumBytes: Int
    private let lock = NSLock()
    private var buffer = Data()
    private var response: HTTPURLResponse?
    private var task: URLSessionDataTask?
    private var continuation: CheckedContinuation<Response, Error>?
    private var onFinish: (() -> Void)?
    private var terminal: Result<Response, Error>?

    init(maximumBytes: Int) { self.maximumBytes = maximumBytes }

    func start(
        task: URLSessionDataTask, continuation: CheckedContinuation<(Data, HTTPURLResponse), Error>,
        onFinish: @escaping () -> Void
    ) {
        lock.lock()
        if let result = terminal {
            lock.unlock()
            task.cancel()
            onFinish()
            continuation.resume(with: result)
            return
        }
        self.task = task
        self.continuation = continuation
        self.onFinish = onFinish
        lock.unlock()
        // If cancellation wins after unlocking, resuming the already-cancelled task cannot start I/O.
        task.resume()
    }

    func cancel() { finish(.failure(DocumentClientError.cancelled), cancelTask: true) }

    func receive(response: URLResponse) -> Bool {
        guard let http = response as? HTTPURLResponse else {
            finish(.failure(DocumentClientError.invalidResponse), cancelTask: true)
            return false
        }
        guard http.expectedContentLength <= Int64(maximumBytes) else {
            finish(.failure(DocumentClientError.responseTooLarge), cancelTask: true)
            return false
        }
        lock.lock()
        defer { lock.unlock() }
        guard terminal == nil else { return false }
        self.response = http
        return true
    }

    func receive(data: Data) {
        lock.lock()
        guard terminal == nil else { lock.unlock(); return }
        // Check before appending. An absent, false, or compressed Content-Length cannot bypass this.
        guard data.count <= maximumBytes - buffer.count else {
            lock.unlock()
            finish(.failure(DocumentClientError.responseTooLarge), cancelTask: true)
            return
        }
        buffer.append(data)
        lock.unlock()
    }

    func complete(error: Error?) {
        lock.lock()
        guard terminal == nil else { lock.unlock(); return }
        let result: Result<Response, Error>
        if let error { result = .failure(error) }
        else if let response { result = .success((buffer, response)) }
        else { result = .failure(DocumentClientError.invalidResponse) }
        lock.unlock()
        finish(result, cancelTask: false)
    }

    private func finish(_ result: Result<Response, Error>, cancelTask: Bool) {
        lock.lock()
        guard terminal == nil else { lock.unlock(); return }
        terminal = result
        let continuation = self.continuation
        let task = self.task
        let onFinish = self.onFinish
        self.continuation = nil
        self.task = nil
        self.onFinish = nil
        buffer = Data()
        response = nil
        lock.unlock()
        // No callback or continuation resumes while a state or registry lock is held.
        if cancelTask { task?.cancel() }
        onFinish?()
        continuation?.resume(with: result)
    }
}
