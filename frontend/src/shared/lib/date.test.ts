import { expect, it } from 'vitest'
import { formatDate } from './date'

it('精确时刻换算为北京时间，默认仍按精确时刻处理', () => {
  expect(formatDate('2026-10-24T16:01:00Z')).toBe('10月25日 00:01')
  expect(formatDate('2026-10-24T16:01:00Z', 'datetime')).toBe('10月25日 00:01')
})

it('仅日期保留原文日历日期，不显示猜出的时刻', () => {
  expect(formatDate('2026-10-24T00:00:00Z', 'day')).toBe('10月24日（时刻未核实）')
  expect(formatDate('invalid', 'day')).toBe('未找到')
  expect(formatDate(null, 'day')).toBe('未找到')
})

it('需要跨年识别时显示年份，日期精度保持一致', () => {
  expect(formatDate('2014-03-04T02:00:00Z', 'datetime', true)).toBe('2014年3月4日 10:00')
  expect(formatDate('2014-03-04T00:00:00Z', 'day', true)).toBe('2014年3月4日（时刻未核实）')
})
