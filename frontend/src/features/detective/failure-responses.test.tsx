// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { renderDetective } from './detective.test.utils'
import { DetectiveMessage } from './detective-messages'
import { ResearchPanel } from './research-panel'
import { parseTrace } from './events'
import { loadConversation, type DetectiveTurn } from './conversation'
import { reportFixture } from './verification-fixtures.test-utils'
import { serializeReport } from './verification-report'

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.unstubAllGlobals()
})

function send() {
  renderDetective()
  fireEvent.change(screen.getByLabelText('问侦探'), { target: { value: '核对公开比赛规则' } })
  fireEvent.submit(screen.getByRole('button', { name: '查证' }).closest('form')!)
}

it.each(['failure', 'stopped'] as const)(
  '普通工具的 %s 状态经解析和恢复后不会显示为成功',
  (status) => {
    const observation = parseTrace({
      event: 'observation',
      data: JSON.stringify({
        tool: 'fetch_page',
        summary: '这次没有读到网页原文。',
        sources: [],
        status,
      }),
      id: null,
    })!
    const turn = loadConversation('test', [
      {
        id: 't1',
        question: '比赛规则',
        content: '尚未核实规则。',
        sources: [],
        status: 'completed',
        trace: [{ type: 'step', tool: 'fetch_page', label: '读取网页原文' }, observation],
      },
    ])[0]
    render(
      <>
        <DetectiveMessage turn={turn} />
        <ResearchPanel turns={[turn]} onClose={() => {}} />
      </>,
    )
    expect(screen.queryByLabelText('已完成')).toBeNull()
    const workflow = within(screen.getByRole('group', { name: '工作流程' }))
    expect(workflow.getByText(status === 'failure' ? '失败' : '已中断')).toBeTruthy()
    expect(screen.queryByText('fetch_page')).toBeNull()
  },
)

it('核验未完成时保留可读正文，报告中保留说法与原文但不显示内部执行字段', async () => {
  const report = reportFixture()
  report.status = 'incomplete'
  report.queries[0].status = 'failure'
  report.queries[0].error_code = 'provider_unavailable'
  const turn: DetectiveTurn = {
    id: 't1',
    question: '比赛资格',
    content: '官网接受年满十八岁的参赛者；另一份公告尚未核实。',
    trace: [],
    sources: [],
    status: 'completed',
    report,
  }
  render(<DetectiveMessage turn={turn} />)
  expect(await screen.findByText(turn.content)).toBeTruthy()
  expect(screen.getByText('反驳')).toBeTruthy()
  expect(screen.getByRole('link', { name: 'Example 官方参赛规则' })).toBeTruthy()
  for (const text of ['yuanbao', 'provider_unavailable', 'step-1', 'query-1', 'sha256:example'])
    expect(document.body.textContent).not.toContain(text)
  expect(screen.queryByText(/计划步骤/)).toBeNull()
  const markdown = serializeReport(report, 'markdown')
  expect(markdown).toContain('Example 比赛 学生资格')
  expect(markdown).toContain('https://example.org/rules')
  expect(markdown).not.toMatch(
    /yuanbao|provider_unavailable|step-1|query-1|sha256:example|计划步骤/,
  )
  expect(JSON.parse(serializeReport(report, 'json')).queries[0].error_code).toBe(
    'provider_unavailable',
  )
})

it.each(['network', 'http', 'invalid-response', 'internal'] as const)(
  '请求 %s 时显示查证进展而不展示技术错误',
  async (failure) => {
    vi.stubGlobal('fetch', async () => {
      if (failure === 'network') throw new TypeError('fetch failed internal')
      if (failure === 'http') return new Response('bad gateway internal', { status: 502 })
      if (failure === 'invalid-response') return new Response('invalid internal response')
      return new Response(JSON.stringify({ code: 500, message: '服务器内部错误', data: null }))
    })
    send()
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/查证|核实/)
    expect(alert.textContent).not.toMatch(/internal|HTTP|格式无效|请求失败|重试/)
  },
)

it.each([400, 429, 503])('业务提示 %s 保留用户能采取的处理办法', async (code) => {
  const message =
    code === 400
      ? '这些资料太长了，请先只问一场比赛或一项具体规则。'
      : code === 429
        ? '公共查证额度已用完。你可以到账户设置中填写自己的模型密钥后继续。'
        : '无法读取你保存的密钥，请到账户设置中重新保存。'
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ code, message, data: null })))
  send()
  expect((await screen.findByRole('alert')).textContent).toBe(message)
})

it('部分正文之后的业务错误仍说明处理办法', async () => {
  const message = '这些资料太长了，请先只问一场比赛或一项具体规则。'
  vi.stubGlobal(
    'fetch',
    async () =>
      new Response(
        'event: delta\ndata: {"content":"已读到报名截止为十月三十日。"}\n\n' +
          `event: error\ndata: ${JSON.stringify({ message })}\n\n`,
        { headers: { 'content-type': 'text/event-stream' } },
      ),
  )
  send()
  expect(await screen.findByText('已读到报名截止为十月三十日。')).toBeTruthy()
  await waitFor(() => expect(screen.getByRole('status').textContent).toContain(message))
})

it('部分正文后断流保留已有内容并说明还没写完', async () => {
  vi.stubGlobal(
    'fetch',
    async () =>
      new Response('event: delta\ndata: {"content":"已读到报名截止为十月三十日。"}\n\n', {
        headers: { 'content-type': 'text/event-stream' },
      }),
  )
  send()
  expect(await screen.findByText('已读到报名截止为十月三十日。')).toBeTruthy()
  await waitFor(() => expect(screen.queryByRole('button', { name: '停止查证' })).toBeNull())
  expect(screen.getByRole('status').textContent).toMatch(/未完成|没写完/)
})
