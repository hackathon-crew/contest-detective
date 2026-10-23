import { TZDate } from '@date-fns/tz'
import { endOfDay, endOfMonth, format, startOfDay, startOfMonth } from 'date-fns'
import { dateFields, type ContestSummary } from '@/entities/contest'

export const TIME_ZONE = 'Asia/Shanghai'

export function dayKey(value: Date | string) {
  const timestamp = typeof value === 'string' ? Date.parse(value) : value.getTime()
  return format(new TZDate(timestamp, TIME_ZONE), 'yyyy-MM-dd')
}

export function dayBounds(value: Date) {
  const date = new TZDate(value, TIME_ZONE)
  return {
    date_from: new Date(startOfDay(date).getTime()).toISOString(),
    date_to: new Date(endOfDay(date).getTime()).toISOString(),
  }
}

export function monthBounds(value: Date) {
  const date = new TZDate(value, TIME_ZONE)
  return {
    date_from: new Date(startOfMonth(date).getTime()).toISOString(),
    date_to: new Date(endOfMonth(date).getTime()).toISOString(),
  }
}

export function countContestDays(contests: ContestSummary[]) {
  const counts = new Map<string, number>()
  for (const contest of contests) {
    const days = new Set(
      dateFields
        .map((field) => contest.fields[field]?.value)
        .filter((value): value is string => Boolean(value))
        .map(dayKey),
    )
    for (const day of days) counts.set(day, (counts.get(day) ?? 0) + 1)
  }
  return counts
}
