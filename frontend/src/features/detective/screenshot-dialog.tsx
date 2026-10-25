import { useEffect, useRef, useState } from 'react'
import { ImagePlus } from 'lucide-react'
import { Button, Dialog } from '@/shared/ui'
import type {
  ScreenshotConfirmation,
  ScreenshotExtraction,
  ScreenshotRecognizer,
} from './screenshot-contracts'
import { MAX_SCREENSHOT_TEXT } from './screenshot-image'
import { recognizeScreenshot } from './screenshot-recognizer'

export function ScreenshotDialog({
  onClose,
  onConfirm,
  recognizer = recognizeScreenshot,
}: {
  onClose: () => void
  onConfirm: (value: ScreenshotConfirmation) => void
  recognizer?: ScreenshotRecognizer
}) {
  const input = useRef<HTMLInputElement>(null)
  const request = useRef<AbortController | null>(null)
  const epoch = useRef(0)
  const previewUrl = useRef<string | null>(null)
  const submitting = useRef(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<ScreenshotExtraction | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [claims, setClaims] = useState<{ id: string; text: string; selected: boolean }[]>([])
  const [mode, setMode] = useState<'realtime' | 'deep'>('realtime')
  useEffect(
    () => () => {
      epoch.current++
      request.current?.abort()
      if (previewUrl.current) URL.revokeObjectURL(previewUrl.current)
    },
    [],
  )

  async function choose(file: File) {
    const current = ++epoch.current
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current)
    previewUrl.current = null
    setPreview(null)
    setResult(null)
    setClaims([])
    setError('')
    setPending(true)
    try {
      const extracted = await recognizer(file, { signal: controller.signal })
      if (current !== epoch.current || controller.signal.aborted) return
      // The recognizer has validated dimensions before this preview can decode pixels.
      previewUrl.current = URL.createObjectURL(file)
      setPreview(previewUrl.current)
      setResult(extracted)
      setClaims(extracted.claims.map((claim) => ({ ...claim, selected: false })))
    } catch (failure) {
      if (current === epoch.current && !controller.signal.aborted)
        setError(failure instanceof Error ? failure.message : '图片识别失败，请重试。')
    } finally {
      if (current === epoch.current) setPending(false)
    }
  }
  function close() {
    epoch.current++
    request.current?.abort()
    onClose()
  }
  const selected = claims.filter((claim) => claim.selected)
  function confirm() {
    if (
      submitting.current ||
      pending ||
      !selected.length ||
      selected.some((claim) => !claim.text.trim())
    )
      return
    const confirmed = selected.map((claim) => ({
      id: claim.id,
      text: claim.text.trim(),
      origin: 'screenshot' as const,
    }))
    const question = confirmed.map((claim) => claim.text).join('\n')
    if (question.length > MAX_SCREENSHOT_TEXT) {
      setError('所选文字超过 8000 字符，请精简或减少勾选。')
      return
    }
    submitting.current = true
    try {
      onConfirm({ question, mode, confirmed_claims: confirmed })
      close()
    } catch (failure) {
      submitting.current = false
      setError(failure instanceof Error ? failure.message : '无法开始查证，请重试。')
    }
  }

  return (
    <Dialog
      title="截图查证"
      onClose={close}
      icon={<ImagePlus strokeWidth={1.5} />}
      description="图片只在当前浏览器识别，不上传。确认后，仅所选文字会用于联网查证公开赛事信息。"
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="ghost" onClick={close}>
            取消
          </Button>
          <Button
            type="button"
            disabled={pending || !selected.length || selected.some((claim) => !claim.text.trim())}
            onClick={confirm}
          >
            确认文字并查证
          </Button>
        </div>
      }
    >
      <div className="grid gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={input}
            type="file"
            className="sr-only"
            aria-label="选择截图"
            accept="image/png,image/jpeg,image/webp"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0]
              event.currentTarget.value = ''
              if (file) void choose(file)
            }}
          />
          <Button type="button" variant="outline" onClick={() => input.current?.click()}>
            {pending ? '换一张截图' : result ? '重新选择截图' : '选择截图'}
          </Button>
          <p className="text-sm text-muted">PNG、JPEG 或 WebP，最多 8 MiB。暂不支持视频。</p>
        </div>
        {pending && (
          <p role="status" className="text-sm text-muted">
            正在当前浏览器识别中英文印刷文字，首次加载可能需要片刻…
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        {preview && (
          <img
            src={preview}
            alt="待查证的截图预览"
            className="max-h-40 max-w-full rounded-xl object-contain"
          />
        )}
        {result?.status === 'no_text' && (
          <p role="status" className="text-sm text-muted">
            没有识别到可查证的文字。请换一张清晰截图，或关闭后直接输入说法。
          </p>
        )}
        {!!claims.length && (
          <>
            <p className="text-sm text-ink-soft">
              识别文字可能有误，分数不代表真假。请核对、修改并勾选要查证的说法；不要提交时政或涉及个人的消息。
            </p>
            {result?.warnings.includes('low_confidence') && (
              <p role="status" className="text-sm text-muted">
                部分文字辨识度较低，建议换一张清晰截图；若继续，请逐字核对。
              </p>
            )}
            {result?.warnings.includes('small_text') && (
              <p role="status" className="text-sm text-muted">
                截图中的文字较小，请重点核对日期、数字和名称。
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() =>
                  setClaims((items) => items.map((item) => ({ ...item, selected: true })))
                }
              >
                全选
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() =>
                  setClaims((items) => items.map((item) => ({ ...item, selected: false })))
                }
              >
                取消全选
              </Button>
            </div>
            {claims.map((claim, index) => (
              <div key={claim.id} className="grid gap-2 rounded-2xl border border-rule p-3">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={claim.selected}
                    onChange={(event) =>
                      setClaims((items) =>
                        items.map((item) =>
                          item.id === claim.id ? { ...item, selected: event.target.checked } : item,
                        ),
                      )
                    }
                  />
                  查证这条说法 {index + 1}
                </label>
                <textarea
                  aria-label={`说法 ${index + 1}`}
                  value={claim.text}
                  rows={2}
                  maxLength={MAX_SCREENSHOT_TEXT}
                  className="w-full resize-y rounded-xl border border-rule bg-surface px-3 py-2 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-ink"
                  onChange={(event) =>
                    setClaims((items) =>
                      items.map((item) =>
                        item.id === claim.id ? { ...item, text: event.target.value } : item,
                      ),
                    )
                  }
                />
              </div>
            ))}
            <label className="grid gap-2 text-sm">
              查证方式
              <select
                aria-label="截图查证方式"
                value={mode}
                onChange={(event) => setMode(event.target.value as 'realtime' | 'deep')}
                className="rounded-xl border border-rule bg-surface px-3 py-2 text-ink"
              >
                <option value="realtime">实时查证</option>
                <option value="deep">深度调查</option>
              </select>
            </label>
          </>
        )}
      </div>
    </Dialog>
  )
}
