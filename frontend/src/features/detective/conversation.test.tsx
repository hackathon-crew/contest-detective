// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderDetective } from './detective.test.utils'

beforeEach(() => localStorage.clear())
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function show(path = '/') {
  return renderDetective({ onAddProfile: vi.fn() }, path)
}
function resume() {
  fireEvent.click(screen.getByRole('button', { name: '打开会话列表' }))
  fireEvent.click(
    within(screen.getByRole('navigation', { name: '对话记录' })).getAllByRole('link')[0]!,
  )
}
const event = (type: string, payload: unknown) =>
  `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`
function send(question: string) {
  const input = screen.getByRole('textbox', { name: '问侦探' })
  fireEvent.change(input, { target: { value: question } })
  fireEvent.submit(input.closest('form')!)
}

describe('连续侦探对话', () => {
  it('完整窗口保留前两轮，第二次提问携带已完成的前文', async () => {
    const fetch = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(event('answer', { content: '可以先看线上活动。', sources: [] }), {
          headers: { 'content-type': 'text/event-stream' },
        }),
    )
    vi.stubGlobal('fetch', fetch)
    show()
    send('我是大学生，帮我找黑客松。')
    expect(await screen.findByRole('log', { name: '对话内容' })).toBeTruthy()
    expect(await screen.findByText('可以先看线上活动。')).toBeTruthy()
    send('只看个人参赛。')
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
    const body = JSON.parse(fetch.mock.calls[1]![1]!.body as string)
    expect(body.history).toEqual([
      { role: 'user', content: '我是大学生，帮我找黑客松。' },
      { role: 'assistant', content: '可以先看线上活动。' },
    ])
    expect(within(screen.getByRole('log')).getByText('我是大学生，帮我找黑客松。')).toBeTruthy()
    expect(screen.getByText('只看个人参赛。')).toBeTruthy()
    expect(screen.queryByText('查证过程')).toBeNull()
  })

  it('正文增量在终态前可见，工具过程可展开', async () => {
    let stream!: ReadableStreamDefaultController<Uint8Array>
    vi.stubGlobal(
      'fetch',
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              stream = controller
            },
          }),
          { headers: { 'content-type': 'text/event-stream' } },
        ),
    )
    show()
    send('找线上活动')
    await waitFor(() => expect(stream).toBeTruthy())
    await act(async () => {
      stream.enqueue(
        new TextEncoder().encode(event('step', { tool: 'search_contests', label: '查询比赛库' })),
      )
      stream.enqueue(new TextEncoder().encode(event('delta', { content: '先按线上条件' })))
    })
    expect(await screen.findByText('先按线上条件')).toBeTruthy()
    expect(screen.getByRole('button', { name: '停止查证' })).toBeTruthy()
    await act(async () => {
      stream.enqueue(
        new TextEncoder().encode(
          event('answer', { content: '先按线上条件继续筛选。', sources: [] }),
        ),
      )
      stream.close()
    })
    expect(await screen.findByText('先按线上条件继续筛选。')).toBeTruthy()
  })

  it('重新打开组件仍能恢复此前的问题和回复', async () => {
    vi.stubGlobal(
      'fetch',
      async () =>
        new Response(event('answer', { content: '已保留你的参赛条件。', sources: [] }), {
          headers: { 'content-type': 'text/event-stream' },
        }),
    )
    const first = show()
    send('我只考虑周末')
    expect(await screen.findByText('已保留你的参赛条件。')).toBeTruthy()
    first.unmount()
    show('/detective')
    resume()
    expect(within(screen.getByRole('log')).getByText('我只考虑周末')).toBeTruthy()
    expect(screen.getByText('已保留你的参赛条件。')).toBeTruthy()
  })

  it('返回首页仍继续当前回复，重新打开时记录完整', async () => {
    let stream!: ReadableStreamDefaultController<Uint8Array>
    let signal: AbortSignal | undefined
    vi.stubGlobal('fetch', async (_input: RequestInfo | URL, init?: RequestInit) => {
      signal = init?.signal ?? undefined
      return new Response(
        new ReadableStream({
          start(controller) {
            stream = controller
          },
        }),
        {
          headers: { 'content-type': 'text/event-stream' },
        },
      )
    })
    show()
    send('保留这个问题')
    await waitFor(() => expect(stream).toBeTruthy())
    fireEvent.click(screen.getByRole('link', { name: '浏览赛事' }))
    expect(signal?.aborted).toBe(false)
    await act(async () => {
      stream.enqueue(
        new TextEncoder().encode(event('answer', { content: '这条回复继续完成。', sources: [] })),
      )
      stream.close()
    })
    fireEvent.click(screen.getByRole('link', { name: '侦探' }))
    resume()
    expect(await screen.findByText('这条回复继续完成。')).toBeTruthy()
    expect(within(screen.getByRole('log')).getByText('保留这个问题')).toBeTruthy()
  })

  it('停止后迟到的终态不会覆盖已停止的回复', async () => {
    vi.stubGlobal('fetch', async (_input: RequestInfo | URL, init?: RequestInit) =>
      String(_input).endsWith('/cancel')
        ? new Response(JSON.stringify({ code: 200, message: 'success', data: null }))
        : new Response(
            new ReadableStream({
              start(controller) {
                init?.signal?.addEventListener('abort', () => {
                  controller.enqueue(
                    new TextEncoder().encode(
                      event('answer', { content: '迟到的回复', sources: [] }),
                    ),
                  )
                  controller.close()
                })
              },
            }),
            { headers: { 'content-type': 'text/event-stream' } },
          ),
    )
    show()
    send('随时可以停止')
    fireEvent.click(await screen.findByRole('button', { name: '停止查证' }))
    await waitFor(() =>
      expect(
        (screen.getByRole('textbox', { name: '问侦探' }) as HTMLTextAreaElement).disabled,
      ).toBe(false),
    )
    expect(screen.getByText('查证已停止。')).toBeTruthy()
    expect(screen.queryByText('迟到的回复')).toBeNull()
  })

  it('聊天页挂载后跟随消息区增长', async () => {
    let resize: (() => void) | undefined
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          resize = callback
        }
        observe() {}
        disconnect() {}
      },
    )
    vi.stubGlobal(
      'fetch',
      async () =>
        new Response(event('answer', { content: '这段回复会增长。', sources: [] }), {
          headers: { 'content-type': 'text/event-stream' },
        }),
    )
    show()
    send('看看消息跟随')
    expect(await screen.findByText('这段回复会增长。')).toBeTruthy()
    const log = screen.getByRole('log', { name: '对话内容' })
    Object.defineProperty(log, 'scrollHeight', { configurable: true, value: 1200 })
    Object.defineProperty(log, 'clientHeight', { configurable: true, value: 400 })
    act(() => resize?.())
    expect(log.scrollTop).toBe(1200)
  })
})
