// @vitest-environment jsdom
import { StrictMode } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { NuqsAdapter } from 'nuqs/adapters/react-router/v8'
import { Link, MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AppRoutes } from './app'
vi.mock('@/shared/ui/octopus/inkpaw-octopus', () => ({ mountOctopus: () => null }))

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function renderAt(path: string) {
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
                  id: 'example',
                  name: '赛事详情',
                  fields: {},
                  summary: null,
                  cover_url: null,
                  status: 'upcoming',
                }
              : [],
          total: 0,
          page: 1,
          page_size: 20,
        }),
      ),
  )
  return render(
    <StrictMode>
      <MemoryRouter initialEntries={[path]}>
        <NuqsAdapter>
          <QueryClientProvider
            client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
          >
            <Link to="/?q=robot#explore">筛选赛事</Link>
            <Link to="/contests/example">赛事详情地址</Link>
            <Link to="/detective/saved-conversation">另一段对话</Link>
            <AppRoutes />
          </QueryClientProvider>
        </NuqsAdapter>
      </MemoryRouter>
    </StrictMode>,
  )
}

describe('全局页面动效边界', () => {
  it('只在浏览与侦探之间换页时更新入场容器', () => {
    const { container } = renderAt('/')
    const home = container.querySelector('[data-route-motion="home"]')
    expect(home).not.toBeNull()
    document.documentElement.scrollTop = 400

    fireEvent.click(screen.getByRole('link', { name: '侦探' }))
    const detective = container.querySelector('[data-route-motion="detective"]')
    expect(detective).not.toBeNull()
    expect(detective).not.toBe(home)
    expect(document.documentElement.scrollTop).toBe(0)

    fireEvent.click(screen.getByRole('link', { name: '浏览赛事' }))
    const catalog = container.querySelector('[data-route-motion="contests"]')
    expect(catalog).not.toBeNull()
    expect(catalog).not.toBe(home)
  })

  it('筛选、锚点与详情地址保持首页容器和关注状态', () => {
    const { container } = renderAt('/')
    fireEvent.click(screen.getByRole('button', { name: '按我的情况' }))
    document.documentElement.scrollTop = 400
    const home = container.querySelector('[data-route-motion="home"]')
    expect(home).not.toBeNull()

    fireEvent.click(screen.getByRole('link', { name: '筛选赛事' }))
    expect(container.querySelector('[data-route-motion="home"]')).toBe(home)
    expect(screen.getByRole('button', { name: '按我的情况' }).getAttribute('aria-pressed')).toBe(
      'true',
    )

    fireEvent.click(screen.getByRole('link', { name: '赛事详情地址' }))
    expect(container.querySelector('[data-route-motion="home"]')).toBe(home)
    expect(document.documentElement.scrollTop).toBe(400)
    expect(
      screen.getByRole('button', { name: '按我的情况', hidden: true }).getAttribute('aria-pressed'),
    ).toBe('true')
  })

  it('会话地址变化不重建工作区，也不重播全页入场', () => {
    const { container } = renderAt('/detective')
    const detective = container.querySelector('[data-route-motion="detective"]')
    expect(detective).not.toBeNull()
    const header = screen.getByRole('button', { name: '打开会话列表' })

    fireEvent.click(screen.getByRole('link', { name: '另一段对话' }))
    expect(container.querySelector('[data-route-motion="detective"]')).toBe(detective)
    expect(screen.getByRole('button', { name: '打开会话列表' })).toBe(header)
  })
})
