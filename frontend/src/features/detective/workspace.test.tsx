// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { NuqsAdapter } from 'nuqs/adapters/react-router/v8'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AppRoutes } from '@/app/app'

beforeEach(() => localStorage.clear())
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
const event = (type: string, data: unknown) => `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`
const json = (data: unknown) =>
  new Response(
    JSON.stringify({ code: 200, message: 'success', data, total: 0, page: 1, page_size: 100 }),
  )

function show(path = '/') {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={[path]}>
        <NuqsAdapter>
          <AppRoutes />
        </NuqsAdapter>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}
function send(text: string) {
  const input = screen.getByRole('textbox', { name: '问侦探' })
  fireEvent.change(input, { target: { value: text } })
  fireEvent.submit(input.closest('form')!)
}
function history() {
  fireEvent.click(screen.getByRole('button', { name: '打开会话列表' }))
  return screen.getByRole('navigation', { name: '对话记录' })
}

it('聊天页保留网站导航，记录栏默认收起，点小按钮才展开', () => {
  vi.stubGlobal('fetch', async () => json(null))
  show('/detective')
  expect(screen.getByRole('link', { name: 'Inkpaw' })).toBeTruthy()
  expect(screen.getByRole('link', { name: '侦探' })).toBeTruthy()
  expect(screen.queryByRole('navigation', { name: '对话记录' })).toBeNull()
  expect(history()).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '关闭会话列表' }))
  expect(screen.queryByRole('navigation', { name: '对话记录' })).toBeNull()
})

it('首页入口进入独立侦探页，发送后有独立会话记录', async () => {
  vi.stubGlobal('fetch', async (url: RequestInfo | URL) =>
    String(url).includes('/agent/ask')
      ? new Response(event('answer', { content: '可以继续挑比赛。', sources: [] }), {
          headers: { 'content-type': 'text/event-stream' },
        })
      : json(String(url).includes('/auth/me') ? null : []),
  )
  show()
  fireEvent.click(screen.getByRole('link', { name: '侦探' }))
  expect(screen.getByRole('heading', { name: '想找什么样的比赛？' })).toBeTruthy()
  send('大学生线上比赛')
  expect(await screen.findByText('可以继续挑比赛。')).toBeTruthy()
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(within(history()).getByRole('link', { name: '大学生线上比赛' })).toBeTruthy()
})

it('HTTP 环境没有 randomUUID 时仍能发送、追问并恢复不同会话', async () => {
  vi.stubGlobal('crypto', { getRandomValues: crypto.getRandomValues.bind(crypto) })
  vi.stubGlobal('fetch', async (url: RequestInfo | URL, init?: RequestInit) => {
    if (!String(url).includes('/agent/ask'))
      return json(String(url).includes('/auth/me') ? null : [])
    const body = JSON.parse(init!.body as string)
    return new Response(event('answer', { content: `回复：${body.question}`, sources: [] }), {
      headers: { 'content-type': 'text/event-stream' },
    })
  })
  const first = show('/detective')
  const submit = (text: string) => {
    fireEvent.change(screen.getByRole('textbox', { name: '问侦探' }), {
      target: { value: text },
    })
    fireEvent.click(screen.getByRole('button', { name: '查证' }))
  }
  submit('线上第一条消息')
  expect(await screen.findByText('回复：线上第一条消息')).toBeTruthy()
  submit('继续第一段对话')
  expect(await screen.findByText('回复：继续第一段对话')).toBeTruthy()
  fireEvent.click(screen.getByRole('link', { name: '新对话' }))
  submit('另开一段对话')
  expect(await screen.findByText('回复：另开一段对话')).toBeTruthy()

  first.unmount()
  show('/detective')
  const records = history()
  expect(within(records).getAllByRole('link')).toHaveLength(2)
  fireEvent.click(within(records).getByRole('link', { name: '线上第一条消息' }))
  expect(screen.getByText('回复：线上第一条消息')).toBeTruthy()
  expect(screen.getByText('回复：继续第一段对话')).toBeTruthy()
  expect(screen.queryByText('回复：另开一段对话')).toBeNull()
})

it('首页发送直接进入聊天页，新建与切换会话不混用前文，刷新恢复记录', async () => {
  const requests: { question: string; history?: unknown[] }[] = []
  vi.stubGlobal('fetch', async (url: RequestInfo | URL, init?: RequestInit) => {
    if (!String(url).includes('/agent/ask'))
      return json(String(url).includes('/auth/me') ? null : [])
    const body = JSON.parse(init!.body as string)
    requests.push(body)
    return new Response(event('answer', { content: `已记下：${body.question}`, sources: [] }), {
      headers: { 'content-type': 'text/event-stream' },
    })
  })
  const first = show()
  send('第一段参赛计划')
  expect(await screen.findByText('已记下：第一段参赛计划')).toBeTruthy()
  expect(screen.queryByRole('heading', { name: '近期值得参加的黑客松' })).toBeNull()
  fireEvent.click(screen.getByRole('link', { name: '新对话' }))
  send('第二段参赛计划')
  expect(await screen.findByText('已记下：第二段参赛计划')).toBeTruthy()
  expect(requests[1]?.history).toBeUndefined()
  fireEvent.click(within(history()).getByRole('link', { name: '第一段参赛计划' }))
  expect(screen.getByText('已记下：第一段参赛计划')).toBeTruthy()
  expect(screen.queryByText('已记下：第二段参赛计划')).toBeNull()
  send('继续第一段')
  expect(await screen.findByText('已记下：继续第一段')).toBeTruthy()
  expect(requests[2]?.history).toEqual([
    { role: 'user', content: '第一段参赛计划' },
    { role: 'assistant', content: '已记下：第一段参赛计划' },
  ])
  first.unmount()
  show('/detective')
  const records = history()
  expect(within(records).getAllByRole('link')).toHaveLength(2)
  fireEvent.click(within(records).getByRole('link', { name: '第一段参赛计划' }))
  expect(screen.getByText('已记下：继续第一段')).toBeTruthy()
})

it('离开聊天页不取消流，返回原会话后继续显示完成的回复', async () => {
  let stream!: ReadableStreamDefaultController<Uint8Array>
  let signal: AbortSignal | null | undefined
  vi.stubGlobal('fetch', async (url: RequestInfo | URL, init?: RequestInit) => {
    if (!String(url).includes('/agent/ask'))
      return json(String(url).includes('/auth/me') ? null : [])
    signal = init?.signal
    return new Response(
      new ReadableStream({
        start(controller) {
          stream = controller
        },
      }),
      { headers: { 'content-type': 'text/event-stream' } },
    )
  })
  show('/detective')
  send('保留正在输出的计划')
  await waitFor(() => expect(stream).toBeTruthy())
  fireEvent.click(screen.getByRole('link', { name: '浏览赛事' }))
  expect(signal?.aborted).toBe(false)
  await act(async () => {
    stream.enqueue(
      new TextEncoder().encode(event('answer', { content: '离开页面后仍然完成。', sources: [] })),
    )
    stream.close()
  })
  fireEvent.click(screen.getByRole('link', { name: '侦探' }))
  fireEvent.click(within(history()).getByRole('link', { name: '保留正在输出的计划' }))
  expect(screen.getByText('离开页面后仍然完成。')).toBeTruthy()
})
