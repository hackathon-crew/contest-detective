// @vitest-environment jsdom
import { StrictMode } from 'react'
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'
import { currentUserKey } from '@/entities/user'
import { DetectiveProvider } from '@/features/detective'
import type { LiveSnapshot } from '@/features/detective/live/main.js'
import LivePage from './live-page'

const seen = vi.hoisted(() => ({ snapshot: null as LiveSnapshot | null }))
// 只替换 WebGL 编排边界；真实页面、会话存储、请求和流解析仍参与验证。
vi.mock('@/features/detective/live/main.js', () => ({
  mountLive: (_root: HTMLElement, _callbacks: unknown, initial: LiveSnapshot) => {
    seen.snapshot = initial
    return {
      update: (value: LiveSnapshot) => {
        seen.snapshot = value
      },
      stop() {},
      reopen: async () => {},
    }
  },
}))
afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.unstubAllGlobals()
  seen.snapshot = null
})
function open(state?: { liveQuestion: string }, progress = false) {
  const questions: string[] = []
  const replays: string[] = []
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input)
    if (path.includes('/investigations/')) {
      replays.push(path)
      return Response.json({ code: 404, message: '查证已结束', data: null })
    }
    if (path.endsWith('/agent/guest/ask')) {
      questions.push(JSON.parse(String(init?.body)).question)
      if (progress)
        return new Response(
          new ReadableStream({
            async start(controller) {
              const encoder = new TextEncoder()
              for (let seq = 1; seq <= 12; seq++) {
                controller.enqueue(
                  encoder.encode(
                    `id: ${seq}\nevent: step\ndata: {"tool":"get_contest","label":"读取赛事出处"}\n\n`,
                  ),
                )
                await new Promise((resolve) => setTimeout(resolve, 2))
              }
              controller.enqueue(
                encoder.encode(
                  'id: 13\nevent: answer\ndata: {"content":"完整回答","sources":[],"recommendations":[]}\n\n',
                ),
              )
              controller.close()
            },
          }),
          { headers: { 'Content-Type': 'text/event-stream' } },
        )
      return new Response(
        'id: 1\nevent: answer\ndata: {"content":"你好，直接说你的条件就好。","sources":[],"recommendations":[]}\n\n',
        { headers: { 'Content-Type': 'text/event-stream' } },
      )
    }
    return Response.json({
      code: 200,
      message: 'ok',
      data: path.endsWith('/auth/me') ? null : { limit: 3, remaining: 3 },
    })
  })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(currentUserKey, null)
  render(
    <StrictMode>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[{ pathname: '/live', state }]}>
          <DetectiveProvider scope="guest">
            <Routes>
              <Route path="/live" element={<LivePage />} />
              <Route path="/live/:conversationId" element={<LivePage />} />
            </Routes>
          </DetectiveProvider>
        </MemoryRouter>
      </QueryClientProvider>
    </StrictMode>,
  )
  return { questions, replays }
}
it('新房间在没有登录请求时不递登录卡', async () => {
  open()
  await waitFor(() => expect(seen.snapshot?.remaining).toBe(3))
  expect(seen.snapshot?.ticket).toBeUndefined()
})
it('首页草稿在严格模式下只发起一次查证，并显示真实回答', async () => {
  const { questions } = open({ liveQuestion: '你好' })
  await waitFor(() => expect(seen.snapshot?.turn?.content).toBe('你好，直接说你的条件就好。'))
  expect(seen.snapshot?.turn?.status).toBe('completed')
  expect(seen.snapshot?.turn?.error).toBeUndefined()
  expect(questions).toEqual(['你好'])
  expect(seen.snapshot?.cards).toEqual([])
})

it('完成回答后不会由旧渲染再次启动续读', async () => {
  const { replays } = open({ liveQuestion: '线上比赛' }, true)
  await waitFor(() => expect(seen.snapshot?.turn?.content).toBe('完整回答'))
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 60))
  })
  expect(replays).toEqual([])
  expect(seen.snapshot?.turn?.status).toBe('completed')
})
