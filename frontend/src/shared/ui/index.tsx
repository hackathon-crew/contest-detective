import {
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react'

const control =
  'h-10 rounded-xl border border-rule px-3 text-sm transition-colors duration-140 hover:border-rule-strong focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-40'

export function Button({
  className = '',
  variant = 'secondary',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' }) {
  return (
    <button
      type="button"
      className={`${control} active:scale-95 ${variant === 'primary' ? 'bg-accent text-on-accent hover:bg-accent-hover' : 'bg-surface text-ink'} ${className}`}
      {...props}
    />
  )
}
export function Input({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`${control} min-w-0 bg-surface text-ink placeholder:text-faint ${className}`}
      {...props}
    />
  )
}
export function Select({ className = '', ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={`${control} min-w-0 bg-surface text-ink ${className}`} {...props} />
}
export function Badge({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <span className={`rounded-lg text-xs ${className || 'text-muted'}`}>{children}</span>
}
export function EmptyState({
  children = '没有找到赛事，换个条件再试试。',
}: {
  children?: ReactNode
}) {
  return (
    <p role="status" className="py-8 text-sm text-muted">
      {children}
    </p>
  )
}
export function ErrorState({ error, retry }: { error: unknown; retry?: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-3 py-6 text-sm text-muted">
      <p>{error instanceof Error ? error.message : '加载失败，请重试。'}</p>
      {retry && <Button onClick={retry}>重试</Button>}
    </div>
  )
}
export function Skeleton() {
  return (
    <div
      role="status"
      aria-label="加载中"
      className="h-24 animate-pulse rounded-2xl bg-surface-strong motion-reduce:animate-none"
    />
  )
}
export function Dialog({
  title,
  onClose,
  children,
}: {
  title: string
  onClose: () => void
  children: ReactNode
}) {
  const titleId = useId()
  const panel = useRef<HTMLElement>(null)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    panel.current?.focus()
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
      if (event.key !== 'Tab') return
      const items = Array.from(
        panel.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), [tabindex="0"]',
        ) ?? [],
      )
      const first = items[0],
        last = items.at(-1)
      if (!first) {
        event.preventDefault()
        return
      }
      if (
        event.shiftKey &&
        (document.activeElement === first || document.activeElement === panel.current)
      ) {
        event.preventDefault()
        last?.focus()
      } else if (
        !event.shiftKey &&
        (document.activeElement === last || document.activeElement === panel.current)
      ) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', keydown)
    return () => {
      document.removeEventListener('keydown', keydown)
      document.body.style.overflow = overflow
      previous?.focus()
    }
  }, [onClose])
  return (
    <div
      className="transition-opacity duration-240 ease-out starting:opacity-0 fixed inset-0 z-30 grid place-items-center bg-scrim p-6"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="transition duration-240 ease-out starting:opacity-0 starting:translate-y-4 starting:scale-95 motion-reduce:transform-none max-h-full w-full max-w-3xl overflow-y-auto rounded-3xl bg-surface p-6 shadow-xl outline-none sm:p-8"
      >
        <header className="mb-6 flex items-start justify-between gap-4">
          <h2 id={titleId} className="min-w-0 break-words text-2xl font-bold text-ink">
            {title}
          </h2>
          <Button onClick={onClose}>关闭</Button>
        </header>
        {children}
      </section>
    </div>
  )
}
