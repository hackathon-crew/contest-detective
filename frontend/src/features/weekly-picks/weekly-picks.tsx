import { Link, useLocation } from 'react-router'
import {
  ContestCover,
  dateText,
  libraryDate,
  useContestLibrary,
  modeNames,
  normalizedPrize,
  type ContestSummary,
} from '@/entities/contest'
import { Skeleton } from '@huyanxius/ui'
import { EmptyState, ErrorState } from '@/shared/ui'
import type { Message } from '@/shared/i18n'
import { useLocale } from '@/shared/i18n/locale-context'

function Pick({ contest }: { contest: ContestSummary }) {
  const { locale, t } = useLocale()
  const location = useLocation()
  const key = libraryDate(contest)
  const mode = contest.fields.mode?.value
  const modeLabel = mode === 'hybrid' ? '线上+线下' : modeNames[mode ?? '']
  const meta = [
    contest.fields.organizer?.value,
    modeLabel && t(modeLabel),
    normalizedPrize(contest.fields.prize?.value),
  ]
    .filter(Boolean)
    .join(' · ')
  const labels: Record<string, Message> = {
    registration_deadline: '报名截止',
    submission_deadline: '作品提交截止',
    deadline_unspecified: '截止',
  }
  return (
    <Link
      className="card"
      to={'/contests/' + encodeURIComponent(contest.id) + location.search}
      state={{ backgroundLocation: location }}
    >
      <span className="pic">
        <ContestCover contest={contest} />
      </span>
      <span className="card-name">{contest.name}</span>
      <span className="card-org">{meta}</span>
      <span className="card-dl">
        <b>{key ? dateText(key.info, locale) : t('日期未公布')}</b>
        {key && t(labels[key.field])}
        {key && (
          <span className={'soon-tag' + (key.left >= 0 && key.left <= 2 ? ' hot' : '')}>
            {key.left < 0
              ? t('已截止')
              : key.left === 0
                ? t('今天截止')
                : t(key.left === 1 ? '还有 1 天' : '还有 {days} 天', { days: key.left })}
          </span>
        )}
      </span>
    </Link>
  )
}
export function WeeklyPicks() {
  const { t } = useLocale()
  const query = useContestLibrary()
  const items = (query.data ?? [])
    .filter((contest) => {
      const date = libraryDate(contest)
      return (
        contest.status !== 'ended' &&
        normalizedPrize(contest.fields.prize?.value) &&
        date &&
        date.info.level !== 'conflict' &&
        !date.start &&
        date.left >= 7
      )
    })
    .sort((a, b) => libraryDate(a)!.left - libraryDate(b)!.left)
    .slice(0, 4)
  return (
    <section className="site-wrap picks" aria-labelledby="picks-title">
      <div className="sec-row">
        <h2 id="picks-title">{t('可以提前准备')}</h2>
        <span className="note">{t('至少还有 7 天、奖金写明的几场')}</span>
      </div>
      {query.isPending ? (
        <Skeleton />
      ) : query.isError ? (
        <ErrorState error={query.error} retry={() => void query.refetch()} />
      ) : !items.length ? (
        <EmptyState>{t('暂时没有符合条件的比赛，去全部赛事看看。')}</EmptyState>
      ) : (
        <div className="pick-grid">
          {items.map((contest) => (
            <Pick key={contest.id} contest={contest} />
          ))}
        </div>
      )}
    </section>
  )
}
