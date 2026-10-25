import { createWorker } from 'tesseract.js'
import {
  checkScreenshotDimensions,
  screenshotExtraction,
  type ScreenshotImageInfo,
} from './screenshot-image'

// Tesseract's createWorker promise exposes no handle until initialization completes.
// Its children therefore belong to this isolated worker, not the window. Terminating
// only the outer worker does NOT stop a child blocked on a model download in Chromium.
const NativeWorker = globalThis.Worker
const children = new Set<Worker>()
globalThis.Worker = class OwnedWorker extends NativeWorker {
  constructor(url: string | URL, options?: WorkerOptions) {
    super(url, options)
    children.add(this)
  }
  override terminate() {
    children.delete(this)
    super.terminate()
  }
}
const scope = globalThis as unknown as {
  location: Location
  onmessage:
    | ((
        event: MessageEvent<{
          type: 'recognize' | 'cancel'
          bytes: ArrayBuffer
          source: ScreenshotImageInfo
          assets: string
        }>,
      ) => void)
    | null
  postMessage: (message: unknown) => void
  close: () => void
}
let stopped = false
let bitmap: ImageBitmap | undefined
function finish(message: unknown) {
  if (stopped) return
  stopped = true
  for (const child of children) child.terminate()
  bitmap?.close()
  bitmap = undefined
  scope.postMessage(message)
  scope.close()
}

scope.onmessage = async ({ data }) => {
  if (data.type === 'cancel') {
    finish({ type: 'cancelled' })
    return
  }
  if (stopped) return
  try {
    const assets = new URL(data.assets)
    if (assets.origin !== scope.location.origin) throw new Error('识别资源必须来自当前站点。')
    bitmap = await createImageBitmap(new Blob([data.bytes], { type: data.source.content_type }))
    if (stopped) {
      bitmap.close()
      bitmap = undefined
      return
    }
    checkScreenshotDimensions(bitmap.width, bitmap.height)
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
    const context = canvas.getContext('2d')
    if (!context) throw new Error('浏览器无法处理这张图片，请换一张截图。')
    context.drawImage(bitmap, 0, 0)
    const source = { ...data.source, width: bitmap.width, height: bitmap.height }
    bitmap.close()
    bitmap = undefined
    const normalized = await canvas.convertToBlob({ type: 'image/png' })
    if (stopped) return
    const engine = await createWorker(['chi_sim', 'eng'], 1, {
      workerPath: new URL('worker.min.js', assets).href,
      corePath: new URL('core/', assets).href,
      langPath: new URL('lang/', assets).href,
      workerBlobURL: false,
      cacheMethod: 'none',
      logger: (event) => {
        if (!stopped) scope.postMessage({ type: 'progress', progress: event.progress })
      },
      errorHandler: () => finish({ type: 'error', message: '识别资源加载失败，请稍后重试。' }),
    })
    if (stopped) {
      await engine.terminate()
      return
    }
    const { data: recognized } = await engine.recognize(
      normalized,
      {},
      { text: true, blocks: true },
    )
    if (!stopped) finish({ type: 'result', result: screenshotExtraction(recognized, source) })
  } catch (error) {
    finish({
      type: 'error',
      message:
        error instanceof Error && /^(截图|图片|识别|浏览器)/.test(error.message)
          ? error.message
          : '图片识别失败，请换一张清晰截图后重试。',
    })
  }
}
