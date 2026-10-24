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
  secondary = false,
  verification = false,
}: {
  label: string
  field?: FieldValue
  text?: string
  note?: string
  secondary?: boolean
  verification?: boolean
}) {
  const source = field?.sources?.find((item) => !item.stale && safeUrl(item.url))
  const value = text ?? field?.value
  return (
    <div className="inline-flex min-w-0 flex-wrap items-baseline gap-1">
      <dt className={secondary ? 'sr-only' : 'text-xs text-muted'}>{label}</dt>
      <dd
        className={
          secondary
            ? 'm-0 min-w-0 break-words text-xs text-muted'
            : 'm-0 inline-flex min-w-0 items-center gap-1.5 break-words text-sm font-medium text-ink'
        }
      >
        {source && value ? (
          <a
            href={source.url}
            target="_blank"
            rel="noreferrer"
            aria-label={note ? `${value}（${note}）` : undefined}
            title={note ? `${label}：${value}（${note}）` : undefined}
            className="decoration-rule-strong underline-offset-4 hover:underline"
          >
            {value}
          </a>
        ) : (
          value || '未公布'
        )}
        {verification && field && <LevelBadge level={field.level} />}
      </dd>
    </div>
  )
}

export function RecommendationCards({ items }: { items: ContestRecommendation[] }) {
  if (!items.length) return null
  return (
    <section aria-label="推荐比赛" className="grid min-w-0 grid-cols-1 gap-3 font-sans">
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
            className="flex min-w-0 overflow-hidden rounded-2xl border border-rule bg-surface duration-240 ease-out animate-in fade-in-0 slide-in-from-bottom-2"
          >
            <div
              aria-hidden="true"
              className="detective-recommendation__cover pointer-events-none relative w-20 shrink-0 self-stretch overflow-hidden bg-surface-muted sm:w-48"
            >
              <ContestCover
                contest={contest}
                className="absolute inset-0 h-full w-full object-cover"
              />
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-2 px-3 py-3 sm:px-4">
              <header className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
                <h3 className="min-w-0 text-base leading-normal font-semibold text-ink">
                  {contest.name}
                </h3>
                <dl className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
                  <Fact label="主办方" field={fields.organizer} secondary />
                  <Fact label="参赛形式" field={fields.mode} text={place || undefined} secondary />
                </dl>
              </header>
              {(introduction || contest.summary) && (
                <p
                  className="line-clamp-1 text-sm text-ink-soft"
                  title={introduction || contest.summary || undefined}
                >
                  {introduction || contest.summary}
                </p>
              )}
              <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <dl className="flex min-w-0 flex-wrap items-baseline gap-x-4 gap-y-1">
                  <Fact
                    label={
                      deadline?.field === 'submission_deadline'
                        ? '提交截止'
                        : deadline
                          ? fieldNames[deadline.field]
                          : '截止时间'
                    }
                    field={deadline?.info}
                    text={
                      deadline
                        ? formatDate(deadline.info.value, deadline.info.precision).split('（')[0]
                        : undefined
                    }
                    note={deadline?.info.precision === 'day' ? '时刻未核实' : undefined}
                    verification
                  />
                  <Fact label="奖励" field={fields.prize} />
                </dl>
                <Button asChild variant="ghost" size="sm" className="ml-auto text-accent">
                  <Link to={`/contests/${encodeURIComponent(contest.id)}`}>
                    了解比赛 <ArrowUpRight aria-hidden="true" strokeWidth={1.5} />
                  </Link>
                </Button>
              </div>
              {reason && (
                <p className="line-clamp-1 min-w-0 text-xs text-muted" title={reason}>
                  <span className="text-ink-soft">建议：</span>
                  {reason}
                </p>
              )}
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
