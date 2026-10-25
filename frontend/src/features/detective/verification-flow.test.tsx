// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { renderDetective } from './detective.test.utils'
import { reportFixture } from './verification-fixtures.test-utils'
import { loadSessions } from './sessions'

let streams: ReadableStreamDefaultController<Uint8Array>[]
beforeEach(() => {
  localStorage.clear()
  streams = []
  vi.stubGlobal('fetch', async (url: RequestInfo | URL) => {
    if (!String(url).includes('/agent/ask'))
      return new Response(JSON.stringify({ code: 200, message: 'success', data: null }))
    return new Response(new ReadableStream({ start: (controller) => streams.push(controller) }), {
      headers: { 'content-type': 'text/event-stream' },
    })
  })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
function send() {
  fireEvent.change(screen.getByRole('textbox', { name: '问侦探' }), {
    target: { value: '核实公开比赛的参赛资格' },
  })
  fireEvent.click(screen.getByRole('button', { name: '查证' }))
}
async function emit(type: string, payload: unknown) {
  await act(async () => {
    streams
      .at(-1)!
      .enqueue(new TextEncoder().encode(`event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`))
  })
}
const log = () => within(screen.getByRole('log', { name: '对话内容' }))

it('计划、真实执行和终态报告流式保存，重开仍使用同一份报告', async () => {
  const first = renderDetective({}, '/detective')
  send()
  const report = reportFixture()
  await emit('plan', report.plan)
  expect(log().getByText('调查计划')).toBeTruthy()
  expect(log().getByText('尚无实际查询记录。')).toBeTruthy()
  await emit('step', { tool: 'web_search', label: '元宝查询' })
  await emit('observation', {
    tool: 'web_search',
    summary: '真实搜索已返回',
    sources: [],
    execution: report.queries[0],
  })
  expect(log().getAllByText('2026-10-25T04:59:00Z').length).toBeGreaterThan(0)
  report.status = 'incomplete'
  report.limitations = ['仍需核对另一份原始来源。']
  await emit('answer', { content: '这一段不覆盖原始说法。', sources: [], report })
  expect(log().getByText('查证未完成')).toBeTruthy()
  expect(log().getByText('反驳')).toBeTruthy()
  expect(log().queryByText('这一段不覆盖原始说法。')).toBeNull()
  await waitFor(() => expect(loadSessions('guest')[0].turns[0].report).toEqual(report))
  const session = loadSessions('guest')[0]
  expect(session.turns[0].plan).toEqual(report.plan)
  expect(session.turns[0].trace).toHaveLength(2)
  first.unmount()
  renderDetective({}, `/detective/${session.id}`)
  expect(log().getByText('查证未完成')).toBeTruthy()
  expect(log().getByRole('button', { name: '下载 JSON' })).toBeTruthy()
})

it('没有执行的受阻报告不会显示任何已完成检索', async () => {
  renderDetective({}, '/detective')
  send()
  const report = {
    ...reportFixture(),
    status: 'blocked',
    plan: null,
    queries: [],
    claims: [],
    evidence: [],
    limitations: ['缺少元宝配置，未执行查询。'],
  }
  await emit('answer', { content: '查证受阻。', sources: [], report })
  expect(log().getByText('查证受阻')).toBeTruthy()
  expect(log().getByText('缺少元宝配置，未执行查询。')).toBeTruthy()
  expect(log().queryByText(/已完成/)).toBeNull()
})

it('计划后提前断流保留计划并显示错误，不生成成功报告', async () => {
  renderDetective({}, '/detective')
  send()
  await emit('plan', reportFixture().plan)
  await act(async () => streams.at(-1)!.close())
  expect(await log().findByRole('alert')).toBeTruthy()
  expect(log().getByText('调查计划')).toBeTruthy()
  expect(log().queryByText('查证完成')).toBeNull()
  expect(log().queryByRole('button', { name: '下载 JSON' })).toBeNull()
})

it('取消已发出但未返回的查询不显示完成，也不生成报告', async () => {
  renderDetective({}, '/detective')
  send()
  await emit('plan', reportFixture().plan)
  await emit('step', { tool: 'web_search', label: '元宝查询' })
  fireEvent.click(screen.getByRole('button', { name: '停止查证' }))
  expect(log().getByText('已停止，完成 0 项检索')).toBeTruthy()
  expect(log().queryByLabelText('已完成')).toBeNull()
  expect(log().queryByRole('button', { name: '下载 JSON' })).toBeNull()
  expect(loadSessions('guest')[0].turns[0].status).toBe('stopped')
})

it('无效报告拒绝作为终态答案且不提供导出', async () => {
  renderDetective({}, '/detective')
  send()
  const report = reportFixture()
  report.claims[0].evidence_ids = ['fabricated']
  await emit('answer', { content: '伪造结论', sources: [], report })
  expect(await log().findByRole('alert')).toBeTruthy()
  expect(log().queryByText('伪造结论')).toBeNull()
  expect(log().queryByRole('button', { name: '下载 JSON' })).toBeNull()
})
