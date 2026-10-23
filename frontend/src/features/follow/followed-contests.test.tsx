// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'
import { FollowedContests } from './followed-contests'
import type { FollowController } from './model'

const clients: QueryClient[] = []
const state: FollowController = { ids: ['one'], toggle: vi.fn(), pending: false, error: null }
function setup(follows = state) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  clients.push(client)
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <FollowedContests follows={follows} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}
afterEach(() => {
  cleanup()
  clients.splice(0).forEach((client) => client.clear())
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it('按关注 id 取赛事并导出日历，下载后释放地址', async () => {
  const requests: URL[] = []
  vi.stubGlobal('fetch', async (input: string) => {
    requests.push(new URL(input, 'https://example.com'))
    return new Response(
      JSON.stringify({
        code: 200,
        message: 'success',
        total: 1,
        page: 1,
        page_size: 100,
        data: [
          {
            id: 'one',
            name: '公开比赛',
            status: 'upcoming',
            cover_url: null,
            fields: { start_at: { value: '2026-11-01T02:00:00Z', level: 'official' } },
          },
        ],
      }),
    )
  })
  const create = vi.fn(() => 'blob:test')
  const revoke = vi.fn()
  Object.defineProperties(URL, {
    createObjectURL: { value: create, configurable: true },
    revokeObjectURL: { value: revoke, configurable: true },
  })
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  setup()
  await screen.findByRole('link', { name: '公开比赛' })
  expect(requests).toHaveLength(1)
  expect(requests[0].searchParams.get('ids')).toBe('one')
  fireEvent.click(screen.getByRole('button', { name: '导出日历' }))
  expect(create).toHaveBeenCalledWith(
    expect.objectContaining({ type: 'text/calendar;charset=utf-8' }),
  )
  expect(click).toHaveBeenCalledOnce()
  expect(click.mock.instances[0]).toHaveProperty('download', '关注的比赛.ics')
  expect(revoke).toHaveBeenCalledWith('blob:test')
})

it('没有已知日期时明确说明，保留关注列表', async () => {
  vi.stubGlobal(
    'fetch',
    async () =>
      new Response(
        JSON.stringify({
          code: 200,
          message: 'success',
          total: 1,
          page: 1,
          page_size: 100,
          data: [
            {
              id: 'one',
              name: '日期待查',
              status: 'upcoming',
              cover_url: null,
              fields: {},
            },
          ],
        }),
      ),
  )
  setup()
  await screen.findByRole('link', { name: '日期待查' })
  fireEvent.click(screen.getByRole('button', { name: '导出日历' }))
  expect(screen.getByRole('alert').textContent).toContain('没有可导出的已知日期')
  expect(screen.getByRole('link', { name: '日期待查' })).toBeTruthy()
})

it('空集合不查询全站，存储错误仍能读到', async () => {
  const fetch = vi.fn()
  vi.stubGlobal('fetch', fetch)
  setup({ ...state, ids: [], error: '无法保存关注，请检查浏览器存储设置' })
  expect(screen.getByRole('status').textContent).toContain('先关注一场赛事')
  expect(screen.getByRole('alert').textContent).toContain('无法保存关注')
  expect(screen.getByRole('button', { name: '导出日历' })).toHaveProperty('disabled', true)
  await waitFor(() => expect(fetch).not.toHaveBeenCalled())
})
