import type { ContentCitation, ContestSummary, CoverageObservation } from './api'
import { safeUrl } from './format'

/** Invalid evidence must not turn an absent fact into a claim about the organizer. */
export function usableCitations(citations: ContentCitation[] | undefined): ContentCitation[] {
  return (citations ?? []).filter(
    (citation) =>
      safeUrl(citation.url) &&
      citation.excerpt?.trim() &&
      /^[a-f0-9]{64}$/.test(citation.content_hash),
  )
}

export function groundedIntroduction(contest: ContestSummary) {
  const introduction = contest.introduction
  if (!introduction?.text.trim()) return null
  const citations = usableCitations(introduction.citations)
  return citations.length ? { ...introduction, text: introduction.text.trim(), citations } : null
}

export function coverageLabel(observation: CoverageObservation | undefined): string {
  if (!observation?.state) return '未核实'
  if (observation.state === 'source_unpublished' && !usableCitations(observation.citations).length)
    return '未核实'
  return (
    {
      not_fetched: '尚未抓取',
      fetch_failed: '来源读取失败',
      extract_failed: '内容提取失败',
      not_found_in_source: '已查来源中未找到',
      source_unpublished: '来源明确未公布',
      found: '已找到来源内容',
      conflict: '来源说法不一',
    }[observation.state] ?? '未核实'
  )
}
