import type { ScreenshotExtraction, ScreenshotRecognizer } from './screenshot-contracts'
import { inspectScreenshot, MAX_SCREENSHOT_BYTES } from './screenshot-image'

export const SCREENSHOT_TIMEOUT_MS = 45_000

export const recognizeScreenshot: ScreenshotRecognizer = async (file, { signal, onProgress }) => {
  signal.throwIfAborted()
  if (file.size > MAX_SCREENSHOT_BYTES) throw new Error('图片不能超过 8 MiB，请压缩或裁剪后重试。')
  const bytes = await file.arrayBuffer()
  signal.throwIfAborted()
  const source = inspectScreenshot(bytes, file.type)
  if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined')
    throw new Error('当前浏览器不支持本地图片识别，请使用新版浏览器，或直接输入要查证的说法。')
  return new Promise<ScreenshotExtraction>((resolve, reject) => {
    let worker: Worker
    try {
      worker = new Worker(new URL('./screenshot-worker.ts', import.meta.url), { type: 'module' })
    } catch {
      reject(new Error('浏览器无法启动图片识别，请稍后重试。'))
      return
    }
    let finished = false
    let timer: ReturnType<typeof setTimeout>
    let cleanupTimer: ReturnType<typeof setTimeout> | undefined
    const finish = (result?: ScreenshotExtraction, error?: unknown, cancelChildren = false) => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      signal.removeEventListener('abort', abort)
      if (cancelChildren) {
        // Let the responsive owner terminate its children before stopping it.
        cleanupTimer = setTimeout(() => worker.terminate(), 1000)
        worker.postMessage({ type: 'cancel' })
      } else worker.terminate()
      if (error) reject(error)
      else if (result) resolve(result)
    }
    const abort = () => finish(undefined, new DOMException('图片识别已取消', 'AbortError'), true)
    signal.addEventListener('abort', abort, { once: true })
    timer = setTimeout(
      () => finish(undefined, new Error('图片识别超时，请裁剪图片或稍后重试。'), true),
      SCREENSHOT_TIMEOUT_MS,
    )
    worker.onerror = () => finish(undefined, new Error('图片识别资源无法运行，请稍后重试。'), true)
    worker.onmessage = ({ data }) => {
      if (finished) {
        if (data.type === 'cancelled' || data.type === 'result' || data.type === 'error') {
          clearTimeout(cleanupTimer)
          worker.terminate()
        }
        return
      }
      if (data.type === 'progress' && Number.isFinite(data.progress)) onProgress?.(data.progress)
      else if (data.type === 'error') finish(undefined, new Error(data.message))
      else if (data.type === 'result') finish(data.result)
    }
    if (signal.aborted) {
      abort()
      return
    }
    worker.postMessage(
      {
        type: 'recognize',
        bytes,
        source,
        assets: new URL(`${import.meta.env.BASE_URL}ocr/`, window.location.origin).href,
      },
      [bytes],
    )
  })
}
