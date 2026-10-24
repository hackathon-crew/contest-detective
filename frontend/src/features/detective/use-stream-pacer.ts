import { useEffect, useLayoutEffect, useRef, useState } from 'react'

function useReducedMotion() {
  const [reduced, setReduced] = useState(
    () =>
      typeof window.matchMedia !== 'function' ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  )
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReduced(query.matches)
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  return reduced
}

const BATCH_MS = 48,
  LIGHT_MS = 1100
export type StreamReveal = { revealedAt: readonly number[]; now: number }
type Paced = StreamReveal & { visible: string }

/** Display-only pacing. The caller retains the complete, authoritative network answer. */
export function useStreamPacer(answer: string, streaming: boolean): Paced {
  const reduced = useReducedMotion()
  const [view, setView] = useState<Paced>(() => ({
    visible: streaming && !reduced ? '' : answer,
    revealedAt: [],
    now: performance.now(),
  }))
  const current = useRef({
    answer,
    streaming,
    reduced,
    visible: view.visible,
    revealedAt: [] as number[],
    lastReveal: 0,
    animated: streaming && !reduced,
  })
  const wake = useRef<() => void>(() => {})
  useLayoutEffect(() => {
    const s = current.current
    const replaces = !answer.startsWith(s.answer)
    s.answer = answer
    s.streaming = streaming
    s.reduced = reduced
    if (reduced || replaces || (!s.animated && !streaming)) {
      const changed = s.visible !== answer || s.revealedAt.length > 0
      s.visible = answer
      s.revealedAt = []
      s.animated = streaming && !reduced
      if (changed) setView({ visible: answer, revealedAt: [], now: performance.now() })
    } else if (streaming) s.animated = true
    wake.current()
  }, [answer, streaming, reduced])
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    let disposed = false
    let due = 0
    const schedule = (delay = BATCH_MS) => {
      if (!disposed && timer === undefined) {
        due = performance.now() + delay
        timer = setTimeout(tick, delay)
      }
    }
    function tick() {
      timer = undefined
      const s = current.current
      if (disposed || s.reduced) return
      const now = performance.now(),
        backlog = s.answer.length - s.visible.length
      if (backlog > 0) {
        const count = Math.max(1, Math.ceil((Math.min(420, 36 + backlog * 2.4) * BATCH_MS) / 1000))
        const start = s.visible.length
        let end = Math.min(s.answer.length, start + count)
        // Source offsets are UTF-16, but never expose half of a surrogate pair.
        if (end < s.answer.length && /[\uDC00-\uDFFF]/.test(s.answer[end])) end++
        const chars = Array.from(s.answer.slice(start, end))
        let offset = start
        chars.forEach((char, k) => {
          const t = now - BATCH_MS + (k * BATCH_MS) / chars.length
          for (let i = 0; i < char.length; i++) s.revealedAt[offset++] = t
        })
        s.visible = s.answer.slice(0, end)
        s.lastReveal = now
        setView({ visible: s.visible, revealedAt: s.revealedAt.slice(), now })
      }
      if (s.visible.length < s.answer.length) schedule()
      else if (!s.streaming && s.revealedAt.length) {
        const remaining = LIGHT_MS - (now - s.lastReveal)
        if (remaining > 0) schedule(remaining)
        else {
          s.revealedAt = []
          s.animated = false
          setView({ visible: s.visible, revealedAt: [], now })
        }
      }
    }
    wake.current = () => {
      const s = current.current
      if (
        timer !== undefined &&
        (s.reduced || (s.visible.length < s.answer.length && due > performance.now() + BATCH_MS))
      ) {
        clearTimeout(timer)
        timer = undefined
      }
      if (
        !s.reduced &&
        (s.visible.length < s.answer.length || (!s.streaming && s.revealedAt.length))
      )
        schedule()
    }
    wake.current()
    return () => {
      disposed = true
      wake.current = () => {}
      clearTimeout(timer)
    }
  }, [])
  // Markdown 重排也会触发重绘；字的年龄必须按本次重绘计时，不能退回上一批文字的时钟。
  // oxlint-disable-next-line react/purity
  const now = performance.now()
  return reduced ? { visible: answer, revealedAt: [], now } : { ...view, now }
}
