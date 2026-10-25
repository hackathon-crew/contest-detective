// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { renderDetective } from './detective.test.utils'
import { reportFixture } from './verification-fixtures.test-utils'

vi.mock('./screenshot-recognizer', () => ({
  recognizeScreenshot: async () => ({
    status: 'review_required',
    text: '公开比赛报名截止\n未选择的文字',
    claims: [
      { id: 'screenshot-1', text: '公开比赛报名截止', recognition_confidence: 95 },
      { id: 'screenshot-2', text: '未选择的文字', recognition_confidence: 95 },
    ],
    recognition_confidence: 95,
    quality: 'usable',
    warnings: [],
    source: { width: 800, height: 400, content_type: 'image/png' },
  }),
}))
let stream: ReadableStreamDefaultController<Uint8Array>
let requests: unknown[]
beforeEach(() => {
  localStorage.clear()
  requests = []
  vi.stubGlobal(
    'URL',
    class extends URL {
      static createObjectURL() {
        return 'blob:screenshot-test'
      }
      static revokeObjectURL() {}
    },
  )
  vi.stubGlobal('fetch', async (url: RequestInfo | URL, init?: RequestInit) => {
    if (!String(url).includes('/agent/ask'))
      return new Response(JSON.stringify({ code: 200, data: null }))
    requests.push(JSON.parse(String(init?.body)))
    return new Response(
      new ReadableStream({
        start: (controller) => {
          stream = controller
        },
      }),
      {
        headers: { 'content-type': 'text/event-stream' },
      },
    )
  })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
async function emit(type: string, data: unknown) {
  await act(async () =>
    stream.enqueue(new TextEncoder().encode(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`)),
  )
}
it('截图核验入口暂不可用，不发送深度请求且保留手写草稿', async () => {
  renderDetective({}, '/detective')
  const composer = screen.getByRole('textbox', { name: '问侦探' })
  fireEvent.change(composer, { target: { value: '保留手写草稿' } })
  fireEvent.keyDown(screen.getByRole('button', { name: '添加简历或参赛资料' }), { key: 'Enter' })
  const entry = await screen.findByRole('menuitem', { name: '截图查证（暂不可用）' })
  expect(entry.getAttribute('aria-disabled')).toBe('true')
  fireEvent.click(entry)
  expect(screen.queryByRole('dialog')).toBeNull()
  expect((composer as HTMLTextAreaElement).value).toBe('保留手写草稿')
  expect(requests).toHaveLength(0)
})
it('尚无查询步骤的计划也打开既有研究面板', async () => {
  renderDetective({}, '/detective')
  fireEvent.change(screen.getByRole('textbox', { name: '问侦探' }), {
    target: { value: '公开比赛报名截止' },
  })
  fireEvent.click(screen.getByRole('button', { name: '查证' }))
  await waitFor(() => expect(requests).toHaveLength(1))
  await emit('plan', reportFixture().plan)
  const panel = within(await screen.findByRole('complementary', { name: '研究面板' }))
  expect(panel.getByText('调查计划')).toBeTruthy()
  expect(panel.getByText('尚无实际查询记录。')).toBeTruthy()
})
