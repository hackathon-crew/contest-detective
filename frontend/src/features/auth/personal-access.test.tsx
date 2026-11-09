// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { NuqsAdapter } from 'nuqs/adapters/react-router/v8'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AppRoutes } from '@/app/app'
import { currentUserKey } from '@/entities/user'
import { stubResizeObserver } from '../detective/detective.test.utils'

vi.mock('@/shared/ui/octopus/inkpaw-octopus', () => ({ mountOctopus: () => null }))
const user = { id: 'signed-in-user', username: 'reader@example.org', profile: {} }
const json = (data: unknown) =>
  Response.json({ code: 200, message: 'ok', data, total: 0, page: 1, page_size: 100 })
beforeEach(stubResizeObserver)

function show(path = '/', signedIn = false) {
  const calls: string[] = []
  const remote = new Map<string, unknown>()
  let remaining = 3
  let loggedIn = signedIn
  let activeUser = { ...user }
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    calls.push(url)
    if (url.endsWith('/auth/login')) {
      loggedIn = true
      return json(activeUser)
    }
    if (url.endsWith('/auth/me')) return json(loggedIn ? activeUser : null)
    if (url.endsWith('/agent/guest-quota'))
      return json({ limit: 3, remaining, resets_at: '2026-11-03T00:00:00+08:00' })
    if (url.endsWith('/profile/github')) return json({ github: 'finn', skills: ['Python'] })
    if (url.endsWith('/user/profile')) {
      activeUser = { ...activeUser, profile: JSON.parse(String(init?.body)) }
      return json(activeUser)
    }
    if (url.endsWith('/account/conversations/import')) {
      for (const session of JSON.parse(String(init?.body)).sessions) remote.set(session.id, session)
      return json(null)
    }
    if (url.endsWith('/account/conversations')) return json([...remote.values()])
    if (url.endsWith('/agent/guest/ask')) {
      if (remaining === 0)
        return Response.json({
          code: 429,
          message: '今天的三次访客提问已用完',
          data: { action: 'login' },
        })
      remaining--
    }
    if (url.endsWith('/agent/ask') || url.endsWith('/agent/guest/ask'))
      return new Response(
        'event: answer\ndata: {"content":"可以看线上周末赛。","sources":[]}\n\n',
        {
          headers: { 'content-type': 'text/event-stream' },
        },
      )
    return json([])
  })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(currentUserKey, signedIn ? user : null)
  const view = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <NuqsAdapter>
          <AppRoutes />
        </NuqsAdapter>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return { calls, view }
}

async function logIn() {
  fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'reader@example.org' } })
  fireEvent.submit(screen.getByRole('button', { name: '继续' }).closest('form')!)
  fireEvent.change(await screen.findByLabelText('密码'), { target: { value: 'long-password-123' } })
  fireEvent.submit(screen.getByRole('button', { name: '登录并继续' }).closest('form')!)
}

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.unstubAllGlobals()
})

it('游客先查证，登录保存只导入当前会话，切换注册仍保留草稿', async () => {
  const { calls } = show('/?source=welcome')
  const input = document.querySelector<HTMLTextAreaElement>('#top-ask textarea')!
  fireEvent.change(input, { target: { value: '帮我找能线上参加的比赛' } })
  fireEvent.submit(input.closest('form')!)
  expect(await screen.findByText('可以看线上周末赛。')).toBeTruthy()
  expect(calls.some((url) => url.endsWith('/agent/guest/ask'))).toBe(true)
  expect(calls.some((url) => url.endsWith('/agent/ask'))).toBe(false)
  expect(calls.some((url) => url.includes('/account/conversations'))).toBe(false)
  fireEvent.change(screen.getByRole('textbox', { name: '问侦探' }), {
    target: { value: '继续看参赛要求' },
  })
  fireEvent.click(await screen.findByRole('button', { name: '登录后保存这次查证' }))
  expect(await screen.findByRole('heading', { name: '登录 Inkpaw' })).toBeTruthy()
  fireEvent.click(screen.getByRole('link', { name: '创建账号' }))
  expect(screen.getByRole('heading', { name: '注册 Inkpaw' })).toBeTruthy()
  fireEvent.click(screen.getByRole('link', { name: '返回登录' }))
  await logIn()
  await waitFor(() =>
    expect(screen.getByRole('textbox', { name: '问侦探' })).toHaveProperty(
      'value',
      '继续看参赛要求',
    ),
  )
  expect(await screen.findByText('可以看线上周末赛。')).toBeTruthy()
  expect(calls.some((url) => url.endsWith('/account/conversations/import'))).toBe(true)
})

