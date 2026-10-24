import { safeUrl } from '@/entities/contest'
import type { ConversationMessage } from '@/shared/api/generated'
import { parseTrace, type TraceEvent, type TraceSource } from './events'

export type ToolEvent = Extract<TraceEvent, { type: 'step' | 'observation' }>
export interface DetectiveTurn {
  id: string
  question: string
  content: string
  trace: ToolEvent[]
  sources: TraceSource[]
  status: 'running' | 'completed' | 'stopped' | 'error'
  error?: string
}

export const conversationKey = (scope: string) => `contest-detective.conversation.${scope}`

export function loadConversation(scope: string, value?: unknown): DetectiveTurn[] {
  try {
    const saved: unknown = value ?? JSON.parse(localStorage.getItem(conversationKey(scope)) ?? '[]')
    if (!Array.isArray(saved)) return []
    return saved.map((turn) => {
      if (
        !turn ||
        typeof turn !== 'object' ||
        typeof turn.id !== 'string' ||
        typeof turn.question !== 'string' ||
        typeof turn.content !== 'string' ||
        !Array.isArray(turn.trace) ||
        !Array.isArray(turn.sources) ||
        !['running', 'completed', 'stopped', 'error'].includes(turn.status) ||
        (turn.error !== undefined && typeof turn.error !== 'string')
      )
        throw new Error('invalid conversation')
      const trace = turn.trace.map((item: ToolEvent) => {
        const event = parseTrace({ event: item.type, data: JSON.stringify(item), id: null })
        if (event.type !== 'step' && event.type !== 'observation')
          throw new Error('invalid tool event')
        return event
      })
      if (
        !turn.sources.every(
          (source: TraceSource) =>
            source &&
            typeof source.title === 'string' &&
            typeof source.url === 'string' &&
            safeUrl(source.url) &&
            typeof source.site === 'string' &&
            (source.is_official === undefined || typeof source.is_official === 'boolean') &&
            (source.stale === undefined || typeof source.stale === 'boolean'),
        )
      )
        throw new Error('invalid sources')
      return {
        ...turn,
        trace,
        ...(turn.status === 'running'
          ? { status: 'stopped', error: '回复已中断，可以继续提问。' }
          : {}),
      } as DetectiveTurn
    })
  } catch {
    return []
  }
}

/** 本地保留完整记录；模型只接最近六轮、最多 12KB 的已完成前文。 */
export function historyFor(turns: DetectiveTurn[]): ConversationMessage[] {
  const history: ConversationMessage[] = []
  const encoder = new TextEncoder()
  let bytes = 0
  for (const turn of turns.toReversed()) {
    if (turn.status !== 'completed' || !turn.content.trim()) continue
    const content = Array.from(turn.content).slice(0, 2500).join('')
    const size = encoder.encode(turn.question + content).length
    if (history.length >= 12 || bytes + size > 12000) break
    history.unshift({ role: 'user', content: turn.question }, { role: 'assistant', content })
    bytes += size
  }
  return history
}
