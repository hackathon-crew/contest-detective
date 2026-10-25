import { describe, expect, it } from 'vitest'
import { parseTrace } from './events'
import { reportFixture } from './verification-fixtures.test-utils'
import {
  parseInvestigationReport,
  parseInvestigationPlan,
  publicReportUrl,
  serializeReport,
} from './verification-report'

const trace = (event: string, data: unknown) =>
  parseTrace({ event, data: JSON.stringify(data), id: null })

it('解析真实计划、执行回执和最终报告，旧流仍可用', () => {
  const report = reportFixture()
  expect(trace('plan', report.plan)).toEqual({ type: 'plan', plan: report.plan })
  expect(
    trace('observation', {
      tool: 'web_search',
      summary: '执行成功',
      sources: [],
      execution: report.queries[0],
    }),
  ).toMatchObject({ execution: report.queries[0] })
  expect(trace('answer', { content: '查证结束', sources: [], report })).toMatchObject({ report })
  expect(trace('answer', { content: '普通回答', sources: [] })).not.toHaveProperty('report')
  expect(trace('step', { tool: 'get_contest', label: '读取' })).toMatchObject({ type: 'step' })
})

it('来源保留真实 provider、query 和获取时间，不凭官方来源改写 verdict', () => {
  const source = {
    title: '官方',
    url: 'https://example.org',
    provider: 'yuanbao',
    query: '官方赛事',
    retrieved_at: '2026-10-25T05:00:00Z',
  }
  expect(
    trace('answer', { content: '反驳', sources: [source], report: reportFixture() }),
  ).toMatchObject({
    sources: [source],
    report: { claims: [{ verdict: 'refuted', source_level: 'official' }] },
  })
})

it('阻断报告和未完成报告可以没有计划、查询或证据', () => {
  const report = {
    ...reportFixture(),
    status: 'blocked',
    plan: null,
    queries: [],
    claims: [],
    evidence: [],
    limitations: ['未配置搜索服务，未执行查询。'],
  }
  expect(parseInvestigationReport(report)).toEqual(report)
})

const mutations: [string, (report: ReturnType<typeof reportFixture>) => void][] = [
  [
    '未知证据 ID',
    (r) => {
      r.claims[0].evidence_ids = ['invented']
    },
  ],
  [
    '未知查询 ID',
    (r) => {
      r.evidence[0].query_ids = ['invented']
    },
  ],
  [
    '未知计划步骤',
    (r) => {
      r.queries[0].step_id = 'invented'
    },
  ],
  [
    '未知断言 ID',
    (r) => {
      r.plan!.steps[0].claim_ids = ['invented']
    },
  ],
  [
    '重复断言',
    (r) => {
      r.claims.push(r.claims[0])
    },
  ],
  [
    '重复执行',
    (r) => {
      r.queries.push(r.queries[0])
    },
  ],
  [
    '非法时间',
    (r) => {
      r.generated_at = 'tomorrow'
    },
  ],
  [
    '非法 verdict',
    (r) => {
      r.claims[0].verdict = 'official' as never
    },
  ],
  [
    '小数结果数',
    (r) => {
      r.queries[0].result_count = 0.5
    },
  ],
  [
    '不一致 mode',
    (r) => {
      r.plan!.mode = 'realtime'
    },
  ],
]
it.each(mutations)('拒绝%s', (_label, mutate) => {
  const report = reportFixture()
  mutate(report)
  expect(() => parseInvestigationReport(report)).toThrow()
})

it('计划在答案之前可独立校验，但必须具有唯一且非空的步骤 ID', () => {
  expect(parseInvestigationPlan(reportFixture().plan)).toEqual(reportFixture().plan)
  const plan = reportFixture().plan!
  plan.steps.push(plan.steps[0])
  expect(() => parseInvestigationPlan(plan)).toThrow()
})

describe('公开证据 URL 安全边界', () => {
  it.each([
    'javascript:alert(1)',
    'data:text/html,hello',
    'file:///etc/passwd',
    'https://user:password@example.org/rules',
    'https://localhost/rules',
    'http://127.0.0.1/rules',
    'http://2130706433/rules',
    'http://10.0.0.1/rules',
    'http://172.16.1.1/rules',
    'http://192.168.1.1/rules',
    'http://169.254.169.254/latest',
    'http://[::1]/rules',
    'http://[::ffff:127.0.0.1]/rules',
    'http://[fc00::1]/rules',
    'https://internal.local/rules',
    'https://service.internal/rules',
    'https://intranet/rules',
    'https://example.org/rules?key=private',
    'https://example.org/rules?clientSecret=private',
    'https://example.org/rules?accessToken=private',
    'https://example.org/rules?api_key=private',
    'https://example.org/rules?access_token=private',
    'https://example.org/rules#token=private',
    'https://example.org/rules?redirect=http%3A%2F%2F127.0.0.1',
  ])('不显示或导出 %s', (url) => {
    expect(publicReportUrl(url)).toBeUndefined()
    const report = reportFixture()
    report.evidence[0].url = url
    expect(() => parseInvestigationReport(report)).toThrow()
    expect(() => serializeReport(report, 'json')).toThrow()
    expect(() => serializeReport(report, 'markdown')).toThrow()
  })
  it('允许普通公开 HTTPS 和必要的赛事查询参数', () => {
    const url = 'https://example.org/rules?event=2026&lang=zh#eligibility'
    expect(publicReportUrl(url)).toBe(url)
  })
})

it('两种导出只包含同一报告的白名单字段，排除画像与凭据并避免 Markdown 注入', () => {
  const report = { ...reportFixture(), profile: { name: '不应导出的人' }, token: 'secret-token' }
  report.claims[0].text = '只有大学生可以参加。 [伪造](javascript:alert(1)) <script>bad</script>'
  const json = serializeReport(report, 'json')
  const parsed = JSON.parse(json)
  expect(parsed.profile).toBeUndefined()
  expect(parsed.token).toBeUndefined()
  expect(parsed.claims[0].verdict).toBe('refuted')
  const markdown = serializeReport(report, 'markdown')
  expect(markdown).toContain('官方来源')
  expect(markdown).toContain('反驳')
  expect(markdown).toContain('https://example.org/rules')
  expect(markdown).not.toContain('<script>')
  expect(markdown).not.toContain('[伪造](javascript:')
  expect(markdown).not.toContain('| ---')
  expect(markdown).not.toContain('secret-token')
})

it('报告文字中的凭据和值不进入下载文件', () => {
  const report = reportFixture()
  report.claims[0].comparison = 'API_KEY=secret-value'
  expect(() => serializeReport(report, 'json')).toThrow()
  report.claims[0].comparison = '访问 https://example.org?token=secret-value'
  expect(() => serializeReport(report, 'markdown')).toThrow()
})

it('Markdown 证据链接中的括号正确编码，不截断原始 URL', () => {
  const report = reportFixture()
  report.evidence[0].url = 'https://example.org/rules(2026)'
  expect(serializeReport(report, 'markdown')).toContain('https://example.org/rules%282026%29')
  expect(JSON.parse(serializeReport(report, 'json')).evidence[0].url).toBe(report.evidence[0].url)
})
