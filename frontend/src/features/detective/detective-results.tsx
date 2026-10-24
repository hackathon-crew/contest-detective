import { useState } from 'react'
import { Link } from 'react-router'
import { ArrowUpRight, FileText } from 'lucide-react'
import {
  ContestCover,
  LevelBadge,
  displayDeadline,
  fieldNames,
  formatDate,
  modeNames,
  safeUrl,
  type FieldValue,
} from '@/entities/contest'
import { Button, Dialog } from '@/shared/ui'
import type { ContestRecommendation, ProfileFile } from './conversation'

function Fact({
  label,
  field,
  text,
  note,
}: {
  label: string
  field?: FieldValue
  text?: string
  note?: string
}) {
  const source = field?.sources?.find((item) => !item.stale && safeUrl(item.url))
  const value = text ?? field?.value
  return (
    <div className="grid min-w-0 gap-1">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="m-0 min-w-0 break-words text-sm text-ink-soft">
        {source && value ? (
          <a
            href={source.url}
            target="_blank"
            rel="noreferrer"
            aria-label={note ? `${value}（${note}）` : undefined}
            className="decoration-rule-strong underline-offset-4 hover:underline"
          >
            {value}
          </a>
        ) : (
          value || '未公布'
        )}
        {note && <span className="block text-xs text-muted">{note}</span>}
      </dd>
    </div>
  )
}

export function RecommendationCards({ items }: { items: ContestRecommendation[] }) {
  if (!items.length) return null
  return (
    <section
      aria-label="推荐比赛"
      className="grid min-w-0 grid-cols-1 gap-4 font-sans sm:grid-cols-2"
    >
      {items.map(({ contest, introduction, reason }) => {
        const deadline = displayDeadline(contest)
        const fields = contest.fields
        const mode = fields.mode?.value
        const place = [modeNames[mode ?? ''], mode === 'online' ? null : fields.city?.value]
          .filter(Boolean)
          .join(' · ')
        return (
          <article
            key={contest.id}
            aria-label={contest.name}
            className="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-rule bg-surface duration-240 ease-out animate-in fade-in-0 slide-in-from-bottom-2"
          >
            <div className="aspect-video w-full overflow-hidden border-b border-rule bg-surface-strong">
              <ContestCover
                contest={contest}
                className="block h-full w-full object-cover object-bottom"
              />
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-4 p-4">
              <div className="space-y-2">
                <h3 className="text-base leading-relaxed font-semibold text-ink text-balance">
                  {contest.name}
                </h3>
                {(introduction || contest.summary) && (
                  <p className="line-clamp-3 text-sm text-ink-soft">
                    {introduction || contest.summary}
                  </p>
                )}
              </div>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
                <Fact label="主办方" field={fields.organizer} />
                <Fact label="参赛形式" field={fields.mode} text={place || undefined} />
                <Fact
                  label={deadline ? fieldNames[deadline.field] : '截止时间'}
                  field={deadline?.info}
                  text={
                    deadline
                      ? formatDate(deadline.info.value, deadline.info.precision).split('（')[0]
                      : undefined
                  }
                  note={deadline?.info.precision === 'day' ? '时刻未核实' : undefined}
                />
                <Fact label="奖励" field={fields.prize} />
              </dl>
              {reason && <p className="text-sm text-ink-soft">{reason}</p>}
              <footer className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-rule pt-3">
                {deadline ? (
                  <span className="inline-flex items-center gap-1 text-xs text-muted">
                    日期来源 <LevelBadge level={deadline.info.level} />
                  </span>
                ) : (
                  <span className="text-xs text-muted">日期未公布</span>
                )}
                <Button asChild variant="ghost" size="sm" className="text-accent">
                  <Link to={`/contests/${encodeURIComponent(contest.id)}`}>
                    了解比赛 <ArrowUpRight aria-hidden="true" strokeWidth={1.5} />
                  </Link>
                </Button>
              </footer>
            </div>
          </article>
        )
      })}
    </section>
  )
}

export function ProfileFileAttachment({ file }: { file: ProfileFile }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex max-w-full min-w-0 items-center gap-3 rounded-2xl border border-rule bg-surface px-4 py-3 text-left font-sans transition-colors duration-140 hover:bg-surface-muted active:bg-surface-strong focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
      >
        <FileText aria-hidden="true" className="size-5 shrink-0 text-muted" strokeWidth={1.5} />
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium text-ink">{file.name}</span>
          <span className="block text-xs text-muted">
            参赛画像 · {file.candidates.length} 场候选比赛
          </span>
        </span>
      </button>
      <Dialog open={open} title={file.name} onClose={() => setOpen(false)}>
        <pre className="overflow-x-auto rounded-xl bg-surface-muted p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words text-ink-soft">
          {JSON.stringify({ profile: file.profile, candidates: file.candidates }, null, 2)}
        </pre>
      </Dialog>
    </>
  )
}
