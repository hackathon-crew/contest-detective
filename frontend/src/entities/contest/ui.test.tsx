// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, it } from 'vitest'
import { ContestCard } from './ui'

afterEach(cleanup)

it('卡片保留仅日期精度，不显示排序锚点的时刻', () => {
  const deadline = {
    value: '2026-10-25T00:00:00Z',
    precision: 'day' as const,
    level: 'official' as const,
    sources: [],
  }
  render(
    <MemoryRouter>
      <ContestCard
        contest={{
          id: 'day',
          name: '日历日期赛事',
          status: 'upcoming',
          cover_url: null,
          fields: { submission_deadline: deadline },
        }}
      />
    </MemoryRouter>,
  )
  expect(screen.getByText('10月25日')).toBeTruthy()
  expect(screen.getByTitle('10月25日（时刻未核实）')).toBeTruthy()
  expect(screen.queryByText(/08:00/)).toBeNull()
})

it('missing dates are unverified, not asserted to be unpublished', () => {
  render(
    <MemoryRouter>
      <ContestCard
        contest={{
          id: 'missing',
          name: '缺少日期',
          status: 'upcoming',
          cover_url: null,
          fields: {},
        }}
      />
    </MemoryRouter>,
  )
  expect(screen.getByText('日期未核实')).toBeTruthy()
  expect(screen.queryByText('日期未公布')).toBeNull()
})

it('uses lightweight theme metadata and gives card introductions a clickable source', () => {
  render(
    <MemoryRouter>
      <ContestCard
        contest={{
          id: 'grounded',
          name: '有出处的赛事',
          status: 'upcoming',
          cover_url: null,
          fields: {},
          themes: ['Education'],
          theme_sources: [
            {
              url: 'https://example.com/themes',
              title: '主题页面',
              site: '公开站点',
              is_official: false,
              value: 'Education',
              excerpt: 'Education',
            },
          ],
          introduction: {
            text: '设计学习工具。',
            citations: [
              {
                url: 'https://example.com/about',
                content_hash: 'a'.repeat(64),
                excerpt: '设计学习工具。',
              },
            ],
          },
        }}
      />
    </MemoryRouter>,
  )
  expect(screen.getByRole('link', { name: '教育' }).getAttribute('href')).toBe(
    'https://example.com/themes',
  )
  expect(screen.getByText('设计学习工具。')).toBeTruthy()
  expect(screen.getByRole('link', { name: '设计学习工具。' }).getAttribute('href')).toBe(
    '/contests/grounded',
  )
  expect(screen.getByRole('link', { name: '查看介绍来源' }).getAttribute('href')).toBe(
    'https://example.com/about',
  )
})

it('does not present conflicting dates, rewards or conditions as settled card facts', () => {
  render(
    <MemoryRouter>
      <ContestCard
        contest={{
          id: 'conflict',
          name: '有冲突的赛事',
          status: 'upcoming',
          cover_url: null,
          fields: {
            registration_deadline: {
              value: '2026-11-01T12:00:00Z',
              level: 'conflict',
              sources: [],
            },
            prize: { value: '100000 元', level: 'conflict', sources: [] },
            eligibility: { value: '所有人', level: 'conflict', sources: [] },
          },
        }}
      />
    </MemoryRouter>,
  )
  expect(screen.getByText('日期有冲突')).toBeTruthy()
  expect(screen.getByText('奖励有冲突')).toBeTruthy()
  expect(screen.getByText('参赛条件有冲突')).toBeTruthy()
  expect(screen.queryByText('100000 元')).toBeNull()
  expect(screen.queryByText(/还有.*天/)).toBeNull()
})
