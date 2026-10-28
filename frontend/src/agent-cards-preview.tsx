import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Navigate, Route, Routes, useParams } from 'react-router'
import { NuqsAdapter } from 'nuqs/adapters/react-router/v8'
import { DetectivePage } from '@/pages/detective'
import { ContestsPage } from '@/pages/contests'
import { queryClient } from '@/app/query-client'
import { DetectiveContext } from '@/features/detective/detective-context'
import type {
  ContestRecommendation,
  DetectiveTurn,
  ProfileFile,
} from '@/features/detective/conversation'
import { loadSessions, sessionsKey, sessionWithTurn } from '@/features/detective/sessions'
import { CONFIRMED_PROFILE_KEY } from '@/features/profile-match/state'
import type { ContestDetail, Profile } from '@/shared/api'
import snapshot from '../preview/contests.json'
import paypalCover from '../preview/covers/paypal.jpg'
import qlooCover from '../preview/covers/qloo.jpg'
import './index.css'

// 这是独立 Vite 预览入口。固定数据与请求替身不由正式 main.tsx 引用。
const contests: ContestDetail[] = snapshot.map((contest, index) => ({
  ...contest,
  cover_url: new URL(index === 0 ? paypalCover : qlooCover, location.origin).href,
})) as ContestDetail[]
const withProfile = new URLSearchParams(location.search).get('profile') !== 'off'
const profile: Profile = {
  github: 'octocat',
  skills: ['TypeScript', 'Python'],
  topics: ['agent', 'web'],
  identity_kind: 'student',
  preferred_modes: ['online'],
  github_evidence: [],
}
const recommendations: ContestRecommendation[] = [
  {
    contest: contests[0]!,
    introduction: '围绕低代码、机器学习和 Web 应用展开的 AI 黑客松。',
    reason: '准备时间更充裕，适合从现有 Web 项目开始。',
  },
  {
    contest: contests[1]!,
    introduction: '面向机器学习与 AI 项目的智能体主题黑客松。',
    reason: '提交时间较近，适合已有智能体原型的情况。',
  },
]
const candidates = recommendations.map(({ contest, reason }) => ({ contest, reason, score: 1 }))
function profileFile(value: Profile): ProfileFile {
  return { name: `${value.github || 'participant'}-profile.json`, profile: value, candidates }
}
function makeTurn(question: string, file?: ProfileFile): DetectiveTurn {
  return {
    id: crypto.randomUUID(),
    question,
    content: file
      ? '我会结合你的画像看赛道、时间和参与方式。这两场都能线上参加，我把基本信息和适合的做法放在下面了。'
      : '先按 AI 方向和线上参赛来找，这两场可以一起比较。它们的提交时间和奖励不同，具体信息放在卡片里。',
    status: 'completed',
    profileFile: file,
    recommendations,
    trace: [
      { type: 'step', tool: 'search_contests', label: '查询比赛库' },
      {
        type: 'observation',
        tool: 'search_contests',
        summary: '找到两场线上 AI 方向的比赛',
        sources: [],
      },
      { type: 'step', tool: 'web_search', label: '检索比赛的最新信息' },
      {
        type: 'observation',
        tool: 'web_search',
        summary: '整理比赛的截止日期、主办方和奖励',
        sources: [],
      },
    ],
    sources: contests.map((contest) => ({
      title: contest.name,
      url: contest.fields.registration_url!.value!,
      site: 'Devpost',
      is_official: true,
    })),
  }
}
const seedId = withProfile ? 'profile-cards-preview' : 'cards-preview'
const key = sessionsKey('guest')
const saved = loadSessions('guest')
for (const session of saved)
  for (const turn of session.turns) if (turn.recommendations) turn.recommendations = recommendations
if (!saved.some((session: { id: string }) => session.id === seedId)) {
  const turn = makeTurn(
    withProfile
      ? '按我的 GitHub 画像，找两场适合的线上 AI 比赛。'
      : '找两场可以线上参加的 AI 比赛。',
    withProfile ? profileFile(profile) : undefined,
  )
  saved.unshift({
    id: seedId,
    title: turn.question,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    turns: [turn],
  })
}
localStorage.setItem(key, JSON.stringify(saved))

