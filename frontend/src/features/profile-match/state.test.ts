import { expect, it } from 'vitest'
import { mergeDraft } from './state'

it('keeps provenance when a stored and imported skill overlap', () => {
  const merged = mergeDraft(
    { skills: ['Python', 'React'], skill_sources: { Python: ['manual'], React: ['manual'] } },
    { skills: ['Python', 'Swift'], skill_sources: { Python: ['github'], Swift: ['github'] } },
    'github',
  )
  expect(merged.skill_sources).toEqual({
    Python: ['manual', 'github'],
    React: ['manual'],
    Swift: ['github'],
  })
})
