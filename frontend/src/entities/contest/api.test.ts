import { afterEach, expect, it, vi } from 'vitest'
import { listContests } from './api'
import { safeUrl } from './format'
afterEach(() => vi.unstubAllGlobals())
it('serializes followed ids without losing pagination', async () => {
  let requested = ''
  vi.stubGlobal('fetch', async (input: string) => {
    requested = input
    return new Response(
      JSON.stringify({ code: 200, message: 'success', data: [], total: 8, page: 2, page_size: 4 }),
    )
  })
  const result = await listContests({ ids: ['one', 'two'], page: 2, page_size: 4 })
  expect(new URL(requested, 'https://example.com').searchParams.get('ids')).toBe('one,two')
  expect(result.total).toBe(8)
  expect(result.page).toBe(2)
  expect(result.pageSize).toBe(4)
})
it('rejects executable source links', () => {
  expect(safeUrl('javascript:alert(1)')).toBeUndefined()
  expect(safeUrl('https://example.com')).toBe('https://example.com')
})
