import { useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCurrentUser } from '@/entities/user'
import { apiClient } from '@/shared/api'
import type { FollowRead } from '@/shared/api/generated'

export const FOLLOW_STORAGE_KEY = 'contest-detective:follows'
const localKeys = [FOLLOW_STORAGE_KEY, 'inkpaw-follows']
export interface FollowController {
  ids: string[]
  toggle: (contestId: string) => void
  pending: boolean
  error: string | null
}
function stored(key: string): string[] {
  const value: unknown = JSON.parse(localStorage.getItem(key) ?? '[]')
  return Array.isArray(value)
    ? value.filter((id): id is string => typeof id === 'string' && !!id)
    : []
}
function readFollows(): Pick<FollowController, 'ids' | 'error'> {
  const ids: string[] = []
  let error: string | null = null
  for (const key of localKeys) {
    try {
      ids.push(...stored(key))
    } catch {
      error = '无法读取关注，请检查浏览器存储设置'
    }
  }
  return { ids: [...new Set(ids)], error }
}
function clearMigrated(ids: string[]) {
  const migrated = new Set(ids)
  for (const key of localKeys) {
    let values: string[]
    try {
      values = stored(key)
    } catch (e) {
      if (e instanceof SyntaxError) continue
      throw e
    }
    const left = values.filter((id) => !migrated.has(id))
    if (left.length) localStorage.setItem(key, JSON.stringify(left))
    else localStorage.removeItem(key)
  }
}
export function useFollows() {
  const auth = useCurrentUser(),
    user = auth.data,
    client = useQueryClient()
  const [local, setLocal] = useState(readFollows),
    [error, setError] = useState<string | null>(null),
    [saving, setSaving] = useState(false)
  const busy = useRef(false),
    key = ['account-follows', user?.id]
  const query = useQuery({
    queryKey: key,
    enabled: !!user,
    staleTime: 30000,
    queryFn: async () => {
      const snapshot = readFollows()
      const rows = await apiClient.request<FollowRead[]>(
        snapshot.ids.length ? '/account/follows/merge' : '/account/follows',
        snapshot.ids.length ? { method: 'POST', json: { ids: snapshot.ids } } : undefined,
      )
      if (snapshot.ids.length) {
        await client.invalidateQueries({ queryKey: ['account-summary', user?.id] })
        try {
          clearMigrated(snapshot.ids)
          setLocal(readFollows())
        } catch {
          setError('关注已同步，无法清理本机记录，请检查浏览器存储设置')
        }
      }
      return rows
    },
  })
  async function setFollow(contestId: string, on: boolean, reminders?: boolean) {
    if (busy.current) return
    busy.current = true
    setSaving(true)
    setError(null)
    try {
      if (user) {
        await apiClient.request('/account/follows/' + contestId, {
          method: on ? 'PUT' : 'DELETE',
          ...(on ? { json: reminders === undefined ? {} : { reminders } } : {}),
        })
        await Promise.all([
          client.invalidateQueries({ queryKey: key }),
          client.invalidateQueries({ queryKey: ['account-summary', user.id] }),
        ])
      } else {
        const current = readFollows().ids,
          next = on
            ? [...new Set([...current, contestId])]
            : current.filter((id) => id !== contestId)
        localStorage.setItem(FOLLOW_STORAGE_KEY, JSON.stringify(next))
        localStorage.removeItem('inkpaw-follows')
        setLocal({ ids: next, error: null })
      }
    } catch (e) {
      const text = user
        ? e instanceof Error
          ? e.message
          : '无法同步关注，请重试'
        : '无法保存关注，请检查浏览器存储设置'
      setError(text)
      throw new Error(text)
    } finally {
      busy.current = false
      setSaving(false)
    }
  }
  async function setReminders(contestId: string, reminders: boolean) {
    if (!user || busy.current) return
    busy.current = true
    setSaving(true)
    setError(null)
    try {
      await apiClient.request('/account/follows/' + contestId, {
        method: 'PATCH',
        json: { reminders },
      })
      await client.invalidateQueries({ queryKey: key })
    } catch (e) {
      const text = e instanceof Error ? e.message : '无法修改提醒，请重试'
      setError(text)
      throw new Error(text)
    } finally {
      busy.current = false
      setSaving(false)
    }
  }
  const ids = user ? (query.data ?? []).map((row) => row.contest.id) : local.ids
  const toggle = (contestId: string) => {
    void setFollow(contestId, !ids.includes(contestId)).catch(() => {})
  }
  return {
    ids,
    toggle,
    rows: user ? (query.data ?? []) : [],
    setFollow,
    setReminders,
    pending: auth.isPending || saving || (!!user && query.isPending),
    error: error ?? (query.error instanceof Error ? query.error.message : local.error),
  }
}
