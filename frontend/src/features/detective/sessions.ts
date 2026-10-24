import { loadConversation, type DetectiveTurn } from './conversation'

export interface DetectiveSession {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  turns: DetectiveTurn[]
}

export const sessionsKey = (scope: string) => `contest-detective.sessions.${scope}`

export function sessionWithTurn(
  question: string,
  turn: DetectiveTurn,
  previous?: DetectiveSession,
): DetectiveSession {
  const now = Date.now()
  return previous
    ? { ...previous, updatedAt: now, turns: [...previous.turns, turn] }
    : {
        id: crypto.randomUUID(),
        title: Array.from(question.replace(/\s+/g, ' ')).slice(0, 32).join(''),
        createdAt: now,
        updatedAt: now,
        turns: [turn],
      }
}

export function loadSessions(scope: string): DetectiveSession[] {
  try {
    const saved = localStorage.getItem(sessionsKey(scope))
    if (saved === null) {
      const turns = loadConversation(scope)
      // 旧版单段记录归入一个会话，原记录保留，迁移失败也能再次恢复。
      return turns.length
        ? [{ id: 'previous', title: turns[0]!.question, createdAt: 0, updatedAt: 0, turns }]
        : []
    }
    const sessions: unknown = JSON.parse(saved)
    if (!Array.isArray(sessions)) return []
    return sessions.flatMap((session) => {
      if (
        !session ||
        typeof session.id !== 'string' ||
        typeof session.title !== 'string' ||
        !Number.isFinite(session.createdAt) ||
        !Number.isFinite(session.updatedAt) ||
        !Array.isArray(session.turns)
      )
        return []
      const turns = loadConversation('', session.turns)
      return turns.length ? [{ ...session, turns } as DetectiveSession] : []
    })
  } catch {
    return []
  }
}
