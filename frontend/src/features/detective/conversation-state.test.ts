// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest'
import { conversationKey, historyFor, loadConversation, type DetectiveTurn } from './conversation'

afterEach(() => localStorage.clear())
const turn: DetectiveTurn = {
  id: 'one',
  question: '线上比赛',
  content: '可以继续按参赛身份筛选。',
  trace: [],
  sources: [],
  status: 'completed',
}

it('本地记录按身份隔离，恢复中断回复时保留部分文字', () => {
  localStorage.setItem(conversationKey('one'), JSON.stringify([{ ...turn, status: 'running' }]))
  expect(loadConversation('two')).toEqual([])
  expect(loadConversation('one')[0]).toMatchObject({
    question: turn.question,
    content: turn.content,
    status: 'stopped',
  })
})

it('破损记录和不安全来源链接不进入聊天界面', () => {
  localStorage.setItem(conversationKey('one'), 'broken')
  expect(loadConversation('one')).toEqual([])
  localStorage.setItem(
    conversationKey('one'),
    JSON.stringify([
      { ...turn, sources: [{ title: '原文', url: 'javascript:alert(1)', site: '' }] },
    ]),
  )
  expect(loadConversation('one')).toEqual([])
})

it('模型收到全部已完成前文，本地完整记录不变', () => {
  const turns = Array.from({ length: 9 }, (_, index) => ({
    ...turn,
    id: `${index}`,
    question: `问题${index}`,
  }))
  expect(historyFor(turns)).toHaveLength(18)
  expect(historyFor(turns)[0]).toEqual({ role: 'user', content: '问题0' })
  expect(historyFor(turns).at(-1)?.role).toBe('assistant')
  expect(turns).toHaveLength(9)
})

it('长中文和表情前文保持完整内容，未完成回复不发给模型', () => {
  const turns = Array.from({ length: 5 }, (_, index) => ({
    ...turn,
    id: `${index}`,
    content: '🙂'.repeat(4000),
  }))
  const history = historyFor([...turns, { ...turn, status: 'stopped' }])
  expect(history).toHaveLength(10)
  expect(history.at(-1)?.content).toBe('🙂'.repeat(4000))
  expect(history.every((message) => !message.content.includes('\uFFFD'))).toBe(true)
})
