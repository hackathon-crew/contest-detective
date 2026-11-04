// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest'
import type { ContestDetail, FollowRead } from '@/shared/api'
import { readAlbum, storeAlbum, syncAlbum } from './live-album'
const contest: ContestDetail = {
  id: 'one',
  name: '比赛',
  cover_url: null,
  status: 'upcoming',
  fields: {},
  summary: null,
}
afterEach(() => localStorage.clear())
it('游客收下的卡刷新可读，账号本机队列互不串号', () => {
  storeAlbum('guest', [contest])
  storeAlbum('alice', [{ ...contest, id: 'private' }])
  expect(readAlbum('guest').map((card) => card.id)).toEqual(['one'])
  expect(readAlbum('bob')).toEqual([])
})
it('同步不关闭已有提醒；新卡只收藏、不发邮件', async () => {
  const rows: FollowRead[] = [{ contest, reminders: true, created_at: '2026-11-05T00:00:00Z' }]
  storeAlbum('alice', [contest, { ...contest, id: 'two' }])
  const result = await syncAlbum('alice', async (path, options) => {
    if (path.endsWith('/two') && options)
      rows.push({
        contest: { ...contest, id: 'two' },
        reminders: (options?.json as { reminders: boolean }).reminders,
        created_at: '2026-11-05T00:00:00Z',
      })
    else if (options?.method === 'PUT') rows[0].reminders = false
    return options?.method === 'PUT' ? rows.at(-1) : rows
  })
  expect(result.map((row) => [row.contest.id, row.reminders])).toEqual([
    ['one', true],
    ['two', false],
  ])
  expect(readAlbum('alice')).toEqual([])
})
it('网络保存失败保留待同步卡，后续可继续保存', async () => {
  storeAlbum('alice', [contest])
  await expect(
    syncAlbum('alice', async () => {
      throw new Error('offline')
    }),
  ).rejects.toThrow('offline')
  expect(readAlbum('alice').map((card) => card.id)).toEqual(['one'])
})
