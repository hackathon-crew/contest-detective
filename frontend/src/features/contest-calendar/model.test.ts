import { expect, it } from 'vitest'
import type { ContestSummary } from '@/entities/contest'
import { countContestDays, dayBounds } from './model'

it('北京时间的一天跨越 UTC 日期', () => {
  expect(dayBounds(new Date('2026-10-25T05:00:00Z'))).toEqual({
    date_from: '2026-10-24T16:00:00.000Z',
    date_to: '2026-10-25T15:59:59.999Z',
  })
})

it('同一场多个节点在同一天只计一场，跨北京零点归到次日', () => {
  const item: ContestSummary = {
    id: 'one',
    name: '赛事',
    cover_url: null,
    status: 'upcoming',
    fields: {
      start_at: { value: '2026-10-24T16:00:00Z', level: 'official' },
      submission_deadline: { value: '2026-10-25T03:00:00Z', level: 'official' },
      registration_deadline: { value: '2026-10-24T15:59:59Z', level: 'official' },
    },
  }
  expect(countContestDays([item])).toEqual(
    new Map([
      ['2026-10-25', 1],
      ['2026-10-24', 1],
    ]),
  )
})
