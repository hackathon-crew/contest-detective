import type { VerificationOptions } from '@/features/detective/verification-contracts'
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router'
import { MessageCircle, PanelLeftClose, PanelLeftOpen, PanelRight, SquarePen } from 'lucide-react'
import { Collapsible, Dialog as PrimitiveDialog } from 'radix-ui'
import { useQueryClient } from '@tanstack/react-query'
import { currentUserKey, personalIntent, useCurrentUser, useLoginGate } from '@/entities/user'
import {
  ProfileMatchDialog,
  ProfileNudge,
  useProfileNudge,
  loadConfirmedProfile,
  hasProfileData,
  type ProfileMatchSection,
} from '@/features/profile-match'
import { SiteHeader } from '@/shared/ui/site-header'
import { AuthControls } from '@/features/auth'
import { FollowButton, useFollows } from '@/features/follow'
import type { ContestRecommendation, Profile } from '@/shared/api'
import type { ProfileRequest } from '@/features/detective/detective-context'
import { useContest } from '@/entities/contest'
import {
  ContestReference,
  type ContestReferenceValue,
} from '@/features/detective/contest-reference'
import readingFrame from '@/shared/assets/mascot/octo-read.png'
import {
  DetectiveComposer,
  DetectiveMessage,
  ResearchPanel,
  DetectiveMascot,
  ProfileRequestMessage,
  useDetective,
  useGuestQuota,
} from '@/features/detective'
import '@/features/detective/detective-composer.css'
import '@/features/detective/detective-conversation.css'
import '@/features/detective/detective-workspace.css'
import { useLocale } from '@/shared/i18n/locale-context'

const Octopus = lazy(() =>
  import('@/shared/ui/octopus/Octopus').then((module) => ({ default: module.Octopus })),
)

