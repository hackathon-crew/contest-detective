import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ContestCard, createContestCalendar, listAllContests } from '@/entities/contest'
import { Button, EmptyState, ErrorState, Skeleton } from '@/shared/ui'
import { FollowButton } from './follow-button'
import type { FollowController } from './model'

export function FollowedContests({ follows }: { follows: FollowController }) {
  const [downloadError, setDownloadError] = useState<Error | null>(null)
  const query = useQuery({
    queryKey: ['followed-contests', follows.ids],
    queryFn: () => listAllContests({ ids: follows.ids }),
    enabled: follows.ids.length > 0,
  })
  function download() {
    try {
      const value = createContestCalendar(query.data ?? [])
      if (!value) throw new Error('关注赛事中没有可导出的已知日期')
      const url = URL.createObjectURL(new Blob([value], { type: 'text/calendar;charset=utf-8' }))
      try {
        const link = document.createElement('a')
        link.href = url
        link.download = '关注的比赛.ics'
        link.click()
      } finally {
        URL.revokeObjectURL(url)
      }
      setDownloadError(null)
    } catch (error) {
      setDownloadError(error instanceof Error ? error : new Error('日历生成失败，请重试'))
    }
  }
  return (
    <section
      id="follow"
      aria-labelledby="followed-contests-title"
      className="min-w-0 space-y-4 py-8"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="followed-contests-title" className="text-2xl font-bold text-ink">
          我的关注
        </h2>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={download}
          disabled={!follows.ids.length || !query.data?.length}
        >
          导出日历
        </Button>
      </div>
      {follows.error && <ErrorState error={new Error(follows.error)} />}
      {downloadError && <ErrorState error={downloadError} />}
      {!follows.ids.length ? (
        <EmptyState>先关注一场赛事</EmptyState>
      ) : query.isPending ? (
        <Skeleton />
      ) : query.isError ? (
        <ErrorState error={query.error} retry={() => void query.refetch()} />
      ) : query.data.length ? (
        <div className="grid gap-3">
          {query.data.map((contest) => (
            <ContestCard
              key={contest.id}
              contest={contest}
              action={<FollowButton contestId={contest.id} follows={follows} />}
            />
          ))}
        </div>
      ) : (
        <EmptyState>关注的赛事暂时无法获取</EmptyState>
      )}
    </section>
  )
}
