// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { NuqsAdapter } from 'nuqs/adapters/react-router/v8'
import { afterEach, expect, it, vi } from 'vitest'
import { AppRoutes } from '@/app/app'
import { currentUserKey } from '@/entities/user'
import type { DetectiveSession } from './sessions'

vi.mock('@/shared/ui/octopus/inkpaw-octopus', () => ({ mountOctopus: () => null }))
const account = {
  id: 'history-owner',
  username: 'history@example.org',
  profile: { skills: ['Python'] },
}
const json = (data: unknown) =>
  Response.json({ code: 200, message: 'ok', data, total: 0, page: 1, page_size: 100 })
function show(path = '/detective') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(currentUserKey, account)
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <NuqsAdapter>
          <AppRoutes />
        </NuqsAdapter>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  localStorage.clear()
  vi.unstubAllGlobals()
})

it('清除浏览器数据后仍能从账号读取已保存对话并继续提问', async () => {
  let stored: DetectiveSession[] = []
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.endsWith('/account/conversations')) return json(stored)
    if (url.endsWith('/agent/ask')) {
      const body = JSON.parse(String(init?.body))
      const turn = {
        id: body.turn_id,
        question: body.question,
        content: '账号里保存的答复',
        trace: [],
        sources: [],
        status: 'completed' as const,
      }
      const previous = stored.find((item) => item.id === body.conversation_id)
      if (previous) previous.turns.push(turn)
      else
        stored = [
          {
            id: body.conversation_id,
            title: body.question,
            createdAt: 1,
            updatedAt: 2,
            turns: [turn],
          },
        ]
      return new Response('event: answer\ndata: {"content":"账号里保存的答复","sources":[]}\n\n', {
        headers: { 'content-type': 'text/event-stream' },
      })
    }
    return json(url.endsWith('/auth/me') ? account : [])
  })
  const first = show()
  const input = await screen.findByRole('textbox', { name: '问侦探' })
  fireEvent.change(input, { target: { value: '找线上比赛' } })
  fireEvent.submit(input.closest('form')!)
  expect(await screen.findByText('账号里保存的答复')).toBeTruthy()
  expect(stored[0]?.id).toEqual(expect.any(String))
  const id = stored[0]!.id
  first.unmount()
  localStorage.clear()
  show('/detective/' + id)
  expect(await screen.findByText('账号里保存的答复')).toBeTruthy()
  const next = screen.getByRole('textbox', { name: '问侦探' })
  fireEvent.change(next, { target: { value: '只看周末' } })
  fireEvent.submit(next.closest('form')!)
  await waitFor(() => expect(stored[0]!.turns).toHaveLength(2))
  expect(stored[0]!.turns.map((turn) => turn.question)).toEqual(['找线上比赛', '只看周末'])
})

it('只导入当前账号的旧聊天，成功后清理已迁移副本并保留访客数据', async () => {
  const turn = {
    id: 'old-turn',
    question: '旧问题',
    content: '旧答案',
    trace: [],
    sources: [],
    status: 'completed' as const,
  }
  const legacy = [{ id: 'old-session', title: '旧问题', createdAt: 1, updatedAt: 2, turns: [turn] }]
  localStorage.setItem('contest-detective.sessions.history-owner', JSON.stringify(legacy))
  localStorage.setItem(
    'contest-detective.sessions.guest',
    JSON.stringify([{ ...legacy[0], id: 'guest-session' }]),
  )
  let stored: DetectiveSession[] = []
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.endsWith('/account/conversations/import')) {
      stored = JSON.parse(String(init?.body)).sessions
      return json(null)
    }
    if (url.endsWith('/account/conversations')) return json(stored)
    return json(url.endsWith('/auth/me') ? account : [])
  })
  show('/detective/old-session')
  expect(await screen.findByText('旧答案')).toBeTruthy()
  await waitFor(() =>
    expect(localStorage.getItem('contest-detective.sessions.history-owner')).toBeNull(),
  )
  expect(stored.map((item) => item.id)).toEqual(['old-session'])
  expect(localStorage.getItem('contest-detective.sessions.guest')).not.toBeNull()
})

it('浏览器禁用本地存储时仍从服务器读取账号聊天', async () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('blocked')
  })
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) =>
    json(
      String(input).endsWith('/account/conversations')
        ? [
            {
              id: 'server-only',
              title: '服务器记录',
              createdAt: 1,
              updatedAt: 2,
              turns: [
                {
                  id: 'one',
                  question: '原问题',
                  content: '服务器保存的回复',
                  trace: [],
                  sources: [],
                  status: 'completed',
                },
              ],
            },
          ]
        : [],
    ),
  )
  show('/detective/server-only')
  expect(await screen.findByText('服务器保存的回复')).toBeTruthy()
  expect(screen.queryByRole('alert')).toBeNull()
})
