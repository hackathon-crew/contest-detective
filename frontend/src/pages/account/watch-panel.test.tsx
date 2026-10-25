// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, expect, it, vi } from 'vitest'
import { currentUserKey } from '@/entities/user'
import { WatchPanel } from './watch-panel'

const owner = { id: 'owner-a', username: 'a@example.com', profile: {} }
const other = { id: 'owner-b', username: 'b@example.com', profile: {} }
const baseStatus = {
  contest_id: 'contest-a',
  contest_name: 'A 赛事',
  enabled: false,
  state: 'paused',
  last_check: null,
  last_success_at: null,
  next_check_at: null,
}
function page(overrides: Record<string, unknown> = {}) {
  return {
    items: [baseStatus],
    notifications: [],
    has_more: false,
    has_more_notifications: false,
    ...overrides,
  }
}
function response(data: unknown, code = 200, message = 'ok') {
  return new Response(JSON.stringify({ code, message, data }))
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((finish) => {
    resolve = finish
  })
  return { promise, resolve }
}
function source(url: string, title: string, value: string) {
  return { url, title, value, site: '赛事官网', excerpt: value, is_official: true }
}
function field(value: string, sources = [source('https://example.com/rules', '赛事规则', value)]) {
  return { value, level: 'official', sources }
}
function notification(eventId = 20, name = '变动赛事') {
  return {
    event_id: eventId,
    contest_id: 'contest-' + eventId,
    occurred_at: '2026-10-25T02:15:00Z',
    read_at: null as string | null,
    change: {
      before: { name, fields: { prize: field('1000 元') } },
      after: { name, fields: { prize: field('2000 元') } },
    },
  }
}
function setup(user: typeof owner | null = owner, followedIds?: string[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(currentUserKey, user)
  const view = render(
    <QueryClientProvider client={client}>
      <WatchPanel followedIds={followedIds} />
    </QueryClientProvider>,
  )
  return { client, ...view }
}
async function readySwitch(name = '盯梢「A 赛事」') {
  const control = (await screen.findByRole('switch', { name })) as HTMLButtonElement
  await waitFor(() => expect(control.disabled).toBe(false))
  return control
}
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

it('does not request or render private watch data while logged out', async () => {
  const fetcher = vi.fn()
  vi.stubGlobal('fetch', fetcher)
  setup(null)
  await act(async () => {})
  expect(fetcher).not.toHaveBeenCalled()
  expect(screen.queryByText('比赛盯梢')).toBeNull()
})

it('separates disabled subscriptions from paused scheduling and never implies an unperformed check', async () => {
  vi.stubGlobal('fetch', async () =>
    response(
      page({
        items: [
          baseStatus,
          {
            ...baseStatus,
            contest_id: 'contest-b',
            contest_name: 'B 赛事',
            enabled: true,
            state: 'scheduler_paused',
          },
        ],
      }),
    ),
  )
  setup()
  expect((await readySwitch()).getAttribute('aria-checked')).toBe('false')
  expect((await readySwitch('盯梢「B 赛事」')).getAttribute('aria-checked')).toBe('true')
  expect(screen.getByText('已暂停盯梢')).toBeTruthy()
  expect(screen.getByText('订阅已开启，自动检查暂停')).toBeTruthy()
  expect(screen.getAllByText('尚未实际检查')).toHaveLength(2)
  expect(screen.queryByText(/预计下次/)).toBeNull()
  expect(screen.getByText(/仅记录开启盯梢之后/)).toBeTruthy()
})

it('shows an actual failed check without losing its earlier success and labels scheduling as approximate', async () => {
  vi.stubGlobal('fetch', async () =>
    response(
      page({
        items: [
          {
            ...baseStatus,
            enabled: true,
            state: 'scheduled',
            last_check: {
              contest_id: 'contest-a',
              checked_at: '2026-10-25T02:00:00Z',
              completed_at: '2026-10-25T02:01:00Z',
              outcome: 'failed',
              source_url: 'https://example.com/check',
              error_type: 'TimeoutError',
            },
            last_success_at: '2026-10-24T01:00:00Z',
            next_check_at: '2026-10-26T02:00:00Z',
          },
        ],
      }),
    ),
  )
  setup()
  await readySwitch()
  expect(screen.getByText(/检查失败/)).toBeTruthy()
  expect(screen.getByText(/最近成功检查/).querySelector('time')?.dateTime).toBe(
    '2026-10-24T01:00:00Z',
  )
  expect(screen.getByText(/预计下次：约/).textContent).toContain('随队列调整')
  expect(screen.getByRole('link', { name: '检查来源' }).getAttribute('href')).toBe(
    'https://example.com/check',
  )
})

it('keeps a rejected toggle unchanged, displays its error, and rejects repeated clicks while pending', async () => {
  const saving = deferred<Response>()
  const writes: RequestInit[] = []
  vi.stubGlobal('fetch', async (_url: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === 'PUT') {
      writes.push(init)
      return saving.promise
    }
    return response(page())
  })
  setup()
  const control = await readySwitch()
  fireEvent.click(control)
  fireEvent.click(control)
  expect(control.disabled).toBe(true)
  expect(control.getAttribute('aria-checked')).toBe('false')
  expect(writes).toHaveLength(1)
  expect(JSON.parse(String(writes[0].body))).toEqual({ enabled: true })
  saving.resolve(response(null, 403, '只能为已关注的比赛开启盯梢'))
  expect(await screen.findByRole('alert')).toHaveProperty(
    'textContent',
    '只能为已关注的比赛开启盯梢',
  )
  await waitFor(() => expect(control.disabled).toBe(false))
  expect(control.getAttribute('aria-checked')).toBe('false')
})

