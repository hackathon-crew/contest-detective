import { expect, it } from 'vitest'
import { displayDeadline, nextDeadline, officialDeadlineCount } from './deadline'
import type { ContestSummary, FieldValue } from './api'
const field = (
  value: string | null,
  level: FieldValue['level'] = 'official',
  precision: FieldValue['precision'] = 'day',
): FieldValue => ({ value, level, precision, sources: [] })
const contest = (fields: ContestSummary['fields']): ContestSummary => ({
  id: 'one',
  name: '比赛',
  cover_url: null,
  status: 'upcoming',
  fields,
})
it('counts a contest once when both deadlines are official and ignores unspecified dates', () => {
  expect(
    officialDeadlineCount([
      contest({
        registration_deadline: field('2026-10-24'),
        submission_deadline: field('2026-10-25'),
      }),
      contest({ deadline_unspecified: field('2026-10-24') }),
      contest({
        registration_deadline: field(null),
        submission_deadline: field('2026-10-25', 'reposted'),
      }),
    ]),
  ).toBe(1)
})
it('keeps day precision deadlines open through the Beijing calendar day', () => {
  const result = nextDeadline(
    contest({
      registration_deadline: field('2026-10-24T00:00:00Z'),
      submission_deadline: field('2026-10-24T01:00:00Z', 'official', 'datetime'),
    }),
    new Date('2026-10-24T02:00:00Z'),
  )
  expect(result?.field).toBe('registration_deadline')
  expect(new Date(result!.end).toISOString()).toBe('2026-10-24T15:59:59.999Z')
  expect(
    nextDeadline(contest({ start_at: field('2026-10-25') }), new Date('2026-10-24T02:00:00Z')),
  ).toBeNull()
})
it('retains a known past deadline for display while excluding it from upcoming contests', () => {
  const ended = contest({ submission_deadline: field('2026-10-20') })
  const now = new Date('2026-10-24T02:00:00Z')
  expect(nextDeadline(ended, now)).toBeNull()
  expect(displayDeadline(ended, now)?.info.value).toBe('2026-10-20')
})
