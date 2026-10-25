// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ContestDetail } from './contest-detail'

const facts = [
  ['eligibility', '参赛资格', '仅限在校大学生'],
  ['team_size', '组队人数', '每队2至4人'],
  ['entry_fee', '报名费用', '免费报名'],
  ['entry_requirements', '参赛与作品要求', '需连续到场两天，并现场演示作品'],
  ['judging_criteria', '评审规则', '技术实现占40%'],
  ['past_statistics', '往届数据', '上一届120支队伍，12支获奖'],
]
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
it('does not request contest details while the dialog is closed', () => {
  const fetch = vi.fn()
  vi.stubGlobal('fetch', fetch)
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ContestDetail contestId="closed" open={false} onClose={() => undefined} />
    </QueryClientProvider>,
  )
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(fetch).not.toHaveBeenCalled()
})
it('groups sourced participation facts and keeps one shared source entry', async () => {
  const url = 'https://organizer.example/rules'
  const fields = Object.fromEntries(
    facts.map(([name, , value]) => [
      name,
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
          },
        ],
      },
    ]),
  )
  vi.stubGlobal('fetch', async () =>
    Response.json({
      code: 200,
      message: 'ok',
      data: {
        id: 'facts',
        name: '参赛规则',
        fields,
        summary: null,
        status: 'upcoming',
        cover_url: null,
      },
    }),
  )
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <ContestDetail contestId="facts" onClose={() => undefined} />
    </QueryClientProvider>,
  )
  const conditions = await screen.findByRole('region', { name: '参赛条件' })
  expect(within(conditions).getByText('仅限在校大学生')).toBeTruthy()
  expect(screen.getByRole('region', { name: '提交与评审' })).toBeTruthy()
  for (const [, label, value] of facts) {
    expect(screen.getByText(label!)).toBeTruthy()
    expect(screen.getByText(value!)).toBeTruthy()
  }
  const sources = document.querySelector<HTMLDetailsElement>('.contest-detail-sources')!
  expect(sources.open).toBe(false)
  fireEvent.click(screen.getByRole('button', { name: '查看参赛资格的信息来源 1' }))
  expect(sources.open).toBe(true)
  expect(screen.getAllByRole('link', { name: /主办方规则/ })).toHaveLength(1)
  expect(screen.getByRole('link', { name: /主办方规则/ }).getAttribute('href')).toBe(url)
})
