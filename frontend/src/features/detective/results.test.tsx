// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, it } from 'vitest'
import type { ContestDetail } from '@/shared/api'
import type { DetectiveTurn } from './conversation'
import { DetectiveMessage } from './detective-messages'
import { loadSessions, sessionsKey } from './sessions'

afterEach(() => {
  cleanup()
  localStorage.clear()
})

const contest: ContestDetail = {
  id: 'agent-weekend',
  name: '智能体周末',
  cover_url: 'https://example.org/poster.jpg',
  status: 'upcoming',
  summary: '用两天时间完成一个可演示的智能体应用。',
  fields: {
    organizer: { value: '开发者社区', level: 'reposted' },
    mode: { value: 'online', level: 'reposted' },
    prize: { value: '¥20,000', level: 'reposted' },
    submission_deadline: {
      value: '2026-11-01T00:00:00Z',
      precision: 'day',
      level: 'reposted',
      sources: [
        {
          url: 'https://example.org/event',
          site: '赛事社区',
          title: '活动公告',
          is_official: false,
          value: '2026-11-01T00:00:00Z',
          excerpt: '11 月 1 日提交截止',
          precision: 'day',
        },
      ],
    },
    registration_url: { value: 'https://example.org/apply', level: 'reposted' },
  },
}
const turn: DetectiveTurn = {
  id: 'turn',
  question: '推荐适合我参加的比赛',
  content: '我找到了一场适合继续了解的比赛。',
  status: 'completed',
  trace: [],
  sources: [],
}

function show(value: DetectiveTurn) {
  return render(
    <MemoryRouter>
      <DetectiveMessage turn={value} />
    </MemoryRouter>,
  )
}

it('adds source-backed cards beneath the existing answer without requiring a profile', () => {
  show({
    ...turn,
    recommendations: [{ contest, reason: '线上参赛，可以用已有的 Python 项目做原型。' }],
  } as DetectiveTurn)
  expect(screen.getByText(turn.content)).toBeTruthy()
  const card = within(screen.getByRole('article', { name: contest.name }))
  expect(card.getByText(contest.summary!)).toBeTruthy()
  expect(card.getByText('线上参赛，可以用已有的 Python 项目做原型。')).toBeTruthy()
  expect(card.getByText('开发者社区')).toBeTruthy()
  expect(card.getByText('¥20,000')).toBeTruthy()
  expect(card.getByText('仅转载')).toBeTruthy()
  const deadline = card.getByRole('link', { name: '11月1日（时刻未核实）' })
  expect(deadline.getAttribute('href')).toBe('https://example.org/event')
  expect(deadline.textContent).not.toMatch(/\d{2}:\d{2}/)
  expect(card.getByRole('link', { name: '了解比赛' }).getAttribute('href')).toBe(
    '/contests/agent-weekend',
  )
})

it('restores a profile file with its candidate data and lets the user inspect it', () => {
  const saved = {
    ...turn,
    profileFile: {
      name: 'octocat-profile.json',
      profile: { github: 'octocat', skills: ['Python'], topics: ['agent'] },
      candidates: [{ contest, score: 2, reason: '技能相符' }],
    },
  }
  localStorage.setItem(
    sessionsKey('guest'),
    JSON.stringify([
      { id: 'session', title: turn.question, createdAt: 1, updatedAt: 1, turns: [saved] },
    ]),
  )
  show(loadSessions('guest')[0]!.turns[0]!)
  fireEvent.click(screen.getByRole('button', { name: /octocat-profile.json/ }))
  const dialog = screen.getByRole('dialog', { name: 'octocat-profile.json' })
  expect(dialog.textContent).toContain('"github": "octocat"')
  expect(dialog.textContent).toContain('"name": "智能体周末"')
})

it('keeps ordinary markdown replies unchanged', () => {
  show({ ...turn, content: '**周末可参加。** [公告](https://example.org/event)' })
  expect(screen.getByText('周末可参加。', { selector: 'strong' })).toBeTruthy()
  expect(screen.getByRole('link', { name: '公告' }).getAttribute('href')).toBe(
    'https://example.org/event',
  )
  expect(screen.queryByRole('region', { name: '推荐比赛' })).toBeNull()
})
