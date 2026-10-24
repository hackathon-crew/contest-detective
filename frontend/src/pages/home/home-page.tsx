import { useCallback, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useLocation, useMatch, useNavigate } from 'react-router'

import { ContestBrowser } from '@/features/contest-browser'
import { SiteHeader } from '@/shared/ui/site-header'
import { SiteFooter } from '@/shared/ui/site-footer'
import { AppearanceControl } from '@/features/appearance'
import { AuthControls } from '@/features/auth'
import {
  ProfileMatchDialog,
  loadConfirmedProfile,
  type ProfileMatchSection,
} from '@/features/profile-match'
import { currentUserKey, useCurrentUser } from '@/entities/user'
import type { Profile } from '@/shared/api'
import { Button } from '@/shared/ui'
import { ContestCalendar } from '@/features/contest-calendar'
import { ContestDetail } from '@/features/contest-detail'
import { DetectiveDock } from '@/features/detective'
import { WeeklyPicks } from '@/features/weekly-picks'
import { FollowButton, FollowedContests, useFollows } from '@/features/follow'
import { ErrorState } from '@/shared/ui'

/** 首页只负责摆放各个区块，数据由各个 feature 自己取。 */
export function HomePage() {
  const { data: user } = useCurrentUser()
  const client = useQueryClient()
  const [profileSection, setProfileSection] = useState<ProfileMatchSection | null>(null)
  const [guestProfile, setGuestProfile] = useState(loadConfirmedProfile)
  const follows = useFollows()
  const [showFollows, setShowFollows] = useState(false)
  const listArea = useRef<HTMLDivElement | null>(null)
  const followAction = (contest: { id: string }) => (
    <FollowButton contestId={contest.id} follows={follows} />
  )
  const contestId = useMatch('/contests/:contestId')?.params.contestId
  const navigate = useNavigate()
  const { search } = useLocation()
  const closeDetail = useCallback(() => navigate({ pathname: '/', search }), [navigate, search])
  function confirmed(profile: Profile) {
    if (user) void client.invalidateQueries({ queryKey: currentUserKey })
    else setGuestProfile(profile)
  }

  return (
    <div className="min-h-dvh">
      <SiteHeader
        utilities={<AuthControls compact />}
        actions={
          <Button
            variant="ghost"
            onClick={() => {
              setShowFollows((value) => !value)
              listArea.current?.scrollIntoView?.({ block: 'start' })
            }}
          >
            {showFollows ? '全部赛事' : '我的关注'}
          </Button>
        }
      />

      {/* 底部留白给常驻的侦探输入条，免得最后一个区块被它挡住 */}
      <main className="mx-auto max-w-7xl px-6 pb-32 sm:px-8">
        <section className="grid items-start gap-10 py-10 md:grid-cols-2 lg:py-14">
          <div className="space-y-6 lg:py-12">
            <h1 className="text-4xl font-bold text-balance text-ink">近期值得参加的黑客松</h1>
            <div className="flex flex-wrap gap-3">
              <a
                href="#explore"
                onClick={() => setShowFollows(false)}
                className="inline-flex h-10 items-center rounded-xl bg-accent px-4 text-sm font-medium text-on-accent transition-colors duration-140 hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
              >
                浏览赛事
              </a>
              <Button variant="outline" onClick={() => setProfileSection('all')}>
                按我的情况挑比赛
              </Button>
            </div>
          </div>
          <WeeklyPicks renderAction={followAction} />
        </section>
        {!showFollows && follows.error && <ErrorState error={new Error(follows.error)} />}
        <div
          id="explore"
          ref={listArea}
          className="grid items-start gap-8 md:grid-cols-2 lg:grid-cols-3"
        >
          <div className="min-w-0 lg:col-span-2">
            {showFollows ? (
              <FollowedContests follows={follows} />
            ) : (
              <ContestBrowser renderAction={followAction} />
            )}
          </div>
          <ContestCalendar followedIds={follows.ids} />
        </div>
      </main>

      <SiteFooter appearance={<AppearanceControl segmented />} />
      <DetectiveDock
        key={user?.id ?? 'guest'}
        profile={user?.profile ?? guestProfile}
        onAddProfile={setProfileSection}
      />
      {profileSection && (
        <ProfileMatchDialog
          user={user}
          initialSection={profileSection}
          onClose={() => setProfileSection(null)}
          onConfirmed={confirmed}
        />
      )}
      {contestId && (
        <ContestDetail
          contestId={contestId}
          onClose={closeDetail}
          action={<FollowButton contestId={contestId} follows={follows} />}
        />
      )}
    </div>
  )
}
