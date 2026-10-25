// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { NuqsAdapter } from 'nuqs/adapters/react-router/v8'
import { MemoryRouter, useLocation } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppRoutes } from '@/app/app'
import { currentUserKey, type PublicUser } from '@/entities/user'
import { stubResizeObserver } from '@/features/detective/detective.test.utils'

vi.mock('@/shared/ui/octopus/inkpaw-octopus', () => ({ mountOctopus: () => null }))

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function LocationDisplay() {
  const location = useLocation()
  return <output data-testid="location">{JSON.stringify(location)}</output>
}

function renderPage(path = '/detective', user: PublicUser | null | 'pending' = null) {
  stubResizeObserver()
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  if (user !== 'pending') client.setQueryData(currentUserKey, user)
  const view = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <NuqsAdapter>
          <AppRoutes />
          <LocationDisplay />
        </NuqsAdapter>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return { ...view, client }
}

function finishIntroduction() {
  fireEvent.click(screen.getByRole('button', { name: '下一步' }))
  fireEvent.click(screen.getByRole('button', { name: '下一步' }))
  return screen.getByRole('dialog', { name: '盯梢与推送' })
}

describe('侦探首次使用引导', () => {
  it('首次访客依次查看三张卡片，最后才选择注册登录或直接使用', async () => {
    const view = renderPage()
    const dialog = await screen.findByRole('dialog', { name: '一句话找比赛' })
    expect(within(dialog).queryByRole('link', { name: '注册 / 登录' })).toBeNull()
    expect(within(dialog).queryByRole('button', { name: '直接使用' })).toBeNull()

    fireEvent.click(within(dialog).getByRole('button', { name: '下一步' }))
    expect(screen.getByRole('dialog', { name: '建立参赛画像' })).toBe(dialog)
    expect(within(dialog).queryByRole('link', { name: '注册 / 登录' })).toBeNull()

    fireEvent.click(within(dialog).getByRole('button', { name: '下一步' }))
    expect(screen.getByRole('dialog', { name: '盯梢与推送' })).toBe(dialog)
    expect(within(dialog).queryByRole('button', { name: '下一步' })).toBeNull()
    expect(within(dialog).getByRole('link', { name: '注册 / 登录' }).getAttribute('href')).toBe(
      '/register',
    )
    fireEvent.click(within(dialog).getByRole('button', { name: '直接使用' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '盯梢与推送' })).toBeNull())
    expect((screen.getByRole('textbox', { name: '问侦探' }) as HTMLTextAreaElement).disabled).toBe(
      false,
    )
    expect(JSON.parse(screen.getByTestId('location').textContent!).pathname).toBe('/detective')
    view.unmount()
    renderPage()
    expect(screen.queryByRole('dialog', { name: '一句话找比赛' })).toBeNull()
  })

  it('确认登录状态前不显示，确认是访客后才显示', async () => {
    let resolveAuth!: (response: Response) => void
    vi.stubGlobal(
      'fetch',
      () =>
        new Promise<Response>((resolve) => {
          resolveAuth = resolve
        }),
    )
    renderPage('/detective', 'pending')
    expect(screen.queryByRole('dialog', { name: '一句话找比赛' })).toBeNull()
    await act(async () => {
      resolveAuth(new Response(JSON.stringify({ code: 200, message: 'success', data: null })))
    })
    expect(await screen.findByRole('dialog', { name: '一句话找比赛' })).toBeTruthy()
  })

  it('已登录用户不显示，之后退出也不把该浏览器当作首次访问', async () => {
    const { client } = renderPage('/detective', {
      id: 'existing-user',
      username: '已有账号',
      profile: {},
    })
    expect(screen.queryByRole('dialog', { name: '一句话找比赛' })).toBeNull()
    await act(async () => {
      client.setQueryData(currentUserKey, null)
    })
    expect(screen.queryByRole('dialog', { name: '一句话找比赛' })).toBeNull()
  })

  it('引导出现后刷新不会再次弹出，即使尚未点完三张', async () => {
    const view = renderPage()
    expect(await screen.findByRole('dialog', { name: '一句话找比赛' })).toBeTruthy()
    view.unmount()
    renderPage()
    expect(screen.queryByRole('dialog', { name: '一句话找比赛' })).toBeNull()
  })

  it('关闭按钮和 Esc 都能退出引导', async () => {
    renderPage()
    let dialog = await screen.findByRole('dialog', { name: '一句话找比赛' })
    fireEvent.click(within(dialog).getByRole('button', { name: '关闭' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '一句话找比赛' })).toBeNull())
    cleanup()
    localStorage.clear()
    renderPage()
    dialog = await screen.findByRole('dialog', { name: '一句话找比赛' })
    fireEvent.keyDown(dialog, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '一句话找比赛' })).toBeNull())
  })

  it('账号入口复用注册登录页，并保留侦探地址及返回行为', async () => {
    renderPage('/detective/existing-session?view=brief#report')
    await screen.findByRole('dialog', { name: '一句话找比赛' })
    const dialog = finishIntroduction()
    fireEvent.click(within(dialog).getByRole('link', { name: '注册 / 登录' }))
    expect(await screen.findByRole('heading', { name: '注册 Inkpaw' })).toBeTruthy()
    const location = JSON.parse(screen.getByTestId('location').textContent!)
    expect(location.pathname).toBe('/register')
    expect(location.state.returnTo).toMatchObject({
      pathname: '/detective/existing-session',
      search: '?view=brief',
      hash: '#report',
    })
    fireEvent.click(screen.getByRole('link', { name: '返回登录' }))
    expect(await screen.findByRole('heading', { name: '登录 Inkpaw' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '返回原页面' }))
    expect(JSON.parse(screen.getByTestId('location').textContent!)).toMatchObject({
      pathname: '/detective/existing-session',
      search: '?view=brief',
      hash: '#report',
    })
    expect(screen.queryByRole('dialog', { name: '一句话找比赛' })).toBeNull()
  })
})
