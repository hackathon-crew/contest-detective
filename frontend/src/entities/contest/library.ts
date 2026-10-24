import type { ContestSummary, FieldValue } from './api'
import { groundedIntroduction } from './content'
import { cardDate } from './card-date'
import { dateFields, formatDate } from './format'

export type LibraryContest = ContestSummary & { summary?: string | null }
export interface LibraryFilters {
  keyword: string
  status: 'all' | 'upcoming' | 'ongoing' | 'ended'
  due: string
  modes: string[]
  cities: string[]
  prize: boolean
  official: boolean
  mine: boolean
  date_from: string | null
  date_to: string | null
  date: string | null
}
export const initialLibraryFilters: LibraryFilters = {
  keyword: '',
  status: 'all',
  due: 'all',
  modes: [],
  cities: [],
  prize: false,
  official: false,
  mine: false,
  date_from: null,
  date_to: null,
  date: null,
}
export type FilterKey = 'status' | 'due' | 'modes' | 'cities' | 'prize' | 'official' | 'mine'
export interface LibraryDate {
  field: string
  info: FieldValue
  day: string
  left: number
  start: boolean
}
export interface LibraryRow {
  type: 'one' | 'series'
  id: string
  contests: LibraryContest[]
  key: LibraryDate | null
  start: string | null
}
export function normalizedPrize(value: string | null | undefined): string | null {
  if (!value?.trim() || /未公布|后续|待定|咨询|待公布/.test(value)) return null
  const amounts = value.match(/\d[\d,]*(?:\.\d+)?/g)
  if (amounts?.every((amount) => Number(amount.replaceAll(',', '')) === 0)) return null
  const short = value.split(/[（(：；，。\n]/)[0]!.trim()
  return short.length > 16 ? short.slice(0, 16) + '…' : short || null
}
const themeNames: Record<string, string> = {
  'Machine Learning/AI': 'AI',
  'Beginner Friendly': '新手友好',
  'Social Good': '公益',
  'Open Ended': '不限方向',
  Education: '教育',
  Design: '设计',
  Health: '健康',
  Gaming: '游戏',
  Blockchain: '区块链',
  Productivity: '效率工具',
  'Low/No Code': '低代码',
  Fintech: '金融科技',
  Cybersecurity: '网络安全',
  Communication: '通信',
  Databases: '数据库',
  Enterprise: '企业服务',
  'Music/Art': '音乐与艺术',
  Mobile: '移动端',
  'Robotic Process Automation': '流程自动化',
  Quantum: '量子计算',
  'E-commerce/Retail': '电商零售',
  Lifehacks: '生活工具',
}
export function contestThemes(contest: LibraryContest): string[] {
  // New summaries carry themes directly; only older payloads use the historical tag header.
  if (contest.themes) return [...new Set(contest.themes.map((theme) => themeNames[theme] ?? theme))]
  const first = contest.summary?.split('\n')[0]?.trim()
  if (!first || !/^(?:主题|Themes?)\s*[:：]/i.test(first)) return []
  return first
    .replace(/^(?:主题|Themes?)\s*[:：]\s*/i, '')
    .split(/[,，、|]/)
    .map((theme) => theme.trim())
    .filter(
      (theme) =>
        theme in themeNames ||
        ['AI', 'Web', 'AR/VR', 'IoT', 'DevOps', 'Serverless'].includes(theme),
    )
    .map((theme) => themeNames[theme] ?? theme)
}
const dayFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})
export function fieldDay(info: FieldValue | undefined): string | null {
  if (!info?.value || !Number.isFinite(Date.parse(info.value))) return null
  if (info.precision === 'day') return info.value.slice(0, 10)
  const parts = dayFormatter.formatToParts(new Date(info.value))
  const values = Object.fromEntries(parts.map((p) => [p.type, p.value]))
  return values.year + '-' + values.month + '-' + values.day
}
export function todayKey(now = new Date()) {
  return fieldDay({
    value: now.toISOString(),
    level: 'not_found',
    sources: [],
    precision: 'datetime',
  })!
}
export function monthDay(day: string) {
  return Number(day.slice(5, 7)) + '月' + Number(day.slice(8, 10)) + '日'
}
export function dateText(info: FieldValue): string {
  const day = fieldDay(info)
  if (!day) return '日期未核实'
  return info.precision === 'day' ? monthDay(day) : formatDate(info.value, info.precision)
}
export function libraryDate(contest: LibraryContest, now = new Date()): LibraryDate | null {
  const key = cardDate(contest, now)
  const day = key && fieldDay(key.info)
  return key && day
    ? {
        ...key,
        day,
        left: Math.round((Date.parse(day) - Date.parse(todayKey(now))) / 86400000),
        start: key.field === 'start_at',
      }
    : null
}
export function contestAbout(contest: LibraryContest) {
  return groundedIntroduction(contest)?.text.slice(0, 300) ?? null
}
export function contestCity(contest: LibraryContest) {
  const city = contest.fields.city?.value
  return contest.fields.mode?.value !== 'online' && city && city !== '线上' ? city : null
}
export function cityOptions(contests: LibraryContest[]) {
  const counts = new Map<string, number>()
  for (const contest of contests) {
    const city = contestCity(contest)
    if (city) counts.set(city, (counts.get(city) ?? 0) + 1)
  }
  return [...counts]
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([city]) => city)
}
export function filterLibrary(
  contests: LibraryContest[],
  filters: LibraryFilters,
  follows: string[],
  now = new Date(),
): LibraryContest[] {
  return contests.filter((contest) => {
    const due = libraryDate(contest, now)
    const deadline = due && !due.start ? due : null
    if (filters.keyword.trim()) {
      const hay = [
        contest.name,
        contest.fields.organizer?.value,
        contest.fields.city?.value,
        contest.fields.venue?.value,
        ...contestThemes(contest),
      ]
        .join(' ')
        .toLowerCase()
      if (
        !filters.keyword
          .toLowerCase()
          .trim()
          .split(/\s+/)
          .every((word) => hay.includes(word))
      )
        return false
    }
    if (filters.status !== 'all' && contest.status !== filters.status) return false
    if (filters.modes.length && !filters.modes.includes(contest.fields.mode?.value ?? ''))
      return false
    if (filters.cities.length && !filters.cities.includes(contestCity(contest) ?? '')) return false
    if (filters.prize && !normalizedPrize(contest.fields.prize?.value)) return false
    if (filters.official && deadline?.info.level !== 'official') return false
    if (filters.mine && !follows.includes(contest.id)) return false
    if (filters.date && calendarDay(contest, now) !== filters.date) return false
    if (filters.due !== 'all') {
      if (filters.due === 'none') {
        if (deadline) return false
      } else if (
        !deadline ||
        deadline.left < 0 ||
        (filters.due === 'later' ? deadline.left <= 30 : deadline.left > Number(filters.due))
      )
        return false
    }
    if (filters.date_from || filters.date_to) {
      const from = filters.date_from ? Date.parse(filters.date_from) : -Infinity
      const to = filters.date_to ? Date.parse(filters.date_to) : Infinity
      if (
        !dateFields.some((field) => {
          const info = contest.fields[field],
            day = fieldDay(info)
          if (!day || !info?.value) return false
          const a =
            info.precision === 'day' ? Date.parse(day + 'T00:00:00+08:00') : Date.parse(info.value)
          const b = info.precision === 'day' ? Date.parse(day + 'T23:59:59.999+08:00') : a
          return a <= to && b >= from
        })
      )
        return false
    }
    return true
  })
}
export function countFilter(
  contests: LibraryContest[],
  filters: LibraryFilters,
  key: FilterKey,
  value: string | boolean,
  follows: string[],
  now = new Date(),
): number {
  return filterLibrary(
    contests,
    { ...filters, [key]: key === 'modes' || key === 'cities' ? [value] : value },
    follows,
    now,
  ).length
}
/** 后端提供 series_id 后只替换这里；临时规则不扩展到别的活动。 */
export function contestSeriesId(contest: LibraryContest): string | null {
  return /WaytoAGI/i.test(contest.fields.organizer?.value ?? '') &&
    /AI 切磋大会|1024/.test(contest.name)
    ? 'waytoagi-1024'
    : null
}
export function seriesCity(contest: LibraryContest) {
  const parts = contest.name.split(/\s*·\s*/).filter(Boolean)
  return {
    city: contest.fields.city?.value || parts[1] || contest.name,
    venue: parts[0] === 'AI 切磋大会' ? parts.slice(2).join(' · ') : contest.fields.venue?.value,
  }
}
export function calendarDay(contest: LibraryContest, now = new Date()) {
  return contestSeriesId(contest)
    ? fieldDay(contest.fields.start_at)
    : (libraryDate(contest, now)?.day ?? null)
}
export interface ContestDay {
  count: number
  due: boolean
  start: boolean
  mine: boolean
}
export function contestDayMap(
  contests: LibraryContest[],
  filters: LibraryFilters,
  follows: string[],
  now = new Date(),
) {
  const map = new Map<string, ContestDay>()
  for (const contest of filterLibrary(contests, { ...filters, date: null }, follows, now)) {
    const day = calendarDay(contest, now)
    if (!day) continue
    const value = map.get(day) ?? { count: 0, due: false, start: false, mine: false }
    value.count++
    if (contestSeriesId(contest) || libraryDate(contest, now)?.start) value.start = true
    else value.due = true
    if (follows.includes(contest.id)) value.mine = true
    map.set(day, value)
  }
  return map
}
export function groupSeries(
  contests: LibraryContest[],
  sort: 'deadline' | 'start',
  now = new Date(),
): LibraryRow[] {
  const groups = new Map<string, LibraryContest[]>(),
    rows: LibraryRow[] = []
  for (const contest of contests) {
    const id = contestSeriesId(contest)
    if (id) groups.set(id, [...(groups.get(id) ?? []), contest])
    else
      rows.push({
        type: 'one',
        id: contest.id,
        contests: [contest],
        key: libraryDate(contest, now),
        start: fieldDay(contest.fields.start_at),
      })
  }
  for (const [id, kids] of groups) {
    const keys = kids
      .map((c) => libraryDate(c, now))
      .filter((k): k is LibraryDate => !!k)
      .sort((a, b) => a.left - b.left)
    rows.push({
      type: 'series',
      id,
      contests: kids,
      key: keys.find((k) => k.left >= 0) ?? keys.at(-1) ?? null,
      start:
        kids
          .map((c) => fieldDay(c.fields.start_at))
          .filter((d): d is string => !!d)
          .sort()[0] ?? null,
    })
  }
  const rank = (row: LibraryRow) => (!row.key ? 1 : row.key.left >= 0 ? 0 : 2)
  return rows.sort((a, b) =>
    sort === 'start'
      ? Number(!a.start) - Number(!b.start) || (a.start ?? '').localeCompare(b.start ?? '')
      : rank(a) - rank(b) ||
        (rank(a) === 2 ? b.key!.left - a.key!.left : rank(a) === 0 ? a.key!.left - b.key!.left : 0),
  )
}
