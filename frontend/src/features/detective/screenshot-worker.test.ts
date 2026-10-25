// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const engineFactory = vi.hoisted(() => vi.fn())
vi.mock('tesseract.js', () => ({ createWorker: engineFactory }))
let children: { terminate: ReturnType<typeof vi.fn> }[]
let post: ReturnType<typeof vi.fn>
let close: ReturnType<typeof vi.fn>
const source = { width: 800, height: 400, content_type: 'image/png' }
function send(type: string) {
  globalThis.onmessage?.call(window, {
    data: { type, bytes: new ArrayBuffer(0), source, assets: `${location.origin}/ocr/` },
  } as MessageEvent)
}
beforeEach(() => {
  vi.resetModules()
  children = []
  post = vi.fn()
  close = vi.fn()
  vi.stubGlobal('postMessage', post)
  vi.stubGlobal('close', close)
  vi.stubGlobal('onmessage', null)
  vi.stubGlobal(
    'Worker',
    class {
      terminate = vi.fn()
      constructor() {
        children.push(this)
      }
    },
  )
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async () => ({ width: 800, height: 400, close: vi.fn() })),
  )
  vi.stubGlobal(
    'OffscreenCanvas',
    class {
      getContext() {
        return { drawImage: vi.fn() }
      }
      async convertToBlob() {
        return new Blob()
      }
    },
  )
  engineFactory.mockReset()
  engineFactory.mockImplementation(() => {
    new Worker(`${location.origin}/ocr/worker.min.js`)
    return new Promise(() => {})
  })
})
afterEach(() => vi.unstubAllGlobals())

it('取消尚未完成的初始化，先终止真实子句柄再确认清理', async () => {
  await import('./screenshot-worker')
  send('recognize')
  await vi.waitFor(() => expect(children).toHaveLength(1))
  send('cancel')
  expect(children[0]!.terminate).toHaveBeenCalledOnce()
  expect(post).toHaveBeenLastCalledWith({ type: 'cancelled' })
  expect(children[0]!.terminate.mock.invocationCallOrder[0]).toBeLessThan(
    post.mock.invocationCallOrder[0]!,
  )
  expect(close).toHaveBeenCalledOnce()
})
it('取消未完成的解码后，迟到结果不会再创建 OCR 子任务', async () => {
  let resolveBitmap: (value: unknown) => void = () => {}
  vi.stubGlobal(
    'createImageBitmap',
    () =>
      new Promise((resolve) => {
        resolveBitmap = resolve
      }),
  )
  const bitmapClose = vi.fn()
  await import('./screenshot-worker')
  send('recognize')
  send('cancel')
  resolveBitmap({ width: 800, height: 400, close: bitmapClose })
  await vi.waitFor(() => expect(bitmapClose).toHaveBeenCalledOnce())
  expect(engineFactory).not.toHaveBeenCalled()
  expect(post).toHaveBeenCalledOnce()
})
it.each(['result', 'error'])('终态 %s 在发出前清理子任务', async (kind) => {
  engineFactory.mockImplementation(async () => {
    new Worker(`${location.origin}/ocr/worker.min.js`)
    if (kind === 'error') throw new Error('load failed')
    return { recognize: async () => ({ data: { text: '', confidence: 0 } }) }
  })
  await import('./screenshot-worker')
  send('recognize')
  await vi.waitFor(() => expect(post).toHaveBeenCalledOnce())
  expect(post.mock.calls[0]![0].type).toBe(kind)
  expect(children[0]!.terminate).toHaveBeenCalledOnce()
  expect(children[0]!.terminate.mock.invocationCallOrder[0]).toBeLessThan(
    post.mock.invocationCallOrder[0]!,
  )
  expect(close).toHaveBeenCalledOnce()
})
