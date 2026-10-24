// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'
import { NoticeContext } from './components'
import { SettingsPanel } from './settings-panel'
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
it('requires the login email for deletion and keeps a failed email form open', async () => {
  const notice = vi.fn()
  vi.stubGlobal(
    'fetch',
    async (input: RequestInfo | URL, init?: RequestInit) =>
      new Response(
        JSON.stringify({
          code: init?.method === 'POST' ? 503 : 200,
          message: '邮件服务还没有配置',
          data: String(input).endsWith('/auth/me')
            ? { id: 'owner', username: 'owner@example.com', profile: {} }
            : String(input).endsWith('/summary')
              ? { follows: 2, tracks: 1 }
              : {
                  email: 'owner@example.com',
                  email_verified: true,
                  created_at: '2026-10-12T00:00:00Z',
                  password_changed_at: null,
                },
        }),
      ),
  )
  render(
    <MemoryRouter initialEntries={['/account/settings']}>
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <NoticeContext.Provider value={notice}>
          <div className="account-root">
            <SettingsPanel />
          </div>
        </NoticeContext.Provider>
      </QueryClientProvider>
    </MemoryRouter>,
  )
  expect(await screen.findByText('owner@example.com · 已验证')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '删除账号' }))
  const input = await screen.findByLabelText('输入登录邮箱确认')
  const danger = screen
    .getAllByRole('button', { name: '删除账号' })
    .find((e) => e.classList.contains('btn-danger')) as HTMLButtonElement
  expect(danger.disabled).toBe(true)
  fireEvent.change(input, { target: { value: 'other@example.com' } })
  expect(danger.disabled).toBe(true)
  fireEvent.change(input, { target: { value: 'owner@example.com' } })
  expect(danger.disabled).toBe(false)
  fireEvent.click(screen.getByRole('button', { name: '关闭' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  fireEvent.click(screen.getByRole('button', { name: /^修改$/ }))
  fireEvent.change(screen.getByLabelText('新邮箱'), { target: { value: 'new@example.com' } })
  fireEvent.click(screen.getByRole('button', { name: '发验证邮件' }))
  await waitFor(() => expect(notice).toHaveBeenCalledWith('邮件服务还没有配置'))
  expect((screen.getByLabelText('新邮箱') as HTMLInputElement).value).toBe('new@example.com')
})
