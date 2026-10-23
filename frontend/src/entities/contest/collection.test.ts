import { afterEach, expect, it, vi } from 'vitest'
import { listAllContests } from './collection'

afterEach(() => vi.unstubAllGlobals())

it('取完超过一页的赛事并保留调用条件', async () => {
  const calls: URL[] = []
  vi.stubGlobal('fetch', async (input: string) => {
    const url = new URL(input, 'https://example.com')
    calls.push(url)
    const first = url.searchParams.get('page') === '1'
    return new Response(
      JSON.stringify({
        code: 200,
        message: 'success',
        total: 101,
        page: first ? 1 : 2,
        page_size: 100,
        data: Array.from({ length: first ? 100 : 1 }, (_, index) => ({
          id: String(first ? index : 100),
          name: '公开赛事',
          fields: {},
          cover_url: null,
          status: 'upcoming',
        })),
      }),
    )
  })
  const items = await listAllContests({ date_from: '2026-11-01T00:00:00Z' })
  expect(items).toHaveLength(101)
  expect(calls).toHaveLength(2)
  expect(calls.every((url) => url.searchParams.get('date_from') === '2026-11-01T00:00:00Z')).toBe(
    true,
  )
})

it('空关注集合不退化为查询全站', async () => {
  vi.stubGlobal('fetch', () => {
    throw new Error('不应请求全部赛事')
  })
  expect(await listAllContests({ ids: [] })).toEqual([])
})
