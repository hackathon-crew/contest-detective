import { useRef, type ReactNode } from 'react'
import { Dialog, DialogClose, DialogContent } from '@huyanxius/ui'
import { Ic } from './components'
import { useLocale } from '@/shared/i18n/locale-context'

export function AccountModal({
  open,
  close,
  children,
}: {
  open: boolean
  close: () => void
  children: ReactNode
}) {
  const { t } = useLocale()
  const trigger = useRef<HTMLElement | null>(null)

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) close()
      }}
    >
      <DialogContent
        container={document.querySelector<HTMLElement>('.account-root')}
        className="dlg p-0 ring-0"
        aria-describedby={undefined}
        onOpenAutoFocus={() => {
          trigger.current = document.activeElement as HTMLElement | null
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          trigger.current?.focus()
        }}
      >
        <DialogClose asChild>
          <button className="dlg-x" type="button" aria-label={t('关闭')}>
            <Ic name="x" large />
          </button>
        </DialogClose>
        {children}
      </DialogContent>
    </Dialog>
  )
}
