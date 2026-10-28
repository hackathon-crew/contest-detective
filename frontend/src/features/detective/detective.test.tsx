// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderDetective } from './detective.test.utils'
import { parseTrace } from './events'

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.unstubAllGlobals()
})

function renderStream(text: string, business = false, recovered?: string) {
  let calls = 0
  const fetch = vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(
        business
          ? JSON.stringify({ code: 429, message: '提问过于频繁，请稍后再试', data: null })
          : calls++ > 0 && recovered
            ? recovered
            : text,
        { headers: { 'content-type': business ? 'application/json' : 'text/event-stream' } },
      ),
  )
  vi.stubGlobal('fetch', fetch)
  renderDetective({ profile: { skills: ['Python'] } })
  fireEvent.change(screen.getByLabelText('问侦探'), {
    target: { value: '这周末有哪些线上黑客松？' },
  })
  fireEvent.submit(screen.getByRole('button', { name: '查证' }).closest('form')!)
  return fetch
}
const event = (type: string, data: unknown) => `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`

describe('侦探过程', () => {
  it('依次显示两轮步骤、结论与出处，并带上已确认画像', async () => {
    const source = {
      title: '主办方公告',
      url: 'https://example.com/event',
      site: 'example.com',
      is_official: true,
    }
    const fetch = renderStream(
      [
        event('step', { tool: 'search_contests', label: '查询比赛库' }),
        event('observation', { tool: 'search_contests', summary: '找到两场线上活动', sources: [] }),
        event('step', { tool: 'fetch_page', label: '读取主办方公告' }),
        event('observation', {
          tool: 'fetch_page',
          summary: '16:00 是作品提交截止',
          sources: [source],
        }),
        event('answer', {
          content: '**可以线上参加。** 16:00 是作品提交截止。',
          sources: [source],
        }),
      ].join(''),
    )
    expect(await screen.findByText('可以线上参加。', { selector: 'strong' })).toBeTruthy()
    const conversation = within(screen.getByRole('log', { name: '对话内容' }))
    expect(conversation.getByText('查询比赛库')).toBeTruthy()
    expect(conversation.getByText('找到两场线上活动')).toBeTruthy()
    expect(conversation.getByText('读取主办方公告')).toBeTruthy()
    expect(
      screen
        .getAllByRole('link', { name: '主办方公告' })
        .every((link) => link.getAttribute('href') === source.url),
    ).toBe(true)
    expect(JSON.parse(fetch.mock.calls[0]![1]!.body as string).profile.skills).toEqual(['Python'])
  })
  it('开流前的业务拒绝显示原消息，保留问题供重试', async () => {
    renderStream('', true)
    expect(await screen.findByText('提问过于频繁，请稍后再试')).toBeTruthy()
    await waitFor(() =>
      expect((screen.getByLabelText('问侦探') as HTMLInputElement).value).toContain('这周末'),
    )
  })
  it('没有终态就断流时自动续读，不显示失败提示', async () => {
    renderStream(
      'id: 1\n' + event('step', { tool: 'search_contests', label: '查询比赛库' }),
      false,
      'id: 2\n' + event('answer', { content: '续读后完整回答。', sources: [] }),
    )
    expect(await screen.findByText('续读后完整回答。', {}, { timeout: 3000 })).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })
  it('不可用的附加消息不打断后续回答', async () => {
    renderStream(
      'event: observation\ndata: broken\n\n' +
        event('plan', {}) +
        event('answer', { content: '已经找到可参加的比赛。', report: {}, sources: [] }),
    )
    expect(await screen.findByText('已经找到可参加的比赛。')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })
  it('缺少封面、简介与字段值时仍显示回答和推荐', async () => {
    renderStream(
      event('answer', {
        content: '这场线上比赛可以使用 Python。',
        sources: [],
        recommendations: [
          {
            contest: {
              id: 'python-online',
              name: '线上 Python 挑战',
              status: 'upcoming',
              fields: { submission_deadline: { level: 'not_found', sources: [] } },
            },
            reason: '支持线上提交。',
          },
        ],
      }),
    )
    expect(await screen.findByText('这场线上比赛可以使用 Python。')).toBeTruthy()
    expect(screen.getByRole('link', { name: '线上 Python 挑战' })).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })
  it('附加来源异常时保留正文，链接仍在显示时处理', () => {
    expect(
      parseTrace({
        event: 'answer',
        data: JSON.stringify({
          content: '结论',
          sources: [{ title: '来源', url: 'javascript:alert(1)' }],
        }),
        id: null,
      }),
    ).toMatchObject({ type: 'answer', content: '结论' })
  })
  it('断流前已收到的正文继续显示，不要求重新提问', async () => {
    renderStream(
      'id: 1\n' + event('delta', { content: '已查到一场线上活动。' }),
      false,
      'id: 2\n' + event('answer', { content: '已查到一场线上活动，报名时间已确认。', sources: [] }),
    )
    expect(await screen.findByText('已查到一场线上活动。')).toBeTruthy()
    expect(
      await screen.findByText('已查到一场线上活动，报名时间已确认。', {}, { timeout: 3000 }),
    ).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })
  it('停止会取消进行中的请求并恢复输入', async () => {
    let aborted = false
    vi.stubGlobal('fetch', async (_input: RequestInfo | URL, init?: RequestInit) =>
      String(_input).endsWith('/cancel')
        ? new Response(JSON.stringify({ code: 200, message: 'success', data: null }))
        : new Response(
            new ReadableStream({
              start(controller) {
                init?.signal?.addEventListener('abort', () => {
                  aborted = true
                  controller.error(new DOMException('stopped', 'AbortError'))
                })
              },
            }),
            { headers: { 'content-type': 'text/event-stream' } },
          ),
    )
    renderDetective()
    fireEvent.change(screen.getByLabelText('问侦探'), { target: { value: '查一下报名时间' } })
    fireEvent.submit(screen.getByRole('button', { name: '查证' }).closest('form')!)
    fireEvent.click(await screen.findByRole('button', { name: '停止查证' }))
    await waitFor(() =>
      expect((screen.getByLabelText('问侦探') as HTMLInputElement).disabled).toBe(false),
    )
    expect(aborted).toBe(true)
    expect(screen.getByText('查证已停止。')).toBeTruthy()
  })
  it('重新打开页面按保存的断点续读，不再次发起查证', async () => {
    localStorage.setItem(
      'contest-detective.sessions.guest',
      JSON.stringify([
        {
          id: 'conversation',
          title: '查报名时间',
          createdAt: 1,
          updatedAt: 1,
          turns: [
            {
              id: 'turn',
              investigationId: 'saved-run',
              lastSeq: 1,
              question: '查报名时间',
              content: '',
              trace: [],
              sources: [],
              status: 'running',
            },
          ],
        },
      ]),
    )
    const fetch = vi.fn(
      async () =>
        new Response('id: 2\n' + event('answer', { content: '已续接完整回答。', sources: [] }), {
          headers: { 'content-type': 'text/event-stream' },
        }),
    )
    vi.stubGlobal('fetch', fetch)
    renderDetective({}, '/detective/conversation')
    expect(await screen.findByText('已续接完整回答。')).toBeTruthy()
    expect(fetch).toHaveBeenCalledTimes(2)
    const [path, init] = fetch.mock.calls.at(-1) as unknown as [string, RequestInit]
    expect(path).toBe('/api/agent/investigations/saved-run/events')
    expect(new Headers(init.headers).get('Last-Event-ID')).toBe('1')
    expect(init.method).toBeUndefined()
  })
})
