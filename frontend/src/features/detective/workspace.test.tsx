// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { NuqsAdapter } from 'nuqs/adapters/react-router/v8'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AppRoutes } from '@/app/app'
import { stubResizeObserver } from './detective.test.utils'
vi.mock('@/shared/ui/octopus/inkpaw-octopus', () => ({ mountOctopus: () => null }))

beforeEach(() => {
  localStorage.clear()
  stubResizeObserver()
})
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
  const input =
    document.querySelector<HTMLTextAreaElement>('#top-ask textarea') ??
    screen.getByRole('textbox', { name: '问侦探' })
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
  expect(screen.getByRole('link', { name: 'Inkpaw 首页' })).toBeTruthy()
  expect(screen.getByRole('link', { name: '侦探' })).toBeTruthy()
  expect(screen.queryByRole('navigation', { name: '对话记录' })).toBeNull()
  expect(history()).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '关闭会话列表' }))
  expect(screen.queryByRole('navigation', { name: '对话记录' })).toBeNull()
})

it('新对话用捧书章鱼引导建立画像，点加号后收起提示并进入现有表单', async () => {
  vi.stubGlobal('fetch', async () => json(null))
  show('/detective')
  expect(await screen.findByRole('img', { name: '捧书的 Inkpaw 八爪鱼' })).toBeTruthy()
  expect(await screen.findByRole('dialog', { name: '建立参赛画像' })).toBeTruthy()
  fireEvent.keyDown(screen.getByRole('button', { name: '添加简历或参赛资料' }), { key: 'Enter' })
  expect(screen.queryByRole('dialog', { name: '建立参赛画像' })).toBeNull()
  fireEvent.click(await screen.findByRole('menuitem', { name: '添加画像' }))
  expect(await screen.findByRole('dialog', { name: '添加画像' })).toBeTruthy()
  expect(screen.getByLabelText('上传简历')).toBeTruthy()
})

it('画像提示可以关闭，建立画像按钮打开现有画像表单', async () => {
  vi.stubGlobal('fetch', async () => json(null))
  const first = show('/detective')
  const guide = await screen.findByRole('dialog', { name: '建立参赛画像' })
  fireEvent.click(within(guide).getByRole('button', { name: '关闭画像提示' }))
  expect(screen.queryByRole('dialog', { name: '建立参赛画像' })).toBeNull()
  first.unmount()
  show('/detective')
  const nextGuide = await screen.findByRole('dialog', { name: '建立参赛画像' })
  fireEvent.click(within(nextGuide).getByRole('button', { name: '建立画像' }))
  expect(await screen.findByRole('dialog', { name: '添加画像' })).toBeTruthy()
  expect(screen.queryByRole('dialog', { name: '建立参赛画像' })).toBeNull()
})

it.each(['guest', 'account'])('已有 %s 画像时保留章鱼但不再提示建立画像', async (scope) => {
  const profile = { skills: ['Python'] }
  if (scope === 'guest') localStorage.setItem('contest-detective.profile', JSON.stringify(profile))
  vi.stubGlobal('fetch', async () =>
    json(
      scope === 'account' ? { id: 'profile-user', username: 'reader@example.org', profile } : null,
    ),
  )
  show('/detective')
  expect(await screen.findByRole('img', { name: '捧书的 Inkpaw 八爪鱼' })).toBeTruthy()
  if (scope === 'account') expect(await screen.findByText('reader@example.org')).toBeTruthy()
  expect(screen.queryByRole('dialog', { name: '建立参赛画像' })).toBeNull()
})

it('账号的空画像默认值仍显示引导', async () => {
  vi.stubGlobal('fetch', async () =>
    json({
      id: 'new-user',
      username: 'new@example.org',
      profile: {
        skills: [],
        topics: [],
        preferred_modes: [],
        github_evidence: [],
        language_repo_share: {},
        availability: { weekdays: [], windows: [], max_consecutive_days: null },
        identity: null,
        identity_kind: null,
        github: null,
        city: null,
        available_time: null,
        github_last_active_at: null,
      },
    }),
  )
  show('/detective')
  expect(await screen.findByRole('dialog', { name: '建立参赛画像' })).toBeTruthy()
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
  expect(screen.queryByRole('img', { name: '捧书的 Inkpaw 八爪鱼' })).toBeNull()
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

const recommendation = {
  contest: {
    id: 'selected-contest',
    name: '周末应用赛',
    cover_url: 'https://events.example/poster.jpg',
    summary: '两天完成一个应用。',
    status: 'upcoming',
    fields: { prize: { value: '¥20,000', level: 'official' } },
  },
  introduction: '面向应用开发的周末比赛。',
  reason: '适合从现有项目开始。',
}

it('正式回复同时显示原文与 Agent 选中的卡片，刷新后保留', async () => {
  vi.stubGlobal('fetch', async (url: RequestInfo | URL) =>
    String(url).includes('/agent/ask')
      ? new Response(
          event('answer', {
            content: '建议参加周末应用赛。',
            sources: [],
            recommendations: [recommendation],
          }),
          {
            headers: { 'content-type': 'text/event-stream' },
          },
        )
      : json(String(url).includes('/auth/me') ? null : []),
  )
  const first = show('/detective')
  send('推荐一场应用开发比赛')
  expect(await screen.findByText('建议参加周末应用赛。')).toBeTruthy()
  const card = await screen.findByRole('article', { name: '周末应用赛' })
  expect(within(card).getByText('适合从现有项目开始。')).toBeTruthy()
  expect(within(card).getByText('面向应用开发的周末比赛。')).toBeTruthy()
  first.unmount()
  show('/detective')
  fireEvent.click(within(history()).getByRole('link', { name: '推荐一场应用开发比赛' }))
  expect(await screen.findByRole('article', { name: '周末应用赛' })).toBeTruthy()
})

it('旧对话补回正文引用的比赛卡片，保留原文且不重新提问', async () => {
  localStorage.setItem(
    'contest-detective.sessions.guest',
    JSON.stringify([
      {
        id: 'old-session',
        title: '旧推荐',
        createdAt: 1,
        updatedAt: 1,
        turns: [
          {
            id: 'old-turn',
            question: '旧推荐',
            content: '[周末应用赛](https://events.example/weekend)',
            trace: [],
            sources: [],
            status: 'completed',
          },
        ],
      },
    ]),
  )
  const paths: string[] = []
  vi.stubGlobal('fetch', async (url: RequestInfo | URL) => {
    paths.push(String(url))
    return json(
      String(url).includes('/auth/me')
        ? null
        : String(url).includes('/agent/recommendations/resolve')
          ? [recommendation]
          : [],
    )
  })
  show('/detective/old-session')
  expect(await screen.findByRole('article', { name: '周末应用赛' })).toBeTruthy()
  expect(
    screen
      .getAllByRole('link', { name: '周末应用赛' })
      .some((link) => link.getAttribute('href') === 'https://events.example/weekend'),
  ).toBe(true)
  expect(paths.some((path) => path.includes('/agent/ask'))).toBe(false)
})
