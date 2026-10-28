import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useLocation, useMatch, useNavigate } from 'react-router'
import { apiClient, ApiError, type ContestRecommendation, type Profile } from '@/shared/api'
import { currentUserKey, loginReturn, useLoginGate } from '@/entities/user'
import { historyFor, type DetectiveTurn } from './conversation'
import { loadSessions, sessionWithTurn, type DetectiveSession } from './sessions'
import { readAccountSessions } from './sessions-api'
import { parseTrace, recoveryAction, type RecoveryAction } from './events'

import { DetectiveContext } from './detective-context'
import { createId } from './id'
import { cancelInvestigation, investigationStream } from './investigation-stream'
import type { VerificationOptions } from './verification-contracts'

export function DetectiveProvider({ scope, children }: { scope: string; children: ReactNode }) {
  const client = useQueryClient()
  const location = useLocation()
  const navigate = useNavigate()
  const requireLogin = useLoginGate()
  const [sessions, setSessions] = useState(() => (scope === 'guest' ? [] : loadSessions(scope)))
  const [loading, setLoading] = useState(scope !== 'guest')
  const snapshot = useRef(sessions)
  const revision = useRef(0)
  const edited = useRef(new Map<string, number>())
  const legacyTurns = useRef(
    new Set(
      sessions.flatMap((session) =>
        session.turns
          .filter((turn) => turn.status === 'completed' && turn.recommendations == null)
          .map((turn) => turn.id),
      ),
    ),
  )
  const requests = useRef(new Map<string, AbortController>())
  const recovering = useRef(new Set<string>())
  const [storageError, setStorageError] = useState(false)
  const activeId = useMatch('/detective/:conversationId')?.params.conversationId

  const reload = useCallback(
    async (signal?: AbortSignal) => {
      if (scope === 'guest') return
      const started = revision.current
      try {
        const saved = await readAccountSessions(scope, signal)
        if (signal?.aborted) return
        const merged = new Map(saved.map((item) => [item.id, item]))
        for (const item of snapshot.current)
          if (requests.current.has(item.id) || (edited.current.get(item.id) ?? 0) > started)
            merged.set(item.id, item)
        change(() => [...merged.values()].sort((a, b) => b.updatedAt - a.updatedAt))
        setStorageError(false)
      } catch {
        if (!signal?.aborted) setStorageError(true)
      } finally {
        if (!signal?.aborted) setLoading(false)
      }
    },
    [scope],
  )

  useEffect(
    () => () => {
      for (const controller of requests.current.values()) controller.abort()
      requests.current.clear()
    },
    [],
  )
  useEffect(() => {
    const controller = new AbortController()
    void reload(controller.signal)
    const refresh = () => void reload(controller.signal)
    window.addEventListener('focus', refresh)
    return () => {
      controller.abort()
      window.removeEventListener('focus', refresh)
    }
  }, [reload])

  const remoteRunning = sessions.some(
    (item) =>
      item.turns.some((turn) => turn.status === 'running') && !requests.current.has(item.id),
  )
  useEffect(() => {
    if (!remoteRunning) return
    const controller = new AbortController()
    const timer = setInterval(() => void reload(controller.signal), 2000)
    return () => {
      clearInterval(timer)
      controller.abort()
    }
  }, [remoteRunning, reload])

  useEffect(() => {
    for (const session of sessions) {
      const turn = session.turns.find((item) => item.status === 'running' && item.investigationId)
      if (!turn || requests.current.has(session.id)) continue
      const controller = new AbortController()
      requests.current.set(session.id, controller)
      void run(session.id, turn.id, turn.question, [], undefined, controller, undefined, true)
    }
  }, [sessions])

  useEffect(() => {
    const active = sessions.find((session) => session.id === activeId)
    if (!active) return
    for (const turn of active.turns) {
      if (
        !legacyTurns.current.has(turn.id) ||
        turn.status !== 'completed' ||
        turn.report ||
        turn.recommendations != null ||
        recovering.current.has(turn.id)
      )
        continue
      recovering.current.add(turn.id)
      void apiClient
        .request<ContestRecommendation[]>('/agent/recommendations/resolve', {
          method: 'POST',
          json: { content: turn.content, sources: turn.sources },
        })
        .then((recommendations) => {
          update(active.id, turn.id, (current) => ({ ...current, recommendations }))
        })
        .catch(() => {
          // 补读失败时保留原回复；下次打开会话可重新读取，不把旧对话标成查证失败。
        })
        .finally(() => recovering.current.delete(turn.id))
    }
  }, [activeId, sessions])

  function change(transform: (sessions: DetectiveSession[]) => DetectiveSession[]) {
    snapshot.current = transform(snapshot.current)
    setSessions(snapshot.current)
  }
  function update(
    sessionId: string,
    turnId: string,
    transform: (turn: DetectiveTurn) => DetectiveTurn,
  ) {
    edited.current.set(sessionId, ++revision.current)
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
  async function stop(sessionId: string) {
    const controller = requests.current.get(sessionId)
    if (!controller) return
    const turn = snapshot.current
      .find((session) => session.id === sessionId)
      ?.turns.find((item) => item.status === 'running')
    if (turn?.investigationId) {
      try {
        await cancelInvestigation(turn.investigationId, controller.signal)
      } catch {
        update(sessionId, turn.id, (current) => ({
          ...current,
          error: '停止操作未能送达，请再次点击停止查证。',
        }))
        return
      }
    }
    controller.abort()
    requests.current.delete(sessionId)
    change((items) =>
      items.map((session) =>
        session.id === sessionId
          ? {
              ...session,
              turns: session.turns.map((current) =>
                current.id === turn?.id
                  ? { ...current, status: 'stopped', error: '查证已停止。', action: undefined }
                  : current,
              ),
            }
          : session,
      ),
    )
  }
  function send(
    question: string,
    profile?: Profile | null,
    sessionId?: string,
    verificationOptions?: VerificationOptions,
  ) {
    const text = question.trim()
    if (!requireLogin({ question: text })) return null
    const existing = snapshot.current.find((session) => session.id === sessionId)
    if (existing && requests.current.has(existing.id)) return existing.id
    const turnId = createId()
    const turn: DetectiveTurn = {
      id: turnId,
      investigationId: turnId,
      lastSeq: 0,
      request: { profile, verificationOptions },
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
    edited.current.set(id, ++revision.current)
    change((items) =>
      existing ? items.map((session) => (session.id === id ? next : session)) : [next, ...items],
    )
    void run(
      id,
      turnId,
      text,
      historyFor(existing?.turns ?? []),
      profile,
      controller,
      verificationOptions,
    )
    return id
  }
  function retry(turnId: string) {
    const session = snapshot.current.find((item) => item.turns.some((turn) => turn.id === turnId))
    if (!session || requests.current.has(session.id)) return
    const index = session.turns.findIndex((turn) => turn.id === turnId)
    const previous = session.turns[index]!
    const controller = new AbortController()
    requests.current.set(session.id, controller)
    update(session.id, turnId, (turn) => ({
      ...turn,
      investigationId: createId(),
      lastSeq: 0,
      content: '',
      trace: [],
      sources: [],
      status: 'running',
      error: undefined,
      action: undefined,
      recommendations: undefined,
      report: undefined,
      plan: undefined,
    }))
    void run(
      session.id,
      turnId,
      previous.question,
      historyFor(session.turns.slice(0, index)),
      previous.request?.profile,
      controller,
      previous.request?.verificationOptions,
      false,
      previous.investigationId,
    )
  }
  async function run(
    sessionId: string,
    turnId: string,
    question: string,
    history: ReturnType<typeof historyFor>,
    profile: Profile | null | undefined,
    controller: AbortController,
    verificationOptions?: VerificationOptions,
    resume = false,
    retryOf?: string,
  ) {
    let terminal = false
    const fail = (message: string, action?: RecoveryAction) =>
      update(sessionId, turnId, (turn) => ({
        ...turn,
        status: turn.content.trim() ? 'stopped' : 'error',
        error: message,
        action,
      }))
    try {
      const current = snapshot.current
        .find((session) => session.id === sessionId)
        ?.turns.find((turn) => turn.id === turnId)
      for await (const raw of investigationStream(
        {
          investigation_id: current?.investigationId ?? turnId,
          conversation_id: sessionId,
          turn_id: turnId,
          ...(retryOf ? { retry_of: retryOf } : {}),

          question,
          ...(history.length ? { history } : {}),
          ...(profile ? { profile } : {}),
          ...verificationOptions,
        },
        controller.signal,
        { after: current?.lastSeq ?? 0, resume },
      )) {
        if (controller.signal.aborted) break
        const event = parseTrace(raw)
        if (!event) continue
        const updateEvent = (transform: (turn: DetectiveTurn) => DetectiveTurn) =>
          update(sessionId, turnId, (turn) => ({
            ...transform(turn),
            ...(raw.id !== null ? { lastSeq: Number(raw.id) } : {}),
          }))
        if (event.type === 'answer') {
          updateEvent((turn) => ({
            ...turn,
            content: event.content || turn.content,
            sources: event.sources,
            recommendations: event.recommendations,
            report: event.report,
            plan: event.report?.plan ?? turn.plan,
            action: event.action,
            error: undefined,
            status:
              event.action === 'retry' || event.action === 'settings' ? 'stopped' : 'completed',
          }))
          terminal = true
          void client.invalidateQueries({ queryKey: ['contests'] })
          void client.invalidateQueries({ queryKey: ['contest'] })
          break
        }
        if (event.type === 'error') {
          fail(event.message, event.action)
          terminal = true
          break
        }
        if (event.type === 'plan') {
          updateEvent((turn) => ({ ...turn, plan: event.plan }))
          continue
        }
        if (event.type === 'delta')
          updateEvent((turn) => ({ ...turn, content: turn.content + event.content }))
        else updateEvent((turn) => ({ ...turn, trace: [...turn.trace, event] }))
      }
      if (!terminal && !controller.signal.aborted)
        fail('这次查证没能完成。点击一键重查，无需重新输入问题。', 'retry')
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === 401) {
        client.setQueryData(currentUserKey, null)
        navigate('/login', { state: loginReturn(location, { question }) })
      }
      if (!controller.signal.aborted)
        fail(
          cause instanceof ApiError && cause.kind === 'business'
            ? cause.message
            : '这次查证没能完成。点击一键重查，无需重新输入问题。',
          cause instanceof ApiError && cause.kind === 'business'
            ? (recoveryAction((cause.data as { action?: unknown } | null)?.action) ?? 'retry')
            : 'retry',
        )
    } finally {
      if (requests.current.get(sessionId) === controller) requests.current.delete(sessionId)
    }
  }
  return (
    <DetectiveContext value={{ sessions, loading, storageError, reload, send, stop, retry }}>
      {children}
    </DetectiveContext>
  )
}
