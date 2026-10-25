import { createWorker } from 'tesseract.js'
import {
  checkScreenshotDimensions,
  screenshotExtraction,
  type ScreenshotImageInfo,
} from './screenshot-image'

// An owned outer worker lets the caller cancel even while the OCR engine initializes.
// No filename, EXIF or image bytes are sent to a network service.
const scope = globalThis as unknown as {
  location: Location
  onmessage:
    | ((
        event: MessageEvent<{ bytes: ArrayBuffer; source: ScreenshotImageInfo; assets: string }>,
      ) => void)
    | null
  postMessage: (message: unknown) => void
}

scope.onmessage = async ({ data }) => {
  let engine: Awaited<ReturnType<typeof createWorker>> | undefined
  let bitmap: ImageBitmap | undefined
  try {
    const assets = new URL(data.assets)
    if (assets.origin !== scope.location.origin) throw new Error('识别资源必须来自当前站点。')
    bitmap = await createImageBitmap(new Blob([data.bytes], { type: data.source.content_type }))
    checkScreenshotDimensions(bitmap.width, bitmap.height)
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
    const context = canvas.getContext('2d')
    if (!context) throw new Error('浏览器无法处理这张图片，请换一张截图。')
    context.drawImage(bitmap, 0, 0)
    const source = { ...data.source, width: bitmap.width, height: bitmap.height }
    bitmap.close()
    bitmap = undefined
    const normalized = await canvas.convertToBlob({ type: 'image/png' })
    engine = await createWorker(['chi_sim', 'eng'], 1, {
      workerPath: new URL('worker.min.js', assets).href,
      corePath: new URL('core/', assets).href,
      langPath: new URL('lang/', assets).href,
      workerBlobURL: false,
      cacheMethod: 'none',
      logger: (event) => scope.postMessage({ type: 'progress', progress: event.progress }),
      errorHandler: () =>
        scope.postMessage({ type: 'error', message: '识别资源加载失败，请稍后重试。' }),
    })
    const { data: recognized } = await engine.recognize(
      normalized,
      {},
      { text: true, blocks: true },
    )
    scope.postMessage({ type: 'result', result: screenshotExtraction(recognized, source) })
  } catch (error) {
    scope.postMessage({
      type: 'error',
      message:
        error instanceof Error && /^(截图|图片|识别|浏览器)/.test(error.message)
          ? error.message
          : '图片识别失败，请换一张清晰截图后重试。',
    })
  } finally {
    bitmap?.close()
    await engine?.terminate()
  }
}
