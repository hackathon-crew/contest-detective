import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  apiClient,
  type ApiRequestOptions,
  type ContestDetail,
  type FollowRead,
} from '@/shared/api'

const key = (scope: string) => `contest-detective.live-album.${scope}`
const memory = new Map<string, ContestDetail[]>()
export function readAlbum(scope: string): ContestDetail[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key(scope)) ?? '[]')
    return Array.isArray(value)
      ? value.filter(
          (card): card is ContestDetail =>
            card &&
            typeof card.id === 'string' &&
            typeof card.name === 'string' &&
            card.fields &&
            typeof card.fields === 'object',
        )
      : []
  } catch {
    return memory.get(scope) ?? []
  }
}
export function storeAlbum(scope: string, cards: ContestDetail[]): boolean {
  memory.set(scope, cards)
  try {
    localStorage.setItem(key(scope), JSON.stringify(cards))
    return true
  } catch {
    return false
  }
}

/** 只为尚未收藏的比赛关闭提醒；已存在的关注和提醒保持原样。 */
export async function syncAlbum(
  scope: string,
  request: (path: string, options?: ApiRequestOptions) => Promise<unknown>,
): Promise<FollowRead[]> {
  const rows = [...((await request('/account/follows')) as FollowRead[])]
  const saved = new Set(rows.map((row) => row.contest.id))
  const pending = [
    ...new Map(
      [...readAlbum('guest'), ...readAlbum(scope)].map((card) => [card.id, card]),
    ).values(),
  ]
  for (const card of pending) {
    if (!saved.has(card.id)) {
      rows.push(
        (await request('/account/follows/' + encodeURIComponent(card.id), {
          method: 'PUT',
          json: { reminders: false },
        })) as FollowRead,
      )
      saved.add(card.id)
    }
    // 每张得到服务端确认后才清理，失败或中途离开仍能接着同步。
    for (const owner of [scope, 'guest'])
      storeAlbum(
        owner,
        readAlbum(owner).filter((item) => item.id !== card.id),
      )
  }
  return rows
}

export function useLiveAlbum(userId?: string) {
  const scope = userId ?? 'guest'
  const client = useQueryClient()
  const [revision, refresh] = useState(0)
  const [storageAvailable, setStorageAvailable] = useState(true)
  const queryKey = ['live-album', scope]
  const query = useQuery({
    queryKey,
    enabled: !!userId,
    queryFn: () => syncAlbum(scope, apiClient.request),
    staleTime: 30000,
    retry: 2,
  })
  useEffect(() => {
    const update = () => {
      refresh((value) => value + 1)
      if (userId) void client.invalidateQueries({ queryKey: ['live-album', scope] })
    }
    window.addEventListener('online', update)
    window.addEventListener('storage', update)
    window.addEventListener('focus', update)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('storage', update)
      window.removeEventListener('focus', update)
    }
  }, [scope, userId, client])
  void revision
  const cards = [
    ...new Map(
      [
        ...(query.data ?? []).map((row) => row.contest),
        ...readAlbum(scope),
        ...(userId ? readAlbum('guest') : []),
      ].map((card) => [card.id, card]),
    ).values(),
  ]
  function collect(contest: ContestDetail) {
    const pending = [
      ...new Map([...readAlbum(scope), contest].map((card) => [card.id, card])).values(),
    ]
    setStorageAvailable(storeAlbum(scope, pending))
    refresh((value) => value + 1)
    if (userId) void client.invalidateQueries({ queryKey })
  }
  return {
    cards,
    collect,
    notice: !storageAvailable
      ? '卡片已留在当前页面，浏览器未允许写入本机存储。'
      : userId && query.isError
        ? '卡片已收在本机，连接恢复后会继续同步到账号。'
        : '',
  }
}
