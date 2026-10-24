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

function renderStream(text: string, business = false) {
  const fetch = vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(
        business
          ? JSON.stringify({ code: 429, message: '提问过于频繁，请稍后再试', data: null })
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
  it('没有终态就断流时不当成已完成', async () => {
    renderStream(event('step', { tool: 'search_contests', label: '查询比赛库' }))
    expect(await screen.findByText('查证提前结束，请重试。')).toBeTruthy()
  })
  it('拒绝不合契约的载荷和不安全链接', () => {
    expect(() => parseTrace({ event: 'answer', data: '{"content":42}', id: null })).toThrow()
    expect(() =>
      parseTrace({
        event: 'answer',
        data: JSON.stringify({
          content: '结论',
          sources: [{ title: '来源', url: 'javascript:alert(1)' }],
        }),
        id: null,
      }),
    ).toThrow()
  })
  it('停止会取消进行中的请求并恢复输入', async () => {
    let aborted = false
    vi.stubGlobal(
      'fetch',
      async (_input: RequestInfo | URL, init?: RequestInit) =>
        new Response(
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
})
