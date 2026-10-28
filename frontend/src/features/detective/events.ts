import type { ContestRecommendation, ServerSentEvent } from '@/shared/api'
import type {
  InvestigationPlan,
  InvestigationReport,
  SearchExecution,
} from './verification-contracts'
import {
  parseInvestigationPlan,
  parseInvestigationReport,
  parseSearchExecution,
} from './verification-report'

export interface TraceSource {
  title: string
  url: string
  site: string
  is_official?: boolean
  stale?: boolean
  provider?: string | null
  query?: string | null
  retrieved_at?: string | null
}
export type TraceEvent =
  | { type: 'plan'; plan: InvestigationPlan }
  | { type: 'step'; tool: string; label: string }
  | {
      type: 'observation'
      tool: string
      summary: string
      sources: TraceSource[]
      execution?: SearchExecution
      status?: 'success' | 'failure' | 'stopped'
    }
  | { type: 'delta'; content: string }
  | {
      type: 'answer'
      content: string
      sources: TraceSource[]
      recommendations?: ContestRecommendation[]
      report?: InvestigationReport
    }
  | { type: 'error'; message: string }

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 旧消息靠真实搜索回执判断；新消息也覆盖没有搜索回执的工具失败。 */
export function observationStatus(event: Extract<TraceEvent, { type: 'observation' }>) {
  return event.execution?.status === 'failure' ? 'failure' : (event.status ?? 'success')
}
function sources(value: unknown): TraceSource[] {
  if (!Array.isArray(value)) return []
  return value.filter(record).map((item) => ({
    ...item,
    title: typeof item.title === 'string' ? item.title : '',
    url: typeof item.url === 'string' ? item.url : '',
    site: typeof item.site === 'string' ? item.site : '',
    is_official: item.is_official === true,
    stale: item.stale === true,
  })) as TraceSource[]
}

function optional<T>(value: unknown, parse: (value: unknown) => T): T | undefined {
  if (value == null) return undefined
  try {
    return parse(value)
  } catch {
    return undefined
  }
}

/** 附加资料不可用时继续接收正文，不因单个字段丢掉整条回答。 */
export function parseTrace(event: ServerSentEvent): TraceEvent | null {
  let value: unknown
  try {
    value = JSON.parse(event.data)
  } catch {
    return null
  }
  if (!record(value)) return null
  if (event.event === 'plan') {
    const plan = optional(value, parseInvestigationPlan)
    return plan ? { type: 'plan', plan } : null
  }
  if (event.event === 'delta' && typeof value.content === 'string')
    return { type: 'delta', content: value.content }
  if (event.event === 'step' && typeof value.tool === 'string' && typeof value.label === 'string')
    return { type: 'step', tool: value.tool, label: value.label }
  if (
    event.event === 'observation' &&
    typeof value.tool === 'string' &&
    typeof value.summary === 'string'
  )
    return {
      type: 'observation',
      tool: value.tool,
      summary: value.summary,
      sources: sources(value.sources),
      execution: optional(value.execution, parseSearchExecution),
      ...(value.status === 'success' || value.status === 'failure' || value.status === 'stopped'
        ? { status: value.status }
        : {}),
    }
  if (event.event === 'answer' && typeof value.content === 'string') {
    const report = optional(value.report, parseInvestigationReport)
    return {
      type: 'answer',
      content: value.content,
      sources: sources(value.sources),
      recommendations: Array.isArray(value.recommendations)
        ? (value.recommendations as ContestRecommendation[])
        : undefined,
      ...(report ? { report } : {}),
    }
  }
  if (event.event === 'error' && typeof value.message === 'string')
    return { type: 'error', message: value.message }
  return null
}
