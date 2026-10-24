import { useMemo, useRef, type ReactNode } from 'react'
import { AlertCircle, ArrowUpRight, CalendarDays, MapPin, Sparkles } from 'lucide-react'
import {
  ContestCover,
  dateFields,
  dateText,
  formatDate,
  groundedIntroduction,
  statusNames,
  useContest,
  type ContestDetail as Contest,
} from '@/entities/contest'
import { ErrorState, Skeleton } from '@/shared/ui'
import { Dialog, DialogContent, DialogTitle } from '@/shared/ui/dialog'
import { ContestIntroductionSection } from './content'
import { buildEvidenceIndex, type EvidenceIndex } from './evidence-index'
import {
  conflictValues,
  criticalUnknowns,
  detailAction,
  detailLabels,
  displayField,
  hasConflict,
  nextDetailDate,
  showField,
  supportedValue,
} from './presentation'
import { ContestSources, SourceReferences } from './sources'
import './contest-detail.css'

export interface ContestDetailProps {
  contestId: string
  open?: boolean
  onClose: () => void
  action?: ReactNode
  onAsk?: (question: string) => void
  variant?: 'default' | 'library'
}

function Fact({
  contest,
  index,
  field,
  label = detailLabels[field],
}: {
  contest: Contest
  index: EvidenceIndex
  field: string
  label?: string
}) {
  if (!showField(contest, field)) return null
  const conflict = hasConflict(contest, field)
  const alternatives = conflictValues(contest, field)
  return (
    <div className={'contest-detail-fact' + (conflict ? ' has-conflict' : '')}>
      <dt>{label}</dt>
      <dd>
        {conflict ? (
          <>
            <p className="contest-detail-conflict-label">来源说法不一，待核实</p>
            {!!alternatives.length && (
              <ul className="contest-detail-conflict-values">
                {alternatives.map(({ value, site }) => (
                  <li key={value}>
                    <span>{site}</span>
                    {value}
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <span>{displayField(field, contest.fields[field])}</span>
        )}
        <span className="contest-detail-fact-meta">
          {!conflict && contest.fields[field]?.level === 'reposted' && <span>仅见转载</span>}
          <SourceReferences index={index} refs={index.refsByField[field] ?? []} label={label} />
        </span>
      </dd>
    </div>
  )
}

function FactSection({
  title,
  fields,
  contest,
  index,
}: {
  title: string
  fields: string[]
  contest: Contest
  index: EvidenceIndex
}) {
  const visible = fields.filter((field) => showField(contest, field))
  if (!visible.length) return null
  return (
    <section className="contest-detail-section" aria-label={title}>
      <h2>{title}</h2>
      <dl className="contest-detail-facts">
        {visible.map((field) => (
          <Fact key={field} contest={contest} index={index} field={field} />
        ))}
      </dl>
    </section>
  )
}

function ReadingContent({ contest, index }: { contest: Contest; index: EvidenceIndex }) {
  const next = nextDetailDate(contest)
  const pending = criticalUnknowns(contest)
  const generic = pending.filter((item) => item.generic)
  const specific = pending.filter((item) => !item.generic)
  const conflicts = Object.keys(contest.fields).filter((field) => hasConflict(contest, field))
  const mode = supportedValue(contest, 'mode')
  const city = mode !== 'online' ? supportedValue(contest, 'city') : null
  const venue = mode !== 'online' ? supportedValue(contest, 'venue') : null
  const place = [city && !venue?.includes(city) ? city : null, venue].filter(Boolean).join(' · ')
  const modeText = mode ? displayField('mode', contest.fields.mode) : null
  const locationRefs = ['mode', ...(city ? ['city'] : []), ...(venue ? ['venue'] : [])].flatMap(
    (field) => index.refsByField[field] ?? [],
  )
  const otherFields = ['organizer', 'mode', 'city', 'venue', 'registration_url'].filter((field) =>
    hasConflict(contest, field),
  )
  const hasSummary = next || showField(contest, 'prize') || modeText || place
  return (
    <>
      <ContestIntroductionSection key={contest.id} contest={contest} index={index} />
      {!groundedIntroduction(contest) &&
        !Object.keys(contest.fields).some((field) => supportedValue(contest, field)) && (
          <p className="contest-detail-empty">目前可确认的信息较少，参赛前请先核对来源。</p>
        )}
      {hasSummary && (
        <section className="contest-detail-overview" aria-label="参赛要点">
          <div className="contest-detail-highlights">
            {next && (
              <div className="contest-detail-deadline">
                <div className="contest-detail-eyebrow">
                  <CalendarDays aria-hidden="true" />
                  {detailLabels[next.field]}
                </div>
                <p className="contest-detail-date">
                  {next.info.precision === 'day'
                    ? Number(next.info.value!.slice(0, 4)) + '年' + dateText(next.info)
                    : formatDate(next.info.value, next.info.precision, true)}
                </p>
                <div className="contest-detail-fact-meta">
                  <span>
                    {next.info.precision === 'day' ? '具体时刻未核实' : '北京时间 · UTC+8'}
                  </span>
                  {next.info.level === 'reposted' && <span>仅见转载</span>}
                  <SourceReferences
                    index={index}
                    refs={index.refsByField[next.field] ?? []}
                    label={detailLabels[next.field]}
                  />
                </div>
              </div>
            )}
            {showField(contest, 'prize') && (
              <dl className="contest-detail-reward">
                <Fact contest={contest} index={index} field="prize" />
              </dl>
            )}
          </div>
          {(modeText || place) && (
            <div className="contest-detail-location">
              <MapPin aria-hidden="true" />
              <span>{[modeText, place].filter(Boolean).join(' · ')}</span>
              <SourceReferences index={index} refs={locationRefs} label="参赛方式与地点" />
            </div>
          )}
        </section>
      )}
      {!!conflicts.length && (
        <aside className="contest-detail-notice is-conflict" aria-label="来源冲突提醒">
          <AlertCircle aria-hidden="true" />
          <p>
            {conflicts.map((field) => detailLabels[field] ?? field).join('、')}
            的来源说法不一，请先核实。
          </p>
        </aside>
      )}
      {!!pending.length && (
        <aside className="contest-detail-notice" aria-label="参赛前待确认">
          <AlertCircle aria-hidden="true" />
          <div>
            {!!generic.length && <p>{generic.map((item) => item.label).join('、')}待确认。</p>}
            {specific.map((item) => (
              <p key={item.field}>
                {item.message}。
                <SourceReferences
                  index={index}
                  refs={index.refsByField[item.field] ?? []}
                  label={item.label}
                />
              </p>
            ))}
          </div>
        </aside>
      )}
      <FactSection
        title="参赛条件"
        fields={['eligibility', 'team_size', 'entry_fee']}
        contest={contest}
        index={index}
      />
      <FactSection
        title="提交与评审"
        fields={['entry_requirements', 'judging_criteria']}
        contest={contest}
        index={index}
      />
      <FactSection
        title="详细日程"
        fields={dateFields.filter((field) => field !== next?.field)}
        contest={contest}
        index={index}
      />
      <FactSection title="其他参赛信息" fields={otherFields} contest={contest} index={index} />
      <FactSection title="往届参考" fields={['past_statistics']} contest={contest} index={index} />
      <ContestSources contest={contest} index={index} />
    </>
  )
}

export function ContestDetail({
  contestId,
  open = true,
  onClose,
  action,
  onAsk,
  variant = 'default',
}: ContestDetailProps) {
  const query = useContest(contestId, open)
  const title = useRef<HTMLHeadingElement>(null)
  const contest = query.data
  const index = useMemo(() => (contest ? buildEvidenceIndex(contest) : null), [contest])
  const primaryAction = contest ? detailAction(contest) : null
  const organizer = contest ? supportedValue(contest, 'organizer') : null
  const ask = () => {
    if (!contest || !onAsk) return
    const topics = [
      ...criticalUnknowns(contest).map((item) => item.label),
      ...Object.keys(contest.fields)
        .filter((field) => hasConflict(contest, field))
        .map((field) => detailLabels[field] ?? field),
    ]
    onAsk(
      `帮我核实一下「${contest.name}」的${[...new Set(topics)].join('、') || '关键参赛信息'}，并给出来源。`,
    )
  }
  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
      <DialogContent
        className={'contest-detail' + (variant === 'library' ? ' contest-detail--library' : '')}
        aria-describedby={undefined}
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          title.current?.focus()
        }}
      >
        <div className="contest-detail-scroll">
          <header className="contest-detail-header">
            <div className="contest-detail-heading">
              <div className="contest-detail-kicker">
                <span>赛事详情</span>
                {contest && <span>{statusNames[contest.status]}</span>}
              </div>
              <DialogTitle ref={title} tabIndex={-1}>
                {contest?.name ?? '赛事详情'}
              </DialogTitle>
              {organizer && index && (
                <p className="contest-detail-organizer">
                  {organizer}
                  {contest?.fields.organizer?.level === 'reposted' && (
                    <span className="contest-detail-inline-level">仅见转载</span>
                  )}
                  <SourceReferences
                    index={index}
                    refs={index.refsByField.organizer ?? []}
                    label="主办方"
                  />
                </p>
              )}
            </div>
            {contest?.cover_url && (
              <ContestCover contest={contest} className="contest-detail-cover" />
            )}
          </header>
          {query.isPending ? (
            <Skeleton className="h-32 w-full" />
          ) : query.isError ? (
            <ErrorState error={query.error} retry={() => void query.refetch()} />
          ) : (
            contest && index && <ReadingContent key={contest.id} contest={contest} index={index} />
          )}
        </div>
        {contest && (primaryAction || onAsk || action) && (
          <footer className="contest-detail-actions" aria-label="赛事操作">
            {primaryAction && (
              <a
                className="site-button site-button--primary"
                href={primaryAction.href}
                target="_blank"
                rel="noopener noreferrer"
              >
                {primaryAction.label} <ArrowUpRight aria-hidden="true" />
              </a>
            )}
            {onAsk && (
              <button
                type="button"
                className={
                  'site-button ' + (primaryAction ? 'site-button--outline' : 'site-button--primary')
                }
                onClick={ask}
              >
                <Sparkles aria-hidden="true" /> 问侦探
              </button>
            )}
            {action}
          </footer>
        )}
      </DialogContent>
    </Dialog>
  )
}
