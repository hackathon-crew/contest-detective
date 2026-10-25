import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

const stylesheet = readFileSync(new URL('./contest-detail.css', import.meta.url), 'utf8')
const component = readFileSync(new URL('./contest-detail.tsx', import.meta.url), 'utf8')

it('leaves existing button and icon geometry to the shared components', () => {
  expect(stylesheet).not.toMatch(/\.contest-detail-actions\s+[^{\s][^{]*\{/u)
  expect(component).not.toContain("from 'lucide-react'")
  expect(component).toContain('<Icon name="arrow-right" />')
})

it('retains the library typeface and reuses the declared scale for new reading styles', () => {
  expect(stylesheet).toContain("@reference '../../index.css'")
  expect(stylesheet).toContain("--font-contest: 'Inkpaw Contest Sans', var(--font-sans)")
  expect(stylesheet).toContain('font-family: var(--font-contest)')
  const fontSizes = Array.from(stylesheet.matchAll(/font-size:\s*(\d+)px/gu), (match) => match[1])
  // These are the unchanged base detail typography rules, not a new local scale.
  expect([...new Set(fontSizes)].sort()).toEqual(['12', '14', '20'])
  expect(stylesheet).not.toContain('.contest-detail-notice')
  expect(component).not.toContain('contest-detail-notice')
})
