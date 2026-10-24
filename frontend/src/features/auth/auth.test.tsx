// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, useLocation } from 'react-router'
import { NuqsAdapter } from 'nuqs/adapters/react-router/v8'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppRoutes } from '@/app/app'

vi.mock('@/shared/ui/octopus/inkpaw-octopus', () => ({ mountOctopus: () => null }))

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  localStorage.clear()
})

function Address() {
  const location = useLocation()
  return (
    <output aria-label="当前地址">{location.pathname + location.search + location.hash}</output>
  )
}

function setup(
  path = '/login',
  options: { failLoginOnce?: boolean; holdLogin?: Promise<void> } = {},
) {
  const calls: { path: string; body?: unknown }[] = []
  let loginCount = 0
  const user = { id: 'user-one', username: 'night@example.com', profile: { skills: [] } }
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input)
    calls.push({ path, body: init?.body ? JSON.parse(String(init.body)) : undefined })
    const login = path.endsWith('/auth/login')
    if (login) {
      loginCount += 1
      await options.holdLogin
    }
    const rejected = login && options.failLoginOnce && loginCount === 1
    return new Response(
      JSON.stringify({
        code: rejected ? 401 : 200,
        message: rejected ? '邮箱或密码不正确' : 'success',
        data:
          path.endsWith('/auth/me') || path.endsWith('/auth/logout')
            ? null
            : path.includes('/auth/')
              ? user
              : [],
        total: 0,
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
          <Address />
          <AppRoutes />
        </QueryClientProvider>
      </NuqsAdapter>
    </MemoryRouter>,
  )
  return calls
}

function continueWithEmail(value = 'night@example.com') {
  fireEvent.change(screen.getByLabelText('邮箱'), { target: { value } })
  fireEvent.submit(screen.getByRole('button', { name: '继续' }).closest('form')!)
}

function enterPassword(value = 'local-test-password') {
  fireEvent.change(screen.getByLabelText('密码'), { target: { value } })
}

function submit(name: string) {
  fireEvent.submit(screen.getByRole('button', { name }).closest('form')!)
}

describe('全屏账户流程', () => {
  it('直接打开登录页，先填写邮箱，再输入密码', () => {
    const calls = setup()
    expect(screen.getByRole('heading', { name: '登录 Inkpaw' })).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByRole('navigation', { name: '主导航' })).toBeNull()
    expect(screen.queryByLabelText('密码')).toBeNull()
    continueWithEmail()
    expect(screen.getByRole('heading', { name: '输入密码' })).toBeTruthy()
    expect(screen.getByLabelText('密码').getAttribute('autocomplete')).toBe('current-password')
    expect(calls.filter((call) => call.path.endsWith('/auth/login'))).toHaveLength(0)
  })

  it('从紧凑登录入口进入，登录后返回原地址并能退出', async () => {
    const calls = setup('/contests?keyword=Python#all')
    fireEvent.click(screen.getByRole('link', { name: '登录' }))
    continueWithEmail()
    enterPassword()
    submit('登录并继续')
    await waitFor(() =>
      expect(screen.getByLabelText('当前地址').textContent).toBe('/contests?keyword=Python#all'),
    )
    expect(screen.getByText('night@example.com')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '退出' }))
    await screen.findByRole('link', { name: '登录' })
    expect(calls.map((call) => call.path)).toContain('/api/auth/logout')
  })

  it('注册跳过验证码，只用邮箱和密码创建账户并自动登录', async () => {
    const calls = setup('/register')
    expect(screen.getByRole('heading', { name: '注册 Inkpaw' })).toBeTruthy()
    continueWithEmail('  night@example.com  ')
    expect(screen.getByRole('heading', { name: '创建密码' })).toBeTruthy()
    expect(screen.queryByLabelText('验证码')).toBeNull()
    expect(screen.getByLabelText('密码').getAttribute('autocomplete')).toBe('new-password')
    enterPassword()
    submit('创建账号')
    await screen.findByRole('navigation', { name: '主导航' })
    expect(
      calls.filter((call) => call.path.includes('/auth/') && !call.path.endsWith('/me')),
    ).toEqual([
      {
        path: '/api/auth/register',
        body: { email: 'night@example.com', password: 'local-test-password' },
      },
      {
        path: '/api/auth/login',
        body: { email: 'night@example.com', password: 'local-test-password' },
      },
    ])
    expect(localStorage.getItem('password')).toBeNull()
    expect(sessionStorage.getItem('password')).toBeNull()
  })

  it('业务拒绝保留密码表单，重试可以登录', async () => {
    setup('/login', { failLoginOnce: true })
    continueWithEmail()
    enterPassword()
    submit('登录并继续')
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', '邮箱或密码不正确')
    expect(screen.getByLabelText('密码')).toHaveProperty('value', 'local-test-password')
    expect(screen.getByRole('button', { name: '登录并继续' }).hasAttribute('disabled')).toBe(false)
    submit('登录并继续')
    await screen.findByRole('navigation', { name: '主导航' })
  })

  it('账户创建后自动登录失败，重试只登录已有账户', async () => {
    const calls = setup('/register', { failLoginOnce: true })
    continueWithEmail()
    enterPassword()
    submit('创建账号')
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      '账号已创建。邮箱或密码不正确',
    )
    submit('登录并继续')
    await screen.findByRole('navigation', { name: '主导航' })
    expect(calls.filter((call) => call.path.endsWith('/auth/register'))).toHaveLength(1)
  })

  it('可以显示密码，返回修改邮箱后清空密码', () => {
    setup()
    continueWithEmail()
    enterPassword()
    fireEvent.click(screen.getByRole('button', { name: '显示密码' }))
    expect(screen.getByLabelText('密码').getAttribute('type')).toBe('text')
    fireEvent.click(screen.getByRole('button', { name: '返回邮箱' }))
    expect(screen.getByLabelText('邮箱')).toHaveProperty('value', 'night@example.com')
    continueWithEmail('another@example.com')
    expect(screen.getByLabelText('密码')).toHaveProperty('value', '')
    expect(screen.getByLabelText('密码').getAttribute('type')).toBe('password')
  })

  it('从登录切换注册时仍保留返回地址', async () => {
    setup('/contests?mode=online')
    fireEvent.click(screen.getByRole('link', { name: '登录' }))
    fireEvent.click(screen.getByRole('link', { name: '创建账号' }))
    continueWithEmail()
    enterPassword()
    submit('创建账号')
    await screen.findByRole('navigation', { name: '主导航' })
    expect(screen.getByLabelText('当前地址').textContent).toBe('/contests?mode=online')
  })

  it('校验邮箱和注册密码，不发送无效凭据', () => {
    const calls = setup('/register')
    continueWithEmail('invalid')
    expect(screen.getByRole('alert').textContent).toBe('请输入有效的邮箱地址。')
    continueWithEmail()
    enterPassword('short')
    submit('创建账号')
    expect(screen.getByRole('alert').textContent).toBe('密码需要 8–128 个字符。')
    expect(
      calls.filter((call) => call.path.endsWith('/register') || call.path.endsWith('/login')),
    ).toEqual([])
  })

  it('提交中阻止重复登录，完成后才离开', async () => {
    let release!: () => void
    const holdLogin = new Promise<void>((resolve) => {
      release = resolve
    })
    const calls = setup('/login', { holdLogin })
    continueWithEmail()
    enterPassword()
    submit('登录并继续')
    submit('正在登录…')
    expect(screen.getByRole('button', { name: '正在登录…' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: '返回邮箱' }).hasAttribute('disabled')).toBe(true)
    expect(calls.filter((call) => call.path.endsWith('/auth/login'))).toHaveLength(1)
    release()
    await waitFor(() => expect(screen.queryByLabelText('密码')).toBeNull())
    await screen.findByRole('navigation', { name: '主导航' })
  })
})
