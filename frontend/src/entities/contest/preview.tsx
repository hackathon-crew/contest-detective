import { useState, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router'
import { Icon } from '@/shared/ui/site-icon'
import type { ContestSummary, FieldValue } from './api'
import { formatDate, modeNames, safeUrl } from './format'
import { displayDeadline, deadlineDays } from './deadline'
import { useLocale } from '@/shared/i18n/locale-context'
import { dateText } from './library'
import type { Message } from '@/shared/i18n'
const levels = {
  official: ['check', '官方原文'],
  reposted: ['dot', '转载'],
  conflict: ['alert', '说法不一'],
  not_found: ['minus', '未找到'],
} as const
const labels: Record<string, Message> = {
  registration_deadline: '报名截止',
  submission_deadline: '提交截止',
  deadline_unspecified: '截止（未注明类型）',
}
export function VerificationLevel({ level }: { level: FieldValue['level'] }) {
  const { t } = useLocale()
  const [icon, label] = levels[level]
  return (
    <span className={'lv lv-' + level}>
      <Icon name={icon} />
      {t(label)}
    </span>
  )
}
export function ContestCover({
  contest,
  className,
}: {
  contest: ContestSummary
  className?: string
}) {
  const [failed, setFailed] = useState(false)
  const url = safeUrl(contest.cover_url)
  return url && !failed ? (
    <img className={className} src={url} alt="" loading="lazy" onError={() => setFailed(true)} />
  ) : (
    <span className={'cover-empty ' + (className ?? '')} aria-hidden="true" />
  )
}
export function prizeText(contest: ContestSummary) {
  const value = contest.fields.prize?.value
  if (!value || /^[^\d]*0$/.test(value.trim())) return null
  const short = value.split(/[（(：；，]/)[0].trim()
  return short.length > 16 ? short.slice(0, 16) + '…' : short
}
export function ContestPreview({
  contest,
  extra,
  card = false,
}: {
  contest: ContestSummary
  extra?: ReactNode
  card?: boolean
}) {
  const { locale, t } = useLocale()
  const location = useLocation()
  const deadline = displayDeadline(contest)
  const days = deadline ? deadlineDays(deadline) : null
  const mode = contest.fields.mode?.value
  const modeLabel = mode === 'hybrid' ? '线上+线下' : modeNames[mode ?? '']
  const meta = [
    contest.fields.organizer?.value,
    modeLabel && t(modeLabel),
    mode !== 'online' && !card ? contest.fields.city?.value : null,
    prizeText(contest),
  ]
    .filter(Boolean)
    .join(' · ')
  const date = deadline
    ? formatDate(deadline.info.value, deadline.info.precision, false, locale)
    : t('日期未核实')
  // 首页只展示原文公布的日期；未核实的钟点仍在提示和详情中标明。
  const visibleDate = deadline ? dateText(deadline.info, locale) : date
  const left =
    days === null ? null : (
      <span className={'soon-tag' + (days >= 0 && days <= 2 ? ' hot' : '')}>
        {days < 0
          ? t('已截止')
          : days === 0
            ? t('今天截止')
            : t(days === 1 ? '还有 1 天' : '还有 {days} 天', { days })}
      </span>
    )
  return (
    <Link
      className={card ? 'card' : 'row'}
      to={`/contests/${contest.id}${location.search}`}
      state={{ backgroundLocation: location }}
    >
      {card ? (
        <span className="pic">
          <ContestCover contest={contest} />
        </span>
      ) : (
        <ContestCover contest={contest} />
      )}
      {card ? (
        <>
          <span className="card-name">{contest.name}</span>
          <span className="card-org">{meta}</span>
          <span className="card-dl">
            <b title={date}>{visibleDate}</b>
            {deadline && t(labels[deadline.field])} {left}
          </span>
        </>
      ) : (
        <>
          <span className="row-main">
            <span className="row-name">{contest.name}</span>
            <span className="row-meta">{meta}</span>
            {extra}
          </span>
          <span className="row-side">
            <span className="row-date" title={date}>
              {visibleDate}
            </span>
            <span className="row-sub">
              {deadline && (
                <>
                  {t(labels[deadline.field])} <VerificationLevel level={deadline.info.level} />
                </>
              )}
              {left}
            </span>
          </span>
        </>
      )}
    </Link>
  )
}
