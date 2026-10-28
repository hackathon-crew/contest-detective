import type {
  ClaimAssessment,
  InvestigationPlan,
  InvestigationReport,
  ReportEvidence,
  SearchExecution,
} from './verification-contracts'

export const verdictNames = {
  supported: '支持',
  refuted: '反驳',
  conflicting: '证据冲突',
  insufficient: '证据不足',
} as const
export const sourceLevelNames = {
  official: '官方来源',
  reposted: '转载来源',
  conflict: '来源冲突',
  not_found: '未找到来源',
} as const
export const reportStatusNames = {
  complete: '查证完成',
  incomplete: '查证未完成',
  blocked: '查证受阻',
} as const
export const evidenceKindNames = {
  search_snippet: '搜索摘要，仅作线索',
  fetched_page: '已读取的网页原文',
  database_record: '比赛库留存证据',
} as const

const secretParameter =
  /(?:^|[-_])(auth|authorization|token|secret|password|passwd|pwd|credential|session|signature|sig|api[-_]?key|access[-_]?key|private[-_]?key|code)(?:$|[-_])/iu
const secretNames = new Set([
  'key',
  'apikey',
  'accesskey',
  'secret',
  'clientsecret',
  'token',
  'accesstoken',
  'refreshtoken',
  'password',
  'passwd',
  'authorization',
  'auth',
  'session',
  'sessionid',
  'signature',
  'sig',
  'credential',
  'credentials',
  'code',
])
const secretAssignment =
  /(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|client[_ -]?secret|password|authorization)\s*[:=]\s*[^\s,;]+/iu

