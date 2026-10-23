import { createEvents, type EventAttributes } from 'ics'
import { addHours } from 'date-fns'
import type { ContestSummary, FieldValue } from './api'
import { fieldNames, safeUrl } from './format'

const DEADLINES = ['registration_deadline', 'submission_deadline', 'deadline_unspecified']

function timestamp(value: string | null | undefined): number | null {
  if (!value) return null
  const result = new Date(value).getTime()
  return Number.isFinite(result) ? result : null
}

function isDay(value: FieldValue | undefined): boolean {
  return Boolean(value && 'precision' in value && value.precision === 'day')
}

function calendarDate(timestamp: number, offset = 0): [number, number, number] {
  const date = new Date(timestamp)
  date.setUTCDate(date.getUTCDate() + offset)
  return [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()]
}

/** 只导出已知日期；两小时是日历占位长度，不补写任何赛事字段。 */
export function createContestCalendar(contests: ContestSummary[]): string | null {
  const events: EventAttributes[] = []
  for (const contest of contests) {
    const nodes = DEADLINES.map((field) => ({
      field,
      start: timestamp(contest.fields[field]?.value),
      end: null as number | null,
      allDay: isDay(contest.fields[field]),
    }))
    const start = timestamp(contest.fields.start_at?.value)
    const allDay = isDay(contest.fields.start_at)
    const compatibleEnd = isDay(contest.fields.end_at) === allDay
    if (start !== null)
      nodes.push({
        field: 'contest',
        start,
        end: compatibleEnd ? timestamp(contest.fields.end_at?.value) : null,
        allDay,
      })
    for (const node of nodes) {
      if (
        node.start === null ||
        (node.end !== null && (node.end < node.start || (!node.allDay && node.end === node.start)))
      )
        continue
      const end = node.end ?? addHours(new Date(node.start), 2).getTime()
      events.push({
        uid: `${contest.id}-${node.field}@contest-detective`,
        title: `${contest.name} · ${node.field === 'contest' ? '比赛' : fieldNames[node.field]}`,
        // 全天区间的结束日期不包含在内；原文结束日仍属于比赛日。
        start: node.allDay ? calendarDate(node.start) : node.start,
        end: node.allDay ? calendarDate(node.end ?? node.start, 1) : end,
        startInputType: 'utc',
        startOutputType: 'utc',
        endInputType: 'utc',
        endOutputType: 'utc',
        url: safeUrl(contest.fields.registration_url?.value),
        location: contest.fields.venue?.value ?? contest.fields.city?.value ?? undefined,
      })
    }
  }
  if (!events.length) return null
  const { error, value } = createEvents(events, { calName: '关注的比赛' })
  if (error || !value) throw new Error('日历生成失败，请重试')
  return value
}
