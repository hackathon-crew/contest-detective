import { useEffect } from 'react'

export interface ContestDetailProps {
  /** 地址里的赛事标识，详情按它向后端取这一场的全部字段和出处。 */
  contestId: string
  onClose: () => void
}

/** 赛事详情弹窗：每个关键字段的取值、核实等级和出处。 */
export function ContestDetail({ onClose }: ContestDetailProps) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-20 grid place-items-center bg-scrim p-4" onClick={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="contest-detail-title"
        className="w-full max-w-2xl rounded-2xl bg-surface p-6"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-center justify-between gap-4">
          <h2 id="contest-detail-title" className="text-lg font-semibold text-ink">
            赛事详情
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="h-9 rounded-xl px-3 text-sm text-muted hover:bg-surface-strong"
          >
            关闭
          </button>
        </header>
      </section>
    </div>
  )
}
