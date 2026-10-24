// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, useLocation, useNavigate } from 'react-router'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import type { ReactNode } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { AppRoutes } from '@/app/app'
vi.mock('@/shared/ui/octopus/inkpaw-octopus', () => ({ mountOctopus: () => null }))
const fields = {
  start_at: { value: '2026-10-25T02:00:00Z', level: 'reposted', sources: [] },
  mode: { value: 'online', level: 'reposted', sources: [] },
}
const item = { id: 'one', name: '真实接口赛事', cover_url: null, status: 'upcoming', fields }
let requested: string[] = []
function LocationValue() {
  return <output data-testid="query">{useLocation().search}</output>
}
function QueryAdapter({ children }: { children: ReactNode }) {
  const { search } = useLocation()
  const navigate = useNavigate()
  return (
    <NuqsTestingAdapter
      searchParams={search}
      hasMemory
      onUrlUpdate={({ queryString }) => void navigate({ search: queryString }, { replace: true })}
    >
      {children}
    </NuqsTestingAdapter>
  )
}
function start(path = '/contests') {
  window.history.replaceState(null, '', path)
  requested = []
  vi.stubGlobal('fetch', async (input: string) => {
    requested.push(input)
    const url = new URL(input, 'https://example.com')
    let data: unknown
    if (url.pathname === '/api/contests/one')
      data = {
        ...item,
        summary: '比赛介绍',
        fields: {
          ...fields,
          start_at: {
            ...fields.start_at,
            sources: [
              {
                title: '赛事规则',
                url: 'https://example.com/rules',
                site: '主办方',
                published_at: null,
                is_official: false,
                value: '2026-10-25T02:00:00Z',
                excerpt: '10月25日开赛',
                stale: true,
              },
            ],
          },
        },
      }
    else if (url.pathname === '/api/auth/me') data = null
    else data = url.searchParams.get('keyword') === '无结果' ? [] : [item]
    return new Response(
      JSON.stringify({
        code: 200,
        message: 'success',
        data,
        total: Array.isArray(data) ? data.length : 1,
        page: 1,
        page_size: 20,
      }),
    )
  })
  render(
    <MemoryRouter initialEntries={[path]}>
      <QueryAdapter>
        <QueryClientProvider
          client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
        >
          <AppRoutes />
          <LocationValue />
        </QueryClientProvider>
      </QueryAdapter>
    </MemoryRouter>,
  )
}
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
it('opens field sources and preserves filters after closing', async () => {
  start('/contests?keyword=真实')
  const links = await screen.findAllByRole('link', { name: '真实接口赛事' })
  fireEvent.click(links[0]!)
  fireEvent.click(await screen.findByText('查看原文摘录'))
  expect(await screen.findByRole('link', { name: '赛事规则' })).toBeTruthy()
  expect(screen.getByText('10月25日开赛').closest('.contest-detail-source')?.className).toContain(
    'line-through',
  )
  fireEvent.click(screen.getByRole('button', { name: '关闭' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect((screen.getByRole('searchbox', { name: '搜索赛事' }) as HTMLInputElement).value).toBe(
    '真实',
  )
})
it('loads the whole collection then filters locally without a second keyword request', async () => {
  start()
  await screen.findAllByRole('link', { name: '真实接口赛事' })
  fireEvent.change(screen.getByRole('searchbox', { name: '搜索赛事' }), {
    target: { value: '无结果' },
  })
  expect(await screen.findByText('没有符合条件的比赛')).toBeTruthy()
  expect(
    requested.some((url) => new URL(url, 'https://example.com').searchParams.has('keyword')),
  ).toBe(false)
  await waitFor(() =>
    expect(new URLSearchParams(screen.getByTestId('query').textContent ?? '').get('keyword')).toBe(
      '无结果',
    ),
  )
})

it('restores multiple URL filters and keeps inactive alternatives countable', async () => {
  start('/contests?mode=online,hybrid&due=none&official=true&view=calendar')
  await screen.findByText('没有符合条件的比赛')
  expect(screen.getByRole('button', { name: /^线上\s*0$/ }).getAttribute('aria-pressed')).toBe(
    'true',
  )
  expect(
    screen.getByRole('button', { name: /^线上\+线下\s*0$/ }).getAttribute('aria-pressed'),
  ).toBe('true')
  expect(screen.getByRole('button', { name: '日历' }).getAttribute('aria-pressed')).toBe('true')
  fireEvent.click(screen.getByRole('button', { name: '清除全部' }))
  fireEvent.click(screen.getByRole('button', { name: '列表' }))
  await screen.findAllByRole('link', { name: '真实接口赛事' })
  await waitFor(() => expect(screen.getByTestId('query').textContent).toBe(''))
})

it('date survives in result links and can be toggled without erasing other day counts', async () => {
  start('/contests?date=2026-10-24')
  await screen.findByText('没有符合条件的比赛')
  const mini = screen.getByRole('group', { name: '小日历' })
  const day = within(mini).getByRole('button', { name: '10月25日，1 场' })
  fireEvent.click(day)
  const links = await screen.findAllByRole('link', { name: '真实接口赛事' })
  await waitFor(() => expect(links[0]!.getAttribute('href')).toContain('date=2026-10-25'))
  expect(screen.getByRole('button', { name: '去掉 10月25日' })).toBeTruthy()
  fireEvent.click(day)
  await waitFor(() => expect(screen.queryByRole('button', { name: '去掉 10月25日' })).toBeNull())
  await waitFor(() =>
    expect(
      new URLSearchParams(screen.getByTestId('query').textContent ?? '').get('date'),
    ).toBeNull(),
  )
})
