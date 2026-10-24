import { afterEach, expect, it, vi } from 'vitest'
import { listAllContests, loadContestLibrary } from './collection'

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

it('全量加载补齐详情摘要和来源，限定并发并复用详情缓存', async () => {
  let active = 0,
    peak = 0
  const cached: string[] = []
  vi.stubGlobal('fetch', async (input: string) => {
    const url = new URL(input, 'https://example.com')
    const id = url.pathname.split('/').at(-1)!
    const base = { name: '赛事', cover_url: null, status: 'upcoming', fields: {} }
    if (url.pathname === '/api/contests')
      return new Response(
        JSON.stringify({
          code: 200,
          message: 'success',
          data: Array.from({ length: 8 }, (_, i) => ({ ...base, id: String(i) })),
          total: 8,
          page: 1,
          page_size: 100,
        }),
      )
    active++
    peak = Math.max(peak, active)
    await new Promise((resolve) => setTimeout(resolve, 1))
    active--
    return new Response(
      JSON.stringify({
        code: 200,
        message: 'success',
        data: { ...base, id, summary: 'Education、Health' },
      }),
    )
  })
  const result = await loadContestLibrary((detail) => cached.push(detail.id))
  expect(result).toHaveLength(8)
  expect(result.every((c) => c.summary === 'Education、Health')).toBe(true)
  expect(cached).toHaveLength(8)
  expect(peak).toBeLessThanOrEqual(6)
})

it('先交付完整列表，详情读取不挡住已知字段和计数', async () => {
  let seeded = false
  const item = { id: 'one', name: '赛事', cover_url: null, status: 'upcoming', fields: {} }
  vi.stubGlobal('fetch', async (input: string) => {
    const detail = String(input).includes('/contests/one')
    if (detail) expect(seeded).toBe(true)
    return Response.json({
      code: 200,
      message: 'ok',
      data: detail ? { ...item, summary: 'Education' } : [item],
      total: 1,
      page: 1,
      page_size: 100,
    })
  })
  await loadContestLibrary(undefined, (items) => {
    expect(items).toHaveLength(1)
    seeded = true
  })
  expect(seeded).toBe(true)
})
