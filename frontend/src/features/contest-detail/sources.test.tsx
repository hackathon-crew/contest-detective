// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { ContestDetail, PublicContestDocument, Source } from '@/entities/contest'
import { buildEvidenceIndex } from './evidence-index'
import { ContestSources, SourceReferences } from './sources'

const url = 'https://organizer.example/rules'
const quote = '每队最多四人，可以个人参赛。'
const citation = { url, content_hash: 'a'.repeat(64), excerpt: quote }
const source: Source = {
  url,
  title: '官方规则',
  site: '主办方',
  is_official: true,
  value: '最多四人',
  excerpt: quote,
}
const document: PublicContestDocument = {
  url,
  title: '官方规则',
  site: '主办方',
  is_official: true,
  content_hash: citation.content_hash,
  kind: 'page',
  representation: 'extracted_text',
  completeness: 'partial',
  fetch_method: 'http',
  retrieved_at: '2026-10-24T00:00:00Z',
  extractor_version: 'v1',
  excerpts: [quote],
  body: '不应出现的完整正文',
}
const base: ContestDetail = {
  id: 'contest',
  name: '测试赛事',
  cover_url: null,
  status: 'upcoming',
  fields: { team_size: { value: '最多四人', level: 'official', sources: [source] } },
  introduction: { text: '介绍', citations: [citation] },
  documents: [document],
  summary: '历史描述，与本次核实无关。',
}

