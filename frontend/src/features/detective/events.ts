import type { ServerSentEvent } from '@/shared/api'
import { safeUrl } from '@/entities/contest'

export interface TraceSource {
  title: string
  url: string
  site: string
  is_official?: boolean
  stale?: boolean
}
export type TraceEvent =
  | { type: 'step'; tool: string; label: string }
  | { type: 'observation'; tool: string; summary: string; sources: TraceSource[] }
  | { type: 'delta'; content: string }
  | { type: 'answer'; content: string; sources: TraceSource[] }
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
      (item.stale !== undefined && typeof item.stale !== 'boolean')
    )
      return invalid()
    return {
      title: item.title,
      url: item.url,
      site: item.site ?? '',
      is_official: item.is_official === true,
      stale: item.stale === true,
    } as TraceSource
  })
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
    }
  if (event.event === 'answer' && typeof value.content === 'string' && value.content.trim())
    return { type: 'answer', content: value.content, sources: sources(value.sources) }
  if (event.event === 'error' && typeof value.message === 'string')
    return { type: 'error', message: value.message }
  return invalid()
}
