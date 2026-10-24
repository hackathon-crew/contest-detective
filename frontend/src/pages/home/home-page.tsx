import { lazy, Suspense, useCallback, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocation, useNavigate, Link } from 'react-router'
import {
  ContestPreview,
  loadContestCollection,
  nextDeadline,
  deadlineDays,
  officialDeadlineCount,
  safeUrl,
} from '@/entities/contest'
import { currentUserKey, useCurrentUser } from '@/entities/user'
import { AppearanceControl } from '@/features/appearance'
import { AuthControls } from '@/features/auth'
import { ContestDetail } from '@/features/contest-detail'
import { DetectiveComposer, useDetective } from '@/features/detective'
import { FollowButton, useFollows } from '@/features/follow'
import {
  ProfileMatchDialog,
  loadConfirmedProfile,
  type ProfileMatchSection,
} from '@/features/profile-match'
import type { Profile } from '@/shared/api'
import { ErrorState, Skeleton } from '@/shared/ui'
import { SiteHeader } from '@/shared/ui/site-header'
import { SiteFooter } from '@/shared/ui/site-footer'
import { Icon } from '@/shared/ui/site-icon'
import calendar from '@/shared/assets/stickers/calendar.png'
import searchFrame from '@/shared/assets/mascot/octo-search.png'
import { ClosingCallout, DetectiveIntro, FilterIntro, McpIntro } from './home-content'
import { HomeFilter } from './home-filter'
import { DetectiveDemo } from './detective-demo'
import { McpPanel } from './mcp-panel'
import '@/features/detective/detective-composer.css'
import './home-page.css'
const Octopus = lazy(() =>
  import('@/shared/ui/octopus/Octopus').then((module) => ({ default: module.Octopus })),
)
const chips = ['这周截止的线上比赛', '上海的线下黑客松', '奖金过万的 AI 比赛', '按我的 GitHub 推荐']
export function HomePage({ contestId }: { contestId?: string }) {
  const { data: user } = useCurrentUser()
  const client = useQueryClient()
  const [guestProfile, setGuestProfile] = useState(loadConfirmedProfile)
  const [profileSection, setProfileSection] = useState<ProfileMatchSection | null>(null)
  const [question, setQuestion] = useState('')
  const [size, setSize] = useState(() => (window.innerWidth <= 880 ? 120 : 360))
  const input = useRef<HTMLTextAreaElement>(null)
  const navigate = useNavigate()
  const location = useLocation()
  const { send } = useDetective()
  const follows = useFollows()
  const collection = useQuery({
    queryKey: ['contests', 'collection'],
    queryFn: () => loadContestCollection(),
  })
  const contests = collection.data?.items ?? []
  const total = collection.data?.total
  const covers = contests.filter((contest) => safeUrl(contest.cover_url)).slice(0, 46)
  const half = Math.ceil(covers.length / 2)
  const soon = contests
    .flatMap((contest) => {
      const deadline = nextDeadline(contest)
      return deadline && deadlineDays(deadline) <= 14 ? [{ contest, end: deadline.end }] : []
    })
    .sort((a, b) => a.end - b.end)
    .slice(0, 8)
  const [lastContestId, setLastContestId] = useState(contestId)
  if (contestId && contestId !== lastContestId) setLastContestId(contestId)
  const detailId = contestId ?? lastContestId ?? ''
  const closeDetail = useCallback(
    () => navigate({ pathname: '/', search: location.search }),
    [navigate, location.search],
  )
  function confirmed(profile: Profile) {
    if (user) void client.invalidateQueries({ queryKey: currentUserKey })
    else setGuestProfile(profile)
  }
  function ask(text: string) {
    const value = text.trim()
    if (!value) return
    const id = send(value, user?.profile ?? guestProfile)
    navigate(`/detective/${id}`)
  }
  function focusAsk() {
    input.current?.scrollIntoView({
      block: 'center',
      behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    })
    input.current?.focus({ preventScroll: true })
  }
  const octopusHost = useCallback((node: HTMLDivElement | null) => {
    if (!node) return
    const update = () => setSize(window.innerWidth <= 880 ? 120 : 360)
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(update)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])
  return (
    <div className="bg-page min-h-dvh">
      <SiteHeader utilities={<AuthControls compact />} />
      <main className="inkpaw-home">
        <section className="hero">
          <div className="wrap hero-main">
            <div className="hero-copy">
              <Link className="lib-pill" to="/contests">
                已收录 <b>{total ?? '—'}</b> 场比赛 <Icon name="arrow-right" />
              </Link>
              <h1>
                说出你的条件，
                <br />
                侦探替你<span className="hl">找比赛</span>
              </h1>
              <p className="hero-lead">
                Inkpaw 检索
                Devpost、ETHGlobal、WaytoAGI、主办方官网和公众号，每个报名截止和提交截止都追到原文核对，并告诉你出处。
              </p>
              <div id="top-ask">
                <DetectiveComposer
                  value={question}
                  pending={false}
                  onChange={setQuestion}
                  onSubmit={(event) => {
                    event.preventDefault()
                    ask(question)
                  }}
                  onStop={() => {}}
                  onAddProfile={setProfileSection}
                  inputRef={input}
                  placeholder="比如：我会 Python，想找 11 月截止、线上能参加的 AI 黑客松"
                />
              </div>
              <div className="chips">
                {chips.map((chip) => (
                  <button
                    type="button"
                    className="chip"
                    key={chip}
                    onClick={() => {
                      setQuestion(chip)
                      input.current?.focus()
                    }}
                  >
                    {chip}
                  </button>
                ))}
              </div>
            </div>
            <div className="hero-octo" ref={octopusHost} title="点一下它">
              <Suspense
                fallback={
                  <img
                    className="px"
                    src={searchFrame}
                    width={106 * (size / 120)}
                    height={85 * (size / 120)}
                    alt="Inkpaw 八爪鱼"
                  />
                }
              >
                <Octopus size={size} mood="search" />
              </Suspense>
            </div>
          </div>
          <div className="wall" aria-hidden="true">
            {[covers.slice(0, half), covers.slice(half)].map((row, index) => (
              <div className={'wall-row' + (index ? ' rev' : '')} key={index}>
                {[...row, ...row].map((contest, index) => (
                  <img
                    key={contest.id + index}
                    src={contest.cover_url!}
                    alt=""
                    title={contest.name}
                    loading="lazy"
                    onError={(event) => {
                      event.currentTarget.style.visibility = 'hidden'
                    }}
                  />
                ))}
              </div>
            ))}
          </div>
          <div className="wrap">
            {collection.isError && (
              <ErrorState error={collection.error} retry={() => void collection.refetch()} />
            )}
            <div className="stats">
              <div className="stat">
                <b>{total ?? '—'}</b>
                <span>场比赛在库</span>
              </div>
              <div className="stat">
                <b>{collection.data ? officialDeadlineCount(contests) : '—'}</b>
                <span>场的截止时间对过官方原文</span>
              </div>
              <div className="stat">
                <b>6</b>
                <span>个比赛来源，另加联网检索</span>
              </div>
              <div className="stat">
                <b>3</b>
                <span>个 MCP 工具，接进你的 AI</span>
              </div>
            </div>
          </div>
        </section>
        <section className="feature" id="filter">
          <div className="wrap feature-grid">
            <FilterIntro />
            <HomeFilter
              profile={user?.profile ?? guestProfile}
              total={total}
              onAddProfile={() => setProfileSection('all')}
            />
          </div>
        </section>
        <section className="feature" id="agent">
          <div className="wrap feature-grid flip">
            <DetectiveIntro />
            <DetectiveDemo contests={contests} onAsk={ask} onAddProfile={setProfileSection} />
          </div>
        </section>
        <section className="feature" id="mcp">
          <div className="wrap feature-grid">
            <McpIntro />
            <McpPanel contests={contests} />
          </div>
        </section>
        <section className="soon" id="soon">
          <div className="wrap">
            <div className="sec-head">
              <div>
                <h2>两周内截止</h2>
                <p>按截止时间排，点开看每个字段的出处。</p>
              </div>
              <Link to="/contests">
                查看全部 {total ?? '—'} 场 <Icon name="arrow-right" />
              </Link>
              <img
                className="stk px x2"
                src={calendar}
                width={160}
                height={144}
                alt=""
                style={{ right: '132px', top: '-96px' }}
              />
            </div>
            {collection.isPending ? (
              <Skeleton />
            ) : collection.isError ? (
              <ErrorState error={collection.error} retry={() => void collection.refetch()} />
            ) : soon.length ? (
              <div className="grid">
                {soon.map(({ contest }) => (
                  <ContestPreview key={contest.id} contest={contest} card />
                ))}
              </div>
            ) : (
              <p className="empty">两周内没有已公布截止时间的比赛，去赛事库看看。</p>
            )}
          </div>
        </section>
        <ClosingCallout onAsk={focusAsk} />
      </main>
      <SiteFooter appearance={<AppearanceControl segmented />} />
      <ProfileMatchDialog
        open={!!profileSection}
        initialSection={profileSection ?? 'all'}
        user={user}
        onClose={() => setProfileSection(null)}
        onConfirmed={confirmed}
      />
      <ContestDetail
        open={!!contestId}
        contestId={detailId}
        onClose={closeDetail}
        onAsk={ask}
        action={<FollowButton contestId={detailId} follows={follows} />}
      />
    </div>
  )
}
