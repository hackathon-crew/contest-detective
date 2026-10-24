import {
  parseAsArrayOf,
  parseAsBoolean,
  parseAsInteger,
  parseAsString,
  parseAsStringLiteral,
  useQueryStates,
} from 'nuqs'
import { useMemo } from 'react'
import {
  modeNames,
  monthDay,
  statusNames,
  cityOptions,
  contestDayMap,
  filterLibrary,
  groupSeries,
  todayKey,
  useContestLibrary,
  type LibraryContest,
  type LibraryFilters,
} from '@/entities/contest'
import type { MatchItem } from '@/shared/api'

const emptyLibrary: LibraryContest[] = []

export function activeFilters(filters: LibraryFilters) {
  const values: { key: string; label: string; patch: Partial<LibraryFilters> }[] = []
  if (filters.keyword)
    values.push({ key: 'keyword', label: '“' + filters.keyword + '”', patch: { keyword: '' } })
  if (filters.date)
    values.push({ key: 'date', label: monthDay(filters.date), patch: { date: null } })
  if (filters.status !== 'all')
    values.push({ key: 'status', label: statusNames[filters.status], patch: { status: 'all' } })
  const dueNames: Record<string, string> = {
    '0': '今天截止',
    '7': '7 天内',
    '30': '30 天内',
    later: '30 天以后',
    none: '没写截止时间',
  }
  if (filters.due !== 'all')
    values.push({ key: 'due', label: dueNames[filters.due]!, patch: { due: 'all' } })
  filters.modes.forEach((mode) =>
    values.push({
      key: 'mode-' + mode,
      label: mode === 'hybrid' ? '线上+线下' : (modeNames[mode] ?? mode),
      patch: { modes: filters.modes.filter((m) => m !== mode) },
    }),
  )
  filters.cities.forEach((city) =>
    values.push({
      key: 'city-' + city,
      label: city,
      patch: { cities: filters.cities.filter((c) => c !== city) },
    }),
  )
  for (const [key, label] of [
    ['prize', '写明了奖金'],
    ['official', '截止时间对过原文'],
    ['mine', '我关注的'],
  ] as const)
    if (filters[key]) values.push({ key, label, patch: { [key]: false } })
  if (filters.date_from || filters.date_to)
    values.push({ key: 'range', label: '日期范围', patch: { date_from: null, date_to: null } })
  return values
}
export function useContestBrowser(
  followedIds: string[],
  matches: MatchItem[] | null,
  restrictedIds: string[] | null = null,
) {
  const [params, setParams] = useQueryStates(
    {
      keyword: parseAsString.withDefault(''),
      status: parseAsStringLiteral(['upcoming', 'ongoing', 'ended'] as const),
      due: parseAsStringLiteral(['0', '7', '30', 'later', 'none'] as const),
      mode: parseAsArrayOf(
        parseAsStringLiteral(['online', 'offline', 'hybrid'] as const),
      ).withDefault([]),
      city: parseAsArrayOf(parseAsString).withDefault([]),
      prize: parseAsBoolean.withDefault(false),
      official: parseAsBoolean.withDefault(false),
      mine: parseAsBoolean.withDefault(false),
      date: parseAsString,
      date_from: parseAsString,
      date_to: parseAsString,
      sort: parseAsStringLiteral(['deadline', 'start'] as const).withDefault('deadline'),
      view: parseAsStringLiteral(['list', 'calendar', 'cal'] as const).withDefault('list'),
      page: parseAsInteger.withDefault(1),
      month: parseAsString,
      day: parseAsString,
    },
    { history: 'replace', shallow: false },
  )
  const query = useContestLibrary()
  const today = todayKey()
  const validDate = (value: string | null) =>
    value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) ? value : null
  const filters: LibraryFilters = {
    ...params,
    status: params.status ?? 'all',
    due: params.due ?? 'all',
    modes: params.mode,
    cities: params.city,
    date: validDate(params.date),
  }
  const all = query.data ?? emptyLibrary
  const base: LibraryContest[] = useMemo(
    () =>
      all.filter(
        (contest) =>
          (restrictedIds === null || restrictedIds.includes(contest.id)) &&
          (matches === null || matches.some((item) => item.contest.id === contest.id)),
      ),
    [all, matches, restrictedIds],
  )
  const calendarFilters = { ...filters, date: null }
  const calendarItems = filterLibrary(base, calendarFilters, followedIds)
  const filtered =
    params.view === 'list' ? filterLibrary(base, filters, followedIds) : calendarItems
  const rows = groupSeries(filtered, params.sort)
  const pages = Math.max(1, Math.ceil(rows.length / 20))
  const page = Math.max(1, Math.min(params.page, pages))
  const month =
    params.month && /^\d{4}-(0[1-9]|1[0-2])$/.test(params.month) ? params.month : today.slice(0, 7)
  function change(patch: Partial<LibraryFilters>) {
    const { modes, cities, status, due, ...rest } = patch
    void setParams({
      ...rest,
      ...(modes ? { mode: modes as typeof params.mode } : {}),
      ...(cities ? { city: cities } : {}),
      ...(status ? { status: status === 'all' ? null : status } : {}),
      ...(due ? { due: due === 'all' ? null : (due as typeof params.due) } : {}),
      page: 1,
    })
  }
  function clear() {
    change({
      keyword: '',
      status: 'all',
      due: 'all',
      modes: [],
      cities: [],
      prize: false,
      official: false,
      mine: false,
      date: null,
      date_from: null,
      date_to: null,
    })
  }
  return {
    query,
    all,
    base,
    filters,
    rows,
    calendarRows: groupSeries(calendarItems, params.sort),
    dayMap: contestDayMap(base, filters, followedIds),
    cities: cityOptions(all),
    hasFollows: followedIds.length > 0,
    total: filtered.length,
    page,
    pages,
    params,
    month,
    day: validDate(params.day) ?? today,
    today,
    change,
    clear,
    setParams,
  }
}
export type ContestBrowserModel = ReturnType<typeof useContestBrowser>
