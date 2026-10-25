// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { ContestDetail as Contest, FieldValue } from '@/entities/contest'
import { FollowButton } from '@/features/follow'
import { ContestDetail } from './contest-detail'

const citation = {
  url: 'https://organizer.example/about',
  content_hash: 'a'.repeat(64),
  excerpt: '围绕开放数据，为城市居民设计可使用的服务。',
}
const source = {
  url: citation.url,
  site: '主办方',
  title: '主办方规则',
  is_official: true,
  value: '',
  excerpt: citation.excerpt,
}
const base: Contest = {
  id: 'one',
  name: '城市服务挑战赛',
  status: 'upcoming',
  cover_url: null,
  fields: {},
  summary: null,
}
const field = (value: string): FieldValue => ({
  value,
  level: 'official',
  sources: [{ ...source, value }],
})
const clients: QueryClient[] = []
function show(
  data: Partial<Contest>,
  variant: 'default' | 'library' = 'library',
  onAsk?: (question: string) => void,
  toggle = vi.fn(),
) {
  vi.stubGlobal('fetch', async () =>
    Response.json({ code: 200, message: 'ok', data: { ...base, ...data } }),
  )
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  clients.push(client)
  return render(
    <QueryClientProvider client={client}>
      <ContestDetail
        contestId="one"
        variant={variant}
        onClose={() => undefined}
        onAsk={onAsk}
        action={
          <FollowButton
            contestId="one"
            follows={{ ids: [], pending: false, error: null, toggle }}
          />
        }
      />
    </QueryClientProvider>,
  )
}
function readingText() {
  const clone = document.querySelector('.contest-detail-scroll')!.cloneNode(true) as HTMLElement
  clone
    .querySelectorAll('.contest-detail-sources, .contest-detail-history')
    .forEach((node) => node.remove())
  return clone.textContent ?? ''
}
afterEach(() => {
  cleanup()
  clients.splice(0).forEach((client) => client.clear())
  vi.unstubAllGlobals()
})

