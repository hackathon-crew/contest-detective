import { readEventStream, type ServerSentEvent } from './sse'

export type ApiQueryValue = string | number | boolean | null | undefined

export type ApiRequestOptions = Omit<RequestInit, 'body'> & {
  body?: BodyInit | null
  /** 有值时序列化成 JSON 请求体，并补上 content-type。 */
  json?: unknown
  /** 值为 null 或 undefined 的参数不会出现在地址里。 */
  query?: Record<string, ApiQueryValue>
}

/**
 * 后端 ListResponse 解包后的结果。后端的分页字段和 data 同级，不嵌在 data 里；
 * pageSize 为 0 表示这次没分页，total 就是 items 的条数。
 */
export interface ApiListResult<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
}

/**
 * - business：后端正常响应了，但 code 不是 200。message 是后端写给用户看的提示，可以直接展示。
 * - http：HTTP 状态不是 2xx。后端约定恒返回 200，出现它多半是 Vite 代理或 nginx 那一层出错。
 * - invalid-response：HTTP 正常，但 body 不是 code/message/data 的形状。
 * - network：请求没发出去，或者连接中途断了。
 */
export type ApiErrorKind = 'business' | 'http' | 'invalid-response' | 'network'

/** 前端只有这一种请求错误，页面按 kind 决定怎么提示。 */
export class ApiError extends Error {
  readonly kind: ApiErrorKind
  /** 后端业务码，只有 business 才有。 */
  readonly code: number | null
  /** HTTP 状态码，network 没有。 */
  readonly status: number | null
  readonly data: unknown

  constructor(
    message: string,
    options: {
      kind: ApiErrorKind
      code?: number | null
      status?: number | null
      data?: unknown
      cause?: unknown
    },
  ) {
    super(message, { cause: options.cause })
    this.name = 'ApiError'
    this.kind = options.kind
    this.code = options.code ?? null
    this.status = options.status ?? null
    this.data = options.data ?? null
  }

  /** 网络失败和 5xx 可能下次就好；业务错误和格式错误重试多少次都是同一个结果。 */
  get retryable(): boolean {
    return this.kind === 'network' || (this.kind === 'http' && (this.status ?? 0) >= 500)
  }
}

export interface ApiClient {
  request<T>(path: string, options?: ApiRequestOptions): Promise<T>
  requestList<T>(path: string, options?: ApiRequestOptions): Promise<ApiListResult<T>>
  /**
   * 打开一个 SSE 事件流。后端在开流之前拒绝请求（比如参数不合法）时返回的仍是 JSON 外壳，
   * 这种情况和 request 一样抛 ApiError，不会产出任何事件。
   */
  stream(path: string, options?: ApiRequestOptions): AsyncGenerator<ServerSentEvent>
}

export interface ApiClientOptions {
  /** 默认 /api，走同源转发。 */
  baseUrl?: string
  fetchFn?: typeof fetch
}

interface ApiEnvelope {
  code: number
  message: string
  data: unknown
  [key: string]: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isAbortError(value: unknown): value is Error {
  return value instanceof Error && value.name === 'AbortError'
}

function buildUrl(baseUrl: string, path: string, query: ApiRequestOptions['query']): string {
  const url = `${baseUrl}/${path.replace(/^\/+/, '')}`
  if (!query) return url

  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value !== null && value !== undefined) search.set(key, String(value))
  }
  const serialized = search.toString()
  return serialized ? `${url}${url.includes('?') ? '&' : '?'}${serialized}` : url
}

function buildInit(options: ApiRequestOptions | undefined): RequestInit | undefined {
  if (!options) return undefined
  const { json, query: _query, ...init } = options
  if (json === undefined) return init

  const headers = new Headers(init.headers)
  if (!headers.has('content-type')) headers.set('content-type', 'application/json')
  return { ...init, headers, body: JSON.stringify(json) }
}

async function readEnvelope(response: Response): Promise<ApiEnvelope> {
  const kind = response.ok ? 'invalid-response' : 'http'
  const message = response.ok ? '后端响应格式无效' : 'HTTP 请求失败'

  let value: unknown
  try {
    value = await response.json()
  } catch (cause) {
    if (isAbortError(cause)) throw cause
    throw new ApiError(message, { kind, status: response.status, cause })
  }

  if (
    !isRecord(value) ||
    typeof value.code !== 'number' ||
    typeof value.message !== 'string' ||
    !Object.hasOwn(value, 'data')
  ) {
    throw new ApiError(message, { kind, status: response.status, data: value })
  }
  return value as ApiEnvelope
}

/** 后端业务失败也返回 HTTP 200，只看 response.ok 会把失败当成功。 */
function assertSuccess(response: Response, envelope: ApiEnvelope): void {
  if (!response.ok) {
    throw new ApiError('HTTP 请求失败', {
      kind: 'http',
      status: response.status,
      data: envelope.data,
    })
  }
  if (envelope.code !== 200) {
    throw new ApiError(envelope.message, {
      kind: 'business',
      code: envelope.code,
      status: response.status,
      data: envelope.data,
    })
  }
}

/** 只负责 HTTP 传输和解包响应外壳，不认识任何业务数据。 */
export function createApiClient({
  baseUrl = '/api',
  fetchFn = (input, init) => globalThis.fetch(input, init),
}: ApiClientOptions = {}): ApiClient {
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, '')

  async function send(path: string, options: ApiRequestOptions | undefined): Promise<Response> {
    try {
      return await fetchFn(buildUrl(normalizedBaseUrl, path, options?.query), buildInit(options))
    } catch (cause) {
      if (isAbortError(cause)) throw cause
      throw new ApiError('网络请求失败', { kind: 'network', cause })
    }
  }

  return {
    async request<T>(path: string, options?: ApiRequestOptions) {
      const response = await send(path, options)
      const envelope = await readEnvelope(response)
      assertSuccess(response, envelope)
      return envelope.data as T
    },

    async requestList<T>(path: string, options?: ApiRequestOptions) {
      const response = await send(path, options)
      const envelope = await readEnvelope(response)
      assertSuccess(response, envelope)

      if (
        !Array.isArray(envelope.data) ||
        !Number.isInteger(envelope.total) ||
        !Number.isInteger(envelope.page) ||
        !Number.isInteger(envelope.page_size)
      ) {
        throw new ApiError('后端列表响应格式无效', {
          kind: 'invalid-response',
          status: response.status,
          data: envelope,
        })
      }
      return {
        items: envelope.data as T[],
        total: envelope.total as number,
        page: envelope.page as number,
        pageSize: envelope.page_size as number,
      }
    },

    async *stream(path: string, options?: ApiRequestOptions) {
      const response = await send(path, options)
      const contentType = response.headers.get('content-type') ?? ''

      if (!contentType.startsWith('text/event-stream')) {
        const envelope = await readEnvelope(response)
        assertSuccess(response, envelope)
        throw new ApiError('后端没有返回事件流', {
          kind: 'invalid-response',
          status: response.status,
          data: envelope.data,
        })
      }
      if (!response.ok || !response.body) {
        throw new ApiError('HTTP 请求失败', { kind: 'http', status: response.status })
      }

      try {
        yield* readEventStream(response.body)
      } catch (cause) {
        if (isAbortError(cause)) throw cause
        throw new ApiError('事件流中断', { kind: 'network', cause })
      }
    },
  }
}

/** 全站共用的实例。测试里用 createApiClient 传入假的 fetchFn，不要改这个实例。 */
export const apiClient = createApiClient()
