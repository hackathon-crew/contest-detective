import { useMemo, useState, type ComponentProps } from 'react'
import { useQuery } from '@tanstack/react-query'
import { TZDate } from '@date-fns/tz'
import { format, startOfMonth } from 'date-fns'
import { zhCN } from 'date-fns/locale'
import { Link, useLocation } from 'react-router'
import { DayButton } from 'react-day-picker'
import {
  dateFields,
  fieldNames,
  formatDate,
  listAllContests,
  type FieldValue,
} from '@/entities/contest'
import { Button, Calendar, EmptyState, ErrorState, Skeleton } from '@/shared/ui'
import { CalendarDayButton } from '@/shared/ui/calendar'
import { countContestDays, dayBounds, dayKey, monthBounds, TIME_ZONE } from './model'

type CalendarField = FieldValue & { precision?: 'day' | 'datetime' }

export function ContestCalendar({ followedIds }: { followedIds?: string[] }) {
  const [today] = useState(() => new TZDate(Date.now(), TIME_ZONE))
  const [month, setMonth] = useState<Date>(today)
  const [selected, setSelected] = useState<Date>(today)
  const [onlyFollowed, setOnlyFollowed] = useState(false)
  const { search } = useLocation()
  const ids = onlyFollowed ? (followedIds ?? []) : undefined
  const enabled = !onlyFollowed || Boolean(ids?.length)
  const monthFilters = { ...monthBounds(month), ids }
  const dayFilters = { ...dayBounds(selected), ids }
  const monthly = useQuery({
    queryKey: ['contest-calendar', 'month', monthFilters],
    queryFn: () => listAllContests(monthFilters),
    enabled,
  })
  const daily = useQuery({
    queryKey: ['contest-calendar', 'day', dayFilters],
    queryFn: () => listAllContests(dayFilters),
    enabled,
  })
  const counts = useMemo(() => countContestDays(monthly.data ?? []), [monthly.data])
  const components = useMemo(
    () => ({
      DayButton: (props: ComponentProps<typeof DayButton>) => {
        const count = counts.get(dayKey(props.day.date)) ?? 0
        return (
          <CalendarDayButton {...props} locale={zhCN} className="min-h-12 gap-0">
            {format(props.day.date, 'd')}
            <span
              aria-hidden={count === 0}
              className={props.modifiers.selected ? 'text-primary-foreground' : 'text-muted'}
            >
              {count > 0 ? `${count}场` : '\u00a0'}
            </span>
          </CalendarDayButton>
        )
      },
    }),
    [counts],
  )
  const selectedKey = dayKey(selected)

  return (
    <section
      id="calendar"
      aria-labelledby="contest-calendar-title"
      className="min-w-0 space-y-4 py-8"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="contest-calendar-title" className="text-2xl font-bold text-ink">
          赛事日历
        </h2>
        {followedIds !== undefined && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            aria-pressed={onlyFollowed}
            onClick={() => setOnlyFollowed((value) => !value)}
          >
            只看关注
          </Button>
        )}
      </div>
      <Calendar
        mode="single"
        required
        selected={selected}
        month={month}
        onSelect={setSelected}
        onMonthChange={(next) => {
          setMonth(next)
          setSelected(startOfMonth(new TZDate(next, TIME_ZONE)))
        }}
        locale={zhCN}
        timeZone={TIME_ZONE}
        showOutsideDays={false}
        fixedWeeks
        className="w-full max-w-lg rounded-2xl border border-rule bg-surface p-3"
        classNames={{ root: 'w-full' }}
        components={components}
        labels={{
          labelNext: () => '下个月',
          labelPrevious: () => '上个月',
          labelDayButton: (date, modifiers) =>
            `${format(date, 'yyyy年M月d日')}，${counts.get(dayKey(date)) ?? 0}场赛事${modifiers.selected ? '，已选中' : ''}`,
        }}
        formatters={{ formatCaption: (date) => format(date, 'yyyy年M月', { locale: zhCN }) }}
      />
      {(monthly.error || daily.error) && (
        <ErrorState
          error={monthly.error ?? daily.error}
          retry={() => {
            void monthly.refetch()
            void daily.refetch()
          }}
        />
      )}
      <div aria-busy={daily.isLoading}>
        <h3 className="text-base font-semibold text-ink">
          {format(new TZDate(selected, TIME_ZONE), 'M月d日', { locale: zhCN })}
        </h3>
        {daily.isLoading ? (
          <Skeleton className="mt-3 h-16 w-full rounded-xl" />
        ) : !enabled ? (
          <EmptyState>先关注一场赛事</EmptyState>
        ) : daily.data?.length ? (
          <ul className="divide-y divide-rule">
            {daily.data.map((contest) => (
              <li key={contest.id} className="space-y-1 py-3">
                <Link
                  to={`/contests/${contest.id}${search}`}
                  className="block text-base font-semibold text-ink hover:underline focus-visible:outline-2 focus-visible:outline-ink"
                >
                  {contest.name}
                </Link>
                {dateFields
                  .filter(
                    (field) =>
                      contest.fields[field]?.value &&
                      dayKey(contest.fields[field]!.value!) === selectedKey,
                  )
                  .map((field) => (
                    <p key={field} className="text-xs text-muted">
                      {fieldNames[field]} ·{' '}
                      {formatDate(
                        contest.fields[field]?.value,
                        (contest.fields[field] as CalendarField | undefined)?.precision,
                      )}
                    </p>
                  ))}
              </li>
            ))}
          </ul>
        ) : (
          !daily.error && <EmptyState>这一天没有赛事节点</EmptyState>
        )}
      </div>
    </section>
  )
}
