import { useState } from 'react'
import { Link } from 'react-router'
import { Check, FileText } from 'lucide-react'
import {
  ContestCover,
  Level,
  deadlineDays,
  displayDeadline,
  fieldNames,
  formatDate,
  modeNames,
  prizeText,
  safeUrl,
} from '@/entities/contest'
import { Dialog } from '@/shared/ui'
import type { ContestRecommendation, ProfileFile } from './conversation'
import './detective-results.css'

/* 推荐卡：照首页 mock 侦探回答里的 .picks，一组行共用一个描边容器，行间一条细线；
   左边 4:3 小封面，中间名称、主办方·形式·奖金、简介和带勾的建议，右边是截止日期一列。
   整行点开比赛详情，日期本身链到出处。 */
export function RecommendationCards({ items }: { items: ContestRecommendation[] }) {
  if (!items.length) return null
  return (
    <section
      aria-label="推荐比赛"
      className="min-w-0 overflow-hidden rounded-2xl border border-rule bg-surface font-sans duration-240 ease-out animate-in fade-in-0 slide-in-from-bottom-2"
    >
      {items.map(({ contest, introduction, reason }) => {
        const deadline = displayDeadline(contest)
        const fields = contest.fields
        const mode = fields.mode?.value
        const meta = [
          fields.organizer?.value,
          modeNames[mode ?? ''],
          mode === 'online' ? null : fields.city?.value,
        ].filter(Boolean)
        const prize = prizeText(contest)
        const source = deadline?.info.sources?.find((item) => !item.stale && safeUrl(item.url))
        const date = deadline
          ? formatDate(deadline.info.value, deadline.info.precision).split('（')[0]
          : null
        const note = deadline?.info.precision === 'day' ? '时刻未核实' : undefined
        const left = deadline ? deadlineDays(deadline) : null
        const intro = introduction || contest.summary
        return (
          <article
            key={contest.id}
            aria-label={contest.name}
            className="relative grid min-w-0 grid-cols-[64px_minmax(0,1fr)] gap-x-3 gap-y-1 border-t border-rule px-3 py-3 transition-colors duration-140 first:border-t-0 focus-within:bg-surface-muted hover:bg-surface-muted sm:grid-cols-[88px_minmax(0,1fr)_auto] sm:items-center sm:gap-x-4 sm:px-4"
          >
            <ContestCover
              contest={contest}
              className="detective-recommendation-cover row-span-2 aspect-[4/3] w-16 self-start rounded-lg bg-surface-strong object-cover sm:row-span-1 sm:self-center"
            />
            <div className="min-w-0 space-y-0.5">
              <h3 className="detective-recommendation-title truncate leading-normal font-semibold text-ink">
                <Link
                  to={`/contests/${encodeURIComponent(contest.id)}`}
                  className="outline-none after:absolute after:inset-0 after:content-['']"
                >
                  {contest.name}
                </Link>
              </h3>
              <p className="detective-recommendation-text truncate text-muted">
                {meta.join(' · ')}
                {prize && (
                  <>
                    {meta.length ? ' · ' : ''}
                    <span className="text-ink-soft">{prize}</span>
                  </>
                )}
              </p>
              {intro && (
                <p
                  className="detective-recommendation-text line-clamp-1 text-ink-soft"
                  title={intro}
                >
                  {intro}
                </p>
              )}
              {reason && (
                <p
                  className="detective-recommendation-text flex min-w-0 items-start gap-1 text-ink-soft"
                  title={reason}
                >
                  <Check
                    aria-hidden="true"
                    className="mt-[3px] size-3.5 shrink-0 text-accent"
                    strokeWidth={2.25}
                  />
                  <span className="line-clamp-1">{reason}</span>
                </p>
              )}
            </div>
            <div className="col-start-2 flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5 sm:col-start-3 sm:row-start-1 sm:flex-col sm:items-end sm:text-right">
              {date && source ? (
                <a
                  href={source.url}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={note ? `${date}（${note}）` : undefined}
                  title={note ? `${date}（${note}）` : undefined}
                  className="detective-recommendation-title relative z-10 font-semibold whitespace-nowrap text-ink tabular-nums decoration-rule-strong underline-offset-4 hover:underline"
                >
                  {date}
                </a>
              ) : (
                <span className="detective-recommendation-title font-semibold whitespace-nowrap text-ink tabular-nums">
                  {date ?? '日期未公布'}
                </span>
              )}
              {deadline && (
                <span className="text-xs text-muted">
                  {deadline.field === 'submission_deadline'
                    ? '提交截止'
                    : fieldNames[deadline.field]}
                </span>
              )}
              {deadline && (
                <span className="flex items-center gap-2 text-xs">
                  <Level level={deadline.info.level} />
                  {left !== null && (
                    <span
                      className={
                        left >= 0 && left <= 2 ? 'font-medium text-danger' : 'text-ink-soft'
                      }
                    >
                      {left < 0 ? '已截止' : left === 0 ? '今天截止' : `还有 ${left} 天`}
                    </span>
                  )}
                </span>
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