it('游客可直接聊天，第三次显示0，第四次登录并可取消回到原草稿', async () => {
  const { calls } = show('/detective')
  expect(screen.queryByRole('heading', { name: '登录 Inkpaw' })).toBeNull()
  for (let index = 0; index < 3; index++) {
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: '问侦探' })).toHaveProperty('disabled', false),
    )
    const input = screen.getByRole('textbox', { name: '问侦探' })
    fireEvent.change(input, { target: { value: `找第${index + 1}场线上比赛` } })
    fireEvent.submit(input.closest('form')!)
    await screen.findByText(`今天还剩 ${2 - index} 次提问`)
  }
  const input = screen.getByRole('textbox', { name: '问侦探' })
  fireEvent.change(input, { target: { value: '还有哪些比赛' } })
  fireEvent.submit(input.closest('form')!)
  expect(await screen.findByRole('heading', { name: '登录 Inkpaw' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '返回原页面' }))
  expect(await screen.findByRole('textbox', { name: '问侦探' })).toBeTruthy()
  expect(screen.getByRole('textbox', { name: '问侦探' })).toHaveProperty('value', '还有哪些比赛')
  expect(calls.some((url) => url.endsWith('/account/conversations/import'))).toBe(false)
})

it('游客点画像入口先登录，登录后恢复画像入口且不读取游客画像', async () => {
  localStorage.setItem('contest-detective.profile', JSON.stringify({ skills: ['游客专属资料'] }))
  show()
  const composer = document.querySelector('#top-ask')!
  fireEvent.keyDown(composer.querySelector('button[aria-label="添加简历或参赛资料"]')!, {
    key: 'Enter',
  })
  fireEvent.click(await screen.findByRole('menuitem', { name: '添加画像' }))
  expect(await screen.findByRole('heading', { name: '登录 Inkpaw' })).toBeTruthy()
  expect(screen.queryByLabelText('上传简历')).toBeNull()
  await logIn()
  expect(await screen.findByRole('dialog', { name: '添加画像' })).toBeTruthy()
  expect(screen.queryByText('游客专属资料')).toBeNull()
})

it('游客从赛事库查证后创建账号能保存当前记录并恢复后续草稿', async () => {
  show('/contests?mode=online')
  const input = screen.getByRole('textbox', { name: '问侦探' })
  fireEvent.change(input, { target: { value: '只找周末线上赛' } })
  fireEvent.submit(input.closest('form')!)
  await screen.findByText('可以看线上周末赛。')
  fireEvent.change(screen.getByRole('textbox', { name: '问侦探' }), {
    target: { value: '继续查看周末安排' },
  })
  fireEvent.click(await screen.findByRole('button', { name: '登录后保存这次查证' }))
  fireEvent.click(await screen.findByRole('link', { name: '创建账号' }))
  fireEvent.change(screen.getByLabelText('邀请码'), { target: { value: 'A2BCD3' } })
  fireEvent.submit(screen.getByRole('button', { name: '继续' }).closest('form')!)
  fireEvent.change(await screen.findByLabelText('邮箱'), {
    target: { value: 'reader@example.org' },
  })
  fireEvent.submit(screen.getByRole('button', { name: '继续' }).closest('form')!)
  fireEvent.change(await screen.findByLabelText('验证码'), { target: { value: '123456' } })
  fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'long-password-123' } })
  fireEvent.submit(screen.getByRole('button', { name: '创建账号' }).closest('form')!)
  await waitFor(() =>
    expect(screen.getByRole('textbox', { name: '问侦探' })).toHaveProperty(
      'value',
      '继续查看周末安排',
    ),
  )
})
