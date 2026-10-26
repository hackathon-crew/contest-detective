import type { VerificationOptions } from '@/features/detective/verification-contracts'
import { lazy, Suspense, useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { MessageCircle, PanelLeftClose, PanelLeftOpen, PanelRight, SquarePen } from 'lucide-react'
import { Collapsible, Dialog as PrimitiveDialog } from 'radix-ui'
import { useQueryClient } from '@tanstack/react-query'
import { currentUserKey, useCurrentUser } from '@/entities/user'
import {
  loadConfirmedProfile,
  ProfileMatchDialog,
  type ProfileMatchSection,
} from '@/features/profile-match'
import { SiteHeader } from '@/shared/ui/site-header'
import { AppearanceControl } from '@/features/appearance'
import { AuthControls } from '@/features/auth'
import type { Profile } from '@/shared/api'
import readingFrame from '@/shared/assets/mascot/octo-read.png'
import {
  DetectiveComposer,
  DetectiveMessage,
  ResearchPanel,
  useDetective,
} from '@/features/detective'
import '@/features/detective/detective-composer.css'
import '@/features/detective/detective-conversation.css'
import '@/features/detective/detective-workspace.css'

const Octopus = lazy(() =>
  import('@/shared/ui/octopus/Octopus').then((module) => ({ default: module.Octopus })),
)

export function DetectivePage() {
  const { conversationId } = useParams()
  const { sessions, storageError, send, stop } = useDetective()
  const session = sessions.find((item) => item.id === conversationId)
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
  const client = useQueryClient()
  const [guestProfile, setGuestProfile] = useState(loadConfirmedProfile)
  const [profileSection, setProfileSection] = useState<ProfileMatchSection | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [profileGuideDismissed, setProfileGuideDismissed] = useState(false)
  const profile = user?.profile ?? guestProfile
  const hasProfile = Boolean(
    profile?.github ||
    profile?.skills?.length ||
    profile?.topics?.length ||
    profile?.identity ||
    profile?.identity_kind ||
    profile?.city ||
    profile?.available_time ||
    profile?.preferred_modes?.length ||
    profile?.availability?.weekdays?.length ||
    profile?.availability?.windows?.length ||
    profile?.availability?.max_consecutive_days,
  )
  const sidebarButton = useRef<HTMLButtonElement>(null)
  const researchButton = useRef<HTMLButtonElement>(null)
  const closeSidebar = () => setSidebarOpen(false)
  const closeResearch = () => {
    setResearchMode('closed')
    researchButton.current?.focus({ preventScroll: true })
  }
  function confirmed(profile: Profile) {
    if (user) void client.invalidateQueries({ queryKey: currentUserKey })
    else setGuestProfile(profile)
  }

  return (
    <div className="detective-workspace">
      <SiteHeader
        utilities={
          <>
            <AppearanceControl />
            <AuthControls />
          </>
        }
        actions={
          <Link
            to="/contests"
            className="inline-flex min-h-10 items-center rounded-xl px-2.5 text-sm font-medium text-ink transition-colors duration-140 hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
          >
            浏览赛事
          </Link>
        }
      />
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
              aria-label="打开会话列表"
              aria-expanded={sidebarOpen}
              onClick={() => setSidebarOpen(true)}
            >
              <PanelLeftOpen aria-hidden="true" strokeWidth={1.5} />
            </button>
            <Link to="/detective" className="detective-icon" aria-label="新对话">
              <SquarePen aria-hidden="true" strokeWidth={1.5} />
            </Link>
            <Collapsible.Trigger asChild>
              <button
                ref={researchButton}
                type="button"
                className="detective-icon"
                aria-label="研究面板"
                title="研究面板"
                aria-pressed={researchOpen}
              >
                <PanelRight aria-hidden="true" strokeWidth={1.5} />
              </button>
            </Collapsible.Trigger>
          </header>
          <Conversation
            key={conversationId ?? 'new'}
            session={session}
            missing={!!conversationId && !session}
            storageError={storageError}
            onSubmit={(text, verification) => {
              const id = send(text, user?.profile ?? guestProfile, session?.id, verification)
              if (id !== conversationId) navigate(`/detective/${id}`)
            }}
            onStop={() => session && stop(session.id)}
            onAddProfile={setProfileSection}
            showProfileGuide={!userPending && !hasProfile && !profileGuideDismissed}
            onDismissProfileGuide={() => setProfileGuideDismissed(true)}
          />
        </div>
        <Collapsible.Content asChild>
          <aside
            className="detective-research"
            aria-label="研究面板"
            onKeyDown={(event) => {
              if (event.key === 'Escape') closeResearch()
            }}
          >
            <ResearchPanel
              key={conversationId ?? 'new'}
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
              <PrimitiveDialog.Title>对话记录</PrimitiveDialog.Title>
              <button
                type="button"
                className="detective-icon"
                aria-label="关闭会话列表"
                onClick={closeSidebar}
              >
                <PanelLeftClose aria-hidden="true" strokeWidth={1.5} />
              </button>
            </div>
            <Link
              to="/detective"
              className="detective-nav-item detective-sidebar__new"
              aria-label="新对话"
              onClick={closeSidebar}
            >
              <SquarePen aria-hidden="true" strokeWidth={1.5} />
              <span>新对话</span>
            </Link>
            <nav aria-label="对话记录" className="detective-history">
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
                        <i className="detective-history__busy" aria-label="正在回复" />
                      )}
                    </Link>
                  ))
              ) : (
                <p>对话会保存在这里</p>
              )}
            </nav>
          </PrimitiveDialog.Content>
        </PrimitiveDialog.Root>
      </Collapsible.Root>
      <ProfileMatchDialog
        open={!!profileSection}
        user={user}
        initialSection={profileSection ?? 'all'}
        onClose={() => setProfileSection(null)}
        onConfirmed={confirmed}
      />
    </div>
  )
}

