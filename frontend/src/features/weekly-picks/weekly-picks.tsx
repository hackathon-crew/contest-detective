import { addDays, startOfDay } from 'date-fns'
import { useQuery } from '@tanstack/react-query'
import { TZDate } from '@date-fns/tz'
import { Link, useLocation } from 'react-router'
import {
  ContestCover,
  dateText,
  libraryDate,
  listAllContests,
  modeNames,
  normalizedPrize,
  type ContestSummary,
} from '@/entities/contest'
import { EmptyState, ErrorState, Skeleton } from '@/shared/ui'

function Pick({ contest }: { contest: ContestSummary }) {
  const location = useLocation()
  const key = libraryDate(contest)
  const mode = contest.fields.mode?.value
  const meta = [
    contest.fields.organizer?.value,
    mode === 'hybrid' ? '线上+线下' : modeNames[mode ?? ''],
    normalizedPrize(contest.fields.prize?.value),
  ]
    .filter(Boolean)
    .join(' · ')
  const labels: Record<string, string> = {
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
        <b>{key ? dateText(key.info) : '日期未公布'}</b>
        {key && labels[key.field]}
        {key && (
          <span className={'soon-tag' + (key.left >= 0 && key.left <= 2 ? ' hot' : '')}>
            {key.left < 0 ? '已截止' : key.left === 0 ? '今天截止' : '还有 ' + key.left + ' 天'}
          </span>
        )}
      </span>
    </Link>
  )
}
export function WeeklyPicks() {
  const today = startOfDay(TZDate.tz('Asia/Shanghai'))
  const filters = {
    date_from: today.toISOString(),
    date_to: addDays(today, 7).toISOString(),
    sort: 'deadline' as const,
  }
  const query = useQuery({
    queryKey: ['weekly-picks', filters],
    queryFn: () => listAllContests(filters),
  })
  const items = (query.data ?? [])
    .filter((contest) => {
      const date = libraryDate(contest)
      return (
        normalizedPrize(contest.fields.prize?.value) &&
        date &&
        !date.start &&
        date.left >= 0 &&
        date.left <= 7
      )
    })
    .slice(0, 4)
  return (
    <section className="site-wrap picks" aria-labelledby="picks-title">
      <div className="sec-row">
        <h2 id="picks-title">本周值得看</h2>
        <span className="note">本周截止、奖金写明的几场</span>
      </div>
      {query.isPending ? (
        <Skeleton />
      ) : query.isError ? (
        <ErrorState error={query.error} retry={() => void query.refetch()} />
      ) : !items.length ? (
        <EmptyState>本周没有比赛节点，去全部赛事看看。</EmptyState>
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
