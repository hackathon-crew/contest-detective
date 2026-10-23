import { expect, it } from 'vitest'
import { formatDate, remainingDays } from './format'
it('displays UTC dates in Beijing time', () => {
  expect(formatDate('2026-10-24T18:00:00Z')).toContain('10月25日')
  expect(formatDate('2026-10-24T18:00:00Z')).toContain('02:00')
  expect(formatDate(null)).toBe('未找到')
})
it('rounds a future deadline up to the next day', () => {
  expect(remainingDays('2026-10-25T00:00:01Z', new Date('2026-10-24T00:00:00Z'))).toBe('还剩 2 天')
  expect(remainingDays('2026-10-23T00:00:00Z', new Date('2026-10-24T00:00:00Z'))).toBe('已截止')
})
