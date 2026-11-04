// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { DetectiveMessage } from './detective-messages'
import { parseTrace } from './events'

afterEach(cleanup)
it('回复下方保留最终引用中的官方、转载与过期出处并去重', () => {
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
  expect(screen.getAllByRole('link')).toHaveLength(4)
  const link = screen.getByRole('link', { name: /活动规则/ })
  expect(link.getAttribute('href')).toBe(official.url)
  expect(link.closest('details')).toBeNull()
  expect(screen.getByRole('contentinfo', { name: '引用来源' }).contains(link)).toBe(true)
  expect(screen.getByRole('link', { name: /转载活动/ })).toBeTruthy()
  expect(screen.getByRole('link', { name: /未知出处/ })).toBeTruthy()
  expect(screen.getByRole('link', { name: /过期规则/ })).toBeTruthy()
})