function Sources({ contest = base, name = '详情' }: { contest?: ContestDetail; name?: string }) {
  const index = buildEvidenceIndex(contest)
  return (
    <div role="dialog" aria-label={name}>
      <p>
        比赛规则
        <SourceReferences index={index} refs={index.refsByField.team_size} label="组队人数" />
      </p>
      <ContestSources contest={contest} index={index} />
    </div>
  )
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

it('starts with one collapsed source section and separately collapsed historical summary', () => {
  const { container } = render(<Sources />)
  expect(screen.getByText('信息来源（1）').closest('details')!.open).toBe(false)
  expect(screen.getByText('历史资料（未核实）').closest('details')!.open).toBe(false)
  expect(container.querySelectorAll('[data-contest-sources]')).toHaveLength(1)
  expect(screen.getAllByText(quote)).toHaveLength(1)
  expect(screen.queryByText(document.body!)).toBeNull()
  expect(screen.getByText('保留的历史摘要，不代表本次来源核实结果。')).toBeTruthy()
})

it('opens and focuses matching evidence within the same dialog, then returns to the reading position', () => {
  render(
    <>
      <Sources name="第一个详情" />
      <Sources name="第二个详情" />
    </>,
  )
  const first = screen.getByRole('dialog', { name: '第一个详情' })
  const second = screen.getByRole('dialog', { name: '第二个详情' })
  const trigger = within(second).getByRole('button', { name: '查看组队人数的信息来源 1' })
  const firstDetails = within(first).getByText('信息来源（1）').closest('details')!
  const secondDetails = within(second).getByText('信息来源（1）').closest('details')!
  const push = vi.spyOn(window.history, 'pushState')
  const replace = vi.spyOn(window.history, 'replaceState')
  const before = { url: window.location.href, length: window.history.length }
  second.scrollTop = 218
  trigger.focus()
  fireEvent.click(trigger)
  expect(secondDetails.open).toBe(true)
  expect(firstDetails.open).toBe(false)
  const evidence = within(second).getByText(quote).parentElement!
  expect(window.document.activeElement).toBe(evidence)
  expect(second.contains(window.document.activeElement)).toBe(true)
  expect(push).not.toHaveBeenCalled()
  expect(replace).not.toHaveBeenCalled()
  expect(window.location.href).toBe(before.url)
  expect(window.history.length).toBe(before.length)
  second.scrollTop = 900
  fireEvent.click(within(second).getByRole('button', { name: '返回阅读处' }))
  expect(window.document.activeElement).toBe(trigger)
  expect(second.scrollTop).toBe(218)
  expect(within(second).queryByRole('button', { name: '返回阅读处' })).toBeNull()
})

it('supports repeated activation after collapse and exposes native keyboard buttons', () => {
  render(<Sources />)
  const trigger = screen.getByRole('button', { name: '查看组队人数的信息来源 1' })
  expect(trigger.tagName).toBe('BUTTON')
  expect(trigger.getAttribute('type')).toBe('button')
  expect(trigger.getAttribute('tabindex')).not.toBe('-1')
  trigger.focus()
  fireEvent.click(trigger, { detail: 0 })
  const details = screen.getByText('信息来源（1）').closest('details')!
  expect(details.open).toBe(true)
  details.open = false
  fireEvent.click(trigger, { detail: 0 })
  expect(details.open).toBe(true)
  expect(screen.getAllByRole('button', { name: '返回阅读处' })).toHaveLength(1)
})

it('does not navigate to a different excerpt from the same URL', () => {
  const other = '总奖金为五万元。'
  render(
    <Sources
      contest={{
        ...base,
        introduction: { text: '奖金介绍', citations: [{ ...citation, excerpt: other }] },
      }}
    />,
  )
  fireEvent.click(screen.getByRole('button', { name: '查看组队人数的信息来源 1' }))
  expect(window.document.activeElement).toBe(screen.getByText(quote).parentElement)
  expect(window.document.activeElement).not.toBe(screen.getByText(other).parentElement)
})

it('leaves audit metadata and history collapsed when opening an excerpt', () => {
  const { container } = render(<Sources />)
  fireEvent.click(screen.getByRole('button', { name: '查看组队人数的信息来源 1' }))
  expect(container.querySelector<HTMLDetailsElement>('.contest-detail-source-versions')!.open).toBe(
    false,
  )
  expect(screen.getByText('历史资料（未核实）').closest('details')!.open).toBe(false)
})

it('opens nested metadata when a reference has no excerpt to focus', () => {
  const { container } = render(
    <Sources
      contest={{
        ...base,
        introduction: null,
        documents: [],
        fields: {},
        coverage: { fields: { team_size: { state: 'fetch_failed', urls: [url] } } },
      }}
    />,
  )
  fireEvent.click(screen.getByRole('button', { name: '查看组队人数的信息来源 1' }))
  expect(screen.getByText('信息来源（1）').closest('details')!.open).toBe(true)
  expect(container.querySelector<HTMLDetailsElement>('.contest-detail-source-versions')!.open).toBe(
    true,
  )
  expect((window.document.activeElement as HTMLElement).dataset.sourceEvidence).toBeTruthy()
  expect(screen.getByText(/组队人数采集记录：来源读取失败/)).toBeTruthy()
})

it('keeps safe no-excerpt sources available and filters unsafe links everywhere', () => {
  const unsafe = 'javascript:alert(1)'
  const contest = {
    ...base,
    introduction: null,
    fields: {},
    documents: [
      { ...document, excerpts: [] },
      { ...document, url: unsafe },
    ],
    summary: '[不安全](javascript:alert(1)) 和 [原文](https://organizer.example/history)',
  }
  render(<Sources contest={contest} />)
  const details = screen.getByText('信息来源（1）').closest('details')!
  details.open = true
  screen.getByText('历史资料（未核实）').closest('details')!.open = true
  expect(screen.getByText('没有可展示的摘录，来源链接仍可查看。')).toBeTruthy()
  expect(screen.getByRole('link', { name: '[1] 官方规则' }).getAttribute('href')).toBe(url)
  expect(screen.getByRole('link', { name: '原文' }).getAttribute('target')).toBe('_blank')
  expect(
    screen.getAllByRole('link').every((link) => /^https?:/.test(link.getAttribute('href') ?? '')),
  ).toBe(true)
  expect(screen.queryByRole('link', { name: '不安全' })).toBeNull()
  expect(screen.queryByText(document.body!)).toBeNull()
})

it('shows conflict, reposted and stale metadata without treating failed retrieval as an omission', () => {
  render(
    <Sources
      contest={{
        ...base,
        fields: {
          team_size: {
            value: null,
            level: 'conflict',
            sources: [
              source,
              {
                ...source,
                value: '两至四人',
                excerpt: '每队必须两至四人。',
                is_official: false,
                stale: true,
              },
            ],
          },
        },
        coverage: {
          fields: {
            team_size: { state: 'fetch_failed', urls: [url] },
            entry_fee: { state: 'source_unpublished', citations: [] },
          },
        },
      }}
    />,
  )
  screen.getByText('信息来源（1）').closest('details')!.open = true
  expect(screen.getByText('每队必须两至四人。')).toBeTruthy()
  expect(screen.getByText('转载')).toBeTruthy()
  expect(screen.getByText('可能过期')).toBeTruthy()
  expect(screen.getAllByText(/组队人数的来源说法不一/)).toHaveLength(2)
  expect(screen.getByText(/组队人数采集记录：来源读取失败/)).toBeTruthy()
  expect(screen.getByText(/报名费用采集记录：未核实/)).toBeTruthy()
  expect(screen.queryByText(/来源明确未公布/)).toBeNull()
})

it('omits empty references and deduplicates repeated references to the same URL', () => {
  const index = buildEvidenceIndex(base)
  const refs = index.refsByField.team_size!
  const { rerender } = render(<SourceReferences index={index} refs={[]} />)
  expect(screen.queryByRole('button')).toBeNull()
  rerender(
    <SourceReferences
      index={index}
      refs={[...refs, ...refs, { groupId: 'missing', evidenceIds: ['missing'] }]}
    />,
  )
  expect(screen.getAllByRole('button')).toHaveLength(1)
})

it('keeps a coverage-only conflict visible outside collapsed audit records', () => {
  const { container } = render(
    <Sources
      contest={{
        ...base,
        fields: {},
        coverage: { fields: { team_size: { state: 'conflict', citations: [citation] } } },
      }}
    />,
  )
  fireEvent.click(screen.getByRole('button', { name: '查看组队人数的信息来源 1' }))
  const warning = screen.getByText('组队人数：来源说法不一，保留各方摘录，未做取舍。')
  expect(warning.closest('details')?.className).toBe('contest-detail-sources')
  expect(container.querySelector<HTMLDetailsElement>('.contest-detail-source-versions')!.open).toBe(
    false,
  )
})

it('does not repeat a full quote as a record value', () => {
  render(
    <Sources
      contest={{
        ...base,
        fields: {
          team_size: { value: quote, level: 'official', sources: [{ ...source, value: quote }] },
        },
      }}
    />,
  )
  expect(screen.getAllByText(quote)).toHaveLength(1)
  expect(screen.queryByText(`记录值：${quote}`)).toBeNull()
})

it('tolerates missing surrounding dialog without global document lookup', () => {
  const index = buildEvidenceIndex(base)
  render(
    <>
      <SourceReferences index={index} refs={index.refsByField.team_size} />
      <Sources />
    </>,
  )
  fireEvent.click(screen.getByRole('button', { name: '查看信息的信息来源 1' }))
  expect(screen.getByText('信息来源（1）').closest('details')!.open).toBe(false)
})
