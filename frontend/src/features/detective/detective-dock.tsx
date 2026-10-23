import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import ReactMarkdown from 'react-markdown'
import { safeUrl } from '@/entities/contest'
import { apiClient, type Profile } from '@/shared/api'
import { Button, Input } from '@/shared/ui'
import { parseTrace, type TraceEvent, type TraceSource } from './events'

function Sources({ items }: { items: TraceSource[] }) {
  if (!items.length) return null
  return (
    <ul className="space-y-1 text-xs text-muted">
      {items.map((source, index) => (
        <li key={`${source.url}-${index}`}>
          <a
            href={source.url}
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-4"
          >
            {source.title || source.site || source.url}
          </a>
        </li>
      ))}
    </ul>
  )
}

export function DetectiveDock({ profile }: { profile?: Profile | null }) {
  const client = useQueryClient()
  const [question, setQuestion] = useState('')
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [trace, setTrace] = useState<TraceEvent[]>([])
  const [answer, setAnswer] = useState<Extract<TraceEvent, { type: 'answer' }> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const request = useRef<AbortController | null>(null)
  useEffect(() => () => request.current?.abort(), [])

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (request.current || !question.trim()) return
    const controller = new AbortController()
    request.current = controller
    setOpen(true)
    setPending(true)
    setTrace([])
    setAnswer(null)
    setError(null)
    let terminal = false
    try {
      for await (const raw of apiClient.stream('/agent/ask', {
        method: 'POST',
        json: { question: question.trim(), ...(profile ? { profile } : {}) },
        signal: controller.signal,
      })) {
        const event = parseTrace(raw)
        if (event.type === 'answer') {
          setAnswer(event)
          terminal = true
          void client.invalidateQueries({ queryKey: ['contests'] })
          void client.invalidateQueries({ queryKey: ['contest'] })
          break
        }
        if (event.type === 'error') {
          setError(event.message)
          terminal = true
          break
        }
        setTrace((previous) => [...previous, event])
      }
      if (!terminal && !controller.signal.aborted) setError('查证提前结束，请重试。')
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(cause instanceof Error ? cause.message : '查证失败，请重试。')
    } finally {
      if (request.current === controller) {
        request.current = null
        setPending(false)
      }
    }
  }

  return (
    <section
      aria-label="侦探"
      className="fixed inset-x-6 bottom-4 z-10 mx-auto max-w-3xl space-y-2"
    >
      {open && (
        <div className="max-h-96 space-y-5 overflow-y-auto rounded-2xl border border-rule bg-surface p-5 shadow-lg">
          <header className="flex items-center justify-between gap-3">
            <h2 className="text-2xl font-bold text-ink">查证过程</h2>
            <div className="flex gap-2">
              {pending && (
                <Button
                  variant="ghost"
                  onClick={() => {
                    request.current?.abort()
                    setError('查证已停止。')
                  }}
                >
                  停止
                </Button>
              )}
              <Button
                variant="ghost"
                onClick={() => {
                  request.current?.abort()
                  setOpen(false)
                }}
              >
                收起
              </Button>
            </div>
          </header>
          <ol aria-live="polite" className="space-y-4 text-sm">
            {trace.map((event, index) => (
              <li key={index} className="space-y-2">
                {event.type === 'step' && <p className="font-semibold text-ink">{event.label}</p>}
                {event.type === 'observation' && (
                  <>
                    <p>{event.summary}</p>
                    <Sources items={event.sources} />
                  </>
                )}
              </li>
            ))}
          </ol>
          {pending && !trace.length && (
            <p role="status" className="text-sm text-muted">
              正在查证…
            </p>
          )}
          {answer && (
            <div className="space-y-4 border-t border-rule pt-4">
              <div className="space-y-3 break-words text-sm [&_a]:underline [&_a]:underline-offset-4 [&_li]:ml-4 [&_p]:my-3 [&_ul]:list-disc">
                <ReactMarkdown
                  urlTransform={(url) => safeUrl(url) ?? ''}
                  components={{
                    img: () => null,
                    a: ({ href, children }) => (
                      <a href={href} target="_blank" rel="noreferrer">
                        {children}
                      </a>
                    ),
                  }}
                >
                  {answer.content}
                </ReactMarkdown>
              </div>
              <Sources items={answer.sources} />
            </div>
          )}
          {error && (
            <p role="alert" className="text-sm text-muted">
              {error}
            </p>
          )}
        </div>
      )}
      <form
        className="flex items-center gap-2 rounded-2xl border border-rule bg-surface p-2"
        onSubmit={(event) => void submit(event)}
      >
        <Input
          aria-label="问侦探"
          placeholder="这周末有哪些线上黑客松？"
          value={question}
          maxLength={500}
          disabled={pending}
          onChange={(event) => setQuestion(event.target.value)}
          className="min-w-0 flex-1 border-0 shadow-none"
        />
        <Button type="submit" disabled={pending || !question.trim()}>
          {pending ? '查证中' : '查证'}
        </Button>
      </form>
    </section>
  )
}
