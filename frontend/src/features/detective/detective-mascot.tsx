import { lazy, Suspense } from 'react'
import searchFrame from '@/shared/assets/mascot/octo-search.png'
import type { Mood } from '@/shared/ui/octopus/inkpaw-octopus'
import type { DetectiveTurn } from './conversation'

const Octopus = lazy(() =>
  import('@/shared/ui/octopus/Octopus').then((module) => ({ default: module.Octopus })),
)

function investigationMood(turn: DetectiveTurn | undefined): Mood {
  if (!turn) return 'read'
  if (turn.content || turn.status === 'completed') return 'talk'
  const event = turn.trace.at(-1)
  if (event) {
    if (/fetch|read|extract|get_contest/.test(event.tool)) return 'read'
    if (/search|discover/.test(event.tool)) return 'search'
  }
  return 'think'
}

const labels: Record<Mood, string> = {
  idle: '',
  search: '正在搜索',
  read: '正在读原文',
  think: '正在比对',
  talk: '查证结果',
  happy: '已帮你盯上',
}

export function DetectiveMascot({ turn, happy }: { turn?: DetectiveTurn; happy: boolean }) {
  const mood = happy ? 'happy' : investigationMood(turn)
  return (
    <aside className="detective-mascot" aria-label="调查状态">
      <div className="detective-mascot__inner">
        <div className="detective-mascot__holder" data-happy={happy}>
          <Suspense
            fallback={
              <img
                src={searchFrame}
                width={106}
                height={85}
                alt="Inkpaw 八爪鱼"
                className="pixel-art"
              />
            }
          >
            <Octopus
              size={120}
              mood={mood}
              shadow={false}
              label={`${labels[mood]}的 Inkpaw 八爪鱼`}
            />
          </Suspense>
        </div>
        <span className="detective-mascot__state">{labels[mood]}</span>
      </div>
    </aside>
  )
}
