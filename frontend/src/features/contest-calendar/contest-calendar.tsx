import type { ReactNode } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { monthDay, type ContestDay, type LibraryRow } from '@/entities/contest'

const weekdays = ['一', '二', '三', '四', '五', '六', '日']
function monthDates(month: string, outside = false) {
  const [year, m] = month.split('-').map(Number)
  const lead = (new Date(Date.UTC(year!, m! - 1, 1)).getUTCDay() + 6) % 7
  const days = new Date(Date.UTC(year!, m!, 0)).getUTCDate()
  const count = outside ? Math.ceil((lead + days) / 7) * 7 : lead + days
  return Array.from({ length: count }, (_, index) =>
    outside || index >= lead
      ? new Date(Date.UTC(year!, m! - 1, index - lead + 1)).toISOString().slice(0, 10)
      : null,
  )
}
function shiftMonth(month: string, offset: number) {
  const [year, m] = month.split('-').map(Number)
  return new Date(Date.UTC(year!, m! - 1 + offset, 1)).toISOString().slice(0, 7)
}
function DotTypes({ value }: { value: ContestDay | undefined }) {
  return (
    <span className="ds" aria-hidden="true">
      {value?.due && <i />}
      {value?.start && <i className="start" />}
      {value?.mine && <i className="mine" />}
    </span>
  )
}
function CalendarLegend({ mini = false }: { mini?: boolean }) {
  return (
    <div className={mini ? 'mini-legend' : 'legend'}>
      <span>
        <i className="dot" />
        截止
      </span>
      <span>
        <i className="dot start" />
        开赛
      </span>
      <span>
        <i className="dot mine" />
        我关注的
      </span>
    </div>
  )
}
export function ContestDatePicker({
  month,
  date,
  map,
  today,
  onMonth,
  onDate,
  strip = false,
}: {
  month: string
  date: string | null
  map: Map<string, ContestDay>
  today: string
  onMonth: (month: string) => void
  onDate: (date: string) => void
  strip?: boolean
}) {
  if (strip)
    return (
      <div className="dstrip" role="group" aria-label="按日期看">
        {Array.from({ length: 14 }, (_, i) => {
          const instant = new Date(Date.parse(today) + i * 86400000)
          const day = instant.toISOString().slice(0, 10),
            value = map.get(day)
          const label =
            i === 0
              ? '今天'
              : day.endsWith('-01')
                ? Number(day.slice(5, 7)) + '月'
                : ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][instant.getUTCDay()]
          return (
            <button
              className={'dpill' + (!value ? ' zero' : '') + (i === 0 ? ' today' : '')}
              type="button"
              key={day}
              aria-label={monthDay(day) + '，' + (value?.count ?? 0) + ' 场'}
              aria-pressed={date === day}
              onClick={() => onDate(day)}
            >
              <span className="w">{label}</span>
              <b>{Number(day.slice(8, 10))}</b>
              <DotTypes value={value} />
            </button>
          )
        })}
      </div>
    )
  return (
    <div className="mini" role="group" aria-label="小日历">
      <div className="mini-head">
        <h2>
          {Number(month.slice(0, 4))}年{Number(month.slice(5, 7))}月
        </h2>
        <div className="mini-nav">
          <button type="button" aria-label="上个月" onClick={() => onMonth(shiftMonth(month, -1))}>
            <ChevronLeft className="ic" />
          </button>
          <button type="button" aria-label="下个月" onClick={() => onMonth(shiftMonth(month, 1))}>
            <ChevronRight className="ic" />
          </button>
        </div>
      </div>
      <div className="mini-grid">
        {weekdays.map((day) => (
          <span className="mini-wd" key={day}>
            {day}
          </span>
        ))}
        {monthDates(month).map((day, index) => {
          if (!day) return <span key={index} />
          const value = map.get(day)
          return (
            <button
              key={day}
              type="button"
              className={'mday' + (value ? ' has' : '') + (day === today ? ' today' : '')}
              aria-label={monthDay(day) + '，' + (value?.count ?? 0) + ' 场'}
              aria-pressed={date === day}
              onClick={() => onDate(day)}
            >
              <span className="num">{Number(day.slice(8, 10))}</span>
              <DotTypes value={value} />
            </button>
          )
        })}
      </div>
      <CalendarLegend mini />
    </div>
  )
}
export function ContestCalendar({
  rows,
  followedIds = [],
  month,
  selected,
  today,
  onMonth,
  onSelect,
  renderRows,
}: {
  rows: LibraryRow[]
  followedIds?: string[]
  month: string
  selected: string
  today: string
  onMonth: (month: string) => void
  onSelect: (day: string) => void
  renderRows: (rows: LibraryRow[]) => ReactNode
}) {
  const byDay = new Map<string, LibraryRow[]>()
  rows.forEach((row) => {
    const day = row.type === 'series' ? row.start : row.key?.day
    if (day) byDay.set(day, [...(byDay.get(day) ?? []), row])
  })
  const mine = (row: LibraryRow) => row.contests.some((c) => followedIds.includes(c.id))
  const start = (row: LibraryRow) => row.type === 'series' || row.key?.start
  const picked = byDay.get(selected) ?? []
  return (
    <section aria-label="赛事日历">
      <div className="cal-head">
        <div className="cal-title">
          <button
            className="site-button site-button--ghost site-button--icon"
            type="button"
            aria-label="上个月"
            onClick={() => onMonth(shiftMonth(month, -1))}
          >
            <ChevronLeft className="ic" />
          </button>
          <h3>
            {Number(month.slice(0, 4))}年{Number(month.slice(5, 7))}月
          </h3>
          <button
            className="site-button site-button--ghost site-button--icon"
            type="button"
            aria-label="下个月"
            onClick={() => onMonth(shiftMonth(month, 1))}
          >
            <ChevronRight className="ic" />
          </button>
          <button
            className="site-button site-button--ghost"
            type="button"
            onClick={() => {
              onMonth(today.slice(0, 7))
              onSelect(today)
            }}
          >
            今天
          </button>
        </div>
        <CalendarLegend />
      </div>
      <div className="cal">
        {weekdays.map((day) => (
          <div className="wd" key={day}>
            {day}
          </div>
        ))}
        {monthDates(month, true).map((day) => {
          if (!day) return null
          const list = byDay.get(day) ?? []
          const dot = (row: LibraryRow) => (
            <i className={'dot' + (mine(row) ? ' mine' : start(row) ? ' start' : '')} />
          )
          return (
            <button
              className={
                'day' + (day.slice(0, 7) !== month ? ' out' : '') + (day === today ? ' today' : '')
              }
              type="button"
              key={day}
              aria-label={monthDay(day) + '，' + list.length + ' 场'}
              aria-pressed={day === selected}
              onClick={() => onSelect(day)}
            >
              <span className="dn">{Number(day.slice(8, 10))}</span>
              {list.slice(0, 3).map((row) => (
                <span className={'ev' + (mine(row) ? ' mine' : '')} key={row.id}>
                  {dot(row)}
                  <span>
                    {row.type === 'series'
                      ? 'AI 切磋大会 · ' + row.contests.length + ' 场'
                      : row.contests[0]!.name}
                  </span>
                </span>
              ))}
              {list.length > 3 && <span className="more">还有 {list.length - 3} 场</span>}
              <span className="cnt" aria-hidden="true">
                {list.slice(0, 4).map((row) => (
                  <i
                    key={row.id}
                    className={'dot' + (mine(row) ? ' mine' : start(row) ? ' start' : '')}
                  />
                ))}
              </span>
            </button>
          )
        })}
      </div>
      <div className="day-list">
        <h3>
          {monthDay(selected)} · {picked.length ? picked.length + ' 场' : '没有比赛'}
        </h3>
        {picked.length > 0 && renderRows(picked)}
      </div>
    </section>
  )
}
