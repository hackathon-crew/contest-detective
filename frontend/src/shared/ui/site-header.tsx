import type { ReactNode } from 'react'
import { Link, NavLink } from 'react-router'
import { MessageCircle } from 'lucide-react'
import inkpawMark from '@/shared/assets/inkpaw-mark-56.webp'

export function SiteHeader({ actions, utilities }: { actions?: ReactNode; utilities?: ReactNode }) {
  return (
    <header className="border-b border-rule bg-surface">
      <div className="mx-auto flex min-h-14 max-w-7xl flex-wrap items-center justify-between gap-2 px-6 py-2 sm:px-8">
        <Link
          to="/"
          className="inline-flex shrink-0 items-center gap-2 rounded-lg font-brand text-2xl font-bold text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
        >
          <img
            src={inkpawMark}
            alt=""
            width={48}
            height={42}
            className="shrink-0 [image-rendering:pixelated]"
            loading="eager"
            decoding="async"
            fetchPriority="high"
          />
          Inkpaw
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
