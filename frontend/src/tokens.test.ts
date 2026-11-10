import { checkTokens } from '@huyanxius/ui/checks'
import { expect, it } from 'vitest'

it('uses semantic colors and the shared size scale', () => {
  expect(checkTokens(import.meta.dirname, { semanticRadii: true })).toEqual([])
})