export function DetectivePage() {
  const { t } = useLocale()
  const location = useLocation()
  const { conversationId } = useParams()
  const {
    sessions,
    loading,
    storageError,
    reload,
    send,
    stop,
    profileRequest,
    resumeWithProfile,
    loginRequest,
    clearLoginRequest,
  } = useDetective()
  const session = sessions.find((item) => item.id === conversationId)
  const requestedProfile = profileRequest?.conversationId === conversationId ? profileRequest : null
  const savedReference = session?.turns.at(-1)?.request?.contest
  const selectedId = new URLSearchParams(location.search).get('contest') ?? savedReference?.id ?? ''
  const selected = useContest(selectedId)
  const reference = selected.data ?? savedReference ?? null
  const [researchState, setResearchState] = useState<{
    conversationId?: string
    mode: 'auto' | 'open' | 'closed'
  }>({ conversationId, mode: 'auto' })
  // 切换对话只重置面板偏好，保留工作区节点，避免重播整页入场动画。
  if (researchState.conversationId !== conversationId) {
    setResearchState({ conversationId, mode: 'auto' })
  }
  const researchMode = researchState.mode
  const setResearchMode = (mode: 'open' | 'closed') => setResearchState({ conversationId, mode })
  const hasResearch =
    session?.turns.some(
      (turn) => turn.trace.length || turn.sources.length || turn.plan || turn.report,
    ) ?? false
  const researchOpen = researchMode === 'open' || (researchMode === 'auto' && hasResearch)
  const navigate = useNavigate()
  const { data: user, isPending: userPending } = useCurrentUser()
  const guestQuota = useGuestQuota(!user && !userPending)
  const intent = personalIntent(location)
  const profile = hasProfileData(user?.profile) ? user?.profile : loadConfirmedProfile()
  const requireLogin = useLoginGate()
  useEffect(() => {
    if (!loginRequest) return
    clearLoginRequest()
    requireLogin({
      question: loginRequest.question,
      saveGuestConversation: loginRequest.conversationId,
    })
  }, [loginRequest])
  useEffect(() => {
    if (!user || !intent.saveGuestConversation) return
    navigate(
      { pathname: location.pathname, search: location.search, hash: location.hash },
      {
        replace: true,
        state: {
          ...location.state,
          personalIntent: { ...intent, saveGuestConversation: undefined },
        },
      },
    )
  }, [user, intent.saveGuestConversation])
  const client = useQueryClient()
  const [profileSection, setProfileSection] = useState<ProfileMatchSection | null>(
    () => personalIntent(location).profileSection ?? null,
  )
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const follows = useFollows()
  const [celebrating, setCelebrating] = useState(false)
  const [watchNotice, setWatchNotice] = useState(false)
  const [followEvent, setFollowEvent] = useState(0)
  useEffect(() => {
    if (!watchNotice) return
    const jump = setTimeout(() => setCelebrating(false), 900)
    const notice = setTimeout(() => setWatchNotice(false), 3200)
    return () => {
      clearTimeout(jump)
      clearTimeout(notice)
    }
  }, [watchNotice, followEvent])
  const nudge = useProfileNudge({
    profile,
    enabled: !userPending && !profileSection && !requestedProfile,
    guideEligible:
      !session?.turns.length && !selectedId && !loading && (!conversationId || !!session),
    answerId: session?.turns.filter((turn) => turn.status === 'completed').at(-1)?.id,
  })
  const sidebarButton = useRef<HTMLButtonElement>(null)
  const researchButton = useRef<HTMLButtonElement>(null)
  const closeSidebar = () => setSidebarOpen(false)
  const closeResearch = () => {
    setResearchMode('closed')
    researchButton.current?.focus({ preventScroll: true })
  }
  function confirmed(profile: Profile) {
    void client.invalidateQueries({ queryKey: currentUserKey })
    if (requestedProfile || intent.resumeProfileQuestion) {
      setProfileSection(null)
      const id = requestedProfile
        ? resumeWithProfile(profile)
        : send(intent.question!, profile, session?.id, undefined, reference)
      if (id) navigate(`/detective/${id}`, { replace: true })
    }
  }

  return (
    <div className="detective-workspace">
      <SiteHeader utilities={<AuthControls compact />} />
      <Collapsible.Root
        className="detective-workspace__body"
        open={researchOpen}
        onOpenChange={(open) => setResearchMode(open ? 'open' : 'closed')}
      >
        <div className="detective-workspace__main">
          <header className="detective-workspace__header">
            <button
              ref={sidebarButton}
              type="button"
              className="detective-icon"
              aria-label={t('打开会话列表')}
              aria-expanded={sidebarOpen}
              onClick={() => setSidebarOpen(true)}
            >
              <PanelLeftOpen aria-hidden="true" strokeWidth={1.5} />
            </button>
            <Link to="/detective" className="detective-icon" aria-label={t('新对话')}>
              <SquarePen aria-hidden="true" strokeWidth={1.5} />
            </Link>
            <Collapsible.Trigger asChild>
              <button
                ref={researchButton}
                type="button"
                className="detective-icon"
                aria-label={t('研究面板')}
                title={t('研究面板')}
              >
                <PanelRight aria-hidden="true" strokeWidth={1.5} />
              </button>
            </Collapsible.Trigger>
          </header>
          <Conversation
            key={`${conversationId ?? 'new'}:${new URLSearchParams(location.search).get('contest') ?? ''}`}
            session={session}
            missing={!!conversationId && !session && !requestedProfile && !loading && !storageError}
            loading={loading && !!conversationId}
            storageError={storageError}
            onReload={() => void reload()}
            initialQuestion={personalIntent(location).question}
            reference={reference}
            referenceLoading={!!selectedId && !reference && selected.isPending}
            referenceError={!!selectedId && !reference && selected.isError}
            onSubmit={async (text, verification, contest) => {
              if (!user && guestQuota.isPending) await guestQuota.refetch()
              const id = send(text, profile, session?.id, verification, contest)
              if (id && id !== conversationId) navigate(`/detective/${id}`)
            }}
            onStop={() => session && stop(session.id)}
            onAddProfile={(section) => {
              if (
                requireLogin({
                  question: requestedProfile?.question,
                  profileSection: section,
                  resumeProfileQuestion: !!requestedProfile,
                })
              )
                setProfileSection(section)
            }}
            showProfileGuide={nudge.guideVisible}
            onDismissProfileGuide={nudge.dismissGuide}
            nudgeTalking={nudge.visible}
            profileRequest={requestedProfile}
            celebrating={celebrating}
            guestRemaining={!user ? guestQuota.data?.remaining : undefined}
            onSave={(question) => requireLogin({ question, saveGuestConversation: session?.id })}
            recommendationAction={(contest) => (
              <FollowButton
                contestId={contest.id}
                follows={follows}
                watch
                onFollow={() => {
                  setCelebrating(true)
                  setWatchNotice(true)
                  setFollowEvent((event) => event + 1)
                }}
              />
            )}
          />
        </div>
        <Collapsible.Content asChild>
          <aside
            className="detective-research"
            aria-label={t('研究面板')}
            onKeyDown={(event) => {
              if (event.key === 'Escape') closeResearch()
            }}
          >
            <ResearchPanel
              key={`${conversationId ?? 'new'}:${new URLSearchParams(location.search).get('contest') ?? ''}`}
              turns={session?.turns ?? []}
              onClose={closeResearch}
            />
          </aside>
        </Collapsible.Content>
        <PrimitiveDialog.Root open={sidebarOpen} onOpenChange={setSidebarOpen}>
          <PrimitiveDialog.Overlay className="detective-sidebar-overlay" />
          <PrimitiveDialog.Content
            className="detective-sidebar"
            aria-describedby={undefined}
            onCloseAutoFocus={(event) => {
              event.preventDefault()
              sidebarButton.current?.focus()
            }}
          >
            <div className="detective-sidebar__top">
              <PrimitiveDialog.Title>{t('对话记录')}</PrimitiveDialog.Title>
              <button
                type="button"
                className="detective-icon"
                aria-label={t('关闭会话列表')}
                onClick={closeSidebar}
              >
                <PanelLeftClose aria-hidden="true" strokeWidth={1.5} />
              </button>
            </div>
            <Link
              to="/detective"
              className="detective-nav-item detective-sidebar__new"
              aria-label={t('新对话')}
              onClick={closeSidebar}
            >
              <SquarePen aria-hidden="true" strokeWidth={1.5} />
              <span>{t('新对话')}</span>
            </Link>
            <nav aria-label={t('对话记录')} className="detective-history">
              {sessions.length ? (
                sessions
                  .toSorted((a, b) => b.updatedAt - a.updatedAt)
                  .map((item) => (
                    <Link
                      key={item.id}
                      to={`/detective/${item.id}`}
                      className="detective-nav-item"
                      aria-current={item.id === conversationId ? 'page' : undefined}
                      title={item.title}
                      onClick={closeSidebar}
                    >
                      <MessageCircle aria-hidden="true" strokeWidth={1.5} />
                      <span>{item.title}</span>
                      {item.turns.at(-1)?.status === 'running' && (
                        <i className="detective-history__busy" aria-label={t('正在回复')} />
                      )}
                    </Link>
                  ))
              ) : (
                <p>{t('对话会保存在这里')}</p>
              )}
            </nav>
          </PrimitiveDialog.Content>
        </PrimitiveDialog.Root>
      </Collapsible.Root>
      <ProfileNudge
        open={nudge.visible}
        onClose={nudge.dismiss}
        onChoose={(section) => {
          nudge.dismiss()
          setProfileSection(section)
        }}
      />
      <ProfileMatchDialog
        open={!!profileSection}
        user={user}
        initialSection={profileSection ?? 'all'}
        onClose={() => {
          setProfileSection(null)
          if (intent.resumeProfileQuestion)
            navigate(
              { pathname: location.pathname, search: location.search, hash: location.hash },
              {
                replace: true,
                state: {
                  ...location.state,
                  personalIntent: {
                    ...intent,
                    resumeProfileQuestion: undefined,
                    profileSection: undefined,
                  },
                },
              },
            )
        }}
        onConfirmed={confirmed}
      />
      {watchNotice && (
        <p role="status" className="detective-watch-notice">
          {t('截止或规则一变，发邮件告诉你')}
        </p>
      )}
      {follows.error && (
        <p role="alert" className="detective-watch-notice">
          {follows.error}
        </p>
      )}
    </div>
  )
}

