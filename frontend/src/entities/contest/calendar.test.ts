import { describe, expect, it } from 'vitest'
import type { ContestSummary, FieldValue } from './api'
import { createContestCalendar } from './calendar'

function event(fields: Record<string, FieldValue>): ContestSummary {
  return { id: 'one', name: '周末赛', status: 'upcoming', cover_url: null, fields }
}
function value(
  raw: string,
  precision: 'day' | 'datetime' = 'datetime',
): FieldValue & { precision: 'day' | 'datetime' } {
  return { value: raw, level: 'official', sources: [], precision }
}

describe('关注日历导出', () => {
  it('区分三种截止并将比赛时段转换为 UTC', () => {
    const text = createContestCalendar([
      event({
        start_at: value('2026-11-01T10:00:00+08:00'),
        end_at: value('2026-11-01T18:00:00+08:00'),
        registration_deadline: value('2026-10-31T23:59:59+08:00'),
        submission_deadline: value('2026-11-02T16:00:00Z'),
        deadline_unspecified: value('2026-11-03T16:00:00Z'),
      }),
    ])!
    expect(text.match(/BEGIN:VEVENT/g)).toHaveLength(4)
    expect(text).toContain('SUMMARY:周末赛 · 比赛')
    expect(text).toContain('SUMMARY:周末赛 · 报名截止')
    expect(text).toContain('SUMMARY:周末赛 · 作品提交截止')
    expect(text).toContain('SUMMARY:周末赛 · 截止（未注明类型）')
    expect(text).toContain('DTSTART:20261031T155959Z')
    expect(text).toContain('DTSTART:20261101T020000Z')
    expect(text).toContain('DTEND:20261101T100000Z')
  })

  it('没有结束时间时补两小时，缺少的报名日期不生成', () => {
    const text = createContestCalendar([event({ start_at: value('2026-11-01T02:00:00Z') })])!
    expect(text.match(/BEGIN:VEVENT/g)).toHaveLength(1)
    expect(text).toContain('DTEND:20261101T040000Z')
    expect(text).not.toContain('报名截止')
    expect(text).not.toContain('1970')
  })

  it('没有任何已知日期时不生成下载文件', () => {
    expect(createContestCalendar([event({})])).toBeNull()
  })

  it('只有日期的截止和比赛区间导出全天事件，不补具体时刻', () => {
    const text = createContestCalendar([
      event({
        submission_deadline: value('2026-10-31T00:00:00Z', 'day'),
        start_at: value('2026-11-01T00:00:00Z', 'day'),
        end_at: value('2026-11-03T00:00:00Z', 'day'),
      }),
    ])!
    expect(text).toContain('DTSTART;VALUE=DATE:20261031')
    expect(text).toContain('DTEND;VALUE=DATE:20261101')
    expect(text).toContain('DTSTART;VALUE=DATE:20261101')
    expect(text).toContain('DTEND;VALUE=DATE:20261104')
    expect(text).not.toMatch(/DTSTART:.*T/)
  })
})
