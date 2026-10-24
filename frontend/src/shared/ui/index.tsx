import { useId, useRef, type ReactNode } from 'react'
import { cn } from 'cn'
import { Button } from './button'
import {
  Dialog as DialogRoot,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from './dialog'
export { Button } from './button'
export { Input } from './input'
export * from './select'
export { Badge } from './badge'
export { Skeleton } from './skeleton'
export { Calendar } from './calendar'
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

export function Dialog({
  title,
  onClose,
  children,
  description,
  icon,
  className,
  footer,
}: {
  title: string
  onClose: () => void
  children: ReactNode
  description?: string
  icon?: ReactNode
  className?: string
  footer?: ReactNode
}) {
  const descriptionId = useId()
  const titleRef = useRef<HTMLHeadingElement>(null)
  return (
    <DialogRoot
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent
        aria-describedby={description ? descriptionId : undefined}
        className={cn('max-h-5/6 p-6 sm:p-8', className)}
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          titleRef.current?.focus({ preventScroll: true })
        }}
      >
        <DialogHeader className="shrink-0 pr-8">
          {icon ? (
            <div className="flex items-center gap-3">
              <span
                aria-hidden="true"
                className="flex size-8 shrink-0 items-center justify-center text-ink"
              >
                {icon}
              </span>
              <DialogTitle ref={titleRef} tabIndex={-1} className="outline-none">
                {title}
              </DialogTitle>
            </div>
          ) : (
            <DialogTitle ref={titleRef} tabIndex={-1} className="outline-none">
              {title}
            </DialogTitle>
          )}
          {description && <DialogDescription id={descriptionId}>{description}</DialogDescription>}
        </DialogHeader>
        {/* 外扩的焦点圈最多占 4px；负外边距让字段仍与标题、页脚对齐。 */}
        <div className="-m-1 min-h-0 overflow-y-auto p-1">{children}</div>
        {footer && <div className="shrink-0 border-t border-rule pt-4">{footer}</div>}
      </DialogContent>
    </DialogRoot>
  )
}
