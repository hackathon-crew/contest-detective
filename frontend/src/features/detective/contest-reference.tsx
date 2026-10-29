import { useState } from 'react'
import { X } from 'lucide-react'
import { Link } from 'react-router'
import { safeUrl } from '@/entities/contest'

export interface ContestReferenceValue {
  id: string
  name: string
  cover_url?: string | null
}

/** 这里只标识正在谈论的比赛；日期等事实仍在比赛详情中查看。 */
export function ContestReference({
  contest,
  onRemove,
  showCover = true,
}: {
  contest: ContestReferenceValue
  onRemove?: () => void
  showCover?: boolean
}) {
  const [failedCover, setFailedCover] = useState<string | null>(null)
  const cover = showCover ? safeUrl(contest.cover_url) : null
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-2xl bg-surface-muted p-3 text-ink">
      <Link
        to={`/contests/${encodeURIComponent(contest.id)}`}
        className="flex min-h-9 min-w-0 flex-1 items-center gap-3 rounded-xl outline-offset-4 transition-opacity duration-140 hover:opacity-75 focus-visible:outline-2 focus-visible:outline-accent"
        aria-label={`查看比赛：${contest.name}`}
      >
        {cover && cover !== failedCover && (
          <img
            src={cover}
            alt=""
            className="size-12 shrink-0 rounded-lg object-cover"
            onError={() => setFailedCover(cover)}
          />
        )}
        <span className="line-clamp-2 min-w-0 text-sm font-medium" title={contest.name}>
          {contest.name}
        </span>
      </Link>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label="移除比赛引用"
          className="grid size-9 shrink-0 cursor-pointer place-items-center rounded-xl text-muted transition-colors duration-140 hover:bg-surface-strong hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"
        >
          <X className="size-4" strokeWidth={1.5} aria-hidden="true" />
        </button>
      )}
    </div>
  )
}
