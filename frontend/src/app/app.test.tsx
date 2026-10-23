// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { NuqsAdapter } from 'nuqs/adapters/react-router/v8'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AppRoutes } from './app'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function renderAt(path: string) {
  window.history.replaceState(null, '', path)
  vi.stubGlobal(
    'fetch',
    async (input: RequestInfo | URL) =>
      new Response(
        JSON.stringify({
          code: 200,
          message: 'success',
          data: String(input).includes('/auth/me')
            ? null
            : String(input).includes('/contests/')
              ? {
                  id: 'tme-ai-hackathon',
                  name: '赛事详情',
                  cover_url: null,
                  status: 'upcoming',
                  fields: {},
                  summary: null,
                }
              : [],
          total: 0,
          page: 1,
          page_size: 20,
        }),
      ),
  )
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

describe('路由', () => {
  it('首页可打开画像确认入口', async () => {
    renderAt('/')
    fireEvent.click(screen.getByRole('button', { name: '按我的情况挑比赛' }))
    expect(await screen.findByRole('button', { name: '确认并挑比赛' })).toBeTruthy()
  })
  it('首页显示四个区块，不开详情', () => {
    renderAt('/')

    for (const name of ['本周值得看', '全部赛事', '赛事日历']) {
      expect(screen.getByRole('heading', { name })).toBeTruthy()
    }
    expect(screen.getByRole('region', { name: '侦探' })).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('直接打开详情地址时，首页和详情弹窗都在', () => {
    renderAt('/contests/tme-ai-hackathon')

    expect(screen.getByRole('dialog', { name: '赛事详情' })).toBeTruthy()
    expect(screen.getByText('全部赛事', { selector: 'h2' })).toBeTruthy()
  })

  it('关闭详情回到首页，首页区块不重新挂载', () => {
    renderAt('/contests/tme-ai-hackathon')
    const list = screen.getByText('全部赛事', { selector: 'h2' })

    fireEvent.click(screen.getByRole('button', { name: '关闭' }))

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByText('全部赛事', { selector: 'h2' })).toBe(list)
  })

  it('未知地址回到首页', () => {
    renderAt('/no-such-page')

    expect(screen.getByRole('heading', { name: '本周值得看' })).toBeTruthy()
  })
})