function Conversation({
  session,
  missing,
  storageError,
  onSubmit,
  onStop,
  onAddProfile,
  showProfileGuide,
  onDismissProfileGuide,
}: {
  session: ReturnType<typeof useDetective>['sessions'][number] | undefined
  missing: boolean
  storageError: boolean
  onSubmit: (question: string, verification?: VerificationOptions) => void
  onStop: () => void
  onAddProfile: (section: ProfileMatchSection) => void
  showProfileGuide: boolean
  onDismissProfileGuide: () => void
}) {
  const [question, setQuestion] = useState('')
  const input = useRef<HTMLTextAreaElement>(null)
  const scroll = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)
  const turns = session?.turns ?? []
  const lastTurn = turns.at(-1)
  const pending = lastTurn?.status === 'running'
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
    if (!question.trim() || pending) return
    pinned.current = true
    onSubmit(question.trim(), verification)
    setQuestion('')
  }
  return (
    <main className="detective-conversation" data-empty={!turns.length}>
      <div
        ref={scroll}
        className="detective-conversation__scroll"
        role={turns.length ? 'log' : undefined}
        tabIndex={turns.length ? 0 : undefined}
        aria-label={turns.length ? '对话内容' : undefined}
        aria-live={pending ? 'polite' : undefined}
        aria-busy={pending}
        onScroll={(event) => {
          const node = event.currentTarget
          pinned.current = node.scrollHeight - node.scrollTop - node.clientHeight < 64
        }}
      >
        {turns.length ? (
          <div ref={observeThread} className="detective-thread">
            {turns.map((turn) => (
              <DetectiveMessage key={turn.id} turn={turn} />
            ))}
          </div>
        ) : (
          <div className="detective-greeting">
            {!missing && (
              <div className="detective-greeting__mascot grid size-45 place-items-center">
                <Suspense
                  fallback={
                    <img
                      src={readingFrame}
                      alt="捧书的 Inkpaw 八爪鱼"
                      width={159}
                      height={128}
                      className="[image-rendering:pixelated]"
                    />
                  }
                >
                  <Octopus size={180} mood="read" shadow={false} label="捧书的 Inkpaw 八爪鱼" />
                </Suspense>
              </div>
            )}
            <h2>{missing ? '这段对话不在当前浏览器中' : '想找什么样的比赛？'}</h2>
            {missing && <p>从左侧选择已有记录，或发起一段新对话。</p>}
          </div>
        )}
        <div className="detective-conversation__compose">
          {storageError && (
            <p role="alert" className="detective-turn__error">
              浏览器未能保存记录，刷新前请复制需要保留的内容。
            </p>
          )}
          <DetectiveComposer
            value={question}
            pending={pending}
            onChange={setQuestion}
            onSubmit={submit}
            onStop={onStop}
            inputRef={input}
            onAddProfile={onAddProfile}
            onVerifyScreenshot={({ question, ...verification }) => onSubmit(question, verification)}
            profileGuide={
              showProfileGuide && !missing && !turns.length
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
