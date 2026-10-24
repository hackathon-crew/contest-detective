import { describe, expect, it } from 'vitest'
import type { ContestDetail } from './api'
import {
  countFilter,
  filterLibrary,
  groupSeries,
  normalizedPrize,
  contestThemes,
  contestAbout,
  dateText,
  initialLibraryFilters,
  calendarDay,
  contestDayMap,
} from './library'
import { cardDate } from './card-date'

const now = new Date('2026-10-24T04:00:00Z')
const field = (value: string, precision: 'day' | 'datetime' = 'datetime') => ({
  value,
  precision,
  level: 'official' as const,
  sources: [],
})
function contest(
  id: string,
  fields: ContestDetail['fields'] = {},
  extra: Partial<ContestDetail> = {},
): ContestDetail {
  return { id, name: id, cover_url: null, status: 'upcoming', fields, summary: null, ...extra }
}
const contests = [
  contest('上海线上', {
    mode: field('online'),
    city: field('上海'),
    prize: field('$100'),
    submission_deadline: field('2026-10-25T00:00:00Z', 'day'),
  }),
  contest(
    '上海线下',
    { mode: field('offline'), city: field('上海'), prize: field('$200') },
    { status: 'ongoing' },
  ),
  contest(
    '深圳线上',
    { mode: field('online'), city: field('深圳'), prize: field('$0') },
    { status: 'ongoing' },
  ),
]

describe('奖金归一', () => {
  it.each([
    '$0',
    '$CAD 0',
    '$0.00',
    '0 元',
    '后续公布',
    '官网未公布',
    '待定',
    '咨询主办方',
    '赛道奖品/资源后续在公众号发布',
    '',
  ])('排除零金额或未公布：%s', (value) => {
    expect(normalizedPrize(value)).toBeNull()
  })
  it('保留写明的奖金并取第一句', () => {
    expect(normalizedPrize('总奖金池 28 万元人民币，另有实习机会')).toBe('总奖金池 28 万元人民币')
    expect(normalizedPrize('$1,000')).toBe('$1,000')
    expect(normalizedPrize('八个奖项（最高1万元奖金）+投资机会')).toBe('八个奖项')
  })
})

describe('筛选计数', () => {
  it('换状态时保留奖金和形式，计数不受当前状态限制', () => {
    const filters = {
      ...initialLibraryFilters,
      status: 'upcoming' as const,
      modes: ['online'],
      prize: true,
    }
    expect(countFilter(contests, filters, 'status', 'ongoing', [], now)).toBe(0)
    expect(countFilter(contests, filters, 'status', 'all', [], now)).toBe(1)
  })
  it('多选项计数只替换本组，其他条件继续生效', () => {
    const filters = { ...initialLibraryFilters, modes: ['online', 'offline'], prize: true }
    expect(countFilter(contests, filters, 'modes', 'offline', [], now)).toBe(1)
    expect(countFilter(contests, filters, 'modes', 'online', [], now)).toBe(1)
    expect(countFilter(contests, { ...filters, status: 'ongoing' }, 'prize', true, [], now)).toBe(1)
  })
  it('城市按字段筛选，线上赛事不算线下城市', () => {
    expect(
      filterLibrary(contests, { ...initialLibraryFilters, cities: ['上海'] }, [], now).map(
        (c) => c.id,
      ),
    ).toEqual(['上海线下'])
  })
  it('今天与7天内用关键截止日期，没有截止不混入', () => {
    const values = [
      contest('今天', { submission_deadline: field('2026-10-24T00:00:00Z', 'day') }),
      contest('下周', { submission_deadline: field('2026-10-31T15:00:00Z') }),
      contest('只有开赛', { start_at: field('2026-10-24T00:00:00Z', 'day') }),
    ]
    expect(
      filterLibrary(values, { ...initialLibraryFilters, due: '0' }, [], now).map((c) => c.id),
    ).toEqual(['今天'])
    expect(
      filterLibrary(values, { ...initialLibraryFilters, due: '7' }, [], now).map((c) => c.id),
    ).toEqual(['今天', '下周'])
    expect(
      filterLibrary(values, { ...initialLibraryFilters, due: 'none' }, [], now).map((c) => c.id),
    ).toEqual(['只有开赛'])
  })
  it('从主办方、地点和翻译后的主题搜索，保留日期范围及关注条件', () => {
    const value = contest(
      '同城赛',
      {
        organizer: field('社区'),
        venue: field('创客空间'),
        mode: field('offline'),
        start_at: field('2026-10-24T00:00:00Z', 'day'),
      },
      { summary: '主题：Machine Learning/AI, Beginner Friendly\n正文' },
    )
    expect(contestThemes(value)).toEqual(['AI', '新手友好'])
    expect(
      filterLibrary(
        [value],
        {
          ...initialLibraryFilters,
          keyword: '社区 创客 AI',
          mine: true,
          date_from: '2026-10-23T16:00:00Z',
          date_to: '2026-10-24T15:59:59Z',
        },
        ['同城赛'],
        now,
      ),
    ).toHaveLength(1)
    expect(
      filterLibrary(
        [value],
        { ...initialLibraryFilters, date_from: '2026-10-25T00:00:00Z' },
        [],
        now,
      ),
    ).toHaveLength(0)
  })
})

