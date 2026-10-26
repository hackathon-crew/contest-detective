// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { NuqsAdapter } from 'nuqs/adapters/react-router/v8'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AppRoutes } from './app'
import { stubResizeObserver } from '@/features/detective/detective.test.utils'
vi.mock('@/shared/ui/octopus/inkpaw-octopus', () => ({ mountOctopus: () => null }))

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function renderAt(path: string) {
  stubResizeObserver()
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
  it.each([
    ['/', /按你的兴趣和优势/],
    ['/contests?q=AI', '赛事库'],
    ['/detective', '想找什么样的比赛？'],
  ])('MCP 接入在当前页面打开并保留页面状态：%s', async (path, title) => {
    renderAt(path)
    const heading = screen.getByRole('heading', { name: title })
    const trigger = screen.getByRole('link', { name: 'MCP' })
    trigger.focus()
    fireEvent.click(trigger)

    const dialog = await screen.findByRole('dialog', { name: '接入 MCP' })
    expect(screen.getByRole('heading', { name: title, hidden: true })).toBe(heading)
    expect(within(dialog).getByRole('button', { name: 'Claude Code' })).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cursor' }))
    expect(within(dialog).getByText(/~\/\.cursor\/mcp.json/)).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(screen.getByRole('heading', { name: title })).toBe(heading)
    expect(document.activeElement).toBe(trigger)
  })

  it('打开 MCP 深链接时直接显示接入说明', async () => {
    renderAt('/#mcp')
    expect(await screen.findByRole('dialog', { name: '接入 MCP' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '关闭' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(screen.getByRole('heading', { level: 1 })).toBeTruthy()
  })

  it('首页可打开画像确认入口', async () => {
    renderAt('/')
    fireEvent.keyDown(screen.getAllByRole('button', { name: '添加简历或参赛资料' })[0], {
      key: 'Enter',
    })
    fireEvent.click(await screen.findByRole('menuitem', { name: '添加画像' }))
    expect(await screen.findByRole('button', { name: '确认并挑比赛' })).toBeTruthy()
  })
  it('关注入口打开关注筛选，返回后恢复浏览区块', async () => {
    renderAt('/contests')
    fireEvent.click(screen.getByRole('button', { name: '我的关注' }))
    expect(await screen.findByText('还没有关注的比赛')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '看全部比赛' }))
    expect(await screen.findByText('没有符合条件的比赛')).toBeTruthy()
  })
  it('首页展示新入口，完整浏览保留在独立赛事库', () => {
    renderAt('/')
    expect(screen.getByRole('heading', { level: 1 })).toBeTruthy()
    expect(screen.getByRole('heading', { name: '两周内截止' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: '全部赛事' })).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
  })
  it('赛事库保留完整浏览、日历和常驻侦探', () => {
    renderAt('/contests')
    expect(screen.getByRole('region', { name: '全部赛事' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '日历' })).toBeTruthy()
    expect(screen.getByRole('region', { name: '侦探' })).toBeTruthy()
  })

  it('直接打开详情地址时，首页和详情弹窗都在', () => {
    renderAt('/contests/tme-ai-hackathon')

    expect(screen.getByRole('dialog', { name: '赛事详情' })).toBeTruthy()
    expect(screen.getByRole('heading', { level: 1, hidden: true })).toBeTruthy()
  })

  it('关闭详情回到首页，首页区块不重新挂载', async () => {
    renderAt('/contests/tme-ai-hackathon')
    const list = screen.getByRole('heading', { level: 1, hidden: true })

    fireEvent.click(screen.getByRole('button', { name: '关闭' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(screen.getByRole('heading', { level: 1 })).toBe(list)
  })

  it('未知地址回到首页', () => {
    renderAt('/no-such-page')

    expect(screen.getByRole('heading', { level: 1 })).toBeTruthy()
  })
})
