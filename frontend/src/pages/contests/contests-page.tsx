import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useLocation, useNavigate } from 'react-router'
import { Search, UserRound, X } from 'lucide-react'
import {
  ContestBrowser,
  LibraryRows,
  activeFilters,
  useContestBrowser,
} from '@/features/contest-browser'
import { ContestFilters } from '@/features/contest-filters'
import { SiteHeader } from '@/shared/ui/site-header'
import { SiteFooter } from '@/shared/ui/site-footer'
import octopusRead from '@/shared/assets/mascot/octo-read.png'
import { AppearanceControl } from '@/features/appearance'
import { AuthControls } from '@/features/auth'
import {
  ProfileMatchDialog,
  loadConfirmedProfile,
  type ProfileMatchSection,
} from '@/features/profile-match'
import { currentUserKey, useCurrentUser } from '@/entities/user'
import { createContestCalendar, libraryDate, type LibraryRow } from '@/entities/contest'
import type { MatchItem, Profile } from '@/shared/api'
import { ContestCalendar, ContestDatePicker } from '@/features/contest-calendar'
import { ContestDetail } from '@/features/contest-detail'
import { DetectiveDock, useDetective } from '@/features/detective'
import { WeeklyPicks } from '@/features/weekly-picks'
import { FollowButton, useFollows } from '@/features/follow'
import { ErrorState } from '@/shared/ui'
import './contests-page.css'
const Octopus = lazy(() =>
  import('@/shared/ui/octopus/Octopus').then((module) => ({ default: module.Octopus })),
)

