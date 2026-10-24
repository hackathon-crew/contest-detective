import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { apiClient, type Profile } from '@/shared/api'
import { historyFor, type DetectiveTurn } from './conversation'
import { loadSessions, sessionsKey, sessionWithTurn, type DetectiveSession } from './sessions'
import { parseTrace } from './events'
import { DetectiveContext } from './detective-context'

export function DetectiveProvider({ scope, children }: { scope: string; children: ReactNode }) {
  const client = useQueryClient()
  const [sessions, setSessions] = useState(() => loadSessions(scope))
  const snapshot = useRef(sessions)
  const requests = useRef(new Map<string, AbortController>())
  const [storageError, setStorageError] = useState(false)

  useEffect(
    () => () => {
      for (const controller of requests.current.values()) controller.abort()
    },
    [],
  )
  useEffect(() => {
    try {
      localStorage.setItem(sessionsKey(scope), JSON.stringify(sessions))
      queueMicrotask(() => setStorageError(false))
    } catch {
      queueMicrotask(() => setStorageError(true))
    }
  }, [scope, sessions])

  function change(transform: (sessions: DetectiveSession[]) => DetectiveSession[]) {
    snapshot.current = transform(snapshot.current)
    setSessions(snapshot.current)
  }
  function update(
    sessionId: string,
    turnId: string,
    transform: (turn: DetectiveTurn) => DetectiveTurn,
  ) {
    change((items) =>
      items.map((session) =>
        session.id === sessionId
          ? {
              ...session,
              turns: session.turns.map((turn) => (turn.id === turnId ? transform(turn) : turn)),
            }
          : session,
      ),
    )
  }
  function stop(sessionId: string) {
    const controller = requests.current.get(sessionId)
    if (!controller) return
    controller.abort()
    requests.current.delete(sessionId)
    change((items) =>
      items.map((session) =>
        session.id === sessionId
          ? {
              ...session,
              turns: session.turns.map((turn) =>
                turn.status === 'running'
                  ? { ...turn, status: 'stopped', error: '查证已停止。' }
                  : turn,
              ),
            }
          : session,
      ),
    )
  }
  function send(question: string, profile?: Profile | null, sessionId?: string) {
    const text = question.trim()
    const existing = snapshot.current.find((session) => session.id === sessionId)
    if (existing && requests.current.has(existing.id)) return existing.id
    const turnId = crypto.randomUUID()
    const turn: DetectiveTurn = {
      id: turnId,
      question: text,
      content: '',
      trace: [],
      sources: [],
      status: 'running',
    }
    const next = sessionWithTurn(text, turn, existing)
    const id = next.id
    if (!text) return id
    const controller = new AbortController()
    requests.current.set(id, controller)
    change((items) =>
      existing ? items.map((session) => (session.id === id ? next : session)) : [next, ...items],
    )
    void run(id, turnId, text, historyFor(existing?.turns ?? []), profile, controller)
    return id
  }
  async function run(
    sessionId: string,
    turnId: string,
    question: string,
    history: ReturnType<typeof historyFor>,
    profile: Profile | null | undefined,
    controller: AbortController,
  ) {
    let terminal = false
    const fail = (message: string) =>
      update(sessionId, turnId, (turn) => ({ ...turn, status: 'error', error: message }))
    try {
      for await (const raw of apiClient.stream('/agent/ask', {
        method: 'POST',
        json: { question, ...(history.length ? { history } : {}), ...(profile ? { profile } : {}) },
        signal: controller.signal,
      })) {
        if (controller.signal.aborted) break
        const event = parseTrace(raw)
        if (event.type === 'answer') {
          update(sessionId, turnId, (turn) => ({
            ...turn,
            content: event.content,
            sources: event.sources,
            status: 'completed',
          }))
          terminal = true
          void client.invalidateQueries({ queryKey: ['contests'] })
          void client.invalidateQueries({ queryKey: ['contest'] })
          break
        }
        if (event.type === 'error') {
          fail(event.message)
          terminal = true
          break
        }
        if (event.type === 'delta')
          update(sessionId, turnId, (turn) => ({ ...turn, content: turn.content + event.content }))
        else update(sessionId, turnId, (turn) => ({ ...turn, trace: [...turn.trace, event] }))
      }
      if (!terminal && !controller.signal.aborted) fail('查证提前结束，请重试。')
    } catch (cause) {
      if (!controller.signal.aborted)
        fail(cause instanceof Error ? cause.message : '查证失败，请重试。')
    } finally {
      if (requests.current.get(sessionId) === controller) requests.current.delete(sessionId)
    }
  }
  return (
    <DetectiveContext value={{ sessions, storageError, send, stop }}>{children}</DetectiveContext>
  )
}
