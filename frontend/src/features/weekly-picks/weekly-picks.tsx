import { addDays, startOfDay } from 'date-fns'
import { TZDate } from '@date-fns/tz'
import { ContestCard, useContests } from '@/entities/contest'
import { EmptyState, ErrorState, Skeleton } from '@/shared/ui'

export function WeeklyPicks() {
  const today = startOfDay(TZDate.tz('Asia/Shanghai'))
  const query = useContests({
    date_from: today.toISOString(),
    date_to: addDays(today, 7).toISOString(),
    sort: 'deadline',
    page_size: 6,
  })
  return (
    <section aria-labelledby="weekly-picks-title" className="min-w-0 space-y-5">
      <h2 id="weekly-picks-title" className="text-2xl font-bold text-ink">
        本周值得看
      </h2>
      {query.isPending ? (
        <Skeleton />
      ) : query.isError ? (
        <ErrorState error={query.error} retry={() => void query.refetch()} />
      ) : query.data.items.length === 0 ? (
        <EmptyState>本周没有比赛节点，去全部赛事看看。</EmptyState>
      ) : (
        <div className="grid gap-3">
          {query.data.items.map((contest) => (
            <ContestCard key={contest.id} contest={contest} />
          ))}
        </div>
      )}
    </section>
  )
}
