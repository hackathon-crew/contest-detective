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
