// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { NuqsAdapter } from 'nuqs/adapters/react-router/v8'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'
import { AppRoutes } from '@/app/app'
vi.mock('@/shared/ui/octopus/inkpaw-octopus', () => ({ mountOctopus: () => null }))
const official = (value: string) => ({ value, level: 'official', precision: 'day', sources: [] })
const contests = [
  {
    id: 'python',
    name: 'Python Hack',
    cover_url: null,
    status: 'upcoming',
    fields: {
      registration_deadline: official('2027-11-01'),
      submission_deadline: official('2027-11-02'),
      mode: official('online'),
    },
  },
  {
    id: 'offline',
    name: 'Offline Hack',
    cover_url: null,
    status: 'upcoming',
    fields: { deadline_unspecified: official('2027-11-03'), mode: official('offline') },
  },
]
afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.unstubAllGlobals()
})
function show(path = '/', collectionResponse?: (url: URL) => Promise<Response>) {
  window.history.replaceState(null, '', path)
  const calls: { url: URL; init?: RequestInit }[] = []
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost')
    calls.push({ url, init })
    if (
      url.pathname === '/api/contests' &&
      !url.searchParams.has('date_from') &&
      collectionResponse
    )
      return collectionResponse(url)
    if (url.pathname.endsWith('/agent/ask'))
      return new Response('event: answer\ndata: {"content":"已核实出处。","sources":[]}\n\n', {
        headers: { 'content-type': 'text/event-stream' },
      })
    const items = url.searchParams.get('mode') === 'online' ? [contests[0]] : contests
    const data = url.pathname.endsWith('/auth/me')
      ? null
      : url.pathname.includes('/contests/')
        ? {
            ...contests.find(({ id }) => url.pathname.endsWith(`/contests/${id}`)),
            summary: null,
          }
        : items
    return Response.json({
      code: 200,
      message: 'ok',
      data,
      total: items.length,
      page: 1,
      page_size: 100,
    })
  })
  render(
    <MemoryRouter initialEntries={[path]}>
      <NuqsAdapter>
        <QueryClientProvider
          client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
        >
          <AppRoutes />
        </QueryClientProvider>
      </NuqsAdapter>
    </MemoryRouter>,
  )
  return calls
}
it('reads live totals and passes mode, deadline range and keyword to the list API', async () => {
  const calls = show()
  await waitFor(() =>
    expect(screen.getByText('场比赛在库').parentElement?.querySelector('b')?.textContent).toBe('2'),
  )
  expect(
    screen.getByText('场的截止时间对过官方原文').parentElement?.querySelector('b')?.textContent,
  ).toBe('1')
  fireEvent.click(
    within(screen.getByRole('group', { name: '参赛形式' })).getByRole('button', { name: '线上' }),
  )
  fireEvent.click(
    within(screen.getByRole('group', { name: '截止时间' })).getByRole('button', { name: '一周内' }),
  )
  fireEvent.change(screen.getByRole('searchbox', { name: '关键词' }), {
    target: { value: 'Python' },
  })
  await waitFor(() =>
    expect(
      calls.some(
        ({ url }) =>
          url.searchParams.get('mode') === 'online' &&
          url.searchParams.get('keyword') === 'Python' &&
          !!url.searchParams.get('date_from') &&
          !!url.searchParams.get('date_to'),
      ),
    ).toBe(true),
  )
  expect(await screen.findByText('找到 1 场')).toBeTruthy()
})
it('sends the exact hero question into a real conversation route', async () => {
  const calls = show()
  fireEvent.change(screen.getAllByRole('textbox', { name: '问侦探' })[0], {
    target: { value: '帮我核对 Python 比赛的截止时间' },
  })
  fireEvent.keyDown(screen.getAllByRole('textbox', { name: '问侦探' })[0], { key: 'Enter' })
  await waitFor(() =>
    expect(
      calls.some(
        ({ url, init }) =>
          url.pathname.endsWith('/agent/ask') &&
          JSON.parse(String(init?.body)).question === '帮我核对 Python 比赛的截止时间',
      ),
    ).toBe(true),
  )
  expect(screen.getByRole('button', { name: '打开会话列表' })).toBeTruthy()
})
it('opens GitHub profile import from the primary personalized recommendation action', async () => {
  show()
  fireEvent.click(screen.getByRole('button', { name: '按我的画像推荐' }))
  const dialog = await screen.findByRole('dialog', { name: '连接到 GitHub' })
  expect(within(dialog).getByRole('textbox', { name: 'GitHub 用户名' })).toBeTruthy()
})
it('starts an explicitly requested deep investigation with the edited question', async () => {
  const calls = show()
  fireEvent.change(screen.getByRole('textbox', { name: '深度检索问题' }), {
    target: { value: '帮我核对 Python Hack 的报名条件和作品提交截止时间' },
  })
  expect(calls.some(({ url }) => url.pathname.endsWith('/agent/ask'))).toBe(false)
  fireEvent.click(screen.getByRole('button', { name: '开始深度检索' }))
  await waitFor(() => {
    const request = calls.find(({ url }) => url.pathname.endsWith('/agent/ask'))
    expect(request).toBeTruthy()
    expect(JSON.parse(String(request?.init?.body))).toMatchObject({
      question: '帮我核对 Python Hack 的报名条件和作品提交截止时间',
      mode: 'deep',
    })
  })
  expect(screen.getByRole('button', { name: '打开会话列表' })).toBeTruthy()
})
it('asks the detective about the opened contest instead of replaying the demo', async () => {
  const calls = show('/contests/python')
  fireEvent.click(await screen.findByRole('button', { name: '问侦探这场比赛' }))
  await waitFor(() =>
    expect(
      calls.some(
        ({ url, init }) =>
          url.pathname.endsWith('/agent/ask') &&
          JSON.parse(String(init?.body)).question === '帮我核实一下「Python Hack」的截止时间',
      ),
    ).toBe(true),
  )
  expect(screen.getByRole('button', { name: '打开会话列表' })).toBeTruthy()
})
it('returns from a catalog detail to the same filtered catalog instance', async () => {
  show('/contests')
  const input = screen.getByRole('searchbox', { name: '搜索赛事' })
  fireEvent.change(input, { target: { value: 'Python' } })
  const library = screen.getByRole('region', { name: '全部赛事' })
  fireEvent.click(await within(library).findByRole('link', { name: 'Python Hack' }))
  expect(await screen.findByRole('dialog', { name: 'Python Hack' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '关闭' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(screen.getByRole('searchbox', { name: '搜索赛事' })).toBe(input)
  expect((input as HTMLInputElement).value).toBe('Python')
})

it('shows first-page cards before the rest arrives and preserves them when the next page fails', async () => {
  let finish!: (response: Response) => void
  const remaining = new Promise<Response>((resolve) => {
    finish = resolve
  })
  const deadline = new Date(Date.now() + 86400000).toISOString()
  const first = Array.from({ length: 100 }, (_, index) => ({
    ...contests[0],
    id: 'first-' + index,
    name: '首批赛事 ' + index,
    fields: {
      submission_deadline: {
        value: deadline,
        level: 'official',
        precision: 'datetime',
        sources: [],
      },
    },
  }))
  show('/', async (url) =>
    url.searchParams.get('page') === '2'
      ? remaining
      : Response.json({
          code: 200,
          message: 'ok',
          data: first,
          total: 101,
          page: 1,
          page_size: 100,
        }),
  )
  const section = within(screen.getByRole('heading', { name: '两周内截止' }).closest('section')!)
  try {
    expect(await section.findByRole('link', { name: /首批赛事 0/ })).toBeTruthy()
    expect(screen.getByText(/已加载 100/)).toBeTruthy()
  } finally {
    finish(Response.json({ code: 503, message: '后续赛事暂时不可用', data: null }, { status: 503 }))
  }
  await screen.findByRole('alert')
  expect(section.getByRole('link', { name: /首批赛事 0/ })).toBeTruthy()
  expect(screen.getByRole('button', { name: '重试' })).toBeTruthy()
})