describe('系列', () => {
  it('只按临时主办方与标题规则归组，过滤后仍可显示单个城市', () => {
    const values = [
      contest(
        '北京',
        {
          organizer: field('WaytoAGI'),
          city: field('北京'),
          start_at: field('2026-10-24T00:00:00Z', 'day'),
        },
        { name: 'AI 切磋大会 · 北京' },
      ),
      contest(
        '上海',
        {
          organizer: field('WaytoAGI'),
          city: field('上海'),
          start_at: field('2026-10-25T00:00:00Z', 'day'),
        },
        { name: '1024 超能 Coding · 上海' },
      ),
      contest('别的主办方', { organizer: field('另一社区') }, { name: 'AI 切磋大会' }),
      contest('别的活动', { organizer: field('WaytoAGI') }, { name: '产品交流' }),
    ]
    const rows = groupSeries(values, 'deadline', now)
    expect(rows).toHaveLength(3)
    const series = rows.find((row) => row.type === 'series')
    expect(series?.contests.map((c) => c.id)).toEqual(['北京', '上海'])
    expect(series?.start).toBe('2026-10-24')
    expect(groupSeries(values.slice(0, 1), 'deadline', now)[0]?.type).toBe('series')
  })
  it('截止排序先未来、再无日期、最后过去，全部过期时最晚的在前', () => {
    const values = [
      contest('早过期', { submission_deadline: field('2026-10-20T00:00:00Z', 'day') }),
      contest('没日期'),
      contest('未来', { submission_deadline: field('2026-10-26T00:00:00Z', 'day') }),
      contest('晚过期', { submission_deadline: field('2026-10-23T00:00:00Z', 'day') }),
    ]
    expect(groupSeries(values, 'deadline', now).map((r) => r.id)).toEqual([
      '未来',
      '没日期',
      '晚过期',
      '早过期',
    ])
  })
})

it('day只显示日期，datetime显示北京时间，精确截止已过不算尚未截止', () => {
  expect(dateText(field('2026-10-24T00:00:00Z', 'day'))).toBe('10月24日')
  expect(dateText(field('2026-10-24T15:59:00Z'))).toBe('10月24日 23:59')
  expect(
    cardDate(
      contest('今日', {
        registration_deadline: field('2026-10-24T02:00:00Z'),
        submission_deadline: field('2026-10-25T00:00:00Z', 'day'),
      }),
      now,
    )?.field,
  ).toBe('submission_deadline')
})

it('系列按各场开赛日，其他按关键日期；点阵计数忽略date但保留形式', () => {
  const values = [
    contest(
      '系列',
      {
        organizer: field('WaytoAGI'),
        mode: field('offline'),
        start_at: field('2026-10-24T00:00:00Z', 'day'),
        submission_deadline: field('2026-10-25T00:00:00Z', 'day'),
      },
      { name: 'AI 切磋大会 · 上海' },
    ),
    contest('线上', {
      mode: field('online'),
      start_at: field('2026-10-24T00:00:00Z', 'day'),
      submission_deadline: field('2026-10-27T00:00:00Z', 'day'),
    }),
  ]
  expect(calendarDay(values[0]!, now)).toBe('2026-10-24')
  expect(calendarDay(values[1]!, now)).toBe('2026-10-27')
  const filters = { ...initialLibraryFilters, date: '2026-10-24', modes: ['online'] }
  expect(filterLibrary(values, filters, [], now)).toHaveLength(0)
  const map = contestDayMap(values, filters, ['线上'], now)
  expect(map.get('2026-10-27')).toEqual({ count: 1, due: true, start: false, mine: true })
  expect(map.has('2026-10-24')).toBe(false)
  expect(filterLibrary(values, { ...filters, date: null }, [], now).map((c) => c.id)).toEqual([
    '线上',
  ])
})

it('列表简介只取首段正文，去掉标题和排版标记', () => {
  expect(
    contestAbout(
      contest('摘要', {}, { summary: '## 活动简介\n\n这是**真实**介绍。\n\n## 日程\n下周开赛' }),
    ),
  ).toBe('这是真实介绍。')
})
