import { useMemo, useRef, type ReactNode } from 'react'
import {
  ContestCover,
  dateFields,
  dateText,
  formatDate,
  groundedIntroduction,
  safeUrl,
  useContest,
  type ContestDetail as Contest,
} from '@/entities/contest'
import { ErrorState, Skeleton } from '@/shared/ui'
import { Dialog, DialogContent, DialogTitle } from '@/shared/ui/dialog'
import { Icon } from '@/shared/ui/site-icon'
import { ContestIntroductionSection } from './content'
import { buildEvidenceIndex, type EvidenceIndex } from './evidence-index'
import {
  conflictValues,
  criticalUnknowns,
  detailLabels,
  displayField,
  hasConflict,
  hasPendingEvidence,
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
  const pending = hasPendingEvidence(contest, field)
  const alternatives = conflictValues(contest, field)
  return (
    <div className={'contest-detail-fact' + (conflict ? ' has-conflict' : '')}>
      <dt>{label}</dt>
      <dd>
        {conflict || pending ? (
          <>
            <p className="contest-detail-conflict-label">
              {conflict ? '来源说法不一，待核实' : '信息待核实'}
            </p>
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
  const mode = supportedValue(contest, 'mode')
  const city = mode !== 'online' ? supportedValue(contest, 'city') : null
  const venue = mode !== 'online' ? supportedValue(contest, 'venue') : null
  const place = [city && !venue?.includes(city) ? city : null, venue].filter(Boolean).join(' · ')
  const modeText = mode ? displayField('mode', contest.fields.mode) : null
  const locationFields = [
    ...(mode ? ['mode'] : []),
    ...(city ? ['city'] : []),
    ...(venue ? ['venue'] : []),
  ]
  const locationRefs = locationFields.flatMap((field) => index.refsByField[field] ?? [])
  const locationReposted = locationFields.some(
    (field) => contest.fields[field]?.level === 'reposted',
  )
  const locationOnlyReposted = locationFields.every(
    (field) => contest.fields[field]?.level === 'reposted',
  )
  const otherFields = ['organizer', 'mode', 'city', 'venue', 'registration_url'].filter(
    (field) => hasConflict(contest, field) || hasPendingEvidence(contest, field),
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
                <div className="contest-detail-eyebrow">{detailLabels[next.field]}</div>
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
              <span>{[modeText, place].filter(Boolean).join(' · ')}</span>
              {locationReposted && (
                <span className="contest-detail-inline-level">
                  {locationOnlyReposted ? '仅见转载' : '部分信息仅见转载'}
                </span>
              )}
              <SourceReferences index={index} refs={locationRefs} label="参赛方式与地点" />
            </div>
          )}
        </section>
      )}
      {!!pending.length && (
        <div className="contest-detail-coverage" aria-label="参赛前待确认">
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
  const registration = safeUrl(contest?.fields.registration_url?.value)
  const organizer = contest ? supportedValue(contest, 'organizer') : null
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
          {contest?.cover_url && (
            <ContestCover contest={contest} className="contest-detail-cover" />
          )}
          <div className="contest-detail-body">
            <header className="contest-detail-header">
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
            </header>
            {query.isPending ? (
              <Skeleton className="h-32 w-full" />
            ) : query.isError ? (
              <ErrorState error={query.error} retry={() => void query.refetch()} />
            ) : (
              contest &&
              index && <ReadingContent key={contest.id} contest={contest} index={index} />
            )}
          </div>
        </div>
        {contest && (registration || onAsk || action) && (
          <footer className="contest-detail-actions" aria-label="赛事操作">
            {registration && (
              <a
                className="site-button site-button--primary"
                href={registration}
                target="_blank"
                rel="noopener noreferrer"
              >
                去报名 <Icon name="arrow-right" />
              </a>
            )}
            {onAsk && (
              <button
                type="button"
                className="site-button site-button--outline"
                onClick={() => onAsk(`帮我核实一下「${contest.name}」的截止时间`)}
              >
                问侦探这场比赛
              </button>
            )}
            {action}
          </footer>
        )}
      </DialogContent>
    </Dialog>
  )
}
