import { useRef } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { useContestCollection } from '@/entities/contest'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/shared/ui/dialog'
import { McpIntro } from './home-content'
import { McpPanel } from './mcp-panel'
import './home-page.css'

/** #mcp 同时保留原有接入链接，以及打开弹窗前的页面和筛选条件。 */
export function McpDialog() {
  const location = useLocation()
  const navigate = useNavigate()
  const open = location.hash === '#mcp'
  const title = useRef<HTMLHeadingElement>(null)
  const trigger = useRef<HTMLElement | null>(null)
  const collection = useContestCollection(open)

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value)
          void navigate(
            { pathname: location.pathname, search: location.search, hash: '' },
            { replace: true, state: location.state },
          )
      }}
    >
      <DialogContent
        aria-describedby={undefined}
        className="max-h-5/6 w-11/12 max-w-6xl gap-6 p-6 sm:max-w-6xl sm:p-8"
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          trigger.current = document.activeElement as HTMLElement | null
          title.current?.focus({ preventScroll: true })
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          trigger.current?.focus({ preventScroll: true })
        }}
      >
        <DialogHeader className="shrink-0 pr-8">
          <DialogTitle ref={title} tabIndex={-1} className="outline-none">
            接入 MCP
          </DialogTitle>
        </DialogHeader>
        <div className="inkpaw-home mcp-dialog-body">
          <div className="feature-grid mcp-dialog-grid">
            <McpIntro />
            <McpPanel contests={collection.data?.items} />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
