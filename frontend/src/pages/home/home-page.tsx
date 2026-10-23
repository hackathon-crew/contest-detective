import { useCallback } from 'react'
import { useLocation, useMatch, useNavigate } from 'react-router'

import { ContestBrowser } from '@/features/contest-browser'
import { ContestCalendar } from '@/features/contest-calendar'
import { ContestDetail } from '@/features/contest-detail'
import { DetectiveDock } from '@/features/detective'
import { WeeklyPicks } from '@/features/weekly-picks'

/** 首页只负责摆放各个区块，数据由各个 feature 自己取。 */
export function HomePage() {
  const contestId = useMatch('/contests/:contestId')?.params.contestId
  const navigate = useNavigate()
  const { search } = useLocation()
  const closeDetail = useCallback(() => navigate({ pathname: '/', search }), [navigate, search])

  return (
    <div className="min-h-dvh">
      <header className="border-b border-rule bg-surface">
        <div className="mx-auto flex h-14 max-w-7xl items-center px-6 sm:px-8">
          <span className="text-base font-semibold text-ink">比赛侦探</span>
        </div>
      </header>

      {/* 底部留白给常驻的侦探输入条，免得最后一个区块被它挡住 */}
      <main className="mx-auto max-w-7xl px-6 pb-32 sm:px-8">
        <section className="grid items-start gap-10 py-10 md:grid-cols-2 lg:py-14">
          <div className="space-y-6 lg:py-12">
            <h1 className="text-4xl font-bold text-ink">近期值得参加的黑客松</h1>
            <a
              href="#explore"
              className="inline-flex h-10 items-center rounded-xl bg-accent px-4 text-sm font-medium text-on-accent transition-colors duration-140 hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
            >
              浏览赛事
            </a>
          </div>
          <WeeklyPicks />
        </section>
        <div className="grid items-start gap-8 lg:grid-cols-3">
          <div className="min-w-0 lg:col-span-2">
            <ContestBrowser />
          </div>
          <ContestCalendar />
        </div>
      </main>

      <DetectiveDock />
      {contestId && <ContestDetail contestId={contestId} onClose={closeDetail} />}
    </div>
  )
}
