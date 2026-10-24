import { describe, expect, it } from 'vitest'
import type { ContestSummary } from './api'
import { cardDate } from './card-date'

const now = new Date('2026-10-24T00:00:00Z')
function contest(fields: ContestSummary['fields']): ContestSummary {
  return { id: 'one', name: '公开赛事', status: 'upcoming', cover_url: null, fields }
}
const field = (value: string) => ({ value, level: 'official' as const, sources: [] })
const day = (value: string) => ({ ...field(value), precision: 'day' as const })

describe('卡片日期', () => {
  it('所有截止已过时仍取最晚截止，不回退到开赛日', () => {
    expect(
      cardDate(
        contest({
          registration_deadline: field('2026-10-20T08:00:00Z'),
          submission_deadline: field('2026-10-22T08:00:00Z'),
          start_at: field('2026-10-25T08:00:00Z'),
        }),
        now,
      )?.field,
    ).toBe('submission_deadline')
  })
  it('没有开赛日期时显示作品提交截止，并保留截止类型', () => {
    const result = cardDate(contest({ submission_deadline: field('2026-10-25T08:00:00Z') }), now)
    expect(result?.field).toBe('submission_deadline')
    expect(result?.info.level).toBe('official')
  })
  it('跳过已过去的报名截止，选择最近的有效截止', () => {
    const result = cardDate(
      contest({
        registration_deadline: field('2026-10-23T08:00:00Z'),
        submission_deadline: field('2026-11-01T08:00:00Z'),
        deadline_unspecified: field('2026-10-26T08:00:00Z'),
      }),
      now,
    )
    expect(result?.field).toBe('deadline_unspecified')
  })
  it('没有截止时显示开赛日期，完全没有日期则留空', () => {
    expect(cardDate(contest({ start_at: field('2026-10-25T00:00:00Z') }), now)?.field).toBe(
      'start_at',
    )
    expect(cardDate(contest({}), now)).toBeNull()
  })
  it('当天仅日期的截止不会在北京上午八点后被跳过', () => {
    const result = cardDate(
      contest({
        registration_deadline: day('2026-10-24T00:00:00Z'),
        submission_deadline: field('2026-10-25T08:00:00Z'),
      }),
      new Date('2026-10-24T09:00:00Z'),
    )
    expect(result?.field).toBe('registration_deadline')
  })
  it('当天已有精确时刻且已截止的字段仍会跳过', () => {
    const result = cardDate(
      contest({
        registration_deadline: field('2026-10-24T08:00:00Z'),
        submission_deadline: day('2026-10-25T00:00:00Z'),
      }),
      new Date('2026-10-24T09:00:00Z'),
    )
    expect(result?.field).toBe('submission_deadline')
  })
})