it.each(['default', 'library'] as const)(
  'puts grounded reading before facts, with excerpts only at the bottom in %s',
  async (variant) => {
    show(
      {
        introduction: { text: '用开放数据打造城市服务。', citations: [citation] },
        fields: { registration_deadline: field('2026-11-01T12:00:00Z') },
        summary: '历史日程说明。',
      },
      variant,
    )
    const intro = await screen.findByRole('region', { name: '赛事介绍' })
    expect(within(intro).getByText('用开放数据打造城市服务。')).toBeTruthy()
    expect(within(intro).queryByText(citation.excerpt)).toBeNull()
    expect(
      intro.compareDocumentPosition(screen.getByRole('region', { name: '参赛要点' })) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    const sources = document.querySelector<HTMLDetailsElement>('.contest-detail-sources')!
    expect(sources.open).toBe(false)
    expect(document.querySelector<HTMLDetailsElement>('.contest-detail-history')?.open).toBe(false)
    fireEvent.click(within(intro).getByRole('button', { name: /查看赛事介绍的信息来源/ }))
    expect(sources.open).toBe(true)
    expect(screen.getByRole('link', { name: /主办方规则/ }).getAttribute('href')).toBe(citation.url)
    expect(screen.getByText('历史资料（未核实）')).toBeTruthy()
  },
)

it('hides empty optional sections and never turns a historical summary into an introduction', async () => {
  show({
    summary: '主题：Machine Learning/AI\n\n旧的比赛安排',
    coverage: {
      fields: { prize: { state: 'not_fetched' }, past_statistics: { state: 'fetch_failed' } },
    },
  })
  await screen.findByRole('heading', { name: base.name })
  expect(screen.queryByRole('region', { name: '赛事介绍' })).toBeNull()
  expect(screen.queryByRole('region', { name: '往届参考' })).toBeNull()
  expect(screen.queryByRole('region', { name: '提交与评审' })).toBeNull()
  expect(readingText()).not.toMatch(/尚未抓取|来源读取失败|历史日程|Machine Learning|免费|未公布/)
  expect(screen.getByLabelText('参赛前待确认').textContent).toBe('截止时间、参赛资格、费用待确认。')
})

it.each(['not_fetched', 'fetch_failed', 'extract_failed'] as const)(
  '%s is represented as a pending fee, not an organizer omission',
  async (state) => {
    show({ coverage: { fields: { entry_fee: { state } } } })
    await screen.findByRole('heading', { name: base.name })
    expect(screen.getByLabelText('参赛前待确认').textContent).toContain('费用待确认')
    expect(readingText()).not.toMatch(/未公布|未找到费用|免费|尚未抓取|失败/)
  },
)

it.each([
  ['not_found_in_source', '已查来源中暂未找到费用说明'],
  ['source_unpublished', '来源明确注明费用尚未公布'],
] as const)('keeps %s distinct in the concise decision notice', async (state, text) => {
  show({ coverage: { fields: { entry_fee: { state, citations: [citation] } } } })
  await screen.findByRole('heading', { name: base.name })
  expect(within(screen.getByLabelText('参赛前待确认')).getByText(new RegExp(text))).toBeTruthy()
})

it('does not claim nonpublication without usable evidence', async () => {
  show({ coverage: { fields: { entry_fee: { state: 'source_unpublished', citations: [] } } } })
  await screen.findByRole('heading', { name: base.name })
  expect(readingText()).not.toContain('尚未公布')
  expect(readingText()).toContain('费用待确认')
})

it('keeps conflicting conditions close to the decision and does not pick one as verified', async () => {
  show({
    fields: {
      team_size: {
        value: '可单人',
        level: 'conflict',
        sources: [
          { ...source, value: '可单人或最多4人', excerpt: '官网说明可单人。' },
          {
            ...source,
            url: 'https://other.example/rules',
            site: '报名平台',
            title: '报名规则',
            value: '须2至4人',
            excerpt: '报名平台要求至少2人。',
          },
        ],
      },
    },
  })
  const section = await screen.findByRole('region', { name: '参赛条件' })
  expect(document.querySelector('.contest-detail-notice')).toBeNull()
  expect(within(section).getByText('来源说法不一，待核实')).toBeTruthy()
  expect(within(section).getByText('可单人或最多4人')).toBeTruthy()
  expect(within(section).getByText('须2至4人')).toBeTruthy()
  expect(within(section).queryByText('官网说明可单人。')).toBeNull()
})

it('retains exact date precision, type and timezone in the overview', async () => {
  show({ fields: { submission_deadline: { ...field('2026-11-01T00:00:00Z'), precision: 'day' } } })
  const overview = await screen.findByRole('region', { name: '参赛要点' })
  expect(within(overview).getByText('作品提交截止')).toBeTruthy()
  expect(within(overview).getByText('2026年11月1日')).toBeTruthy()
  expect(within(overview).getByText('具体时刻未核实')).toBeTruthy()
  expect(within(overview).queryByText(/08:00|00:00/)).toBeNull()
  expect(screen.getByLabelText('参赛前待确认').textContent).toContain('报名截止')
})

it.each(['default', 'library'] as const)(
  'retains the original three actions in %s',
  async (variant) => {
    const onAsk = vi.fn()
    const toggle = vi.fn()
    show(
      {
        fields: {
          registration_url: field('https://organizer.example/apply'),
          registration_deadline: field('2026-11-01T12:00:00Z'),
          eligibility: field('18岁以上'),
        },
      },
      variant,
      onAsk,
      toggle,
    )
    const link = await screen.findByRole('link', { name: '去报名' })
    const actions = screen.getByLabelText('赛事操作')
    expect(actions.closest('.contest-detail-scroll')).toBeNull()
    expect(Array.from(actions.children, (element) => element.textContent?.trim())).toEqual([
      '去报名',
      '问侦探这场比赛',
      '关注',
    ])
    expect(link.className).toBe('site-button site-button--primary')
    expect(link.getAttribute('href')).toBe('https://organizer.example/apply')
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toBe('noopener noreferrer')
    expect(link.querySelector('svg.ic')?.getAttribute('aria-hidden')).toBe('true')
    const ask = within(actions).getByRole('button', { name: '问侦探这场比赛' })
    expect(ask.className).toBe('site-button site-button--outline')
    expect(ask.querySelector('svg')).toBeNull()
    fireEvent.click(ask)
    expect(onAsk).toHaveBeenCalledWith('帮我核实一下「城市服务挑战赛」的截止时间')
    const follow = within(actions).getByRole('button', { name: '关注' })
    expect(follow.getAttribute('data-size')).toBe('sm')
    fireEvent.click(follow)
    expect(toggle).toHaveBeenCalledWith('one')
  },
)

it('never renders unsafe links, ungrounded introductions or full source bodies', async () => {
  show({
    introduction: {
      text: '未经核实的介绍',
      citations: [{ ...citation, url: 'javascript:alert(1)' }],
    },
    documents: [
      {
        url: citation.url,
        site: '主办方',
        title: '规则',
        is_official: true,
        fetch_method: 'http',
        completeness: 'partial',
        content_hash: citation.content_hash,
        retrieved_at: '2026-10-24T00:00:00Z',
        extractor_version: 'test',
        excerpts: [citation.excerpt],
        body: '不应公开的第三方完整正文',
      },
    ],
  })
  await screen.findByRole('heading', { name: base.name })
  expect(screen.queryByText('未经核实的介绍')).toBeNull()
  expect(screen.queryByText('不应公开的第三方完整正文')).toBeNull()
  expect(document.querySelector('a[href^="javascript:"]')).toBeNull()
})

it('retries a failed detail and reopens a cached result without another request', async () => {
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
  await screen.findByRole('heading', { name: base.name })
  expect(fetch).toHaveBeenCalledTimes(2)
  rerender(view(false))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  rerender(view(true))
  await screen.findByRole('heading', { name: base.name })
  expect(fetch).toHaveBeenCalledTimes(2)
})

it.each([true, false])(
  'preserves source qualification in the combined location row (all reposted: %s)',
  async (allReposted) => {
    const reposted = (value: string): FieldValue => ({
      value,
      level: 'reposted',
      sources: [{ ...source, value, is_official: false }],
    })
    show({
      fields: { mode: reposted('offline'), city: allReposted ? reposted('北京') : field('北京') },
    })
    const overview = await screen.findByRole('region', { name: '参赛要点' })
    expect(within(overview).getByText('线下 · 北京')).toBeTruthy()
    expect(within(overview).getByText(allReposted ? '仅见转载' : '部分信息仅见转载')).toBeTruthy()
  },
)

it.each([undefined, 'javascript:alert(1)'])(
  'does not invent a replacement primary action for %s registration',
  async (registration) => {
    show(
      {
        fields: {
          organizer: field('主办方'),
          ...(registration ? { registration_url: field(registration) } : {}),
        },
      },
      'library',
      vi.fn(),
    )
    await screen.findByRole('heading', { name: base.name })
    const actions = screen.getByLabelText('赛事操作')
    expect(within(actions).queryByRole('link')).toBeNull()
    expect(within(actions).getByRole('button', { name: '问侦探这场比赛' }).className).toBe(
      'site-button site-button--outline',
    )
  },
)

it('presents pending facts as ordinary coverage text without a warning card or icon', async () => {
  show({})
  await screen.findByRole('heading', { name: base.name })
  const pending = screen.getByLabelText('参赛前待确认')
  expect(pending.className).toBe('contest-detail-coverage')
  expect(pending.querySelector('svg')).toBeNull()
  expect(document.querySelector('.contest-detail-notice')).toBeNull()
})
