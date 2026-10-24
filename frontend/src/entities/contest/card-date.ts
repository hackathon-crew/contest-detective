import type { ContestSummary, FieldValue } from './api'

export function cardDate(
  contest: ContestSummary,
  now = new Date(),
): { field: string; info: FieldValue } | null {
  const deadlines = ['registration_deadline', 'submission_deadline', 'deadline_unspecified']
    .flatMap((field) => {
      const info = contest.fields[field]
      const instant = info?.value ? Date.parse(info.value) : NaN
      const time =
        info?.precision === 'day' && Number.isFinite(instant)
          ? Date.parse(info.value!.slice(0, 10) + 'T23:59:59.999+08:00')
          : instant
      return info?.value && Number.isFinite(time) ? [{ field, info, time }] : []
    })
    .sort((a, b) => a.time - b.time)
  const next = deadlines.find((date) => date.time >= now.getTime())
  if (next) return next
  if (deadlines.length) return deadlines.at(-1)!
  const start = contest.fields.start_at
  if (start?.value) return { field: 'start_at', info: start }
  return null
}
