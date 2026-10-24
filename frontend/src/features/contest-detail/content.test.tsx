// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ContestDetail } from './contest-detail'

const citation = {
  url: 'https://organizer.example/about',
  content_hash: 'a'.repeat(64),
  excerpt: '围绕开放数据，为城市居民设计可使用的服务。',
}
const base = {
  id: 'one',
  name: '城市服务挑战赛',
  status: 'upcoming',
  cover_url: null,
  fields: {},
  summary: null,
}
const clients: QueryClient[] = []
function show(data: Record<string, unknown>, variant: 'default' | 'library' = 'library') {
  vi.stubGlobal('fetch', async () =>
    Response.json({ code: 200, message: 'ok', data: { ...base, ...data } }),
  )
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  clients.push(client)
  return render(
    <QueryClientProvider client={client}>
      <ContestDetail contestId="one" variant={variant} onClose={() => undefined} />
    </QueryClientProvider>,
  )
}
afterEach(() => {
  cleanup()
  clients.splice(0).forEach((client) => client.clear())
  vi.unstubAllGlobals()
})

it.each(['default', 'library'] as const)(
  'shows a grounded introduction before facts and preserves historical summary in %s',
  async (variant) => {
    show(
      {
        introduction: {
          text: '用开放数据打造城市服务。',
          method: 'extractive',
          citations: [citation],
        },
        coverage: {
          introduction: { state: 'found', citations: [citation] },
          fields: {},
          sources: {},
        },
        summary: '主题：Education, Health\n\n历史日程说明。',
      },
      variant,
    )
    const introduction = await screen.findByRole('region', { name: '赛事介绍' })
    expect(within(introduction).getByText('用开放数据打造城市服务。')).toBeTruthy()
    expect(
      within(introduction)
        .getByRole('link', { name: /介绍来源/ })
        .getAttribute('href'),
    ).toBe(citation.url)
    expect(within(introduction).getByText(citation.excerpt)).toBeTruthy()
    expect(
      introduction.compareDocumentPosition(screen.getByText('报名截止')) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(screen.getByRole('heading', { name: '历史资料' })).toBeTruthy()
    expect(screen.getByText('历史日程说明。')).toBeTruthy()
  },
)

it('does not turn legacy metadata into an introduction and tolerates older server fields', async () => {
  show({ summary: '主题：Machine Learning/AI, Beginner Friendly\n\n2026-11-01 开赛' })
  const introduction = await screen.findByRole('region', { name: '赛事介绍' })
  expect(within(introduction).getByText('尚未获取有出处的赛事介绍。')).toBeTruthy()
  expect(within(introduction).queryByText(/Machine Learning/)).toBeNull()
  expect(screen.getByText(/主题：Machine Learning/)).toBeTruthy()
  expect(screen.queryByText(/官方未公布/)).toBeNull()
})

it.each([
  ['not_fetched', '尚未抓取'],
  ['fetch_failed', '来源读取失败'],
  ['extract_failed', '内容提取失败'],
  ['not_found_in_source', '已查来源中未找到'],
  ['source_unpublished', '来源明确未公布'],
  ['conflict', '来源说法不一'],
])('distinguishes %s from organizer nonpublication', async (state, label) => {
  show({
    coverage: {
      introduction: { state, citations: [citation], urls: [citation.url] },
      fields: { prize: { state, citations: [citation] } },
      sources: {},
    },
  })
  const introduction = await screen.findByRole('region', { name: '赛事介绍' })
  expect(within(introduction).getByText(label)).toBeTruthy()
  expect(screen.getAllByText(label).length).toBeGreaterThanOrEqual(2)
  expect(
    within(introduction)
      .getByRole('link', { name: /覆盖证据/ })
      .getAttribute('href'),
  ).toBe(citation.url)
  if (state !== 'source_unpublished') expect(screen.queryByText('来源明确未公布')).toBeNull()
})

it('does not claim a source is unpublished without a usable citation', async () => {
  show({
    coverage: {
      introduction: { state: 'source_unpublished', citations: [] },
      fields: { prize: { state: 'source_unpublished' } },
      sources: {},
    },
  })
  await screen.findByRole('region', { name: '赛事介绍' })
  expect(screen.queryByText('来源明确未公布')).toBeNull()
  expect(screen.getAllByText('未核实').length).toBeGreaterThan(0)
})

it('keeps conflict evidence and verification level separate', async () => {
  const alternative = {
    ...citation,
    url: 'https://other.example/rules',
    excerpt: '总奖金为五千元。',
  }
  show({
    fields: {
      prize: {
        value: null,
        level: 'conflict',
        sources: [
          {
            url: citation.url,
            title: '主办方奖金说明',
            site: '主办方',
            is_official: true,
            value: '10000 元',
            excerpt: '总奖金为一万元。',
          },
          {
            url: alternative.url,
            title: '赛事规则转载',
            site: '转载站',
            is_official: false,
            value: '5000 元',
            excerpt: alternative.excerpt,
          },
        ],
      },
    },
    coverage: {
      introduction: { state: 'not_fetched' },
      fields: { prize: { state: 'conflict', citations: [citation, alternative] } },
      sources: {},
    },
  })
  await screen.findByText('奖金')
  expect(screen.getByText('说法不一')).toBeTruthy()
  expect(screen.getByRole('link', { name: '主办方奖金说明' }).getAttribute('href')).toBe(
    citation.url,
  )
  expect(screen.getByRole('link', { name: '赛事规则转载' }).getAttribute('href')).toBe(
    alternative.url,
  )
  expect(screen.getByText('总奖金为一万元。')).toBeTruthy()
  expect(screen.getAllByText(alternative.excerpt).length).toBeGreaterThan(0)
})

it('displays public document excerpts and links, never a full document body by default', async () => {
  show({
    documents: [
      {
        url: citation.url,
        title: '活动说明',
        site: '主办方',
        is_official: true,
        kind: 'page',
        representation: 'extracted_text',
        completeness: 'partial',
        fetch_method: 'http',
        content_hash: citation.content_hash,
        retrieved_at: '2026-10-24T00:00:00Z',
        extractor_version: 'test',
        excerpts: [citation.excerpt],
        body: '不应直接显示的第三方完整正文。',
      },
    ],
  })
  const documents = await screen.findByRole('region', { name: '来源资料' })
  expect(within(documents).getByRole('link', { name: '活动说明' }).getAttribute('href')).toBe(
    citation.url,
  )
  expect(within(documents).getByText(citation.excerpt)).toBeTruthy()
  expect(within(documents).getByText('部分内容')).toBeTruthy()
  expect(screen.queryByText('不应直接显示的第三方完整正文。')).toBeNull()
})

it('does not render an ungrounded introduction or unsafe evidence link', async () => {
  show({
    introduction: {
      text: '未经核实的介绍',
      method: 'extractive',
      citations: [{ ...citation, url: 'javascript:alert(1)' }],
    },
  })
  await screen.findByRole('region', { name: '赛事介绍' })
  expect(screen.queryByText('未经核实的介绍')).toBeNull()
  expect(
    screen
      .queryAllByRole('link')
      .some((link) => link.getAttribute('href')?.startsWith('javascript:')),
  ).toBe(false)
})

it('retries a failed detail without replacing the dialog and reopens cached results', async () => {
  let failed = true
  const fetch = vi.fn(async () =>
    Response.json(
      {
        code: failed ? 503 : 200,
        message: failed ? '详情暂时不可用' : 'ok',
        data: failed ? null : base,
      },
      { status: failed ? 503 : 200 },
    ),
  )
  vi.stubGlobal('fetch', fetch)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  clients.push(client)
  const view = (open: boolean) => (
    <QueryClientProvider client={client}>
      <ContestDetail contestId="one" open={open} onClose={() => undefined} />
    </QueryClientProvider>
  )
  const { rerender } = render(view(true))
  await screen.findByRole('alert')
  failed = false
  fireEvent.click(screen.getByRole('button', { name: '重试' }))
  await screen.findByText('城市服务挑战赛')
  expect(fetch).toHaveBeenCalledTimes(2)
  rerender(view(false))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  rerender(view(true))
  expect(await screen.findByText('城市服务挑战赛')).toBeTruthy()
  expect(fetch).toHaveBeenCalledTimes(2)
})

it('stays closed if an in-flight detail finishes after dismissal', async () => {
  let complete!: (response: Response) => void
  const fetch = vi.fn(
    () =>
      new Promise<Response>((resolve) => {
        complete = resolve
      }),
  )
  vi.stubGlobal('fetch', fetch)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  clients.push(client)
  const view = (open: boolean) => (
    <QueryClientProvider client={client}>
      <ContestDetail contestId="one" open={open} onClose={() => undefined} />
    </QueryClientProvider>
  )
  const { rerender } = render(view(true))
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
  rerender(view(false))
  await act(async () => {
    complete(Response.json({ code: 200, message: 'ok', data: base }))
  })
  expect(screen.queryByRole('dialog')).toBeNull()
  rerender(view(true))
  expect(await screen.findByText('城市服务挑战赛')).toBeTruthy()
  expect(fetch).toHaveBeenCalledTimes(1)
})