it('refetches the current account after a successful toggle', async () => {
  let status = baseStatus
  const paths: string[] = []
  vi.stubGlobal('fetch', async (url: RequestInfo | URL, init?: RequestInit) => {
    paths.push(String(url))
    if (init?.method === 'PUT') {
      status = { ...baseStatus, enabled: true, state: 'scheduler_paused' }
      return response(status)
    }
    return response(page({ items: [status] }))
  })
  setup()
  const control = await readySwitch()
  fireEvent.click(control)
  await waitFor(() => expect(control.getAttribute('aria-checked')).toBe('true'))
  expect(screen.getByText('订阅已开启，自动检查暂停')).toBeTruthy()
  expect(paths).toEqual([
    '/api/account/watch',
    '/api/account/watch/contest-a',
    '/api/account/watch',
  ])
})

it('aborts an old account fetch and ignores its late response after switching accounts', async () => {
  const old = deferred<Response>()
  let identity = owner.id
  let oldSignal: AbortSignal | undefined
  vi.stubGlobal('fetch', async (_url: RequestInfo | URL, init?: RequestInit) => {
    if (identity === owner.id) {
      oldSignal = init?.signal ?? undefined
      return old.promise
    }
    return response(page({ items: [{ ...baseStatus, contest_name: 'B 的私有状态' }] }))
  })
  const { client } = setup()
  await waitFor(() => expect(oldSignal).toBeTruthy())
  await act(async () => {
    identity = other.id
    client.setQueryData(currentUserKey, other)
  })
  await readySwitch('盯梢「B 的私有状态」')
  expect(oldSignal?.aborted).toBe(true)
  await act(async () => old.resolve(response(page())))
  expect(screen.queryByText('A 赛事')).toBeNull()
  expect(screen.getByText('B 的私有状态')).toBeTruthy()
  await waitFor(() =>
    expect(client.getQueriesData({ queryKey: ['account-watch', owner.id] })).toHaveLength(0),
  )
})

it('aborts an in-flight mutation on account change without leaking its error or refetching as the new owner', async () => {
  const old = deferred<Response>()
  let identity = owner.id
  let mutationSignal: AbortSignal | undefined
  const reads: string[] = []
  vi.stubGlobal('fetch', async (_url: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === 'PUT') {
      mutationSignal = init.signal ?? undefined
      return old.promise
    }
    reads.push(identity)
    return response(
      page({
        items: [{ ...baseStatus, contest_name: identity === owner.id ? 'A 赛事' : 'B 赛事' }],
      }),
    )
  })
  const { client } = setup()
  fireEvent.click(await readySwitch())
  await act(async () => {
    identity = other.id
    client.setQueryData(currentUserKey, other)
  })
  await readySwitch('盯梢「B 赛事」')
  expect(mutationSignal?.aborted).toBe(true)
  await act(async () => old.resolve(response(null, 403, 'A 账号的操作失败')))
  expect(screen.queryByRole('alert')).toBeNull()
  expect(screen.queryByText('A 赛事')).toBeNull()
  expect(reads).toEqual([owner.id, other.id])
})

