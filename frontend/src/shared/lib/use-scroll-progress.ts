import { useEffect, type RefObject } from 'react'

/** 封面墙按入场位置立起，演示窗口在视口中心转正。 */
export function useScrollProgress(ref: RefObject<HTMLElement | null>, kind: 'wall' | 'window') {
  useEffect(() => {
    const element = ref.current!
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    let frame = 0
    function update() {
      frame = 0
      const rect = element.getBoundingClientRect()
      const height = window.innerHeight
      const progress = reduced
        ? 1
        : kind === 'wall'
          ? Math.min(1, Math.max(0, (height - rect.top) / (height * 0.7)))
          : Math.min(
              1,
              (1 -
                Math.min(
                  1,
                  Math.abs(rect.top + rect.height / 2 - height * 0.5) / (height * 0.55),
                )) *
                1.4,
            )
      element.style.setProperty('--progress', String(progress))
    }
    function schedule() {
      if (!frame) frame = requestAnimationFrame(update)
    }
    update()
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
    }
  }, [kind, ref])
}
