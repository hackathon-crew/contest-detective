import type { ReactNode } from 'react'
import { Link, NavLink } from 'react-router'
import { MessageCircle } from 'lucide-react'

export function SiteHeader({ actions, utilities }: { actions?: ReactNode; utilities?: ReactNode }) {
  return (
    <header className="border-b border-rule bg-surface">
      <div className="mx-auto flex min-h-14 max-w-7xl flex-wrap items-center justify-between gap-2 px-6 py-2 sm:px-8">
        <Link to="/" className="text-base font-semibold text-ink">
          比赛侦探
        </Link>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <NavLink
            to="/detective"
            className={({ isActive }) =>
              `inline-flex min-h-10 items-center gap-1.5 rounded-xl px-2.5 text-sm font-medium text-ink transition-colors duration-140 hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2 ${isActive ? 'bg-surface-muted' : ''}`
            }
          >
            <MessageCircle aria-hidden="true" size={16} strokeWidth={1.5} />
            侦探
          </NavLink>
          {actions}
          {utilities}
        </div>
      </div>
    </header>
  )
}