it('renders only changed snapshot fields and keeps before/after sources separate and safe', async () => {
  const item = notification()
  const before = field('2026-11-01', [
    source('https://example.com/old', '旧报名公告', '2026-11-01'),
  ])
  const after = field('2026-11-08', [
    source('https://example.com/new', '延期公告', '2026-11-08'),
    source('javascript:alert(1)', '不安全来源', '2026-11-08'),
  ])
  const city = field('上海')
  const changed = {
    ...item,
    change: {
      before: {
        name: item.change.before.name,
        fields: { registration_deadline: { ...before, precision: 'day' }, city },
      },
      after: {
        name: item.change.after.name,
        fields: {
          registration_deadline: { ...after, precision: 'day' },
          city: { sources: city.sources, level: city.level, value: city.value },
        },
      },
    },
  }
  vi.stubGlobal('fetch', async () => response(page({ notifications: [changed] })))
  setup()
  const changes = within(await screen.findByRole('list', { name: '比赛变动记录' }))
  await waitFor(() => expect(changes.getByText('报名截止')).toBeTruthy())
  expect(changes.getByText(/变更前：2026年11月1日（时刻未核实）/)).toBeTruthy()
  expect(changes.getByText(/变更后：2026年11月8日（时刻未核实）/)).toBeTruthy()
  expect(changes.queryByText('城市')).toBeNull()
  const oldSource = within(changes.getByRole('list', { name: '变更前来源' })).getByRole('link')
  const newSource = within(changes.getByRole('list', { name: '变更后来源' })).getByRole('link')
  expect(oldSource.getAttribute('href')).toBe('https://example.com/old')
  expect(newSource.getAttribute('href')).toBe('https://example.com/new')
  expect(newSource.getAttribute('rel')).toBe('noopener noreferrer')
  expect(changes.queryByRole('link', { name: '不安全来源' })).toBeNull()
  expect(changes.getByText('2026/10/25 10:15').getAttribute('datetime')).toBe(item.occurred_at)
})

it('marks only the selected notification read and keeps a rejected ownership request unread', async () => {
  let items = [notification(20, '第一场'), notification(21, '第二场')]
  const writes: string[] = []
  let fail = true
  vi.stubGlobal('fetch', async (url: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === 'POST') {
      writes.push(String(url))
      if (fail) return response(null, 404, '未找到这条变动记录')
      items = items.map((item) =>
        item.event_id === 21 ? { ...item, read_at: '2026-10-25T03:00:00Z' } : item,
      )
      return response(null)
    }
    return response(page({ notifications: items }))
  })
  setup()
  await readySwitch()
  fireEvent.click(screen.getByRole('button', { name: /标记「第二场」/ }))
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', '未找到这条变动记录')
  expect(screen.getAllByRole('button', { name: /标记/ })).toHaveLength(2)
  fail = false
  await waitFor(() =>
    expect(
      (screen.getByRole('button', { name: /标记「第二场」/ }) as HTMLButtonElement).disabled,
    ).toBe(false),
  )
  fireEvent.click(screen.getByRole('button', { name: /标记「第二场」/ }))
  await waitFor(() => expect(screen.queryByRole('button', { name: /标记「第二场」/ })).toBeNull())
  expect(screen.getByRole('button', { name: /标记「第一场」/ })).toBeTruthy()
  expect(writes).toEqual([
    '/api/account/watch/notifications/21/read',
    '/api/account/watch/notifications/21/read',
  ])
})

it('loads older notifications with an event cursor without confusing pagination with ingestion', async () => {
  const paths: string[] = []
  vi.stubGlobal('fetch', async (url: RequestInfo | URL) => {
    paths.push(String(url))
    return response(
      String(url).includes('before_event_id=20')
        ? page({ notifications: [notification(19, '更早记录')] })
        : page({ notifications: [notification(20, '最近记录')], has_more_notifications: true }),
    )
  })
  setup()
  await readySwitch()
  expect(screen.queryByRole('button', { name: '继续处理待收取变动' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '查看更早变动' }))
  expect(await screen.findByText('更早记录')).toBeTruthy()
  expect(screen.getByText('最近记录')).toBeTruthy()
  expect(screen.queryByRole('button', { name: '查看更早变动' })).toBeNull()
  expect(paths).toEqual(['/api/account/watch', '/api/account/watch?before_event_id=20'])
})

