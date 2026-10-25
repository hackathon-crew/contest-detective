// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ScreenshotDialog } from './screenshot-dialog'
import type { ScreenshotExtraction } from './screenshot-contracts'

const result: ScreenshotExtraction = {
  status: 'review_required',
  quality: 'usable',
  text: '第一条\n不选这条',
  recognition_confidence: 99,
  warnings: [],
  source: { width: 100, height: 100, content_type: 'image/png' },
  claims: [
    { id: 'one', text: '第一条', recognition_confidence: 99 },
    { id: 'two', text: '不选这条', recognition_confidence: 99 },
  ],
}
const choose = () =>
  fireEvent.change(screen.getByLabelText('选择截图'), {
    target: { files: [new File(['fixture'], 'private-filename.png', { type: 'image/png' })] },
  })
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
  URL.createObjectURL = vi.fn(() => 'blob:local-preview')
  URL.revokeObjectURL = vi.fn()
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  localStorage.clear()
})
it('高分不自动查询，确认只发送校正选择的文字', async () => {
  const onConfirm = vi.fn()
  const onClose = vi.fn()
  render(
    <ScreenshotDialog onClose={onClose} onConfirm={onConfirm} recognizer={async () => result} />,
  )
  choose()
  await screen.findByLabelText('说法 1')
  expect(onConfirm).not.toHaveBeenCalled()
  expect(fetch).not.toHaveBeenCalled()
  expect(
    (screen.getByRole('button', { name: '确认文字并查证' }) as HTMLButtonElement).disabled,
  ).toBe(true)
  fireEvent.change(screen.getByLabelText('说法 1'), {
    target: { value: '比赛报名截止是 10 月 30 日' },
  })
  fireEvent.click(screen.getByLabelText('查证这条说法 1'))
  fireEvent.change(screen.getByLabelText('截图查证方式'), { target: { value: 'deep' } })
  fireEvent.click(screen.getByRole('button', { name: '确认文字并查证' }))
  fireEvent.click(screen.getByRole('button', { name: '确认文字并查证' }))
  expect(onConfirm).toHaveBeenCalledExactlyOnceWith({
    question: '比赛报名截止是 10 月 30 日',
    mode: 'deep',
    confirmed_claims: [{ id: 'one', text: '比赛报名截止是 10 月 30 日', origin: 'screenshot' }],
  })
  expect(JSON.stringify(onConfirm.mock.calls)).not.toContain('private-filename')
  expect(localStorage.length).toBe(0)
})
it('关闭识别后取消请求，不发布晚到结果', async () => {
  let resolve!: (value: ScreenshotExtraction) => void
  let signal!: AbortSignal
  const onClose = vi.fn()
  const onConfirm = vi.fn()
  const ui = render(
    <ScreenshotDialog
      onClose={onClose}
      onConfirm={onConfirm}
      recognizer={(_file, options) => {
        signal = options.signal
        return new Promise((done) => {
          resolve = done
        })
      }}
    />,
  )
  choose()
  fireEvent.click(screen.getByRole('button', { name: '取消' }))
  expect(signal.aborted).toBe(true)
  ui.unmount()
  resolve(result)
  await Promise.resolve()
  expect(onConfirm).not.toHaveBeenCalled()
})
it('替换截图后忽略旧结果，同一文件可重试', async () => {
  const resolvers: ((value: ScreenshotExtraction) => void)[] = []
  const signals: AbortSignal[] = []
  const recognizer = vi.fn((_file, options) => {
    signals.push(options.signal)
    return new Promise<ScreenshotExtraction>((done) => resolvers.push(done))
  })
  render(<ScreenshotDialog onClose={() => {}} onConfirm={() => {}} recognizer={recognizer} />)
  choose()
  choose()
  expect(signals[0]?.aborted).toBe(true)
  resolvers[1]!({
    ...result,
    claims: [{ id: 'new', text: '新的截图', recognition_confidence: 90 }],
  })
  await screen.findByDisplayValue('新的截图')
  resolvers[0]!(result)
  await waitFor(() => expect(screen.queryByDisplayValue('第一条')).toBeNull())
  expect(recognizer).toHaveBeenCalledTimes(2)
})
it('空白与失败可恢复，不允许提交空结论', async () => {
  const recognizer = vi
    .fn()
    .mockRejectedValueOnce(new Error('图片已损坏'))
    .mockResolvedValueOnce({
      ...result,
      status: 'no_text',
      claims: [],
      text: '',
      quality: 'no_text',
    })
  render(<ScreenshotDialog onClose={() => {}} onConfirm={() => {}} recognizer={recognizer} />)
  choose()
  expect((await screen.findByRole('alert')).textContent).toContain('图片已损坏')
  choose()
  expect(await screen.findByText(/没有识别到可查证的文字/)).toBeTruthy()
  expect(
    (screen.getByRole('button', { name: '确认文字并查证' }) as HTMLButtonElement).disabled,
  ).toBe(true)
})
