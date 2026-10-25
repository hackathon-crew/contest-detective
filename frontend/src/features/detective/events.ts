import type { ContestRecommendation, ServerSentEvent } from '@/shared/api'
import { safeUrl } from '@/entities/contest'
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
function invalid(): never {
  throw new Error('查证消息格式无效，请重试。')
}
function sources(value: unknown): TraceSource[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) return invalid()
  return value.map((item) => {
    if (
      !record(item) ||
      typeof item.title !== 'string' ||
      typeof item.url !== 'string' ||
      !safeUrl(item.url) ||
      (item.site !== undefined && typeof item.site !== 'string') ||
      (item.is_official !== undefined && typeof item.is_official !== 'boolean') ||
      (item.stale !== undefined && typeof item.stale !== 'boolean') ||
      ['provider', 'query', 'retrieved_at'].some(
        (key) => item[key] != null && typeof item[key] !== 'string',
      )
    )
      return invalid()
    return {
      title: item.title,
      url: item.url,
      site: item.site ?? '',
      is_official: item.is_official === true,
      stale: item.stale === true,
      ...(item.provider !== undefined ? { provider: item.provider } : {}),
      ...(item.query !== undefined ? { query: item.query } : {}),
      ...(item.retrieved_at !== undefined ? { retrieved_at: item.retrieved_at } : {}),
    } as TraceSource
  })
}

function recommendations(value: unknown): ContestRecommendation[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) return invalid()
  for (const item of value) {
    if (
      !record(item) ||
      !record(item.contest) ||
      typeof item.reason !== 'string' ||
      (item.introduction !== undefined &&
        item.introduction !== null &&
        typeof item.introduction !== 'string')
    )
      return invalid()
    const contest = item.contest
    if (
      typeof contest.id !== 'string' ||
      typeof contest.name !== 'string' ||
      !['upcoming', 'ongoing', 'ended'].includes(String(contest.status)) ||
      (contest.cover_url !== null && typeof contest.cover_url !== 'string') ||
      (contest.summary !== null && typeof contest.summary !== 'string') ||
      !record(contest.fields)
    )
      return invalid()
    for (const field of Object.values(contest.fields)) {
      if (
        !record(field) ||
        (field.value !== null && typeof field.value !== 'string') ||
        !['official', 'reposted', 'conflict', 'not_found'].includes(String(field.level)) ||
        (field.sources !== undefined &&
          (!Array.isArray(field.sources) ||
            field.sources.some((source) => !record(source) || typeof source.url !== 'string')))
      )
        return invalid()
    }
  }
  return value as ContestRecommendation[]
}

/** SSE 只负责分帧，这里检查业务载荷，避免半条结论或错误被当成回答。 */
export function parseTrace(event: ServerSentEvent): TraceEvent {
  let value: unknown
  try {
    value = JSON.parse(event.data)
  } catch {
    return invalid()
  }
  if (!record(value)) return invalid()
  if (event.event === 'plan') return { type: 'plan', plan: parseInvestigationPlan(value) }
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
      ...(value.execution != null ? { execution: parseSearchExecution(value.execution) } : {}),
    }
  if (event.event === 'answer' && typeof value.content === 'string' && value.content.trim())
    return {
      type: 'answer',
      content: value.content,
      sources: sources(value.sources),
      recommendations: recommendations(value.recommendations),
      ...(value.report != null ? { report: parseInvestigationReport(value.report) } : {}),
    }
  if (event.event === 'error' && typeof value.message === 'string')
    return { type: 'error', message: value.message }
  return invalid()
}
