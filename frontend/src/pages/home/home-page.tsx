import type { VerificationOptions } from '@/features/detective/verification-contracts'
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useLocation, useNavigate, Link } from 'react-router'
import { ChevronDown } from 'lucide-react'
import { useContestCollection, safeUrl } from '@/entities/contest'
import {
  currentUserKey,
  loginReturn,
  personalIntent,
  useCurrentUser,
  useLoginGate,
} from '@/entities/user'
import { AppearanceControl } from '@/features/appearance'
import { AuthControls } from '@/features/auth'
import { ContestDetail } from '@/features/contest-detail'
import { DetectiveComposer, useDetective } from '@/features/detective'
import { FollowButton, useFollows } from '@/features/follow'
import {
  ProfileMatchDialog,
  ProfileNudge,
  useProfileNudge,
  loadConfirmedProfile,
  type ProfileMatchSection,
} from '@/features/profile-match'
import { ErrorState } from '@/shared/ui'
import { SiteHeader } from '@/shared/ui/site-header'
import { SiteFooter } from '@/shared/ui/site-footer'
import { Icon } from '@/shared/ui/site-icon'
import { useScrollProgress } from '@/shared/lib/use-scroll-progress'
import searchFrame from '@/shared/assets/mascot/octo-search.png'
import { HomeFeatures, HomeClosing } from './home-features'
import '@/features/detective/detective-composer.css'
import './home-page.css'
import './home-refresh.css'

const Octopus = lazy(() =>
  import('@/shared/ui/octopus/Octopus').then((module) => ({ default: module.Octopus })),
)
const questions = [
  '两周内截止、线上能参加的 AI 比赛',
  '怀柔科学城黑客松的报名截止是哪天？',
  '这场比赛收不收中国学生？',
]

function WallCover({ url, name }: { url: string; name: string }) {
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  const imageRef = useCallback((image: HTMLImageElement | null) => {
    if (image?.complete && image.naturalWidth > 0) setLoaded(true)
  }, [])
  if (failed) return null
  return (
    <div className="wall-card" title={name}>
      <img
        ref={imageRef}
        src={url}
        alt=""
        loading="lazy"
        data-loaded={loaded}
        onLoad={() => setLoaded(true)}
        onError={() => setFailed(true)}
      />
    </div>
  )
}

