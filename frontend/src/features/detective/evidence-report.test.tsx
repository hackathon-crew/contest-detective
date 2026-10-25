// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { EvidenceReport, InvestigationProgress } from './evidence-report'
import { DetectiveMessage } from './detective-messages'
import { reportFixture } from './verification-fixtures.test-utils'
import { loadConversation, type DetectiveTurn } from './conversation'
import { ResearchPanel } from './research-panel'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
const turn = (): DetectiveTurn => ({
  id: 'turn-1',
  question: '核实参赛资格',
  content: '错误旧正文不应该覆盖确认说法',
  trace: [],
  sources: [],
  status: 'completed',
  report: reportFixture(),
})

it('原始确认说法逐条展示，官方来源可反驳，证据引用与原文均可点开', () => {
  render(<EvidenceReport report={reportFixture()} />)
  expect(screen.getByRole('heading', { name: '只有大学生可以参加。' })).toBeTruthy()
  expect(screen.getByText('反驳')).toBeTruthy()
  expect(screen.getAllByText('来源等级：官方来源').length).toBeGreaterThan(0)
  const citation = screen.getByRole('link', { name: '证据 evidence-1' })
  expect(document.getElementById(citation.getAttribute('href')!.slice(1))).toBeTruthy()
  expect(screen.getByRole('link', { name: 'Example 官方参赛规则' }).getAttribute('href')).toBe(
    'https://example.org/rules',
  )
  expect(screen.getByText('所有年满十八岁的参赛者均可报名。')).toBeTruthy()
  expect(screen.getAllByText(/yuanbao/).length).toBeGreaterThan(0)
  expect(screen.getByText('2026-10-25T04:59:00Z')).toBeTruthy()
  expect(screen.queryByRole('table')).toBeNull()
})

it.each(['incomplete', 'blocked'] as const)('终态 %s 不显示查证完成', (status) => {
  const report = reportFixture()
  report.status = status
  report.limitations = ['页面读取失败，不能确认。']
  render(<EvidenceReport report={report} />)
  expect(screen.queryByText('查证完成')).toBeNull()
  expect(screen.getByText(status === 'incomplete' ? '查证未完成' : '查证受阻')).toBeTruthy()
  expect(screen.getByText('页面读取失败，不能确认。')).toBeTruthy()
})

it('搜索摘要明确只是线索，历史与来源独立性限制可见', () => {
  const report = reportFixture()
  report.status = 'incomplete'
  report.claims[0].verdict = 'insufficient'
  report.evidence[0].evidence_kind = 'search_snippet'
  report.evidence[0].historical = true
  report.evidence[0].source_lineage = null
  render(<EvidenceReport report={report} />)
  expect(screen.getByText('搜索摘要，仅作线索')).toBeTruthy()
  expect(screen.getByText('历史资料')).toBeTruthy()
  expect(screen.getByText('来源独立性未确认。')).toBeTruthy()
})

it('调查计划与实际执行分开显示，失败的真实回执不标为完成', () => {
  const report = reportFixture()
  const execution = {
    ...report.queries[0],
    status: 'failure' as const,
    result_count: 0,
    error_code: 'provider_unavailable',
  }
  render(<InvestigationProgress plan={report.plan!} queries={[execution]} />)
  expect(screen.getByText('调查计划')).toBeTruthy()
  expect(screen.getByText('实际查询记录')).toBeTruthy()
  expect(screen.getByText('失败')).toBeTruthy()
  expect(screen.getByText('provider_unavailable')).toBeTruthy()
  expect(screen.queryByText('查证完成')).toBeNull()
})

it('报告 JSON 和 Markdown 使用同一合同，并释放下载 URL', async () => {
  const blobs: Blob[] = []
  const createObjectURL = vi.fn((blob: Blob) => {
    blobs.push(blob)
    return 'blob:fixture'
  })
  const revokeObjectURL = vi.fn()
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL }))
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  render(<EvidenceReport report={reportFixture()} />)
  fireEvent.click(screen.getByRole('button', { name: '下载 JSON' }))
  fireEvent.click(screen.getByRole('button', { name: '下载 Markdown' }))
  expect(click).toHaveBeenCalledTimes(2)
  expect(blobs.map((blob) => blob.type)).toEqual([
    'application/json;charset=utf-8',
    'text/markdown;charset=utf-8',
  ])
  await new Promise((resolve) => setTimeout(resolve, 10))
  expect(revokeObjectURL).toHaveBeenCalledTimes(2)
  expect(document.querySelector('a[download]')).toBeNull()
})

it('报告存在时不把普通正文作为另一份核实结论', () => {
  render(<DetectiveMessage turn={turn()} />)
  expect(screen.getByRole('region', { name: '查证报告' })).toBeTruthy()
  expect(screen.queryByText('错误旧正文不应该覆盖确认说法')).toBeNull()
})

it('保存与重新打开保持原始报告和实际回执，非法关联不恢复', () => {
  const saved = turn()
  saved.plan = saved.report!.plan!
  saved.trace = [
    {
      type: 'observation',
      tool: 'web_search',
      summary: '已执行',
      sources: [],
      execution: saved.report!.queries[0],
    },
  ]
  const restored = loadConversation('test', JSON.parse(JSON.stringify([saved])))
  expect(restored[0]).toEqual(saved)
  render(<DetectiveMessage turn={restored[0]} />)
  expect(screen.getByText('反驳')).toBeTruthy()
  saved.report!.claims[0].evidence_ids = ['fake']
  expect(loadConversation('test', [saved])).toEqual([])
})

it('研究面板保留真实执行状态和源元数据', () => {
  const saved = turn()
  saved.report!.status = 'incomplete'
  const execution = {
    ...saved.report!.queries[0],
    status: 'failure' as const,
    result_count: 0,
    error_code: 'provider_unavailable',
  }
  saved.report!.queries = [execution]
  saved.trace = [
    { type: 'step', tool: 'web_search', label: '搜索' },
    { type: 'observation', tool: 'web_search', summary: '工具失败', execution, sources: [] },
  ]
  render(<ResearchPanel turns={[saved]} onClose={() => {}} />)
  const workflow = screen.getByRole('group', { name: '工作流程' })
  expect(within(workflow).getByText('失败')).toBeTruthy()
  expect(within(workflow).queryByLabelText('已完成')).toBeNull()
  expect(screen.getByText('查证未完成')).toBeTruthy()
})

it('最终严格报告不复活已被后端拒绝的历史搜索链接', () => {
  const item = turn()
  item.trace = [
    {
      type: 'observation',
      tool: 'web_search',
      summary: '曾发现网页线索',
      sources: [
        {
          title: '随后拒绝的重定向',
          url: 'https://redirect.example.org/rules',
          site: 'example.org',
        },
      ],
    },
  ]
  item.sources = []
  render(<ResearchPanel turns={[item]} onClose={() => {}} />)
  expect(screen.queryByRole('link', { name: /随后拒绝/ })).toBeNull()
  expect(screen.getByRole('link', { name: 'Example 官方参赛规则' })).toBeTruthy()
})

it('严格模式最终来源白名单仍拒绝历史比赛库的敏感链接', () => {
  const item = turn()
  item.sources = [
    {
      title: '不应显示的历史私密来源',
      url: 'https://example.org/rules?token=do-not-export',
      site: 'example.org',
    },
  ]
  render(<ResearchPanel turns={[item]} onClose={() => {}} />)
  expect(screen.queryByRole('link', { name: /不应显示/ })).toBeNull()
})