export function ContestsPage({ contestId }: { contestId?: string }) {
  const { data: user } = useCurrentUser()
  const client = useQueryClient()
  const [profileSection, setProfileSection] = useState<ProfileMatchSection | null>(null)
  const [guestProfile, setGuestProfile] = useState(loadConfirmedProfile)
  const [matches, setMatches] = useState<MatchItem[] | null>(null)
  const [sheet, setSheet] = useState(false)
  const [narrow, setNarrow] = useState(
    () => window.matchMedia?.('(max-width: 880px)').matches ?? false,
  )
  useEffect(() => {
    const media = window.matchMedia?.('(max-width: 880px)')
    if (!media) return
    const change = () => setNarrow(media.matches)
    media.addEventListener('change', change)
    return () => media.removeEventListener('change', change)
  }, [])
  const closeSheet = useCallback(() => setSheet(false), [])
  const [downloadError, setDownloadError] = useState<unknown>(null)
  const follows = useFollows()
  const browser = useContestBrowser(follows.ids, matches)
  const listArea = useRef<HTMLElement>(null)
  const searchInput = useRef<HTMLInputElement>(null)
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [keyword, setKeyword] = useState(browser.filters.keyword)
  const [previousKeyword, setPreviousKeyword] = useState(browser.filters.keyword)
  if (previousKeyword !== browser.filters.keyword) {
    setPreviousKeyword(browser.filters.keyword)
    setKeyword(browser.filters.keyword)
  }
  useEffect(
    () => () => {
      if (searchTimer.current) clearTimeout(searchTimer.current)
    },
    [],
  )
  const [lastContestId, setLastContestId] = useState(contestId)
  if (contestId && contestId !== lastContestId) setLastContestId(contestId)
  const detailId = contestId ?? lastContestId ?? ''
  const navigate = useNavigate()
  const { send } = useDetective()
  const { search } = useLocation()
  const closeDetail = useCallback(
    () => navigate({ pathname: '/contests', search }),
    [navigate, search],
  )
  const profile = user?.profile ?? guestProfile
  const reasons = matches
    ? new Map(matches.map((item) => [item.contest.id, item.reason]))
    : undefined
  const renderAction = (id: string) => <FollowButton contestId={id} follows={follows} iconOnly />
  const renderRows = (rows: LibraryRow[]) => (
    <LibraryRows rows={rows} renderAction={renderAction} reasons={reasons} />
  )
  function change(patch: Parameters<typeof browser.change>[0]) {
    if ('keyword' in patch) {
      if (searchTimer.current) clearTimeout(searchTimer.current)
      setKeyword(patch.keyword ?? '')
    }
    browser.change(patch)
  }
  function clear() {
    if (searchTimer.current) clearTimeout(searchTimer.current)
    setKeyword('')
    browser.clear()
  }
  const official = browser.all.filter((contest) => {
    const date = libraryDate(contest)
    return date && !date.start && date.info.level === 'official'
  }).length
  const scrollToLibrary = () =>
    listArea.current?.scrollIntoView?.({ block: 'start', behavior: 'smooth' })
  function onMonth(month: string) {
    void browser.setParams({ month, day: month + '-01' })
  }
  function onDate(date: string) {
    void browser.setParams({
      date: browser.filters.date === date ? null : date,
      day: date,
      page: 1,
    })
  }
  function download() {
    try {
      const value = createContestCalendar(browser.all.filter((c) => follows.ids.includes(c.id)))
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
      setDownloadError(error)
    }
  }
  const pickerProps = {
    month: browser.month,
    date: browser.filters.date,
    map: browser.dayMap,
    today: browser.today,
    onMonth,
    onDate,
  }
  const tags = [
    profile?.identity,
    ...(profile?.skills ?? []),
    ...(profile?.topics ?? []),
    profile?.city,
    ...(profile?.preferred_modes ?? []).map((mode) =>
      mode === 'online' ? '想线上参加' : mode === 'offline' ? '想线下参加' : '线上线下都可',
    ),
  ].filter((value): value is string => !!value)
  return (
    <div className="contests-page">
      <SiteHeader
        utilities={<AuthControls compact />}
        actions={
          <button
            className="site-button site-button--ghost nav-follows"
            type="button"
            onClick={() => {
              change({ mine: true })
              scrollToLibrary()
            }}
          >
            我的关注{follows.ids.length > 0 && <span className="badge">{follows.ids.length}</span>}
          </button>
        }
      />
      <main>
        <section className="site-wrap head">
          <div className="head-copy">
            <h1>赛事库</h1>
            <p className="head-lead">
              {browser.query.isPending ? (
                '正在读取赛事库。'
              ) : browser.query.isError && !browser.query.data ? (
                '赛事库读取失败，请重试。'
              ) : !browser.query.complete ? (
                <>
                  已加载 <b>{browser.all.length}</b> 场比赛，
                  {browser.query.isFetching ? '正在读取其余赛事。' : '其余赛事尚未读取完成。'}
                </>
              ) : (
                <>
                  收录 <b>{browser.all.length}</b> 场黑客松，按截止时间排好。<b>{official}</b>{' '}
                  场的截止时间对过主办方原文，其余每个日期都标明了出处。
                </>
              )}
            </p>
            <div className="searchrow">
              <label className="search">
                <Search className="ic ic-20" />
                <input
                  ref={searchInput}
                  type="search"
                  aria-label="搜索赛事"
                  placeholder="搜索比赛、主办方、城市或方向"
                  autoComplete="off"
                  value={keyword}
                  onChange={(event) => {
                    const value = event.target.value
                    setKeyword(value)
                    if (searchTimer.current) clearTimeout(searchTimer.current)
                    searchTimer.current = setTimeout(
                      () => browser.change({ keyword: value.trim() }),
                      180,
                    )
                  }}
                />
                {keyword && (
                  <button
                    className="x"
                    type="button"
                    aria-label="清空搜索"
                    onClick={() => {
                      change({ keyword: '' })
                      searchInput.current?.focus()
                    }}
                  >
                    <X className="ic" />
                  </button>
                )}
              </label>
              <button
                className="site-button site-button--outline"
                type="button"
                aria-pressed={matches !== null}
                onClick={() => (matches ? setMatches(null) : setProfileSection('all'))}
              >
                <UserRound className="ic" />
                按我的情况挑
              </button>
            </div>
          </div>
          <div className="head-octo" title="点一下它">
            <Suspense
              fallback={
                <img
                  src={octopusRead}
                  width={narrow ? 120 : 240}
                  height={narrow ? 120 : 240}
                  alt=""
                  className="pixel-art"
                />
              }
            >
              <Octopus size={narrow ? 120 : 240} mood="read" />
            </Suspense>
          </div>
        </section>
        <WeeklyPicks />
        <section className="site-wrap lib" id="lib" ref={listArea} aria-label="全部赛事">
          <ContestFilters
            contests={browser.base}
            filters={browser.filters}
            follows={follows.ids}
            cities={browser.cities}
            onChange={change}
            onClear={clear}
            activeCount={activeFilters(browser.filters).length}
            total={browser.total}
            open={sheet}
            onClose={closeSheet}
            calendar={<ContestDatePicker {...pickerProps} />}
          />
          <div className="library-results">
            <ContestDatePicker {...pickerProps} strip />
            {follows.error && <ErrorState error={new Error(follows.error)} />}
            {downloadError != null && <ErrorState error={downloadError} />}
            <ContestBrowser
              browser={{ ...browser, change, clear }}
              onOpenFilters={() => setSheet(true)}
              renderAction={renderAction}
              reasons={reasons}
              exportAction={
                browser.filters.mine && (
                  <button
                    className="linkbtn"
                    type="button"
                    disabled={
                      !follows.ids.length || browser.query.isPending || browser.query.isError
                    }
                    onClick={download}
                  >
                    导出日历
                  </button>
                )
              }
              profile={
                matches !== null && (
                  <div className="profile-bar">
                    按你的画像挑：
                    {tags.map((tag, i) => (
                      <span key={tag + i} className="tag">
                        {tag}
                      </span>
                    ))}
                    <button
                      className="site-button site-button--ghost"
                      type="button"
                      onClick={() => setMatches(null)}
                    >
                      看全部
                    </button>
                  </div>
                )
              }
              calendar={
                <ContestCalendar
                  rows={browser.calendarRows}
                  followedIds={follows.ids}
                  month={browser.month}
                  selected={browser.day}
                  today={browser.today}
                  onMonth={onMonth}
                  onSelect={(day) => void browser.setParams({ day, month: day.slice(0, 7) })}
                  renderRows={renderRows}
                />
              }
            />
          </div>
        </section>
      </main>
      <SiteFooter appearance={<AppearanceControl segmented />} />
      <DetectiveDock key={user?.id ?? 'guest'} profile={profile} onAddProfile={setProfileSection} />
      <ProfileMatchDialog
        open={!!profileSection}
        user={user}
        initialSection={profileSection ?? 'all'}
        onClose={() => setProfileSection(null)}
        onConfirmed={(confirmed: Profile) => {
          if (user) void client.invalidateQueries({ queryKey: currentUserKey })
          else setGuestProfile(confirmed)
        }}
        onMatched={(_confirmed, results) => {
          setMatches(results)
          setProfileSection(null)
          scrollToLibrary()
        }}
      />
      <ContestDetail
        variant="library"
        open={!!contestId}
        contestId={detailId}
        onClose={closeDetail}
        onAsk={(question) => navigate('/detective/' + send(question, profile))}
        action={<FollowButton contestId={detailId} follows={follows} />}
      />
    </div>
  )
}