export function HomePage({ contestId }: { contestId?: string }) {
  const location = useLocation()
  const { data: user, isPending: userPending } = useCurrentUser()
  const client = useQueryClient()
  const requireLogin = useLoginGate()
  const profileQuery = new URLSearchParams(location.search).get('profile')
  const [profileSection, setProfileSection] = useState<ProfileMatchSection | null>(
    () => personalIntent(location).profileSection ?? null,
  )
  const activeProfileSection =
    profileQuery === 'github' ? (user && !userPending ? 'github' : null) : profileSection
  const [question, setQuestion] = useState(() => personalIntent(location).question ?? '')
  const [size, setSize] = useState(() => (window.innerWidth <= 760 ? 120 : 360))
  const [moreVisible, setMoreVisible] = useState(false)
  const [scrolled, setScrolled] = useState(window.scrollY > 40)
  const [speaking, setSpeaking] = useState(false)
  const input = useRef<HTMLTextAreaElement>(null)
  const octopus = useRef<HTMLDivElement>(null)
  const wall = useRef<HTMLElement>(null)
  const navigate = useNavigate()
  const { send } = useDetective()
  const follows = useFollows()
  const collection = useContestCollection()
  const contests = collection.data?.items ?? []
  const total = collection.data?.total
  const covers = contests.filter((contest) => safeUrl(contest.cover_url)).slice(0, 46)
  const half = Math.ceil(covers.length / 2)
  const waitingForCovers =
    !covers.length &&
    (collection.isPending || (collection.isFetching && !collection.data?.complete))
  const [lastContestId, setLastContestId] = useState(contestId)
  if (contestId && contestId !== lastContestId) setLastContestId(contestId)
  const detailId = contestId ?? lastContestId ?? ''
  const homePath = location.state?.backgroundLocation?.pathname ?? (user ? '/home' : '/')
  const closeDetail = useCallback(
    () => navigate({ pathname: homePath, search: location.search }),
    [navigate, homePath, location.search],
  )
  const nudge = useProfileNudge({
    profile: user?.profile ?? loadConfirmedProfile(),
    enabled: !userPending && !activeProfileSection && !contestId,
  })
  useScrollProgress(wall, 'wall')
  useEffect(() => {
    if (profileQuery !== 'github' || userPending || user) return
    const search = new URLSearchParams(location.search)
    search.delete('profile')
    navigate('/login', {
      replace: true,
      state: loginReturn(
        { ...location, search: search.size ? '?' + search.toString() : '' },
        { profileSection: 'github', question },
      ),
    })
  }, [location, navigate, profileQuery, question, user, userPending])
  useEffect(() => {
    const timer = setTimeout(() => setMoreVisible(true), 1400)
    const resize = () => setSize(window.innerWidth <= 760 ? 120 : 360)
    const scroll = () => setScrolled(window.scrollY > 40)
    window.addEventListener('resize', resize)
    window.addEventListener('scroll', scroll, { passive: true })
    return () => {
      clearTimeout(timer)
      window.removeEventListener('resize', resize)
      window.removeEventListener('scroll', scroll)
    }
  }, [])
  function confirmed() {
    void client.invalidateQueries({ queryKey: currentUserKey })
  }
  function addProfile(section: ProfileMatchSection) {
    nudge.dismiss()
    if (requireLogin({ question, profileSection: section })) setProfileSection(section)
  }
  function closeProfile() {
    setProfileSection(null)
    if (profileQuery) {
      const search = new URLSearchParams(location.search)
      search.delete('profile')
      navigate(
        { pathname: location.pathname, search: search.toString(), hash: location.hash },
        { replace: true, state: location.state },
      )
    }
  }
  function ask(text: string, verification?: VerificationOptions) {
    const value = text.trim()
    if (!value) return
    const id = send(value, user?.profile, undefined, verification)
    if (id) navigate('/detective/' + id)
  }
  function focusAsk() {
    window.scrollTo({
      top: 0,
      behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    })
    input.current?.focus({ preventScroll: true })
  }
  return (
    <div className="bg-page min-h-dvh">
      <SiteHeader utilities={<AuthControls compact />} />
      <main className="inkpaw-home home-refresh">
        <div className="home-stage">
          <section className="hero">
            <div className="hero-main">
              <div className="hero-copy">
                <Link className="pill" to="/contests">
                  已收录 <b>{total ?? '—'}</b> 场比赛 <Icon name="arrow-right" />
                </Link>
                <h1 className="hello">
                  按你的兴趣和优势，
                  <br />
                  找到<span className="hl">适合的比赛</span>
                </h1>
                <div id="top-ask">
                  <DetectiveComposer
                    value={question}
                    pending={false}
                    onChange={setQuestion}
                    onSubmit={(event, verification) => {
                      event.preventDefault()
                      ask(question, verification)
                    }}
                    onStop={() => {}}
                    onAddProfile={addProfile}
                    onVerifyScreenshot={({ question, ...verification }) =>
                      ask(question, verification)
                    }
                    inputRef={input}
                    placeholder="比如：我做过 Python 项目，想找线上能参加的 AI 比赛"
                  />
                </div>
                <div className="chips" aria-label="建议问题">
                  {questions.map((text) => (
                    <button className="chip" type="button" key={text} onClick={() => ask(text)}>
                      {text}
                    </button>
                  ))}
                  <button
                    className="chip chip-accent"
                    type="button"
                    onClick={() => (nudge.hasProfile ? addProfile('all') : nudge.request())}
                  >
                    按我的画像推荐
                  </button>
                </div>
              </div>
              <div
                className="octo-slot hero-octo"
                ref={octopus}
                data-speaking={speaking}
                title="点一下它"
              >
                <Suspense
                  fallback={
                    <img
                      className="pixel-art"
                      src={searchFrame}
                      width={106 * (size / 120)}
                      height={85 * (size / 120)}
                      alt="Inkpaw 八爪鱼"
                    />
                  }
                >
                  <Octopus size={size} mood={speaking ? 'talk' : 'search'} />
                </Suspense>
              </div>
            </div>
            <button
              type="button"
              className={'more' + (moreVisible ? ' show' : '') + (scrolled ? ' gone' : '')}
              onClick={() =>
                wall.current?.scrollIntoView({
                  behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
                    ? 'auto'
                    : 'smooth',
                  block: 'start',
                })
              }
            >
              往下看全部比赛
              <ChevronDown aria-hidden="true" />
            </button>
          </section>
          <section className="wall" ref={wall} aria-label="最近收录的比赛">
            <div className="wall-tilt" aria-hidden="true">
              {[covers.slice(0, half), covers.slice(half)].map((row, rowIndex) => (
                <div className={'wall-row' + (rowIndex ? ' rev soft' : '')} key={rowIndex}>
                  {[...row, ...row].map((contest, index) => (
                    <WallCover
                      key={contest.id + contest.cover_url + index}
                      url={contest.cover_url!}
                      name={contest.name}
                    />
                  ))}
                  {waitingForCovers &&
                    Array.from({ length: 16 }, (_, index) => (
                      <div className="wall-card" key={index} />
                    ))}
                </div>
              ))}
            </div>
            <div className="wall-foot">
              <h2>{total ?? '—'} 场比赛，按截止时间排好了</h2>
              <Link className="btn line" to="/contests">
                进赛事库
              </Link>
            </div>
            <div className="wall-state">
              {collection.data && !collection.data.complete && (
                <p className="note" role="status">
                  已加载 {contests.length} / {total} 场
                  {collection.isFetching ? '，继续读取中。' : '。'}
                </p>
              )}
              {collection.isError && (
                <ErrorState error={collection.error} retry={() => void collection.refetch()} />
              )}
            </div>
          </section>
          <HomeFeatures onAsk={focusAsk} onAddProfile={addProfile} />
          <HomeClosing onAsk={focusAsk} />
        </div>
      </main>
      <SiteFooter appearance={<AppearanceControl segmented />} />
      <ProfileNudge
        open={nudge.visible}
        onClose={nudge.dismiss}
        onChoose={addProfile}
        anchor={octopus}
        wall={wall}
        onPresent={setSpeaking}
      />
      <ProfileMatchDialog
        open={!!activeProfileSection}
        initialSection={activeProfileSection ?? 'all'}
        user={user}
        onClose={closeProfile}
        onConfirmed={confirmed}
      />
      <ContestDetail
        open={!!contestId}
        contestId={detailId}
        onClose={closeDetail}
        onAsk={(contest) => navigate('/detective?contest=' + encodeURIComponent(contest.id))}
        action={<FollowButton contestId={detailId} follows={follows} />}
      />
    </div>
  )
}
