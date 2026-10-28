import { ApiError, apiClient } from '@/shared/api'

function pause(milliseconds: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    signal.throwIfAborted()
    const abort = () => {
      clearTimeout(timer)
      reject(signal.reason)
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort)
      resolve()
    }, milliseconds)
    signal.addEventListener('abort', abort, { once: true })
  })
}

export async function* investigationStream(
  body: { investigation_id: string; question: string; [key: string]: unknown },
  signal: AbortSignal,
  { after = 0, resume = false } = {},
) {
  for (let attempt = 0; attempt < 8; attempt++) {
    signal.throwIfAborted()
    const connection = new AbortController()
    let idle = setTimeout(() => connection.abort(), 30_000)
    try {
      const reconnect = resume || after > 0
      const path = reconnect
        ? `/agent/investigations/${body.investigation_id}/events`
        : '/agent/ask'
      for await (const event of apiClient.stream(path, {
        ...(reconnect
          ? { headers: { 'Last-Event-ID': String(after) } }
          : { method: 'POST', json: body }),
        signal: AbortSignal.any([signal, connection.signal]),
      })) {
        clearTimeout(idle)
        idle = setTimeout(() => connection.abort(), 30_000)
        if (event.id !== null) {
          const seq = Number(event.id)
          if (seq <= after) continue
          after = seq
        }
        attempt = 0
        yield event
      }
    } catch (cause) {
      if (
        signal.aborted ||
        (!connection.signal.aborted && !(cause instanceof ApiError && cause.retryable))
      )
        throw cause
    } finally {
      clearTimeout(idle)
    }
    await pause(Math.min(1000 * 2 ** attempt, 8000), signal)
  }
  throw new Error('自动恢复未能完成。点击一键重查，无需重新输入问题。')
}

export async function cancelInvestigation(id: string, signal: AbortSignal) {
  for (let attempt = 0; ; attempt++) {
    try {
      await apiClient.request(`/agent/investigations/${id}/cancel`, { method: 'POST', signal })
      return
    } catch (cause) {
      if (!(cause instanceof ApiError && cause.retryable) || attempt === 7) throw cause
      await pause(Math.min(1000 * 2 ** attempt, 8000), signal)
    }
  }
}
