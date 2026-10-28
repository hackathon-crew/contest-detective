// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router'
import { FollowButton, FOLLOW_STORAGE_KEY, useFollows } from './index'
import { currentUserKey } from '@/entities/user'

function Harness() {
  const follows = useFollows()
  return (
    <>
      <FollowButton contestId="one" follows={follows} />
      <output>{follows.ids.join(',')}</output>
      {follows.error && <p role="alert">{follows.error}</p>}
    </>
  )
}
function setup(signedIn = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(
    currentUserKey,
    signedIn ? { id: 'owner', username: 'owner@example.com', profile: {} } : null,
  )
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Routes>
          <Route path="/" element={<Harness />} />
          <Route path="/login" element={<h1>登录后继续关注</h1>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  localStorage.clear()
})

it('游客关注先登录，保留旧本地记录并且不新增匿名关注', async () => {
  const saved = JSON.stringify(['old'])
  localStorage.setItem(FOLLOW_STORAGE_KEY, saved)
  vi.stubGlobal('fetch', async () => Response.json({ code: 200, message: 'ok', data: null }))
  setup()
  fireEvent.click(screen.getByRole('button', { name: '关注' }))
  expect(await screen.findByRole('heading', { name: '登录后继续关注' })).toBeTruthy()
  expect(localStorage.getItem(FOLLOW_STORAGE_KEY)).toBe(saved)
})

it('登录后的关注通过账号接口保存并在重新打开后恢复', async () => {
  let followed = false
  vi.stubGlobal('fetch', async (_input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === 'PUT') followed = true
    if (init?.method === 'DELETE') followed = false
    const data = followed
      ? [
          {
            contest: { id: 'one', name: 'One', status: 'upcoming', cover_url: null, fields: {} },
            reminders: true,
            created_at: '2026-10-28T00:00:00Z',
          },
        ]
      : []
    return Response.json({ code: 200, message: 'ok', data })
  })
  const first = setup(true)
  await waitFor(() => expect(screen.getByRole('button')).toHaveProperty('disabled', false))
  fireEvent.click(screen.getByRole('button', { name: '关注' }))
  expect(await screen.findByRole('button', { name: '已关注' })).toBeTruthy()
  first.unmount()
  setup(true)
  expect(await screen.findByRole('button', { name: '已关注' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '已关注' }))
  expect(await screen.findByRole('button', { name: '关注' })).toBeTruthy()
  expect(localStorage.getItem(FOLLOW_STORAGE_KEY)).toBeNull()
})

it('游客浏览不读取或展示旧的匿名关注数据', () => {
  localStorage.setItem(FOLLOW_STORAGE_KEY, '{invalid')
  vi.stubGlobal('fetch', async () => Response.json({ code: 200, message: 'ok', data: null }))
  setup()
  expect(screen.getByRole('status').textContent).toBe('')
  expect(screen.queryByRole('alert')).toBeNull()
})
