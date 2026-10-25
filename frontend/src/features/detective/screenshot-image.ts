import type { ScreenshotExtraction, ScreenshotMime } from './screenshot-contracts'

export const MAX_SCREENSHOT_BYTES = 8 * 1024 * 1024
export const MAX_SCREENSHOT_PIXELS = 20_000_000
export const MAX_SCREENSHOT_SIDE = 16_384
export const MAX_SCREENSHOT_TEXT = 8_000
export const MAX_SCREENSHOT_CLAIMS = 20

export interface ScreenshotImageInfo {
  width: number
  height: number
  content_type: ScreenshotMime
}

function invalid(): never {
  throw new Error('图片已损坏或格式不受支持，请选择静态 PNG、JPEG 或 WebP 图片。')
}

export function checkScreenshotDimensions(width: number, height: number) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1)
    return invalid()
  if (
    width > MAX_SCREENSHOT_SIDE ||
    height > MAX_SCREENSHOT_SIDE ||
    width * height > MAX_SCREENSHOT_PIXELS
  )
    throw new Error('图片尺寸过大，请裁剪到 2000 万像素以内，且任一边不超过 16384 像素。')
}

/** Inspect bounded file bytes before any browser decoder or OCR worker allocation. */
export function inspectScreenshot(buffer: ArrayBuffer, declaredType = ''): ScreenshotImageInfo {
  const bytes = new Uint8Array(buffer)
  if (!bytes.length) throw new Error('图片是空文件，请重新选择。')
  if (bytes.length > MAX_SCREENSHOT_BYTES)
    throw new Error('图片不能超过 8 MiB，请压缩或裁剪后重试。')
  const view = new DataView(buffer)
  const ascii = (offset: number, count: number) =>
    String.fromCharCode(...bytes.subarray(offset, offset + count))
  let width = 0
  let height = 0
  let content_type: ScreenshotMime
  if (
    bytes.length >= 24 &&
    bytes[0] === 137 &&
    ascii(1, 3) === 'PNG' &&
    ascii(4, 4) === '\r\n\x1a\n'
  ) {
    content_type = 'image/png'
    if (view.getUint32(8) !== 13 || ascii(12, 4) !== 'IHDR') return invalid()
    width = view.getUint32(16)
    height = view.getUint32(20)
    checkScreenshotDimensions(width, height)
    let ended = false
    for (let offset = 8; offset + 12 <= bytes.length;) {
      const length = view.getUint32(offset)
      if (length > bytes.length - offset - 12) return invalid()
      const kind = ascii(offset + 4, 4)
      if (kind === 'acTL') throw new Error('暂不支持动画图片，请选择一张静态截图。')
      offset += length + 12
      if (kind === 'IEND') {
        ended = length === 0 && offset === bytes.length
        break
      }
    }
    if (!ended) return invalid()
  } else if (bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216) {
    content_type = 'image/jpeg'
    for (let offset = 2; offset + 3 < bytes.length;) {
      if (bytes[offset++] !== 255) return invalid()
      while (bytes[offset] === 255) offset++
      const marker = bytes[offset++]
      if (marker === undefined || marker === 217 || marker === 218) break
      if (marker === 1 || (marker >= 208 && marker <= 215)) continue
      if (offset + 2 > bytes.length) return invalid()
      const length = view.getUint16(offset)
      if (length < 2 || offset + length > bytes.length) return invalid()
      if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker)) {
        if (length < 8) return invalid()
        height = view.getUint16(offset + 3)
        width = view.getUint16(offset + 5)
        break
      }
      offset += length
    }
  } else if (bytes.length >= 20 && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') {
    content_type = 'image/webp'
    if (view.getUint32(4, true) + 8 !== bytes.length) return invalid()
    const u24 = (offset: number) =>
      bytes[offset]! + bytes[offset + 1]! * 256 + bytes[offset + 2]! * 65536
    for (let offset = 12; offset + 8 <= bytes.length;) {
      const kind = ascii(offset, 4)
      const length = view.getUint32(offset + 4, true)
      const data = offset + 8
      if (length > bytes.length - data) return invalid()
      if (kind === 'ANIM' || kind === 'ANMF')
        throw new Error('暂不支持动画图片，请选择一张静态截图。')
      if (kind === 'VP8X') {
        if (length !== 10) return invalid()
        if (bytes[data]! & 2) throw new Error('暂不支持动画图片，请选择一张静态截图。')
        width = u24(data + 4) + 1
        height = u24(data + 7) + 1
      } else if (kind === 'VP8 ' && !width) {
        if (length < 10 || ascii(data + 3, 3) !== '\x9d\x01\x2a') return invalid()
        width = view.getUint16(data + 6, true) & 0x3fff
        height = view.getUint16(data + 8, true) & 0x3fff
      } else if (kind === 'VP8L' && !width) {
        if (length < 5 || bytes[data] !== 47) return invalid()
        width = 1 + bytes[data + 1]! + ((bytes[data + 2]! & 63) << 8)
        height =
          1 + (bytes[data + 2]! >> 6) + (bytes[data + 3]! << 2) + ((bytes[data + 4]! & 15) << 10)
      }
      offset = data + length + (length % 2)
    }
  } else return invalid()
  checkScreenshotDimensions(width, height)
  if (declaredType && declaredType !== content_type) return invalid()
  return { width, height, content_type }
}

interface RecognizedLine {
  text: string
  confidence: number
  bbox: { y0: number; y1: number }
}
export interface OcrText {
  text: string
  confidence: number
  blocks: { paragraphs: { lines: RecognizedLine[] }[] }[] | null
}

function score(value: number): number | null {
  return Number.isFinite(value) && value >= 0 && value <= 100 ? value : null
}

export function screenshotExtraction(
  data: OcrText,
  source: ScreenshotImageInfo,
): ScreenshotExtraction {
  const text = data.text.trim()
  if (text.length > MAX_SCREENSHOT_TEXT)
    throw new Error('截图文字过多，请裁剪到需要查证的部分后重试。')
  const lines =
    data.blocks?.flatMap((block) => block.paragraphs.flatMap((paragraph) => paragraph.lines)) ?? []
  const candidates = (
    lines.length
      ? lines
      : text.split(/\n+/).map((line) => ({ text: line, confidence: data.confidence }))
  )
    .map((line) => ({
      text: line.text.trim().replace(/([\p{Script=Han}]) +(?=[\p{Script=Han}])/gu, '$1'),
      confidence: score(line.confidence),
    }))
    .filter((line) => line.text)
  if (candidates.length > MAX_SCREENSHOT_CLAIMS)
    throw new Error('截图包含太多段文字，请裁剪到最多 20 条说法后重试。')
  if (!text || !candidates.length)
    return {
      status: 'no_text',
      text: '',
      claims: [],
      recognition_confidence: null,
      quality: 'no_text',
      warnings: [],
      source,
    }
  const confidence = score(data.confidence)
  const low =
    confidence === null ||
    confidence < 60 ||
    candidates.some((line) => line.confidence === null || line.confidence < 40)
  const small = lines.some((line) => line.bbox.y1 - line.bbox.y0 <= 16)
  return {
    status: 'review_required',
    text,
    claims: candidates.map((line, index) => ({
      id: `screenshot-${index + 1}`,
      text: line.text,
      recognition_confidence: line.confidence,
    })),
    recognition_confidence: confidence,
    quality: low ? 'low_confidence' : 'usable',
    warnings: [
      ...(low ? ['low_confidence' as const] : []),
      ...(small ? ['small_text' as const] : []),
    ],
    source,
  }
}