function Conversation({
  session,
  missing,
  loading,
  storageError,
  onReload,
  initialQuestion,
  reference,
  referenceLoading,
  referenceError,
  onSubmit,
  onStop,
  onAddProfile,
  showProfileGuide,
  onDismissProfileGuide,
  nudgeTalking,
  profileRequest,
  celebrating,
  recommendationAction,
  guestRemaining,
  onSave,
}: {
  session: ReturnType<typeof useDetective>['sessions'][number] | undefined
  missing: boolean
  loading: boolean
  storageError: boolean
  onReload: () => void
  initialQuestion?: string
  reference: ContestReferenceValue | null
  referenceLoading: boolean
  referenceError: boolean
  onSubmit: (
    question: string,
    verification?: VerificationOptions,
    contest?: ContestReferenceValue | null,
  ) => void
  onStop: () => void
  onAddProfile: (section: ProfileMatchSection) => void
  showProfileGuide: boolean
  onDismissProfileGuide: () => void
  nudgeTalking: boolean
  profileRequest: ProfileRequest | null
  celebrating: boolean
  recommendationAction: (contest: ContestRecommendation['contest']) => ReactNode
  guestRemaining?: number
  onSave: (question: string) => void
}) {
  const { t } = useLocale()
  const [question, setQuestion] = useState(initialQuestion ?? '')
  const [referenceRemoved, setReferenceRemoved] = useState(false)
  const attached = referenceRemoved ? null : reference
  const input = useRef<HTMLTextAreaElement>(null)
  const scroll = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)
  const turns = session?.turns ?? []
  const lastTurn = turns.at(-1)
  const active = !!turns.length || !!profileRequest
  const [mascotSize, setMascotSize] = useState(() => (window.innerWidth <= 760 ? 120 : 180))
  useEffect(() => {
    const resize = () => setMascotSize(window.innerWidth <= 760 ? 120 : 180)
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [])
  const pending =
    loading || (!referenceRemoved && referenceLoading) || lastTurn?.status === 'running'
  useEffect(() => {
    if (!pending) input.current?.focus({ preventScroll: true })
  }, [pending])
  useEffect(() => {
    if (lastTurn?.status === 'error')
      queueMicrotask(() => setQuestion((text) => text || lastTurn.question))
  }, [lastTurn?.id, lastTurn?.status, lastTurn?.question])
  const observeThread = useCallback((node: HTMLDivElement | null) => {
    if (!node) return
    const follow = () => {
      if (scroll.current && pinned.current) scroll.current.scrollTop = scroll.current.scrollHeight
    }
    queueMicrotask(follow)
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(follow)
    observer?.observe(node)
    return () => observer?.disconnect()
  }, [])
  function submit(event: FormEvent, verification?: VerificationOptions) {
    event.preventDefault()
    if (!question.trim() || pending || (!referenceRemoved && referenceError)) return
    pinned.current = true
    onSubmit(question.trim(), verification, attached)
    setQuestion('')
  }
  return (
    <main className="detective-conversation" data-empty={!active}>
      {active && <DetectiveMascot turn={lastTurn} happy={celebrating} />}
      <div
        ref={scroll}
        className="detective-conversation__scroll"
        role={active ? 'log' : undefined}
        tabIndex={active ? 0 : undefined}
        aria-label={active ? t('对话内容') : undefined}
        aria-live={pending ? 'polite' : undefined}
        aria-busy={pending}
        onScroll={(event) => {
          const node = event.currentTarget
          pinned.current = node.scrollHeight - node.scrollTop - node.clientHeight < 64
        }}
      >
        {active ? (
          <div ref={observeThread} className="detective-thread">
            {turns.map((turn) => (
              <DetectiveMessage
                key={turn.id}
                turn={turn}
                recommendationAction={recommendationAction}
                saveAction={
                  guestRemaining !== undefined &&
                  turn.status === 'completed' && (
                    <button
                      type="button"
                      className="detective-guest-save"
                      onClick={() => onSave(question)}
                    >
                      {t('登录后保存这次查证')}
                    </button>
                  )
                }
              />
            ))}
            {profileRequest && (
              <ProfileRequestMessage
                question={profileRequest.question}
                onConnect={() => onAddProfile('github')}
              />
            )}
          </div>
        ) : (
          <div className="detective-greeting">
            {!missing && (
              <div
                className="detective-greeting__mascot grid place-items-center"
                data-speaking={nudgeTalking}
              >
                <Suspense
                  fallback={
                    <img
                      src={readingFrame}
                      alt={t('捧书的 Inkpaw 八爪鱼')}
                      width={159}
                      height={128}
                      className="[image-rendering:pixelated]"
                    />
                  }
                >
                  <Octopus
                    size={mascotSize}
                    mood={nudgeTalking ? 'talk' : 'read'}
                    shadow={false}
                    label={t('捧书的 Inkpaw 八爪鱼')}
                  />
                </Suspense>
              </div>
            )}
            <h2>
              {loading
                ? t('正在读取对话…')
                : missing
                  ? t('没有找到这段对话')
                  : attached
                    ? t('关于这场比赛，想了解什么？')
                    : t('想找什么样的比赛？')}
            </h2>
            {missing && <p>{t('从左侧选择已有记录，或发起一段新对话。')}</p>}
          </div>
        )}
        <div className="detective-conversation__compose">
          {guestRemaining !== undefined && (
            <p className="detective-guest-quota">
              {t('今天还剩 {count} 次提问', { count: guestRemaining })}
            </p>
          )}
          {storageError && (
            <p role="alert" className="detective-turn__error">
              {t('聊天记录暂时无法读取。')}
              <button type="button" className="underline" onClick={onReload}>
                {t('重新读取')}
              </button>
            </p>
          )}
          {referenceError && !referenceRemoved && (
            <p role="alert" className="detective-turn__error">
              {t('比赛资料暂时无法读取，请返回赛事库重新选择。')}
            </p>
          )}
          <DetectiveComposer
            placeholder={attached ? t('输入你想问的问题') : t('问一个问题')}
            attachment={
              attached && (
                <ContestReference
                  contest={attached}
                  onRemove={() => {
                    setReferenceRemoved(true)
                    input.current?.focus()
                  }}
                />
              )
            }
            value={question}
            pending={pending}
            onChange={setQuestion}
            onSubmit={submit}
            onStop={onStop}
            inputRef={input}
            onAddProfile={onAddProfile}
            onVerifyScreenshot={({ question, ...verification }) =>
              onSubmit(question, verification, attached)
            }
            profileGuide={
              showProfileGuide &&
              !missing &&
              !loading &&
              !referenceLoading &&
              !turns.length &&
              !attached
                ? {
                    onDismiss: onDismissProfileGuide,
                    onCreate: () => {
                      onDismissProfileGuide()
                      onAddProfile('profile')
                    },
                  }
                : undefined
            }
          />
        </div>
      </div>
    </main>
  )
}
