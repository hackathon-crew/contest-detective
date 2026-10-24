import { differenceInCalendarDays } from 'date-fns'
import { TZDate } from '@date-fns/tz'
import type { ContestSummary } from './api'
export function nextDeadline(contest: ContestSummary, now = new Date()) {
  return (
    ['registration_deadline', 'submission_deadline', 'deadline_unspecified']
      .flatMap((field) => {
        const info = contest.fields[field]
        if (!info?.value) return []
        // day 保存的是日历日期；它的 UTC00 只用于存储，不能当成北京时间08点截止。
        const end = Date.parse(
          info.precision === 'day' ? info.value.slice(0, 10) + 'T23:59:59.999+08:00' : info.value,
        )
        return Number.isFinite(end) && end >= now.getTime() ? [{ field, info, end }] : []
      })
      .sort((a, b) => a.end - b.end)[0] ?? null
  )
}
export function deadlineDays(
  deadline: NonNullable<ReturnType<typeof nextDeadline>>,
  now = new Date(),
) {
  return differenceInCalendarDays(
    new TZDate(deadline.end, 'Asia/Shanghai'),
    new TZDate(now, 'Asia/Shanghai'),
  )
}
export function officialDeadlineCount(contests: ContestSummary[]) {
  return contests.filter((contest) =>
    ['registration_deadline', 'submission_deadline'].some(
      (field) => contest.fields[field]?.value && contest.fields[field].level === 'official',
    ),
  ).length
}
