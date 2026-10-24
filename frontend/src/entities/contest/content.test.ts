import { expect, it } from 'vitest'
import { coverageLabel, groundedIntroduction, usableCitations } from './content'

const citation = {
  url: 'https://example.com/about',
  content_hash: 'a'.repeat(64),
  excerpt: '公开介绍',
}
it('requires usable evidence before an introduction or nonpublication claim', () => {
  expect(usableCitations([citation])).toEqual([citation])
  expect(usableCitations([{ ...citation, content_hash: 'missing' }])).toEqual([])
  expect(usableCitations([{ ...citation, excerpt: ' ' }])).toEqual([])
  expect(coverageLabel({ state: 'source_unpublished', citations: [citation] })).toBe(
    '来源明确未公布',
  )
  expect(coverageLabel({ state: 'source_unpublished', citations: [] })).toBe('未核实')
  expect(coverageLabel({ state: 'found' })).toBe('已找到来源内容')
  expect(coverageLabel(undefined)).toBe('未核实')
  const contest = {
    id: 'one',
    name: 'one',
    cover_url: null,
    status: 'upcoming' as const,
    fields: {},
  }
  expect(groundedIntroduction(contest)).toBeNull()
  expect(
    groundedIntroduction({ ...contest, introduction: { text: ' ', citations: [citation] } }),
  ).toBeNull()
})
