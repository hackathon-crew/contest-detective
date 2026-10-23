import type { ReactNode } from 'react'
import { Link, useLocation } from 'react-router'
import { Badge } from '@/shared/ui'
import type { ContestSummary, FieldValue } from './api'
import { fieldNames, formatDate, modeNames, safeUrl, statusNames } from './format'
import { cardDate } from './card-date'

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
  const date = cardDate(contest)
  const cover = safeUrl(contest.cover_url)
  return (
    <article className="flex min-w-0 items-start gap-4 rounded-2xl border border-rule bg-surface p-4">
      {cover && (
        <img
          src={cover}
          alt=""
          loading="lazy"
          className="h-20 w-20 shrink-0 rounded-xl object-cover sm:h-24 sm:w-24"
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
          {date ? (
            <>
              {fieldNames[date.field]} {formatDate(date.info.value)}{' '}
              <LevelBadge level={date.info.level} />
            </>
          ) : (
            '时间未找到'
          )}
        </p>
        {action}
      </div>
    </article>
  )
}
