import { afterEach, expect, it, vi } from 'vitest'
import { investigationStream } from './investigation-stream'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

it('reconnects after ten seconds offline with Last-Event-ID and no duplicate events', async () => {
  vi.useFakeTimers()
  const calls: { path: string; init?: RequestInit }[] = []
  let online = true
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ path: String(input), init })
    if (calls.length === 1)
      return new Response(
        'id: 1\nevent: step\ndata: {"tool":"fetch_page","label":"读取原文"}\n\n',
        {
          headers: { 'content-type': 'text/event-stream' },
        },
      )
    if (!online) throw new TypeError('offline')
    return new Response(
      'id: 1\nevent: step\ndata: {}\n\nid: 2\nevent: answer\ndata: {"content":"完整回答","sources":[]}\n\n',
      { headers: { 'content-type': 'text/event-stream' } },
    )
  })
  const stream = investigationStream(
    { investigation_id: 'run-1', question: '查比赛' },
    new AbortController().signal,
  )
  expect((await stream.next()).value?.id).toBe('1')
  online = false
  const next = stream.next()
  await vi.advanceTimersByTimeAsync(10_000)
  online = true
  await vi.advanceTimersByTimeAsync(8_000)
  expect((await next).value?.event).toBe('answer')
  expect(calls[0]?.init?.method).toBe('POST')
  expect(
    calls.slice(1).every(({ path }) => path === '/api/agent/investigations/run-1/events'),
  ).toBe(true)
  expect(new Headers(calls.at(-1)?.init?.headers).get('Last-Event-ID')).toBe('1')
  await stream.return(undefined)
})

it('reuses the same investigation id when the first response is lost', async () => {
  vi.useFakeTimers()
  const requests: RequestInit[] = []
  vi.stubGlobal('fetch', async (_: RequestInfo | URL, init: RequestInit) => {
    requests.push(init)
    if (requests.length === 1) throw new TypeError('connection lost')
    return new Response('id: 1\nevent: answer\ndata: {"content":"答案"}\n\n', {
      headers: { 'content-type': 'text/event-stream' },
    })
  })
  const stream = investigationStream(
    { investigation_id: 'same-id', question: '查比赛' },
    new AbortController().signal,
  )
  const next = stream.next()
  await vi.advanceTimersByTimeAsync(1000)
  expect((await next).value?.event).toBe('answer')
  expect(requests.map((init) => JSON.parse(init.body as string).investigation_id)).toEqual([
    'same-id',
    'same-id',
  ])
  await stream.return(undefined)
})
