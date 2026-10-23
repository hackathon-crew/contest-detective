import { useCallback, useRef, useState } from 'react'

export const FOLLOW_STORAGE_KEY = 'contest-detective:follows'
export interface FollowController {
  ids: string[]
  toggle: (contestId: string) => void
  pending: boolean
  error: string | null
}

function readFollows(): Pick<FollowController, 'ids' | 'error'> {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(FOLLOW_STORAGE_KEY) ?? '[]')
    const ids = Array.isArray(stored)
      ? [
          ...new Set(
            stored.filter((item): item is string => typeof item === 'string' && item.length > 0),
          ),
        ]
      : []
    return { ids, error: null }
  } catch {
    return { ids: [], error: '无法读取关注，请检查浏览器存储设置' }
  }
}

export function useFollows(): FollowController {
  const [state, setState] = useState(readFollows)
  const currentIds = useRef(state.ids)
  const toggle = useCallback((contestId: string) => {
    const next = currentIds.current.includes(contestId)
      ? currentIds.current.filter((id) => id !== contestId)
      : [...currentIds.current, contestId]
    try {
      localStorage.setItem(FOLLOW_STORAGE_KEY, JSON.stringify(next))
      currentIds.current = next
      setState({ ids: next, error: null })
    } catch {
      setState((current) => ({ ...current, error: '无法保存关注，请检查浏览器存储设置' }))
    }
  }, [])
  return { ...state, toggle, pending: false }
}
