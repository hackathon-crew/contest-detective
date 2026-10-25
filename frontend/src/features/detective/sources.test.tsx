// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { DetectiveMessage } from './detective-messages'
import { parseTrace } from './events'

afterEach(cleanup)
it('来源标签只在回复下方展示已核实的官方出处，过滤线索并去重', () => {
  const official = {
    title: '活动规则',
    url: 'https://ethglobal.com/events/example',
    site: 'ETHGlobal',
    is_official: true,
  }
  const answer = parseTrace({
    event: 'answer',
    id: null,
    data: JSON.stringify({
      content: '已经核对报名要求。',
      sources: [
        { ...official, is_official: false },
        official,
        official,
        {
          title: '转载活动',
          url: 'https://hackertrip.space/event',
          site: 'HackerTrip',
          is_official: false,
        },
        {
          title: '过期规则',
          url: 'https://ethglobal.com/events/older',
          site: 'ETHGlobal',
          is_official: true,
          stale: true,
        },
        { title: '未知出处', url: 'https://example.com', site: '' },
      ],
    }),
  })
  if (answer?.type !== 'answer') throw new Error('expected answer')
  render(
    <DetectiveMessage
      turn={{
        id: 'one',
        question: '看看要求',
        content: answer.content,
        status: 'completed',
        sources: answer.sources,
        trace: [
          { type: 'step', tool: 'get_contest', label: '读取活动' },
          { type: 'observation', tool: 'get_contest', summary: '规则已读取', sources: [official] },
        ],
      }}
    />,
  )
  expect(screen.getAllByRole('link')).toHaveLength(1)
  const link = screen.getByRole('link', { name: /活动规则/ })
  expect(link.getAttribute('href')).toBe(official.url)
  expect(link.closest('details')).toBeNull()
  expect(link.closest('footer')?.getAttribute('aria-label')).toBe('可信来源')
  expect(screen.queryByText('转载活动')).toBeNull()
  expect(screen.queryByText('未知出处')).toBeNull()
  expect(screen.queryByText('过期规则')).toBeNull()
})