/** Display/export guard only. The server still owns DNS/redirect SSRF checks. */
export function publicReportUrl(value: string, depth = 0): string | undefined {
  if (
    depth > 2 ||
    [...value].some(
      (character) => character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127,
    ) ||
    /[\\<>[\]`"]/u.test(value)
  )
    return undefined
  try {
    const url = new URL(value)
    const host = url.hostname.toLowerCase().replace(/\.$/u, '')
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.port ||
      !host.includes('.') ||
      host.includes(':') ||
      /^\d+(?:\.\d+){3}$/u.test(host) ||
      /(?:^|\.)(localhost|local|internal|intranet|lan|home|test|invalid|onion)$/u.test(host)
    )
      return undefined
    for (const params of [url.searchParams, new URLSearchParams(url.hash.slice(1))]) {
      for (const [key, parameter] of params) {
        if (
          secretParameter.test(key) ||
          secretNames.has(key.toLowerCase().replace(/[^a-z0-9]/gu, '')) ||
          /^(?:x-amz|x-goog)-/iu.test(key)
        )
          return undefined
        if (/https?:\/\//iu.test(parameter) && !publicReportUrl(parameter, depth + 1))
          return undefined
      }
    }
    return value
  } catch {
    return undefined
  }
}

function invalid(): never {
  throw new Error('查证报告格式或证据关联无效，请重新查证。')
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid()
  return value as Record<string, unknown>
}
function text(value: unknown, nonempty = false): string {
  if (typeof value !== 'string' || (nonempty && !value.trim()) || secretAssignment.test(value))
    return invalid()
  // Do not carry credential-bearing/private URLs from untrusted text into an export.
  for (const match of value.matchAll(/https?:\/\/[^\s<>"'\u3000-\u303f]+/giu)) {
    const url = match[0].replace(/[),.;!\]}]+$/u, '')
    if (!publicReportUrl(url)) return invalid()
  }
  return value
}
function nullableText(value: unknown) {
  return value == null ? null : text(value)
}
function list<T>(value: unknown, parse: (item: unknown) => T): T[] {
  if (!Array.isArray(value)) return invalid()
  return value.map(parse)
}
function strings(value: unknown): string[] {
  return list(value, (item) => text(item, true))
}
function choice<const T extends readonly string[]>(value: unknown, allowed: T): T[number] {
  if (typeof value !== 'string' || !allowed.includes(value)) return invalid()
  return value as T[number]
}
function timestamp(value: unknown): string {
  const result = text(value, true)
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(result) ||
    !Number.isFinite(Date.parse(result))
  )
    return invalid()
  return result
}
function integer(value: unknown, minimum: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) return invalid()
  return value
}
function uniqueIds<T extends { id: string }>(items: T[]): Set<string> {
  const ids = new Set(items.map((item) => item.id))
  if (ids.size !== items.length) return invalid()
  return ids
}
function references(ids: string[], known: Set<string>) {
  if (new Set(ids).size !== ids.length || ids.some((id) => !known.has(id))) invalid()
}
const modes = ['realtime', 'deep'] as const
const levels = ['official', 'reposted', 'conflict', 'not_found'] as const

export function parseInvestigationPlan(value: unknown): InvestigationPlan {
  const plan = object(value)
  const steps = list(plan.steps, (value) => {
    const step = object(value)
    return {
      id: text(step.id, true),
      purpose: text(step.purpose, true),
      query: text(step.query, true),
      claim_ids: strings(step.claim_ids),
    }
  })
  uniqueIds(steps)
  return { mode: choice(plan.mode, modes), steps }
}

export function parseSearchExecution(value: unknown): SearchExecution {
  const execution = object(value)
  return {
    id: text(execution.id, true),
    step_id: text(execution.step_id, true),
    round: integer(execution.round, 1),
    query: text(execution.query, true),
    provider: text(execution.provider, true),
    status: choice(execution.status, ['success', 'failure']),
    executed_at: timestamp(execution.executed_at),
    result_count: integer(execution.result_count, 0),
    error_code: nullableText(execution.error_code),
  }
}

function parseEvidence(value: unknown): ReportEvidence {
  const evidence = object(value)
  const url = text(evidence.url, true)
  if (!publicReportUrl(url) || typeof evidence.historical !== 'boolean') return invalid()
  return {
    id: text(evidence.id, true),
    title: text(evidence.title),
    url,
    excerpt: text(evidence.excerpt),
    content_hash: nullableText(evidence.content_hash),
    retrieved_at: evidence.retrieved_at == null ? null : timestamp(evidence.retrieved_at),
    evidence_kind: choice(evidence.evidence_kind, [
      'search_snippet',
      'fetched_page',
      'database_record',
    ]),
    provider: nullableText(evidence.provider),
    query_ids: strings(evidence.query_ids),
    source_level: choice(evidence.source_level, levels),
    source_lineage: nullableText(evidence.source_lineage),
    historical: evidence.historical,
  }
}
function parseClaim(value: unknown): ClaimAssessment {
  const claim = object(value)
  return {
    id: text(claim.id, true),
    text: text(claim.text, true),
    verdict: choice(claim.verdict, ['supported', 'refuted', 'conflicting', 'insufficient']),
    source_level: choice(claim.source_level, levels),
    evidence_ids: strings(claim.evidence_ids),
    comparison: text(claim.comparison),
    limitations: strings(claim.limitations),
  }
}

/** Project only the public contract. Never spread model payloads or conversation/profile state. */
export function parseInvestigationReport(value: unknown): InvestigationReport {
  const input = object(value)
  if (input.version !== 1) return invalid()
  const report: InvestigationReport = {
    version: 1,
    mode: choice(input.mode, modes),
    status: choice(input.status, ['complete', 'incomplete', 'blocked']),
    generated_at: timestamp(input.generated_at),
    plan: input.plan == null ? null : parseInvestigationPlan(input.plan),
    queries: list(input.queries, parseSearchExecution),
    claims: list(input.claims, parseClaim),
    evidence: list(input.evidence, parseEvidence),
    limitations: strings(input.limitations),
  }
  const claims = uniqueIds(report.claims)
  const queries = uniqueIds(report.queries)
  const evidence = uniqueIds(report.evidence)
  if (report.queries.length && !report.plan) return invalid()
  if (report.plan) {
    if (report.plan.mode !== report.mode) return invalid()
    const steps = uniqueIds(report.plan.steps)
    for (const query of report.queries) references([query.step_id], steps)
    for (const step of report.plan.steps) references(step.claim_ids, claims)
  }
  for (const claim of report.claims) references(claim.evidence_ids, evidence)
  for (const item of report.evidence) references(item.query_ids, queries)
  return report
}

function markdownText(value: string): string {
  return value
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/[\\`*_{}[\]()#+.!|~-]/gu, '\\$&')
    .replace(/\r?\n/gu, '  \n')
}
function markdownLink(evidence: ReportEvidence): string {
  const url = evidence.url.replace(
    /[<>()"\s]/gu,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  )
  return `[${markdownText(evidence.title || evidence.id)}](${url})`
}

export function serializeReport(value: InvestigationReport, format: 'json' | 'markdown'): string {
  // Validate again at the download boundary, including reports restored from storage.
  const report = parseInvestigationReport(value)
  if (format === 'json') return JSON.stringify(report, null, 2)
  const lines = [
    '# 查证报告',
    '',
    `模式：${report.mode === 'deep' ? '深度调查' : '实时查证'}`,
    `状态：${reportStatusNames[report.status]}`,
    `生成时间：${report.generated_at}`,
    '',
  ]
  if (report.plan) {
    lines.push('## 待核对内容', '')
    for (const step of report.plan.steps)
      lines.push(`- ${markdownText(step.purpose)}`, `  - 准备查找：${markdownText(step.query)}`)
    lines.push('')
  }
  lines.push('## 查找记录', '')
  if (!report.queries.length) lines.push('还没有查找结果。')
  for (const query of report.queries)
    lines.push(
      `- ${query.status === 'success' ? `找到 ${query.result_count} 条线索` : '这次没有取得搜索结果，相关信息仍待核实。'}`,
      `  - 查询：${markdownText(query.query)}`,
      `  - 查找时间：${query.executed_at}`,
    )
  lines.push('', '## 逐条说法核对', '')
  if (!report.claims.length) lines.push('没有可用的说法核对结果。')
  for (const claim of report.claims)
    lines.push(
      `### ${markdownText(claim.text)}`,
      '',
      `结论：${verdictNames[claim.verdict]}`,
      `来源等级：${sourceLevelNames[claim.source_level]}`,
      `比对：${markdownText(claim.comparison) || '未提供比对。'}`,
      `证据：${claim.evidence_ids.map((id) => report.evidence.findIndex((item) => item.id === id) + 1).join('、') || '无'}`,
      ...claim.limitations.map((limitation) => `- 限制：${markdownText(limitation)}`),
      '',
    )
  lines.push('## 证据来源', '')
  for (const [index, evidence] of report.evidence.entries())
    lines.push(
      `### 证据 ${index + 1} · ${markdownLink(evidence)}`,
      '',
      `来源等级：${sourceLevelNames[evidence.source_level]}；类型：${evidenceKindNames[evidence.evidence_kind]}`,
      `摘录：${markdownText(evidence.excerpt) || '无可用摘录。'}`,
      `获取时间：${evidence.retrieved_at ?? '未记录'}`,
      evidence.source_lineage ? '可追溯到原始来源。' : '来源独立性未确认。',
      `历史资料：${evidence.historical ? '是' : '否'}`,
      '',
    )
  if (report.limitations.length)
    lines.push(
      '## 尚未核实',
      '',
      ...report.limitations.map((item) => `- ${markdownText(item)}`),
      '',
    )
  return lines.join('\n')
}

export function downloadReport(report: InvestigationReport, format: 'json' | 'markdown'): void {
  const content = serializeReport(report, format)
  const blob = new Blob([content], {
    type: format === 'json' ? 'application/json;charset=utf-8' : 'text/markdown;charset=utf-8',
  })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `inkpaw-verification-${report.generated_at.slice(0, 10)}.${format === 'json' ? 'json' : 'md'}`
  document.body.append(anchor)
  try {
    anchor.click()
  } finally {
    anchor.remove()
    // Keep the object URL alive for the browser's download navigation, then release it.
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }
}
