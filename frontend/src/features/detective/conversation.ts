import { safeUrl } from '@/entities/contest'
import type { ConversationMessage, MatchItem, Profile, ContestRecommendation } from '@/shared/api'
import type { InvestigationPlan, InvestigationReport } from './verification-contracts'
import { parseInvestigationPlan, parseInvestigationReport } from './verification-report'
import { parseTrace, type TraceEvent, type TraceSource } from './events'

export type ToolEvent = Extract<TraceEvent, { type: 'step' | 'observation' }>
export type { ContestRecommendation } from '@/shared/api'
export interface ProfileFile {
  name: string
  profile: Profile
  candidates: MatchItem[]
}
export interface DetectiveTurn {
  id: string
  question: string
  content: string
  trace: ToolEvent[]
  sources: TraceSource[]
  status: 'running' | 'completed' | 'stopped' | 'error'
  error?: string
  investigationId?: string
  lastSeq?: number
  plan?: InvestigationPlan
  report?: InvestigationReport
  // 与正文一起保存 Agent 最终选中的比赛；旧记录缺少此字段时按正文引用补读。
  recommendations?: ContestRecommendation[]
  profileFile?: ProfileFile
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
      const trace = turn.trace.flatMap((item: ToolEvent) => {
        const event = parseTrace({ event: item.type, data: JSON.stringify(item), id: null })
        return event?.type === 'step' || event?.type === 'observation' ? [event] : []
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
        ...(turn.plan != null ? { plan: parseInvestigationPlan(turn.plan) } : {}),
        ...(turn.report != null ? { report: parseInvestigationReport(turn.report) } : {}),
        ...(turn.status === 'running' && !turn.investigationId
          ? { status: 'stopped', error: '回复已中断，可以继续提问。' }
          : {}),
      } as DetectiveTurn
    })
  } catch {
    return []
  }
}

/** 将已完成对话的完整内容交给模型，保留用户此前给出的条件与上下文。 */
export function historyFor(turns: DetectiveTurn[]): ConversationMessage[] {
  return turns
    .filter((turn) => turn.status === 'completed' && turn.content.trim())
    .flatMap((turn) => [
      { role: 'user' as const, content: turn.question },
      { role: 'assistant' as const, content: turn.content },
    ])
}
