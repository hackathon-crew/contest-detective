import { describe, expect, it } from 'vitest'

import { ApiError, createApiClient } from './client'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/** 记下每次请求，并按顺序返回预设的响应。 */
function fakeFetch(...responses: Array<Response | Error>) {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = []
  const fetchFn: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), init })
    const next = responses.shift()
    if (!next) throw new Error('没有预设响应')
    if (next instanceof Error) throw next
    return next
  }
  return { calls, fetchFn }
}

async function caught(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise
  } catch (error) {
    if (error instanceof ApiError) return error
    throw error
  }
  throw new Error('预期抛出 ApiError')
}

describe('createApiClient', () => {
  it('code 为 200 时返回 data，并按 baseUrl 和 query 拼地址', async () => {
    const { calls, fetchFn } = fakeFetch(
      jsonResponse({ code: 200, message: 'success', data: { status: 'ok' } }),
    )
    const client = createApiClient({ fetchFn })

    await expect(
      client.request('/contests', { query: { keyword: 'AI', status: undefined, page: 2 } }),
    ).resolves.toEqual({ status: 'ok' })
    expect(calls[0]?.url).toBe('/api/contests?keyword=AI&page=2')
  })

  it('json 选项序列化成请求体并补上 content-type', async () => {
    const { calls, fetchFn } = fakeFetch(
      jsonResponse({ code: 200, message: 'success', data: null }),
    )
    const client = createApiClient({ fetchFn })

    await client.request('investigations', { method: 'POST', json: { question: '这周末' } })

    const init = calls[0]?.init
    expect(init?.body).toBe('{"question":"这周末"}')
    expect(new Headers(init?.headers).get('content-type')).toBe('application/json')
  })

  it('HTTP 200 但 code 不是 200 时抛 business 错误，带上后端的提示', async () => {
    const { fetchFn } = fakeFetch(jsonResponse({ code: 404, message: '比赛不存在', data: null }))
    const error = await caught(createApiClient({ fetchFn }).request('/contests/x'))

    expect(error).toMatchObject({ kind: 'business', code: 404, status: 200, message: '比赛不存在' })
    expect(error.retryable).toBe(false)
  })

  it('转发层返回 502 网页时抛 http 错误，可以重试', async () => {
    const { fetchFn } = fakeFetch(new Response('<html>Bad Gateway</html>', { status: 502 }))
    const error = await caught(createApiClient({ fetchFn }).request('/contests'))

    expect(error).toMatchObject({ kind: 'http', status: 502, code: null })
    expect(error.retryable).toBe(true)
  })

  it('body 不是约定的外壳时抛 invalid-response 错误', async () => {
    const { fetchFn } = fakeFetch(jsonResponse({ status: 'ok' }))
    const error = await caught(createApiClient({ fetchFn }).request('/health'))

    expect(error).toMatchObject({ kind: 'invalid-response', status: 200 })
    expect(error.retryable).toBe(false)
  })

  it('fetch 本身失败时抛 network 错误，可以重试', async () => {
    const { fetchFn } = fakeFetch(new TypeError('Failed to fetch'))
    const error = await caught(createApiClient({ fetchFn }).request('/contests'))

    expect(error).toMatchObject({ kind: 'network', status: null })
    expect(error.retryable).toBe(true)
  })

  it('主动取消的请求原样抛出 AbortError，不包装成 ApiError', async () => {
    const abort = new DOMException('aborted', 'AbortError')
    const { fetchFn } = fakeFetch(abort)

    await expect(createApiClient({ fetchFn }).request('/contests')).rejects.toBe(abort)
  })

  it('列表响应把同级的分页字段解包成 camelCase', async () => {
    const { fetchFn } = fakeFetch(
      jsonResponse({
        code: 200,
        message: 'success',
        data: [{ id: 'a' }],
        total: 31,
        page: 2,
        page_size: 10,
      }),
    )

    await expect(createApiClient({ fetchFn }).requestList('/contests')).resolves.toEqual({
      items: [{ id: 'a' }],
      total: 31,
      page: 2,
      pageSize: 10,
    })
  })

  it('列表响应缺分页字段时抛 invalid-response 错误', async () => {
    const { fetchFn } = fakeFetch(jsonResponse({ code: 200, message: 'success', data: [] }))
    const error = await caught(createApiClient({ fetchFn }).requestList('/contests'))

    expect(error.kind).toBe('invalid-response')
  })
})

describe('createApiClient().stream', () => {
  it('响应是事件流时逐条产出事件', async () => {
    const { fetchFn } = fakeFetch(
      new Response('event: step\ndata: {"n":1}\n\nevent: done\ndata: {}\n\n', {
        headers: { 'content-type': 'text/event-stream; charset=utf-8' },
      }),
    )
    const names: string[] = []
    for await (const event of createApiClient({ fetchFn }).stream('/investigations')) {
      names.push(event.event)
    }

    expect(names).toEqual(['step', 'done'])
  })

  it('后端开流前就拒绝时，按 JSON 外壳抛 business 错误', async () => {
    const { fetchFn } = fakeFetch(jsonResponse({ code: 400, message: '问题不能为空', data: null }))
    const read = async () => {
      for await (const _event of createApiClient({ fetchFn }).stream('/investigations')) {
        // 不应该产出事件
      }
    }

    expect(await caught(read())).toMatchObject({
      kind: 'business',
      code: 400,
      message: '问题不能为空',
    })
  })
})
