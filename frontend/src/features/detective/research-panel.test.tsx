// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { renderDetective } from './detective.test.utils'

const official = {
  title: 'ETHGlobal 官方规则',
  url: 'https://ethglobal.com/events/example',
  site: 'ETHGlobal',
  is_official: true,
}
const clue = {
  title: '活动报道',
  url: 'https://example.org/event',
  site: '活动报道站',
}
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

function send(question = '找线上比赛') {
  fireEvent.change(screen.getByRole('textbox', { name: '问侦探' }), {
    target: { value: question },
  })
  fireEvent.click(screen.getByRole('button', { name: '查证' }))
}
async function emit(type: string, payload: unknown, stream = streams.at(-1)!) {
  await act(async () => {
    stream.enqueue(new TextEncoder().encode(`event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`))
  })
}
const panel = () => screen.getByRole('complementary', { name: '研究面板' })

it('工具步骤在流式回答期间自动展开，官网和网页线索保留核实等级并显示站点图标', async () => {
  renderDetective({}, '/detective')
  expect(screen.queryByRole('complementary', { name: '研究面板' })).toBeNull()
  send()
  await emit('delta', { content: '我来核对参赛要求。' })
  expect(screen.queryByRole('complementary', { name: '研究面板' })).toBeNull()
  await emit('step', { tool: 'get_contest', label: '读取赛事出处' })
  expect(within(panel()).getByLabelText('进行中')).toBeTruthy()
  await emit('observation', {
    tool: 'get_contest',
    summary: '已读到官方规则',
    sources: [official, official, clue],
  })
  const websites = within(panel()).getByRole('group', { name: '赛事官网' })
  expect(within(websites).getAllByRole('link')).toHaveLength(1)
  const link = within(websites).getByRole('link', { name: /ETHGlobal 官方规则/ })
  expect(link.getAttribute('href')).toBe(official.url)
  expect(link.querySelector('img')?.getAttribute('src')).toContain('ethglobal.com')
  const clues = within(panel()).getByRole('group', { name: '网页线索' })
  expect(
    within(clues)
      .getByRole('link', { name: /活动报道/ })
      .getAttribute('href'),
  ).toBe(clue.url)
  expect(within(clues).getByText('待核实')).toBeTruthy()
  expect(within(panel()).getByLabelText('已完成')).toBeTruthy()
  await emit('answer', { content: '已经核对报名要求。', sources: [official, clue] })
  const footer = screen.getByRole('contentinfo', { name: '可信来源' })
  expect(footer.querySelector('img')?.getAttribute('src')).toContain('ethglobal.com')
})

it('手动收起后后续步骤不再打扰，同一对话仍能手动打开', async () => {
  renderDetective({}, '/detective')
  send()
  await emit('step', { tool: 'search_contests', label: '查询比赛库' })
  fireEvent.click(within(panel()).getByRole('button', { name: '关闭研究面板' }))
  await waitFor(() => expect(screen.queryByRole('complementary', { name: '研究面板' })).toBeNull())
  await emit('observation', { tool: 'search_contests', summary: '找到比赛', sources: [official] })
  await emit('step', { tool: 'fetch_page', label: '读取网页原文' })
  expect(screen.queryByRole('complementary', { name: '研究面板' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '研究面板' }))
  expect(within(panel()).getByRole('link', { name: /ETHGlobal 官方规则/ })).toBeTruthy()
  expect(within(panel()).getByLabelText('进行中')).toBeTruthy()
})

it('新对话重新允许自动展开且不带入上一段的来源', async () => {
  renderDetective({}, '/detective')
  send('第一段查证')
  await emit('step', { tool: 'get_contest', label: '读取赛事出处' })
  await emit('observation', { tool: 'get_contest', summary: '已读规则', sources: [official] })
  fireEvent.click(within(panel()).getByRole('button', { name: '关闭研究面板' }))
  await emit('answer', { content: '第一段已完成。', sources: [official] })
  fireEvent.click(screen.getByRole('link', { name: '新对话' }))
  send('第二段查证')
  await emit('step', { tool: 'web_search', label: '搜索主办方资料' })
  expect(within(panel()).queryByRole('link', { name: /ETHGlobal 官方规则/ })).toBeNull()
  expect(within(panel()).getByText('搜索主办方资料')).toBeTruthy()
})

