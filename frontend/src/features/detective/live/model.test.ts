import { describe, expect, it } from 'vitest'
import type { ContestRecommendation } from '@/shared/api'
import type { DetectiveTurn } from '../conversation'
import { liveCard, speechLines, turnMood } from './model'
const url = 'https://organizer.example/rules'
const contest: ContestRecommendation['contest'] = {
  id: 'one',
  name: 'Example Hack',
  cover_url: null,
  status: 'upcoming',
  summary: null,
  fields: {
    registration_deadline: {
      value: '2026-11-05',
      level: 'official',
      precision: 'day',
      sources: [
        {
          url,
          site: 'organizer.example',
          title: '规则',
          is_official: true,
          value: '2026-11-05',
          excerpt: '报名截至11月5日',
        },
      ],
    },
    city: { value: '北京', level: 'official', sources: [] },
  },
}
const turn: DetectiveTurn = {
  id: 't',
  question: '找比赛',
  content: '',
  trace: [],
  sources: [],
  status: 'completed',
}
describe('Live 的真实结果投影', () => {
  it('没有来源的字段不作为核实事实，并保留日期精度', () => {
    const card = liveCard(
      { contest, reason: '可关注' },
      turn,
      new Date('2026-11-05T10:00:00+08:00'),
    )
    expect(card.rows).toContainEqual(['城市', '未核实'])
    expect(card.rows[0][1]).toContain('时刻未核实')
    expect(card.left).not.toBe('已截止')
    expect(card.sources.some((source) => source.url === url && source.field === '报名截止')).toBe(
      true,
    )
    expect(card.grade).not.toBe('官网核实')
  })
  it('只把与当前卡有关的真实冲突及拦截投影到卡上', () => {
    const conflict = {
      statements: [
        {
          text: '只接受大学生',
          evidence: {
            id: 'e',
            title: '规则',
            url,
            excerpt: '只接受大学生',
            content_hash: null,
            retrieved_at: null,
            evidence_kind: 'database_record' as const,
            provider: null,
            query_ids: [],
            source_level: 'official' as const,
            source_lineage: null,
            historical: false,
          },
        },
      ],
      accepted_statement: 0,
      reason: '身份条件不符',
      blocks_participation: true,
    }
    expect(liveCard({ contest, reason: '' }, { ...turn, conflicts: [conflict] }).blocked).toBe(
      '不能参赛',
    )
    const other = { ...contest, id: 'two', fields: {} }
    expect(
      liveCard({ contest: other, reason: '' }, { ...turn, conflicts: [conflict] }).blocked,
    ).toBeUndefined()
  })
  it('长 Markdown 分成有上限的气泡', () => {
    const text = '# 标题\n\n**报名要求**见[规则](https://organizer.example)。' + '甲'.repeat(350)
    const lines = speechLines(text)
    expect(lines.length).toBeGreaterThan(3)
    expect(lines.every((line: string) => [...line].length <= 90)).toBe(true)
    expect(lines.join('')).toContain('甲'.repeat(90))
    expect(lines.join('')).not.toContain('https:')
  })
  it('闲聊没有查证动作，工具事件才触发搜索和阅读', () => {
    expect(turnMood({ ...turn, content: '你好' })).toBe('talk')
    expect(
      turnMood({
        ...turn,
        status: 'running',
        trace: [{ type: 'step', tool: 'search_contests', label: '查询' }],
      }),
    ).toBe('search')
    expect(
      turnMood({
        ...turn,
        status: 'running',
        trace: [{ type: 'step', tool: 'get_contest', label: '读资料' }],
      }),
    ).toBe('read')
  })
  it('只在真实检索为空且无来源时表现没查到', () => {
    const empty: DetectiveTurn = {
      ...turn,
      content: '没有找到比赛',
      recommendations: [],
      trace: [
        {
          type: 'observation',
          tool: 'search_contests',
          summary: '找到 0 场比赛，本页 0 场',
          sources: [],
        },
      ],
    }
    expect(turnMood(empty)).toBe('sad')
    expect(turnMood({ ...empty, sources: [{ title: '规则', site: '官网', url }] })).toBe('talk')
  })
})
