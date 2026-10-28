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
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const url = String(input)
    calls.push(url)
    if (url.endsWith('/auth/login')) return json(user)
    if (url.endsWith('/auth/me')) return json(signedIn ? user : null)
    if (url.endsWith('/agent/ask'))
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

it('游客发送问题先登录，切换注册再回来仍能恢复原页面的问题草稿', async () => {
  const { calls } = show('/?source=welcome')
  const input = document.querySelector<HTMLTextAreaElement>('#top-ask textarea')!
  fireEvent.change(input, { target: { value: '帮我找能线上参加的比赛' } })
  fireEvent.submit(input.closest('form')!)
  expect(await screen.findByRole('heading', { name: '登录 Inkpaw' })).toBeTruthy()
  expect(calls.some((url) => url.endsWith('/agent/ask'))).toBe(false)
  fireEvent.click(screen.getByRole('link', { name: '创建账号' }))
  expect(screen.getByRole('heading', { name: '注册 Inkpaw' })).toBeTruthy()
  fireEvent.click(screen.getByRole('link', { name: '返回登录' }))
  await logIn()
  await waitFor(() =>
    expect(document.querySelector<HTMLTextAreaElement>('#top-ask textarea')?.value).toBe(
      '帮我找能线上参加的比赛',
    ),
  )
})

it('游客直接打开聊天页进入登录，登录后回到聊天页', async () => {
  const { calls } = show('/detective')
  expect(await screen.findByRole('heading', { name: '登录 Inkpaw' })).toBeTruthy()
  expect(screen.queryByRole('textbox', { name: '问侦探' })).toBeNull()
  await logIn()
  expect(await screen.findByRole('textbox', { name: '问侦探' })).toBeTruthy()
  expect(calls.some((url) => url.endsWith('/account/conversations'))).toBe(true)
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

it('游客从赛事库创建账号后回到原筛选并恢复聊天草稿', async () => {
  show('/contests?mode=online')
  const input = screen.getByRole('textbox', { name: '问侦探' })
  fireEvent.change(input, { target: { value: '只找周末线上赛' } })
  fireEvent.submit(input.closest('form')!)
  fireEvent.click(await screen.findByRole('link', { name: '创建账号' }))
  fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'reader@example.org' } })
  fireEvent.submit(screen.getByRole('button', { name: '继续' }).closest('form')!)
  fireEvent.change(await screen.findByLabelText('验证码'), { target: { value: '123456' } })
  fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'long-password-123' } })
  fireEvent.submit(screen.getByRole('button', { name: '创建账号' }).closest('form')!)
  await waitFor(() =>
    expect(screen.getByRole('textbox', { name: '问侦探' })).toHaveProperty(
      'value',
      '只找周末线上赛',
    ),
  )
})
