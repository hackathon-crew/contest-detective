import { apiClient } from '@/shared/api'
import { conversationKey } from './conversation'
import { loadSessions, sessionsKey, type DetectiveSession } from './sessions'

export async function readAccountSessions(scope: string, signal?: AbortSignal) {
  if (scope === 'guest') return []
  const keys = [sessionsKey(scope), conversationKey(scope)]
  let before: (string | null)[] = []
  try {
    before = keys.map((key) => localStorage.getItem(key))
  } catch {
    /* Account history does not depend on browser storage access. */
  }
  const legacy = loadSessions(scope)
  for (let offset = 0; offset < legacy.length; offset += 50)
    await apiClient.request('/account/conversations/import', {
      method: 'POST',
      json: { sessions: legacy.slice(offset, offset + 50) },
      signal,
    })
  if (legacy.length) {
    try {
      // Preserve another tab's new writes; imported copies are safe to remove only after success.
      keys.forEach((key, index) => {
        if (localStorage.getItem(key) === before[index]) localStorage.removeItem(key)
      })
    } catch {
      // Server data is saved. A blocked cleanup only causes an idempotent import next time.
    }
  }
  return apiClient.request<DetectiveSession[]>('/account/conversations', { signal })
}
