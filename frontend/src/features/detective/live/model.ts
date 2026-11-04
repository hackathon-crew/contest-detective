import type { ContestDetail, ContestRecommendation } from '@/shared/api'
import { fieldNames, formatDate, modeNames, safeUrl } from '@/entities/contest'
import { cardDate } from '@/entities/contest/card-date'
import type { Mood } from '@/shared/ui/octopus/live-stage'
import type { DetectiveTurn } from '../conversation'

export interface CardSource {
  who: string
  quote: string
  url: string
  field: string
  old?: boolean
}
export interface LiveCard {
  id: string
  name: string
  img: string
  grade: string
  left: string
  urgent: boolean
  conflict: boolean
  rows: [string, string][]
  sources: CardSource[]
  verdict: string
  checked: string
  blocked?: string
  contest: ContestDetail
}
const dateFields = new Set([
  'registration_deadline',
  'submission_deadline',
  'deadline_unspecified',
  'start_at',
  'end_at',
])
const rowLabels: Record<string, string> = {
  registration_deadline: '报名',
  submission_deadline: '提交',
  deadline_unspecified: '截止',
  mode: '形式',
  city: '城市',
  prize: '奖金',
  organizer: '主办',
  eligibility: '资格',
}
const levelNames = {
  official: '官网核实',
  reposted: '只见转载',
  conflict: '来源说法不一',
  not_found: '未核实',
}

export function liveCard(
  item: ContestRecommendation,
  turn?: DetectiveTurn,
  now = new Date(),
): LiveCard {
  const c = item.contest
  const fields = Object.entries(c.fields)
  const sources: CardSource[] = fields.flatMap(([key, info]) =>
    (info.sources ?? [])
      .filter((source) => safeUrl(source.url))
      .map((source) => ({
        field: fieldNames[key] ?? key,
        who: `${fieldNames[key] ?? key} · ${source.is_official ? '官方' : '转载'} · ${source.site || source.title}`,
        quote: source.excerpt || source.value,
        url: source.url,
      })),
  )
  const urls = new Set(sources.map((source) => source.url))
  const conflicts = (turn?.conflicts ?? turn?.report?.conflicts ?? []).filter((conflict) =>
    conflict.statements.some((statement) => urls.has(statement.evidence.url)),
  )
  for (const conflict of conflicts)
    conflict.statements.forEach((statement, i) => {
      if (!safeUrl(statement.evidence.url)) return
      sources.push({
        field: '查证结论',
        who: statement.evidence.title,
        quote: statement.text,
        url: statement.evidence.url,
        old: conflict.accepted_statement != null && i !== conflict.accepted_statement,
      })
    })
  const selected = [
    'registration_deadline',
    'submission_deadline',
    'deadline_unspecified',
    'mode',
    'city',
    'prize',
    'organizer',
    'eligibility',
  ]
    .filter((key) => c.fields[key]?.value)
    .slice(0, 3)
  const rows: [string, string][] = selected.map((key) => {
    const info = c.fields[key]
    const sourced = (info.sources ?? []).some((source) => safeUrl(source.url))
    const value = !sourced
      ? '未核实'
      : dateFields.has(key)
        ? formatDate(info.value, info.precision, true)
        : (modeNames[info.value!] ?? info.value!)
    return [
      rowLabels[key] ?? fieldNames[key] ?? key,
      info.level === 'conflict' && sourced ? `${value}（说法不一）` : value,
    ]
  })
  const levels = selected.map((key) => {
    const info = c.fields[key]
    const valid = (info.sources ?? []).filter((source) => safeUrl(source.url))
    return !valid.length
      ? 'not_found'
      : info.level === 'official' && !valid.some((source) => source.is_official)
        ? 'reposted'
        : info.level
  })
  const level =
    conflicts.length || levels.includes('conflict')
      ? 'conflict'
      : !levels.length || levels.includes('not_found')
        ? 'not_found'
        : levels.includes('reposted')
          ? 'reposted'
          : 'official'
  const due = cardDate(c, now)
  const sourcedDue = due && (due.info.sources ?? []).some((source) => safeUrl(source.url))
  const time =
    due &&
    (due.info.precision === 'day'
      ? Date.parse(due.info.value!.slice(0, 10) + 'T23:59:59.999+08:00')
      : Date.parse(due.info.value!))
  const days = sourcedDue && time !== null ? Math.ceil((time! - now.getTime()) / 86400000) : null
  return {
    id: c.id,
    name: c.name,
    img: safeUrl(c.cover_url) ?? '',
    contest: c,
    grade: levelNames[level],
    conflict: level === 'conflict',
    rows,
    sources,
    left:
      days === null
        ? ''
        : due?.field === 'start_at'
          ? days <= 0
            ? '已开赛'
            : `${days} 天后开赛`
          : days <= 0
            ? '已截止'
            : `还有 ${days} 天`,
    urgent: days !== null && days > 0 && days <= 7,
    verdict: conflicts.map((conflict) => conflict.reason).join('；'),
    checked: turn?.report?.generated_at ? `查证于 ${formatDate(turn.report.generated_at)}` : '',
    ...(conflicts.some((conflict) => conflict.blocks_participation) ? { blocked: '不能参赛' } : {}),
  }
}

/** 气泡只承担逐句阅读，完整 Markdown 始终保存在同一回合的记录里。 */
export function speechLines(content: string): string[] {
  const plain = content
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s*|[-*+]\s+)/gm, '')
    .replace(/[*_`~]/g, '')
    .replace(/\n+/g, ' ')
    .trim()
  return (plain.match(/[^。！？!?；;]+[。！？!?；;]?/gu) ?? []).flatMap((sentence) => {
    const chars = [...sentence.trim()]
    const lines: string[] = []
    for (let at = 0; at < chars.length; at += 90) lines.push(chars.slice(at, at + 90).join(''))
    return lines
  })
}
export function turnMood(turn: DetectiveTurn): Mood {
  if (
    turn.conflicts?.some((conflict) => conflict.blocks_participation) ||
    turn.report?.status === 'blocked'
  )
    return 'warn'
  if (
    turn.status === 'completed' &&
    !turn.recommendations?.length &&
    !turn.sources.length &&
    turn.trace.some(
      (event) =>
        event.type === 'observation' &&
        event.tool === 'search_contests' &&
        /^找到 0 场比赛/.test(event.summary),
    )
  )
    return 'sad'
  if (
    turn.report?.claims.length &&
    turn.report.claims.every((claim) => claim.verdict === 'insufficient')
  )
    return 'sad'
  if (turn.content) return 'talk'
  const tool = turn.trace.at(-1)?.tool ?? ''
  if (/fetch|read|extract|get_contest/.test(tool)) return 'read'
  if (/search|discover/.test(tool)) return 'search'
  return turn.status === 'running' ? 'think' : 'idle'
}
