import type { ReactNode } from 'react'
import { Link, useLocation } from 'react-router'
import { Badge } from '@/shared/ui'
import type { ContestSummary, FieldValue } from './api'
import { formatDate, modeNames, safeUrl, statusNames } from './format'

export function LevelBadge({ level }: { level: FieldValue['level'] }) {
  const names = { official: '官方', reposted: '仅转载', conflict: '冲突', not_found: '未找到' }
  const colors = {
    official: 'text-level-official',
    reposted: 'text-level-reposted',
    conflict: 'text-level-conflict',
    not_found: 'text-level-not-found',
  }
  return (
    <Badge variant="outline" className={colors[level]}>
      {names[level]}
    </Badge>
  )
}
export function ContestCard({ contest, action }: { contest: ContestSummary; action?: ReactNode }) {
  const location = useLocation()
  const start = contest.fields.start_at
  const cover = safeUrl(contest.cover_url)
  return (
    <article className="flex min-w-0 items-start gap-4 rounded-2xl border border-rule bg-surface p-4">
      {cover && (
        <img
          src={cover}
          alt=""
          loading="lazy"
          className="h-24 w-24 shrink-0 rounded-xl object-cover"
        />
      )}
      <div className="min-w-0 flex-1 space-y-2">
        <h3 className="break-words text-base font-semibold text-ink">
          <Link
            className="hover:underline focus-visible:outline-2 focus-visible:outline-ink"
            to={`/contests/${contest.id}${location.search}`}
          >
            {contest.name}
          </Link>
        </h3>
        <p className="text-xs text-muted">
          {statusNames[contest.status]} ·{' '}
          {modeNames[contest.fields.mode?.value ?? ''] ?? '形式未找到'}
          {contest.fields.city?.value ? ` · ${contest.fields.city.value}` : ''}
        </p>
        <p className="text-sm">
          {formatDate(start?.value)} {start && <LevelBadge level={start.level} />}
        </p>
        {action}
      </div>
    </article>
  )
}
