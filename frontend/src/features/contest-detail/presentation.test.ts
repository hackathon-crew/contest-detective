import { describe, expect, it } from 'vitest'
import type { ContestDetail, CoverageObservation, FieldValue } from '@/entities/contest'
import {
  criticalUnknowns,
  detailAction,
  hasConflict,
  nextDetailDate,
  pendingFact,
  supportedValue,
} from './presentation'

const source = {
  url: 'https://example.com/rules',
  site: '主办方',
  title: '赛事规则',
  is_official: true,
  value: '参赛信息',
  excerpt: '参赛信息',
}
const citation = { url: source.url, content_hash: 'a'.repeat(64), excerpt: '费用另行公布。' }
const base: ContestDetail = {
  id: 'test',
  name: '测试',
  status: 'upcoming',
  cover_url: null,
  fields: {},
  summary: null,
}
const field = (value: string): FieldValue => ({
  value,
  level: 'official',
  sources: [{ ...source, value }],
})

describe('decision-facing missing states', () => {
  it.each(['not_fetched', 'fetch_failed', 'extract_failed'] as const)(
    '%s is pending, not absent or free',
    (state) => {
      const contest = { ...base, coverage: { fields: { entry_fee: { state } } } }
      expect(pendingFact(contest, 'entry_fee', '费用').message).toBe('费用待确认')
      expect(criticalUnknowns(contest).map((item) => item.label)).toEqual([
        '截止时间',
        '参赛资格',
        '费用',
      ])
    },
  )
  it('only calls a field not found when sources were actually checked', () => {
    expect(
      pendingFact(
        { ...base, coverage: { fields: { entry_fee: { state: 'not_found_in_source' } } } },
        'entry_fee',
        '费用',
      ).message,
    ).toBe('已查来源中暂未找到费用说明')
  })
  it('requires valid evidence for explicit nonpublication', () => {
    for (const citations of [[], [{ ...citation, url: 'javascript:alert(1)' }]]) {
      expect(
        pendingFact(
          {
            ...base,
            coverage: { fields: { entry_fee: { state: 'source_unpublished', citations } } },
          },
          'entry_fee',
          '费用',
        ).message,
      ).toBe('费用待确认')
    }
    expect(
      pendingFact(
        {
          ...base,
          coverage: {
            fields: { entry_fee: { state: 'source_unpublished', citations: [citation] } },
          },
        },
        'entry_fee',
        '费用',
      ).message,
    ).toBe('来源明确注明费用尚未公布')
  })
  it('never infers free and preserves an explicit zero amount', () => {
    expect(supportedValue(base, 'entry_fee')).toBeNull()
    expect(supportedValue({ ...base, fields: { entry_fee: field('0 元') } }, 'entry_fee')).toBe(
      '0 元',
    )
  })
  it('a submission deadline does not establish a registration cutoff', () => {
    const contest = { ...base, fields: { submission_deadline: field('2026-11-01T12:00:00Z') } }
    expect(criticalUnknowns(contest)[0]?.label).toBe('报名截止')
  })
  it('does not call resolved registration, eligibility or fee missing', () => {
    const contest = {
      ...base,
      fields: {
        registration_deadline: field('2026-11-01T12:00:00Z'),
        eligibility: field('在校学生'),
        entry_fee: field('免费'),
      },
    }
    expect(criticalUnknowns(contest)).toEqual([])
  })
})

describe('traceability, conflicts and actions', () => {
  it('does not display untraceable or stale claims as established facts', () => {
    expect(
      supportedValue(
        { ...base, fields: { prize: { value: '100 万', level: 'official', sources: [] } } },
        'prize',
      ),
    ).toBeNull()
    expect(
      supportedValue(
        {
          ...base,
          fields: { prize: { ...field('100 万'), sources: [{ ...source, stale: true }] } },
        },
        'prize',
      ),
    ).toBeNull()
  })
  it('respects conflicts even when the response retains a selected value', () => {
    const contest = {
      ...base,
      fields: { entry_fee: { ...field('免费'), level: 'conflict' as const } },
    }
    expect(supportedValue(contest, 'entry_fee')).toBeNull()
    expect(hasConflict(contest, 'entry_fee')).toBe(true)
    expect(criticalUnknowns(contest).some((item) => item.field === 'entry_fee')).toBe(false)
  })
  it('coverage conflict also prevents an asserted fact or chosen deadline', () => {
    const contest = {
      ...base,
      fields: { registration_deadline: field('2026-11-01T12:00:00Z') },
      coverage: { fields: { registration_deadline: { state: 'conflict' } as CoverageObservation } },
    }
    expect(nextDetailDate(contest, new Date('2026-10-24T00:00:00Z'))).toBeNull()
  })
  it('keeps deadline type and day precision and never substitutes start for registration', () => {
    const contest = {
      ...base,
      fields: { start_at: { ...field('2026-11-01T00:00:00Z'), precision: 'day' as const } },
    }
    expect(nextDetailDate(contest)?.field).toBe('start_at')
    expect(nextDetailDate(contest)?.info.precision).toBe('day')
    expect(criticalUnknowns(contest)[0]?.label).toBe('截止时间')
  })
  it('does not label a reposted link official or imply registration is open', () => {
    const contest = {
      ...base,
      fields: {
        registration_url: { ...field('https://example.com/apply'), level: 'reposted' as const },
      },
    }
    expect(detailAction(contest)).toEqual({
      href: 'https://example.com/apply',
      label: '查看报名页面',
    })
    expect(detailAction({ ...contest, status: 'ended' })?.label).toBe('查看赛事资料')
  })
  it('never follows an unsafe registration URL', () => {
    const contest = { ...base, fields: { registration_url: field('javascript:alert(1)') } }
    expect(detailAction(contest)).toEqual({ href: source.url, label: '查看赛事原文' })
    expect(detailAction(base)).toBeNull()
  })
})
