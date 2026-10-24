import type { ReactNode } from 'react'
import { Button } from './button'
import { Dialog as DialogRoot, DialogContent, DialogHeader, DialogTitle } from './dialog'
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
  open = true,
  title,
  onClose,
  children,
}: {
  open?: boolean
  title: string
  onClose: () => void
  children: ReactNode
}) {
  return (
    <DialogRoot
      open={open}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent aria-describedby={undefined} className="max-h-5/6 p-6 sm:p-8">
        <DialogHeader className="shrink-0 pr-8">
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="min-h-0 overflow-y-auto">{children}</div>
      </DialogContent>
    </DialogRoot>
  )
}
