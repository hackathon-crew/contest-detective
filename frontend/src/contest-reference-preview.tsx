import { useRef, useState, type FormEvent } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Link, MemoryRouter, useLocation, useNavigate } from 'react-router'
import { ArrowLeft, RotateCcw } from 'lucide-react'
import { ContestDetail } from '@/features/contest-detail'
import { AppearanceControl } from '@/features/appearance'
import { DetectiveComposer } from '@/features/detective/detective-composer'
import {
  ContestReference,
  type ContestReferenceValue,
} from '@/features/detective/contest-reference'
import { SiteHeader } from '@/shared/ui/site-header'
import readingFrame from '@/shared/assets/mascot/octo-read.png'
import { publicFull } from './detail-preview-fixtures'
import './index.css'
import './features/detective/detective-workspace.css'
import './features/detective/detective-conversation.css'
import './features/detective/detective-composer.css'

// 独立预览只使用已有公开快照，不接入正式聊天或请求模型。
const client = new QueryClient({
  defaultOptions: { queries: { staleTime: Infinity, retry: false } },
})
client.setQueryData(['contest', publicFull.id], publicFull)
const showCover = new URLSearchParams(location.search).get('cover') !== 'off'

export function ContestReferencePreview() {
  const [reference, setReference] = useState<ContestReferenceValue | null>(publicFull)
  const [question, setQuestion] = useState('')
  const [messages, setMessages] = useState<
    { id: number; question: string; reference: ContestReferenceValue | null }[]
  >([])
  const input = useRef<HTMLTextAreaElement>(null)
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const detailOpen = pathname.startsWith('/contests')

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!question.trim()) return
    setMessages((items) => [...items, { id: items.length, question: question.trim(), reference }])
    setQuestion('')
    setReference(null)
    input.current?.focus()
  }

  function attachContest() {
    setReference(publicFull)
    navigate('/detective')
    requestAnimationFrame(() => input.current?.focus())
  }

  return (
    <div className="detective-workspace">
      <SiteHeader utilities={<AppearanceControl />} />
      <div className="detective-workspace__body">
        <div className="detective-workspace__main">
          <header className="detective-workspace__header">
            <Link
              to={`/contests/${publicFull.id}`}
              className="detective-icon"
              aria-label="查看比赛"
            >
              <ArrowLeft className="size-5" strokeWidth={1.5} aria-hidden="true" />
            </Link>
            <span />
            <button
              type="button"
              className="detective-icon"
              aria-label="重新预览"
              onClick={() => {
                setReference(publicFull)
                setQuestion('')
                setMessages([])
                input.current?.focus()
              }}
            >
              <RotateCcw className="size-5" strokeWidth={1.5} aria-hidden="true" />
            </button>
          </header>
          <main className="detective-conversation" data-empty={!messages.length}>
            <div className="detective-conversation__scroll">
              {messages.length ? (
                <div className="detective-thread" role="log" aria-label="对话内容">
                  {messages.map((message) => (
                    <div key={message.id} className="detective-turn__question">
                      {message.reference && (
                        <div className="w-80 max-w-full">
                          <ContestReference contest={message.reference} showCover={showCover} />
                        </div>
                      )}
                      <p>{message.question}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="detective-greeting">
                  <img
                    src={readingFrame}
                    alt="捧书的 Inkpaw 八爪鱼"
                    width={159}
                    height={128}
                    className="pixel-art"
                  />
                  <h2>{reference ? '关于这场比赛，想了解什么？' : '想找什么样的比赛？'}</h2>
                </div>
              )}
              <div className="detective-conversation__compose">
                <DetectiveComposer
                  value={question}
                  pending={false}
                  onChange={setQuestion}
                  onSubmit={submit}
                  onStop={() => {}}
                  inputRef={input}
                  placeholder={reference ? '输入你想问的问题' : '问一个问题'}
                  attachment={
                    reference && (
                      <ContestReference
                        contest={reference}
                        showCover={showCover}
                        onRemove={() => {
                          setReference(null)
                          input.current?.focus()
                        }}
                      />
                    )
                  }
                />
              </div>
            </div>
          </main>
        </div>
      </div>
      <ContestDetail
        open={detailOpen}
        variant="library"
        contestId={publicFull.id}
        onClose={() => navigate('/detective')}
        onAsk={attachContest}
      />
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={client}>
    <MemoryRouter initialEntries={['/detective']}>
      <ContestReferencePreview />
    </MemoryRouter>
  </QueryClientProvider>,
)