it('consumes another bounded batch only on request and prevents duplicate clicks', async () => {
  const pending = deferred<Response>()
  let consumed = false
  let writes = 0
  vi.stubGlobal('fetch', async (_url: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === 'POST') {
      writes++
      await pending.promise
      consumed = true
      return response({ processed: 500 })
    }
    return response(page({ has_more: !consumed }))
  })
  setup()
  await readySwitch()
  expect(writes).toBe(0)
  const consume = screen.getByRole('button', { name: '继续处理待收取变动' })
  fireEvent.click(consume)
  fireEvent.click(consume)
  expect(writes).toBe(1)
  pending.resolve(response(null))
  await waitFor(() =>
    expect(screen.queryByRole('button', { name: '继续处理待收取变动' })).toBeNull(),
  )
})

it('reports a read failure rather than claiming there are no updates and allows retry', async () => {
  let fail = true
  vi.stubGlobal('fetch', async () =>
    fail ? response(null, 503, '暂时无法读取') : response(page()),
  )
  setup()
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', '暂时无法读取')
  expect(screen.queryByText(/暂无变动记录/)).toBeNull()
  fail = false
  fireEvent.click(screen.getByRole('button', { name: '重试读取' }))
  await readySwitch()
  expect(screen.queryByRole('alert')).toBeNull()
})

it('does not reconstruct missing legacy snapshots and safely handles name-only changes', async () => {
  const legacy = { ...notification(10), change: { before: null, after: null } }
  const renamed = {
    ...notification(11),
    change: { before: { name: '旧名称' }, after: { name: '新名称' } },
  }
  vi.stubGlobal('fetch', async () => response(page({ notifications: [legacy, renamed] })))
  setup()
  await readySwitch()
  expect(screen.getByText('这条记录缺少完整前后证据，无法展示变化。')).toBeTruthy()
  expect(screen.getByText('变更前：旧名称')).toBeTruthy()
  expect(screen.getByText('变更后：新名称')).toBeTruthy()
  expect(screen.queryByText('奖励')).toBeNull()
})

it('keeps no-source attempts distinct from successful checks and renders default disabled state', async () => {
  vi.stubGlobal('fetch', async () =>
    response(
      page({
        items: [
          { contest_id: 'contest-a', contest_name: 'A 赛事', state: 'paused' },
          {
            ...baseStatus,
            contest_id: 'no-source',
            contest_name: '缺少来源',
            enabled: true,
            state: 'no_source',
            last_check: {
              contest_id: 'no-source',
              checked_at: '2026-10-25T01:00:00Z',
              completed_at: '2026-10-25T01:00:00Z',
              outcome: 'no_source',
            },
          },
        ],
      }),
    ),
  )
  setup()
  expect((await readySwitch()).getAttribute('aria-checked')).toBe('false')
  expect(screen.getByText('暂无可检查的来源')).toBeTruthy()
  expect(screen.getByText(/没有可检查的来源，未抓取页面/)).toBeTruthy()
  expect(screen.queryByText(/最近成功检查/)).toBeNull()
  expect(screen.queryByRole('link', { name: '检查来源' })).toBeNull()
})

it('refreshes watch membership after the followed contests change', async () => {
  let removed = false
  let reads = 0
  vi.stubGlobal('fetch', async () => {
    reads++
    return response(page({ items: removed ? [] : [baseStatus] }))
  })
  const { client, rerender } = setup(owner, ['contest-a'])
  await readySwitch()
  removed = true
  rerender(
    <QueryClientProvider client={client}>
      <WatchPanel followedIds={[]} />
    </QueryClientProvider>,
  )
  expect(await screen.findByText('还没有可盯梢的比赛，先在赛事库关注一场。')).toBeTruthy()
  expect(screen.queryByRole('switch')).toBeNull()
  expect(reads).toBe(2)
})

it('removes loaded private notifications on logout without making a logged-out watch request', async () => {
  const fetcher = vi.fn(async () =>
    response(page({ notifications: [notification(20, '私有变动')] })),
  )
  vi.stubGlobal('fetch', fetcher)
  const { client } = setup()
  expect(await screen.findByText('私有变动')).toBeTruthy()
  await act(async () => client.setQueryData(currentUserKey, null))
  await waitFor(() => expect(screen.queryByText('私有变动')).toBeNull())
  expect(screen.queryByText('比赛盯梢')).toBeNull()
  expect(fetcher).toHaveBeenCalledTimes(1)
  await waitFor(() =>
    expect(client.getQueriesData({ queryKey: ['account-watch', owner.id] })).toHaveLength(0),
  )
})
