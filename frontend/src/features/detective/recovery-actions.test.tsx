// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { renderDetective } from './detective.test.utils'

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.unstubAllGlobals()
})
const event = (type: string, data: unknown) =>
  `id: 1\nevent: ${type}\ndata: ${JSON.stringify(data)}\n\n`
function ask() {
  fireEvent.change(screen.getByLabelText('问侦探'), { target: { value: '查原问题的报名时间' } })
  fireEvent.submit(screen.getByRole('button', { name: '查证' }).closest('form')!)
}

it.each(['stream', 'preflight'])(
  'public quota offers a direct account key settings action (%s)',
  async (kind) => {
    const payload = {
      message: '公共查证额度已用完。填写自己的密钥后可以继续。',
      action: 'settings',
    }
    vi.stubGlobal(
      'fetch',
      async () =>
        new Response(
          kind === 'stream'
            ? event('error', payload)
            : JSON.stringify({ code: 503, message: payload.message, data: { action: 'settings' } }),
          {
            headers: {
              'content-type': kind === 'stream' ? 'text/event-stream' : 'application/json',
            },
          },
        ),
    )
    renderDetective()
    ask()
    expect(await screen.findByText(payload.message)).toBeTruthy()
    expect(screen.getByRole('link', { name: '账户设置' }).getAttribute('href')).toBe(
      '/account/keys',
    )
  },
)

it('one-click retry after restart keeps the question and preferences without retyping', async () => {
  localStorage.setItem(
    'contest-detective.sessions.guest',
    JSON.stringify([
      {
        id: 'conversation',
        title: '查原问题的报名时间',
        createdAt: 1,
        updatedAt: 1,
        turns: [
          {
            id: 'turn',
            investigationId: 'old-run',
            lastSeq: 0,
            question: '查原问题的报名时间',
            content: '',
            request: { profile: { skills: ['Python'] } },
            trace: [],
            sources: [],
            status: 'running',
          },
        ],
      },
    ]),
  )
  const fetch = vi.fn(
    async (input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(
        String(input).endsWith('/events')
          ? event('error', {
              message: '服务重启导致查证中断。点击一键重查，无需重新输入问题。',
              action: 'retry',
            })
          : event('answer', { content: '重查后得到完整答案。', sources: [] }),
        { headers: { 'content-type': 'text/event-stream' } },
      ),
  )
  vi.stubGlobal('fetch', fetch)
  renderDetective({}, '/detective/conversation')
  fireEvent.click(await screen.findByRole('button', { name: '一键重查' }))
  expect(await screen.findByText('重查后得到完整答案。')).toBeTruthy()
  const request = fetch.mock.calls.find(([url]) => String(url).endsWith('/agent/ask'))!
  const body = JSON.parse(request[1]!.body as string)
  expect(body.question).toBe('查原问题的报名时间')
  expect(body.profile).toEqual({ skills: ['Python'] })
  expect(body.investigation_id).not.toBe('old-run')
  expect(screen.getAllByText('查原问题的报名时间', { selector: 'p' })).toHaveLength(1)
})

it('empty results offer an input action for an official link', async () => {
  vi.stubGlobal(
    'fetch',
    async () =>
      new Response(
        event('answer', {
          content: '没有找到可核实的资料，你可以贴官网链接让我读取。',
          sources: [],
          action: 'provide_link',
        }),
        {
          headers: { 'content-type': 'text/event-stream' },
        },
      ),
  )
  renderDetective()
  ask()
  fireEvent.click(await screen.findByRole('button', { name: '贴官网链接' }))
  await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('问侦探')))
})
