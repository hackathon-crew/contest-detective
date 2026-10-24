// @vitest-environment jsdom
import { useState } from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, it } from 'vitest'
import {
  ContestCard,
  groupSeries,
  contestDayMap,
  initialLibraryFilters,
  type ContestSummary,
  type LibraryRow,
} from '@/entities/contest'
import { ContestCalendar, ContestDatePicker } from './index'

const now = new Date('2026-10-24T16:01:00Z')
const items: ContestSummary[] = [
  {
    id: 'one',
    name: '跨天赛',
    cover_url: null,
    status: 'upcoming',
    fields: { start_at: { value: '2026-10-24T16:00:00Z', level: 'official', sources: [] } },
  },
  {
    id: 'two',
    name: '次日赛',
    cover_url: null,
    status: 'upcoming',
    fields: {
      registration_deadline: { value: '2026-10-25T16:00:00Z', level: 'reposted', sources: [] },
    },
  },
  {
    id: 'three',
    name: '仅日期赛',
    cover_url: null,
    status: 'upcoming',
    fields: {
      start_at: { value: '2026-10-27T00:00:00Z', level: 'official', precision: 'day', sources: [] },
    },
  },
]
function Harness() {
  const [month, setMonth] = useState('2026-10')
  const [selected, setSelected] = useState('2026-10-25')
  return (
    <ContestCalendar
      rows={groupSeries(items, 'deadline', now)}
      followedIds={['one']}
      month={month}
      selected={selected}
      today="2026-10-25"
      onMonth={setMonth}
      onSelect={setSelected}
      renderRows={(rows: LibraryRow[]) =>
        rows.map((row) => <ContestCard key={row.id} contest={row.contests[0]!} />)
      }
    />
  )
}
afterEach(cleanup)
it('按北京时间显示整月节点，点选日期只展示当天比赛', () => {
  render(
    <MemoryRouter>
      <Harness />
    </MemoryRouter>,
  )
  const calendar = screen.getByRole('region', { name: '赛事日历' })
  expect(within(calendar).getByRole('button', { name: '10月25日，1 场' })).toBeTruthy()
  expect(within(calendar).getByRole('link', { name: '跨天赛' })).toBeTruthy()
  fireEvent.click(within(calendar).getByRole('button', { name: '10月26日，1 场' }))
  expect(within(calendar).getByRole('link', { name: '次日赛' })).toBeTruthy()
  expect(within(calendar).queryByRole('link', { name: '跨天赛' })).toBeNull()
  fireEvent.click(within(calendar).getByRole('button', { name: '下个月' }))
  expect(within(calendar).getByRole('heading', { name: '2026年11月' })).toBeTruthy()
})
it('整月视图在手机有点阵，day节点不会显示虚构钟点', () => {
  const { container } = render(
    <MemoryRouter>
      <Harness />
    </MemoryRouter>,
  )
  expect(container.querySelectorAll('.cnt .dot')).toHaveLength(3)
  expect(container.querySelector('.dot.mine')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '10月27日，1 场' }))
  expect(screen.getByRole('link', { name: '仅日期赛' })).toBeTruthy()
  expect(screen.getByText('10月27日')).toBeTruthy()
  expect(screen.queryByText(/08:00/)).toBeNull()
})
it('小日历和两周条点选可取消，日期条件不抹掉其他日期的点', () => {
  const map = contestDayMap(items, { ...initialLibraryFilters, date: '2026-10-25' }, [], now)
  function Picker() {
    const [date, setDate] = useState<string | null>(null)
    return (
      <ContestDatePicker
        month="2026-10"
        date={date}
        map={map}
        today="2026-10-25"
        onMonth={() => {}}
        onDate={(next) => setDate((current) => (current === next ? null : next))}
        strip
      />
    )
  }
  render(<Picker />)
  const day = screen.getByRole('button', { name: '10月26日，1 场' })
  expect(screen.getAllByRole('button')).toHaveLength(14)
  fireEvent.click(day)
  expect(day.getAttribute('aria-pressed')).toBe('true')
  expect(screen.getByRole('button', { name: '10月27日，1 场' })).toBeTruthy()
  fireEvent.click(day)
  expect(day.getAttribute('aria-pressed')).toBe('false')
})
