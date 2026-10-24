// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AuthControls } from './auth-controls'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function setup(fail = false, compact = false) {
  const calls: { path: string; body?: unknown }[] = []
  const user = { id: 'user-one', username: 'night@example.com', profile: { skills: [] } }
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input)
    calls.push({ path, body: init?.body ? JSON.parse(String(init.body)) : undefined })
    return new Response(
      JSON.stringify({
        code: fail && path.endsWith('/login') ? 401 : 200,
        message: fail ? '邮箱或密码不正确' : 'success',
        data: path.endsWith('/me') || path.endsWith('/logout') ? null : user,
      }),
    )
  })
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <AuthControls compact={compact} />
    </QueryClientProvider>,
  )
  return calls
}

function fill() {
  fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'night@example.com' } })
  fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'local-test-password' } })
}

describe('账户入口', () => {
  it('登录后显示用户名并能退出', async () => {
    const calls = setup()
    fireEvent.click(screen.getByRole('button', { name: '登录' }))
    fill()
    fireEvent.submit(screen.getByRole('button', { name: '登录' }).closest('form')!)
    expect(await screen.findByText('night@example.com')).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '退出' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '登录' })).toBeTruthy())
    expect(calls.map((call) => call.path)).toContain('/api/auth/logout')
  })

  it('注册完成后登录，密码只用于本次请求', async () => {
    const calls = setup()
    fireEvent.click(screen.getByRole('button', { name: '注册' }))
    fill()
    fireEvent.submit(screen.getByRole('button', { name: '注册' }).closest('form')!)
    await screen.findByText('night@example.com')
    expect(calls.filter((call) => call.path !== '/api/auth/me').map((call) => call.path)).toEqual([
      '/api/auth/register',
      '/api/auth/login',
    ])
    expect(window.localStorage.getItem('password')).toBeNull()
  })

  it('业务拒绝保留表单，并显示可操作的错误', async () => {
    setup(true)
    fireEvent.click(screen.getByRole('button', { name: '登录' }))
    fill()
    fireEvent.submit(screen.getByRole('button', { name: '登录' }).closest('form')!)
    expect(await screen.findByText('邮箱或密码不正确')).toBeTruthy()
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.getByRole('button', { name: '登录' }).hasAttribute('disabled')).toBe(false)
  })
})

it('keeps registration reachable from the compact login entry', () => {
  setup(false, true)
  expect(screen.queryByRole('button', { name: '注册' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '登录' }))
  fireEvent.click(screen.getByRole('button', { name: '还没有账号？注册' }))
  expect(screen.getByRole('dialog', { name: '注册' })).toBeTruthy()
  expect(screen.getByLabelText('密码').getAttribute('autocomplete')).toBe('new-password')
})
