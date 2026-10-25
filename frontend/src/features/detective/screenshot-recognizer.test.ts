// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { recognizeScreenshot, SCREENSHOT_TIMEOUT_MS } from './screenshot-recognizer'

let workers: FakeWorker[] = []
class FakeWorker {
  onmessage?: (event: MessageEvent) => void
  onerror?: () => void
  postMessage = vi.fn()
  terminate = vi.fn()
  constructor() {
    workers.push(this)
  }
}
function file() {
  const bytes = new Uint8Array(readFileSync('tests/fixtures/clean-light.png'))
  return { size: bytes.length, type: 'image/png', arrayBuffer: async () => bytes.buffer } as File
}
beforeEach(() => {
  workers = []
  vi.stubGlobal('Worker', FakeWorker)
  vi.stubGlobal('OffscreenCanvas', class {})
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

it('只将无文件名的本地字节交给可取消 Worker', async () => {
  const request = recognizeScreenshot(file(), { signal: new AbortController().signal })
  await vi.waitFor(() => expect(workers).toHaveLength(1))
  const payload = workers[0]!.postMessage.mock.calls[0]![0]
  expect(Object.keys(payload).sort()).toEqual(['assets', 'bytes', 'source', 'type'])
  expect(new URL(payload.assets).origin).toBe(window.location.origin)
  const result = { status: 'no_text', text: '', claims: [] }
  workers[0]!.onmessage?.({ data: { type: 'result', result } } as MessageEvent)
  expect(await request).toEqual(result)
  expect(workers[0]!.terminate).toHaveBeenCalledOnce()
})
it('取消包括初始化阶段，先终止子 Worker，再释放父 Worker', async () => {
  const controller = new AbortController()
  const request = recognizeScreenshot(file(), { signal: controller.signal })
  const rejection = expect(request).rejects.toMatchObject({ name: 'AbortError' })
  await vi.waitFor(() => expect(workers).toHaveLength(1))
  controller.abort()
  await rejection
  expect(workers[0]!.postMessage).toHaveBeenLastCalledWith({ type: 'cancel' })
  expect(workers[0]!.terminate).not.toHaveBeenCalled()
  workers[0]!.onmessage?.({ data: { type: 'result', result: {} } } as MessageEvent)
  expect(workers[0]!.terminate).toHaveBeenCalledOnce()
})
it('超时与资源错误是真实失败，不当成空白成功', async () => {
  vi.useFakeTimers()
  const request = recognizeScreenshot(file(), { signal: new AbortController().signal })
  const rejection = expect(request).rejects.toThrow('超时')
  await Promise.resolve()
  await Promise.resolve()
  await vi.advanceTimersByTimeAsync(SCREENSHOT_TIMEOUT_MS + 1000)
  await rejection
  expect(workers[0]!.terminate).toHaveBeenCalledOnce()
})
it('输入不合法时不启动 Worker', async () => {
  await expect(
    recognizeScreenshot({ size: 9 * 1024 * 1024 } as File, {
      signal: new AbortController().signal,
    }),
  ).rejects.toThrow('8 MiB')
  expect(workers).toHaveLength(0)
})
it('关闭后再启动的请求在读取文件前就被拒绝', async () => {
  const controller = new AbortController()
  controller.abort()
  await expect(recognizeScreenshot(file(), { signal: controller.signal })).rejects.toMatchObject({
    name: 'AbortError',
  })
  expect(workers).toHaveLength(0)
})
