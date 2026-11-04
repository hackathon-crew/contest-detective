import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import ReactMarkdown from 'react-markdown'
import { useLocation, useNavigate, useParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { useCurrentUser, loginReturn, personalIntent } from '@/entities/user'
import { apiClient, type Profile, type WatchRead } from '@/shared/api'
import { safeUrl } from '@/entities/contest'
import { DetectiveMessage, useDetective, useGuestQuota } from '@/features/detective'
import {
  ProfileMatchDialog,
  hasProfileData,
  loadConfirmedProfile,
  type ProfileMatchSection,
} from '@/features/profile-match'
import { useLiveAlbum } from '@/features/follow/live-album'
import { liveCard } from '@/features/detective/live/model'
import {
  mountLive,
  type LiveHandle,
  type LiveSnapshot,
  type LiveCallbacks,
} from '@/features/detective/live/main.js'
import view from '@/features/detective/live/view.html?raw'
import '@/features/detective/detective-conversation.css'
import '@/features/detective/evidence-report.css'
import '@/features/detective/live/live.css'

export default function LivePage() {
  const location = useLocation(),
    navigate = useNavigate(),
    { conversationId } = useParams()
  const auth = useCurrentUser(),
    user = auth.data
  const detective = useDetective()
  const session = detective.sessions.find((item) => item.id === conversationId)
  const turn = session?.turns.at(-1)
  const quota = useGuestQuota(!user)
  const book = useLiveAlbum(user?.id)
  const intent = personalIntent(location)
  const profile = hasProfileData(user?.profile) ? user?.profile : loadConfirmedProfile()
  const [profileSection, setProfileSection] = useState<ProfileMatchSection | null>(
    intent.profileSection ?? null,
  )
  const [notice, setNotice] = useState('')
  const requestedProfile =
    detective.profileRequest?.conversationId === conversationId ? detective.profileRequest : null
  const watching = useQuery({
    queryKey: ['live-watch', user?.id],
    enabled: !!user,
    queryFn: ({ signal }) => apiClient.request<WatchRead>('/account/watch', { signal }),
  })
  const album = book.cards.map((contest) => {
    const sourceTurn = detective.sessions
      .flatMap((item) => item.turns)
      .findLast((item) =>
        item.recommendations?.some((recommendation) => recommendation.contest.id === contest.id),
      )
    return liveCard({ contest, reason: '' }, sourceTurn)
  })
  const snapshot: LiveSnapshot = {
    textHref: conversationId ? '/detective/' + conversationId : '/detective',
    turn,
    cards: (turn?.recommendations ?? []).map((item) => liveCard(item, turn)),
    album,
    loggedIn: !!user,
    remaining: !user ? quota.data?.remaining : undefined,
    watching: (watching.data?.items ?? [])
      .filter((item) => item.enabled)
      .map((item) => item.contest_id),
    ticket:
      detective.loginRequest && detective.loginRequest.conversationId === conversationId
        ? 'login'
        : requestedProfile
          ? 'profile'
          : undefined,
  }
  const host = useRef<HTMLDivElement>(null),
    runtime = useRef<LiveHandle | null>(null)
  const [logTarget, setLogTarget] = useState<Element | null>(null)
  function submit(text: string) {
    const id = detective.send(text, profile, session?.id)
    if (id) navigate('/live/' + id, { replace: !session })
  }
  function login(watchId?: string | null, section?: ProfileMatchSection) {
    const question = requestedProfile?.question ?? detective.loginRequest?.question
    navigate('/login', {
      state: loginReturn(
        {
          ...location,
          state: {
            ...location.state,
            ...(watchId ? { liveWatch: watchId } : {}),
            ...(detective.loginRequest ? { liveQuestion: question } : {}),
          },
        },
        {
          question,
          saveGuestConversation: session?.id,
          profileSection: section,
          resumeProfileQuestion: !!requestedProfile,
        },
      ),
    })
  }
  async function watch(id: string) {
    try {
      await apiClient.request('/account/follows/' + encodeURIComponent(id), {
        method: 'PUT',
        json: { reminders: true },
      })
      await apiClient.request('/account/watch/' + encodeURIComponent(id), {
        method: 'PUT',
        json: { enabled: true },
      })
      await watching.refetch()
      return true
    } catch {
      // 既有账户入口提供邮箱验证和通知配置，保留当前卡片及查证记录。
      setNotice('卡片已保留。打开账号的盯梢设置，确认收件邮箱后继续。')
      return false
    }
  }
  const handlers = useRef<LiveCallbacks>(null!)
  const latest = useRef(snapshot)
  useLayoutEffect(() => {
    handlers.current = {
      submit,
      stop: () => session && detective.stop(session.id),
      collect: book.collect,
      watch,
      login,
      profile: (section) => (user ? setProfileSection(section) : login(undefined, section)),
      dismissTicket: () => {
        detective.clearLoginRequest()
        detective.clearProfileRequest()
      },
      text: () => navigate(conversationId ? '/detective/' + conversationId : '/detective'),
    }
    latest.current = snapshot
  })
  useEffect(() => {
    const callbacks: LiveCallbacks = {
      submit: (text) => handlers.current.submit(text),
      stop: () => handlers.current.stop(),
      collect: (contest) => handlers.current.collect(contest),
      watch: (id) => handlers.current.watch(id),
      login: (id) => handlers.current.login(id),
      profile: (section) => handlers.current.profile(section),
      dismissTicket: () => handlers.current.dismissTicket(),
      text: () => handlers.current.text(),
    }
    runtime.current = mountLive(host.current!, callbacks, latest.current)
    setLogTarget(host.current!.querySelector('#loglist'))
    return () => {
      runtime.current?.stop()
      runtime.current = null
    }
  }, [view])
  useEffect(() => runtime.current?.update(snapshot))
  const started = useRef(false)
  useEffect(() => {
    const question = location.state?.liveQuestion as string | undefined
    if (!question || started.current || auth.isPending || detective.loading) return
    let active = true
    queueMicrotask(() => {
      if (!active || started.current) return
      started.current = true
      submit(question)
    })
    return () => {
      active = false
    }
  }, [auth.isPending, detective.loading, location.state?.liveQuestion, submit])
  const continuedWatch = useRef(false)
  useEffect(() => {
    const id = location.state?.liveWatch as string | undefined
    if (!id || !user || continuedWatch.current) return
    continuedWatch.current = true
    void watch(id)
  }, [location.state?.liveWatch, user, watch])
  function confirmed(confirmedProfile: Profile) {
    setProfileSection(null)
    if (requestedProfile || intent.resumeProfileQuestion) {
      const id = requestedProfile
        ? detective.resumeWithProfile(confirmedProfile)
        : detective.send(intent.question!, confirmedProfile, session?.id)
      if (id) navigate('/live/' + id, { replace: true })
    }
  }
  return (
    <>
      <div ref={host} className="inkpaw-live" dangerouslySetInnerHTML={{ __html: view }} />
      {logTarget &&
        createPortal(
          <div className="live-record">
            {!session?.turns.length && (
              <p className="empty">这里会留下你们说过的话和查过的步骤。</p>
            )}
            {session?.turns.map((item) => (
              <div key={item.id}>
                <DetectiveMessage
                  turn={item}
                  onProvideLink={() => host.current?.querySelector<HTMLInputElement>('#q')?.focus()}
                />
                {item.report?.status === 'complete' && item.content && (
                  <details>
                    <summary>完整回答</summary>
                    <ReactMarkdown urlTransform={(url) => safeUrl(url) ?? ''}>
                      {item.content}
                    </ReactMarkdown>
                  </details>
                )}
                {(item.recommendations ?? []).map((recommendation) => {
                  const card = liveCard(recommendation, item)
                  return (
                    <details key={card.id}>
                      <summary>{card.name} · 卡片来源</summary>
                      <button
                        type="button"
                        className="link"
                        onClick={() => runtime.current?.reopen(card.id, card)}
                      >
                        看这张卡
                      </button>
                      <ul>
                        {card.sources.map((source, index) => (
                          <li key={index}>
                            <a href={safeUrl(source.url)} target="_blank" rel="noopener noreferrer">
                              {source.who}
                            </a>
                            <p>{source.quote}</p>
                          </li>
                        ))}
                      </ul>
                    </details>
                  )
                })}
              </div>
            ))}
            {detective.storageError && (
              <p>
                本机记录保留在这里。
                <button type="button" onClick={() => void detective.reload()}>
                  读取账号记录
                </button>
              </p>
            )}
          </div>,
          logTarget,
        )}
      <ProfileMatchDialog
        open={!!profileSection}
        user={user}
        initialSection={profileSection ?? 'all'}
        onClose={() => setProfileSection(null)}
        onConfirmed={confirmed}
      />
      {(notice || book.notice) && (
        <div className="live-notice" role="status">
          {notice || book.notice}
          {notice && <a href="/account/watch">打开盯梢设置</a>}
          <button type="button" aria-label="收起提示" onClick={() => setNotice('')}>
            ×
          </button>
        </div>
      )}
    </>
  )
}
