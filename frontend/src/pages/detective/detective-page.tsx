import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { MessageCircle, PanelLeftClose, PanelLeftOpen, SquarePen } from 'lucide-react'
import { Dialog as PrimitiveDialog } from 'radix-ui'
import { useQueryClient } from '@tanstack/react-query'
import { currentUserKey, useCurrentUser } from '@/entities/user'
import { loadConfirmedProfile, ProfileMatchDialog } from '@/features/profile-match'
import { SiteHeader } from '@/shared/ui/site-header'
import { AppearanceControl } from '@/features/appearance'
import { AuthControls } from '@/features/auth'
import type { Profile } from '@/shared/api'
import { DetectiveComposer, DetectiveMessage, useDetective } from '@/features/detective'
import '@/features/detective/detective-composer.css'
import '@/features/detective/detective-conversation.css'
import '@/features/detective/detective-workspace.css'

export function DetectivePage() {
  const { conversationId } = useParams()
  const { sessions, storageError, send, stop } = useDetective()
  const session = sessions.find((item) => item.id === conversationId)
  const navigate = useNavigate()
  const { data: user } = useCurrentUser()
  const client = useQueryClient()
  const [guestProfile, setGuestProfile] = useState(loadConfirmedProfile)
  const [profileOpen, setProfileOpen] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const sidebarButton = useRef<HTMLButtonElement>(null)
  const closeSidebar = () => setSidebarOpen(false)
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
            to="/"
            className="inline-flex min-h-10 items-center rounded-xl px-2.5 text-sm font-medium text-ink transition-colors duration-140 hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
          >
            浏览赛事
          </Link>
        }
      />
      <div className="detective-workspace__body">
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
            <h1>{session?.title ?? '侦探'}</h1>
            <Link to="/detective" className="detective-icon" aria-label="新对话">
              <SquarePen aria-hidden="true" strokeWidth={1.5} />
            </Link>
          </header>
          <Conversation
            key={conversationId ?? 'new'}
            session={session}
            missing={!!conversationId && !session}
            storageError={storageError}
            onSubmit={(text) => {
              const id = send(text, user?.profile ?? guestProfile, session?.id)
              if (id !== conversationId) navigate(`/detective/${id}`)
            }}
            onStop={() => session && stop(session.id)}
            onAddProfile={() => setProfileOpen(true)}
          />
        </div>
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
      </div>
      <ProfileMatchDialog
        open={profileOpen}
        user={user}
        onClose={() => setProfileOpen(false)}
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
}: {
  session: ReturnType<typeof useDetective>['sessions'][number] | undefined
  missing: boolean
  storageError: boolean
  onSubmit: (question: string) => void
  onStop: () => void
  onAddProfile: () => void
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
  function submit(event: FormEvent) {
    event.preventDefault()
    if (!question.trim() || pending) return
    pinned.current = true
    onSubmit(question.trim())
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
            <h2>{missing ? '这段对话不在当前浏览器中' : '想找什么样的比赛？'}</h2>
            {missing && <p>从左侧选择已有记录，或发起一段新对话。</p>}
          </div>
        )}
      </div>
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
        />
      </div>
    </main>
  )
}
