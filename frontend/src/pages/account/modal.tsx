import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Dialog } from 'radix-ui'
import { Ic } from './components'

export function AccountModal({
  open,
  close,
  titleId,
  children,
  narrow = false,
}: {
  open: boolean
  close: () => void
  titleId: string
  children: ReactNode
  narrow?: boolean
}) {
  const [present, setPresent] = useState(open),
    [shown, setShown] = useState(false),
    lastFocus = useRef<HTMLElement | null>(null)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined,
      a = 0,
      b = 0
    if (open) {
      lastFocus.current = document.activeElement as HTMLElement
      setPresent(true)
      a = requestAnimationFrame(() => {
        b = requestAnimationFrame(() => setShown(true))
      })
    } else {
      setShown(false)
      timer = setTimeout(
        () => {
          setPresent(false)
          lastFocus.current?.focus()
        },
        window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 0 : 240,
      )
    }
    return () => {
      clearTimeout(timer)
      cancelAnimationFrame(a)
      cancelAnimationFrame(b)
    }
  }, [open])
  if (!present) return null
  return (
    <Dialog.Root
      open={present}
      onOpenChange={(v) => {
        if (!v) close()
      }}
    >
      <Dialog.Portal container={document.querySelector('.account-root') as HTMLElement | undefined}>
        <div className={'modal' + (shown ? ' open' : '')}>
          <Dialog.Overlay className="scrim" onClick={close} />
          <Dialog.Content
            className={'dlg' + (narrow ? ' dlg-narrow' : '')}
            aria-labelledby={titleId}
            aria-describedby={undefined}
            onPointerDownOutside={close}
          >
            <button className="dlg-x" type="button" onClick={close} aria-label="关闭">
              <Ic name="x" large />
            </button>
            {children}
          </Dialog.Content>
        </div>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