it('工具未返回即停止时保留中断状态，重复调用同一工具分别显示', async () => {
  renderDetective({}, '/detective')
  send()
  await emit('step', { tool: 'search_contests', label: '查询比赛库' })
  await emit('observation', { tool: 'search_contests', summary: '找到第一批', sources: [] })
  await emit('step', { tool: 'search_contests', label: '查询比赛库' })
  fireEvent.click(screen.getByRole('button', { name: '停止查证' }))
  expect(within(panel()).getAllByText('查询比赛库')).toHaveLength(2)
  expect(within(panel()).getByLabelText('已完成')).toBeTruthy()
  await waitFor(() => expect(within(panel()).getByLabelText('已中断')).toBeTruthy())
  expect(within(panel()).queryByLabelText('进行中')).toBeNull()
})

it('最终来源的过期状态覆盖流式来源，图标失败有替代且分区可折叠', async () => {
  renderDetective({}, '/detective')
  send()
  await emit('step', { tool: 'get_contest', label: '读取赛事出处' })
  await emit('observation', { tool: 'get_contest', summary: '已读规则', sources: [official] })
  await emit('answer', { content: '规则需要重新核对。', sources: [{ ...official, stale: true }] })
  expect(within(panel()).getByRole('group', { name: '赛事官网' }).querySelector('a')).toBeNull()
  const link = within(panel()).getByRole('link', { name: /ETHGlobal 官方规则/ })
  expect(within(link).getByText('来源已过期')).toBeTruthy()
  fireEvent.error(link.querySelector('img')!)
  expect(link.querySelector('img')).toBeNull()
  expect(link.querySelector('svg')).toBeTruthy()
  fireEvent.click(within(panel()).getByRole('button', { name: /网页线索/ }))
  expect(within(panel()).queryByRole('link', { name: /ETHGlobal 官方规则/ })).toBeNull()
})

it('无工具的回答只在来源到达时自动打开', async () => {
  renderDetective({}, '/detective')
  send()
  await emit('answer', { content: '可以先按时间筛选。', sources: [] })
  expect(screen.queryByRole('complementary', { name: '研究面板' })).toBeNull()
  send('再看官方要求')
  await emit('answer', { content: '请看官方规则。', sources: [official] })
  expect(within(panel()).getByRole('link', { name: /ETHGlobal 官方规则/ })).toBeTruthy()
})

it('读取官网正文不会把比赛库已核实的来源降回普通网页', async () => {
  renderDetective({}, '/detective')
  send()
  await emit('step', { tool: 'get_contest', label: '读取赛事出处' })
  await emit('observation', { tool: 'get_contest', summary: '已读规则', sources: [official] })
  await emit('step', { tool: 'fetch_page', label: '读取网页原文' })
  await emit('observation', {
    tool: 'fetch_page',
    summary: '已读到正文',
    sources: [{ title: 'ethglobal.com', url: official.url, site: 'ethglobal.com' }],
  })
  const websites = within(panel()).getByRole('group', { name: '赛事官网' })
  expect(within(websites).getByRole('link', { name: /ETHGlobal 官方规则/ })).toBeTruthy()
  expect(within(panel()).getByRole('group', { name: '网页线索' }).querySelector('a')).toBeNull()
})

it('用 Escape 收起面板后焦点回到开关，键盘可以继续使用对话', async () => {
  renderDetective({}, '/detective')
  fireEvent.click(screen.getByRole('button', { name: '研究面板' }))
  const close = within(panel()).getByRole('button', { name: '关闭研究面板' })
  close.focus()
  fireEvent.keyDown(close, { key: 'Escape' })
  expect(document.activeElement).toBe(screen.getByRole('button', { name: '研究面板' }))
})
