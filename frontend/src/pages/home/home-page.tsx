import { useCallback } from 'react'
import { useMatch, useNavigate } from 'react-router'

import { ContestBrowser } from '@/features/contest-browser'
import { ContestCalendar } from '@/features/contest-calendar'
import { ContestDetail } from '@/features/contest-detail'
import { DetectiveDock } from '@/features/detective'
import { WeeklyPicks } from '@/features/weekly-picks'

/** 首页只负责摆放各个区块，数据由各个 feature 自己取。 */
export function HomePage() {
  const contestId = useMatch('/contests/:contestId')?.params.contestId
  const navigate = useNavigate()
  const closeDetail = useCallback(() => navigate('/'), [navigate])

  return (
    <div className="min-h-dvh">
      <header className="border-b border-rule bg-surface">
        <div className="mx-auto flex h-14 max-w-[1200px] items-center px-4 sm:px-8">
          <span className="text-base font-semibold text-ink">比赛侦探</span>
        </div>
      </header>

      {/* 底部留白给常驻的侦探输入条，免得最后一个区块被它挡住 */}
      <main className="mx-auto max-w-[1200px] px-4 pb-32 sm:px-8">
        <WeeklyPicks />
        <ContestBrowser />
        <ContestCalendar />
      </main>

      <DetectiveDock />
      {contestId && <ContestDetail contestId={contestId} onClose={closeDetail} />}
    </div>
  )
}
