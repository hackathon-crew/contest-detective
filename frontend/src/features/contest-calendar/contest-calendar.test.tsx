// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'
import { ContestCalendar } from './index'

const items = [
  {
    id: 'one',
    name: '跨天赛',
    cover_url: null,
    status: 'upcoming',
    fields: {
      start_at: { value: '2026-10-24T16:00:00Z', level: 'official' },
    },
  },
  {
    id: 'two',
    name: '次日赛',
    cover_url: null,
    status: 'upcoming',
    fields: {
      registration_deadline: { value: '2026-10-25T16:00:00Z', level: 'reposted' },
    },
  },
  {
    id: 'three',
    name: '仅日期赛',
    cover_url: null,
    status: 'upcoming',
    fields: {
      start_at: { value: '2026-10-27T00:00:00Z', level: 'official', precision: 'day' },
    },
  },
]
const clients: QueryClient[] = []
let calls: URL[] = []

function start(followedIds?: string[]) {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-24T16:01:00Z'))
  calls = []
  vi.stubGlobal('fetch', async (input: string) => {
    const url = new URL(input, 'https://example.com')
    calls.push(url)
    const ids = url.searchParams.get('ids')?.split(',')
    const from = Date.parse(url.searchParams.get('date_from')!)
    const to = Date.parse(url.searchParams.get('date_to')!)
    const data = items.filter(
      (item) =>
        (!ids || ids.includes(item.id)) &&
        Object.values(item.fields).some(
          (field) => Date.parse(field!.value) >= from && Date.parse(field!.value) <= to,
        ),
    )
    return new Response(
      JSON.stringify({
        code: 200,
        message: 'success',
        data,
        total: data.length,
        page: 1,
        page_size: 100,
      }),
    )
  })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  clients.push(client)
  render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <ContestCalendar followedIds={followedIds} />
      </QueryClientProvider>
    </MemoryRouter>,
  )
}

afterEach(() => {
  cleanup()
  clients.splice(0).forEach((client) => client.clear())
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

it('按北京时间标场次并在选日后查询当天节点', async () => {
  start()
  await waitFor(() =>
    expect(screen.getByRole('button', { name: /2026年10月25日，1场赛事/ })).toBeDefined(),
  )
  expect(await screen.findByRole('link', { name: '跨天赛' })).toBeDefined()
  fireEvent.click(screen.getByRole('button', { name: /2026年10月26日，1场赛事/ }))
  expect(await screen.findByRole('link', { name: '次日赛' })).toBeDefined()
  expect(screen.queryByRole('link', { name: '跨天赛' })).toBeNull()
  expect(
    calls.some(
      (url) =>
        url.searchParams.get('date_from') === '2026-10-25T16:00:00.000Z' &&
        url.searchParams.get('date_to') === '2026-10-26T15:59:59.999Z',
    ),
  ).toBe(true)
})

it('只看关注时把关注集合传给查询', async () => {
  start(['one'])
  await screen.findByRole('link', { name: '跨天赛' })
  fireEvent.click(screen.getByRole('button', { name: '只看关注' }))
  await waitFor(() => expect(calls.some((url) => url.searchParams.get('ids') === 'one')).toBe(true))
  expect(screen.getByRole('button', { name: '只看关注' }).getAttribute('aria-pressed')).toBe('true')
})

it('只有日期的节点保留日期并说明时刻未核实', async () => {
  start()
  await screen.findByRole('link', { name: '跨天赛' })
  fireEvent.click(screen.getByRole('button', { name: /2026年10月27日，1场赛事/ }))
  await screen.findByRole('link', { name: '仅日期赛' })
  expect(screen.getByText('比赛开始 · 10月27日（时刻未核实）')).toBeTruthy()
  expect(screen.queryByText(/08:00/)).toBeNull()
})
