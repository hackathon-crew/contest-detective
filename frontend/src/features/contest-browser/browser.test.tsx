// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { NuqsAdapter } from 'nuqs/adapters/react-router/v8'
import { afterEach, expect, it, vi } from 'vitest'
import { AppRoutes } from '@/app/app'
const fields = {
  start_at: { value: '2026-10-25T02:00:00Z', level: 'reposted', sources: [] },
  mode: { value: 'online', level: 'reposted', sources: [] },
}
const item = { id: 'one', name: '真实接口赛事', cover_url: null, status: 'upcoming', fields }
let requested: string[] = []
function start(path = '/') {
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
      <NuqsAdapter>
        <QueryClientProvider
          client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
        >
          <AppRoutes />
        </QueryClientProvider>
      </NuqsAdapter>
    </MemoryRouter>,
  )
}
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
it('opens field sources and preserves filters after closing', async () => {
  start('/?keyword=真实')
  const links = await screen.findAllByRole('link', { name: '真实接口赛事' })
  fireEvent.click(links[0]!)
  expect(await screen.findByRole('link', { name: '赛事规则' })).toBeTruthy()
  expect(screen.getByText('10月25日开赛').closest('li')?.className).toContain('line-through')
  fireEvent.click(screen.getByRole('button', { name: '关闭' }))
  expect(screen.queryByRole('dialog')).toBeNull()
  expect((screen.getByRole('searchbox', { name: '搜索赛事' }) as HTMLInputElement).value).toBe(
    '真实',
  )
})
it('sends URL filters to the real client and shows an empty result', async () => {
  start()
  await screen.findAllByRole('link', { name: '真实接口赛事' })
  fireEvent.change(screen.getByRole('searchbox', { name: '搜索赛事' }), {
    target: { value: '无结果' },
  })
  await waitFor(() =>
    expect(
      requested.some(
        (url) => new URL(url, 'https://example.com').searchParams.get('keyword') === '无结果',
      ),
    ).toBe(true),
  )
  expect(await screen.findByText('没有找到赛事，换个条件再试试。')).toBeTruthy()
})
