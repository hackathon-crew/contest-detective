// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { renderDetective } from './detective.test.utils'
import type { DetectiveSession } from './sessions'
import snapshot from '../../../preview/detail-full-public-snapshot.json'

const contest = snapshot.response.data
const reference = { id: contest.id, name: contest.name, cover_url: contest.cover_url }
const saved: DetectiveSession = {
  id: 'bound-session',
  title: '问这场比赛',
  createdAt: 1,
  updatedAt: 1,
  turns: [
    {
      id: 'bound-turn',
      question: '学生可以参加吗？',
      content: '可以参加',
      trace: [],
      sources: [],
      status: 'completed',
      request: { contest: reference },
    },
  ],
}
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  localStorage.clear()
})

it('restores the selected contest from account history and keeps it on followup requests', async () => {
  const requests: Record<string, unknown>[] = []
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).endsWith('/agent/ask')) {
      requests.push(JSON.parse(String(init?.body)))
      return new Response('event: answer\ndata: {"content":"参赛条件已整理","sources":[]}\n\n', {
        headers: { 'content-type': 'text/event-stream' },
      })
    }
    return Response.json({ code: 200, message: 'ok', data: contest })
  })
  renderDetective({ savedSessions: [saved] }, '/detective/bound-session')
  await screen.findByText('可以参加')
  expect(screen.getByRole('button', { name: '移除比赛引用' })).toBeTruthy()
  const input = screen.getByRole('textbox', { name: '问侦探' })
  fireEvent.change(input, { target: { value: '需要几个人组队？' } })
  fireEvent.keyDown(input, { key: 'Enter' })
  await waitFor(() => expect(requests).toHaveLength(1))
  expect(requests[0]).toMatchObject({ contest_id: contest.id, question: '需要几个人组队？' })
})

it('retries a saved failed question with its original contest reference', async () => {
  const requests: Record<string, unknown>[] = []
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).endsWith('/agent/ask')) {
      requests.push(JSON.parse(String(init?.body)))
      return new Response('event: answer\ndata: {"content":"重查完成","sources":[]}\n\n', {
        headers: { 'content-type': 'text/event-stream' },
      })
    }
    return Response.json({ code: 200, message: 'ok', data: contest })
  })
  renderDetective(
    {
      savedSessions: [
        {
          ...saved,
          turns: [
            {
              ...saved.turns[0]!,
              content: '',
              status: 'error',
              error: '回复中断',
              action: 'retry',
              investigationId: 'old-run',
            },
          ],
        },
      ],
    },
    '/detective/bound-session',
  )
  fireEvent.click(await screen.findByRole('button', { name: '一键重查' }))
  await waitFor(() => expect(requests).toHaveLength(1))
  expect(requests[0]).toMatchObject({
    contest_id: contest.id,
    retry_of: 'old-run',
    question: '学生可以参加吗？',
  })
})
