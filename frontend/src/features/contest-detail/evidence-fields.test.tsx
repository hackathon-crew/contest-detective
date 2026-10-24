// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ContestDetail } from './contest-detail'

const evidence = [
  ['venue', '具体地点', '示例会议中心'],
  ['eligibility', '参赛人群', '仅限在校大学生'],
  ['team_size', '组队人数', '每队2至4人'],
  ['entry_fee', '报名费用', '免费报名'],
  ['entry_requirements', '参赛门槛与到场要求', '需连续到场两天'],
  ['judging_criteria', '评审规则', '技术实现占40%'],
  ['past_statistics', '往届数据', '上一届120支队伍，12支获奖'],
]

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

it('does not request contest details while its dialog is closed', () => {
  const fetch = vi.fn(async () =>
    Response.json({
      code: 200,
      message: 'ok',
      data: {
        id: 'facts',
        name: '参赛规则',
        fields: {},
        summary: null,
        cover_url: null,
        status: 'upcoming',
      },
    }),
  )
  vi.stubGlobal('fetch', fetch)
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <ContestDetail contestId="facts" open={false} onClose={() => undefined} />
    </QueryClientProvider>,
  )
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(fetch).not.toHaveBeenCalled()
})

it('displays participation facts with their original source links', async () => {
  const url = 'https://organizer.example/rules'
  const fields = Object.fromEntries(
    evidence.map(([field, , value]) => [
      field,
      {
        value,
        level: 'official',
        sources: [
          {
            url,
            title: '主办方规则',
            site: '主办方',
            is_official: true,
            value,
            excerpt: `原文：${value}`,
            stale: false,
          },
        ],
      },
    ]),
  )
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json({
        code: 200,
        message: '',
        data: {
          id: 'facts',
          name: '参赛规则',
          cover_url: null,
          status: 'upcoming',
          fields: {
            ...fields,
            start_at: {
              value: '2026-10-25T00:00:00Z',
              precision: 'day',
              level: 'official',
              sources: [{ url, title: '开赛日期原文', excerpt: '10月25日开赛', stale: false }],
            },
          },
          summary: null,
        },
      }),
    ),
  )
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <ContestDetail contestId="facts" onClose={() => undefined} />
    </QueryClientProvider>,
  )
  await screen.findByText('具体地点')
  expect(screen.getByText('10月25日（时刻未核实）')).toBeTruthy()
  expect(screen.queryByText(/08:00/)).toBeNull()
  for (const [, label, value] of evidence) {
    expect(screen.getByText(label)).toBeTruthy()
    expect(screen.getByText(value)).toBeTruthy()
    expect(screen.getByText(`原文：${value}`)).toBeTruthy()
  }
  expect(screen.getAllByRole('link', { name: '主办方规则' })).toHaveLength(7)
  for (const source of screen.getAllByRole('link', { name: '主办方规则' })) {
    expect(source.getAttribute('href')).toBe(url)
  }
})