const originalFetch = window.fetch.bind(window)
const json = (data: unknown) =>
  new Response(
    JSON.stringify({
      code: 200,
      message: 'success',
      data,
      total: Array.isArray(data) ? data.length : 0,
      page: 1,
      page_size: 100,
    }),
    { headers: { 'content-type': 'application/json' } },
  )

window.fetch = async (input, init) => {
  const url = new URL(
    typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    location.origin,
  )
  if (!url.pathname.startsWith('/api/')) return originalFetch(input, init)
  if (url.pathname === '/api/auth/me') return json(null)
  if (url.pathname === '/api/profile/github') {
    const { username } = JSON.parse(String(init?.body))
    return json({ ...profile, github: username })
  }
  if (url.pathname === '/api/profile/resume') return json(profile)
  if (url.pathname === '/api/match') {
    const value: Profile = JSON.parse(String(init?.body))
    const sessions = JSON.parse(localStorage.getItem(key) ?? '[]')
    const active = sessions.find((session: { id: string }) => session.id === seedId)
    if (active) {
      active.turns.push(makeTurn('请根据这份画像，再帮我检索和挑选比赛。', profileFile(value)))
      active.updatedAt = Date.now()
      localStorage.setItem(key, JSON.stringify(sessions))
    }
    // 只在 mock 中模拟“确认画像→回到 Agent”，正式画像弹窗保持现状。
    location.reload()
    return json(candidates)
  }
  if (url.pathname === '/api/contests') return json(contests)
  if (url.pathname.startsWith('/api/contests/'))
    return json(contests.find((contest) => contest.id === url.pathname.split('/').at(-1)))
  return json([])
}

// 画像只在需要的预览场景里注入；无画像场景保留原本的直接提问体验。
if (withProfile && !localStorage.getItem(CONFIRMED_PROFILE_KEY))
  localStorage.setItem(CONFIRMED_PROFILE_KEY, JSON.stringify(profile))

export function Preview() {
  const [sessions, setSessions] = useState(saved)
  const pending = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => {
    localStorage.setItem(key, JSON.stringify(sessions))
  }, [sessions])
  useEffect(() => () => clearTimeout(pending.current), [])
  return (
    <DetectiveContext
      value={{
        sessions,
        storageError: false,
        send(question, value, sessionId) {
          const previous = sessions.find((session) => session.id === sessionId)
          const answer = makeTurn(question, withProfile && value ? profileFile(value) : undefined)
          const session = sessionWithTurn(
            question,
            { ...answer, status: 'running', content: '', recommendations: undefined },
            previous,
          )
          setSessions((items) => [session, ...items.filter((item) => item.id !== session.id)])
          pending.current = setTimeout(() => {
            setSessions((items) =>
              items.map((item) =>
                item.id === session.id
                  ? {
                      ...item,
                      turns: item.turns.map((turn) => (turn.id === answer.id ? answer : turn)),
                    }
                  : item,
              ),
            )
          }, 900)
          return session.id
        },
        retry(turnId) {
          setSessions((items) =>
            items.map((session) => ({
              ...session,
              turns: session.turns.map((turn) =>
                turn.id === turnId ? { ...makeTurn(turn.question), id: turn.id } : turn,
              ),
            })),
          )
        },
        stop(sessionId) {
          clearTimeout(pending.current)
          setSessions((items) =>
            items.map((session) =>
              session.id === sessionId
                ? {
                    ...session,
                    turns: session.turns.map((turn) =>
                      turn.status === 'running' ? { ...turn, status: 'stopped' } : turn,
                    ),
                  }
                : session,
            ),
          )
        },
      }}
    >
      <Routes>
        <Route path="/detective" element={<DetectivePage />} />
        <Route path="/detective/:conversationId" element={<DetectivePage />} />
        <Route path="/contests" element={<ContestsPage />} />
        <Route path="/contests/:contestId" element={<PreviewDetail />} />
        <Route path="*" element={<Navigate to={`/detective/${seedId}`} replace />} />
      </Routes>
    </DetectiveContext>
  )
}
export function PreviewDetail() {
  const { contestId } = useParams()
  return <ContestsPage contestId={contestId} />
}

createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={queryClient}>
    <MemoryRouter initialEntries={[`/detective/${seedId}`]}>
      <NuqsAdapter>
        <Preview />
      </NuqsAdapter>
    </MemoryRouter>
  </QueryClientProvider>,
)
