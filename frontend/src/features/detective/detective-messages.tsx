import { Check, ChevronRight, LoaderCircle, Square } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import { safeUrl } from '@/entities/contest'
import inkpawMark from '@/shared/assets/inkpaw-mark-32.webp'
import type { DetectiveTurn } from './conversation'
import type { TraceSource } from './events'
import { rehypeStreamReveal } from './rehype-stream-reveal'
import { useStreamPacer } from './use-stream-pacer'
import { SourceIcon } from './source-icon'
import { EvidenceReport, ExecutionDetails, InvestigationProgress } from './evidence-report'
import type { SearchExecution } from './verification-contracts'
import { reportStatusNames } from './verification-report'
import { ProfileFileAttachment, RecommendationCards } from './detective-results'

function Sources({ items }: { items: TraceSource[] }) {
  const trusted = [
    ...new Map(
      items
        .filter((source) => source.is_official === true && !source.stale && safeUrl(source.url))
        .map((source) => [source.url, source]),
    ).values(),
  ]
  if (!trusted.length) return null
  return (
    <footer aria-label="可信来源">
      <ul className="detective-sources">
        {trusted.map((source, index) => (
          <li key={`${source.url}-${index}`}>
            <a href={source.url} target="_blank" rel="noreferrer">
              <SourceIcon url={source.url} />
              <span className="detective-source-number" aria-hidden="true">
                {index + 1}
              </span>
              <span className="detective-source-label">
                {source.title || source.site || source.url}
              </span>
            </a>
          </li>
        ))}
      </ul>
    </footer>
  )
}

function ToolActivity({ turn }: { turn: DetectiveTurn }) {
  const steps: {
    label: string
    tool: string
    summary?: string
    sources: TraceSource[]
    execution?: SearchExecution
  }[] = []
  for (const event of turn.trace) {
    if (event.type === 'step') steps.push({ label: event.label, tool: event.tool, sources: [] })
    else {
      const step = steps.findLast((item) => item.tool === event.tool && item.summary === undefined)
      if (step) {
        step.summary = event.summary
        step.sources = event.sources
        step.execution = event.execution
      }
    }
  }
  if (!steps.length) return null
  const active = turn.status === 'running' && !turn.content && steps.at(-1)!.summary === undefined
  const completed = steps.filter(
    (step) => step.summary !== undefined && step.execution?.status !== 'failure',
  ).length
  const failed = steps.some((step) => step.execution?.status === 'failure')
  const unfinished = steps.some((step) => step.summary === undefined)
  const label = turn.report
    ? reportStatusNames[turn.report.status]
    : active
      ? `正在${steps.at(-1)!.label}`
      : turn.status === 'stopped'
        ? `已停止，完成 ${completed} 项检索`
        : turn.status === 'error'
          ? '检索未完成'
          : failed || unfinished
            ? `检索未完成，成功 ${completed} 项`
            : `已完成 ${completed} 项检索`
  return (
    <details className="detective-tools">
      <summary aria-label={label}>
        <ChevronRight className="detective-tools__chevron" aria-hidden="true" />
        {active ? (
          <LoaderCircle className="detective-spin" aria-hidden="true" />
        ) : failed ||
          unfinished ||
          turn.status !== 'completed' ||
          (turn.report && turn.report.status !== 'complete') ? (
          <Square aria-hidden="true" />
        ) : (
          <Check aria-hidden="true" />
        )}
        <span>{label}</span>
      </summary>
      <ol>
        {steps.map((step, index) => (
          <li key={index}>
            <div className="detective-tools__heading">
              <strong>{step.label}</strong>
              {step.execution?.status === 'failure' ? (
                <span>失败</span>
              ) : step.summary !== undefined ? (
                <Check aria-label="已完成" />
              ) : turn.status === 'running' ? (
                <LoaderCircle className="detective-spin" aria-label="进行中" />
              ) : (
                <Square aria-label="已停止" />
              )}
            </div>
            {step.summary && <p>{step.summary}</p>}
            {step.execution && <ExecutionDetails execution={step.execution} />}
          </li>
        ))}
      </ol>
    </details>
  )
}

const markdownComponents = {
  img: () => null,
  a: ({ href, children }: React.ComponentProps<'a'>) => (
    <a href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  ),
}

export function DetectiveMessage({ turn }: { turn: DetectiveTurn }) {
  const paced = useStreamPacer(turn.content, turn.status === 'running')
  return (
    <article className="detective-turn" aria-label={`关于${turn.question}的对话`}>
      <div className="detective-turn__question">
        {turn.profileFile && <ProfileFileAttachment file={turn.profileFile} />}
        <p>{turn.question}</p>
      </div>
      <div className="detective-turn__answer">
        <div className="detective-turn__avatar">
          <img
            src={inkpawMark}
            alt="Inkpaw"
            width={30}
            height={26}
            className="[image-rendering:pixelated]"
            loading="lazy"
            decoding="async"
          />
        </div>
        <div className="detective-turn__body">
          {!turn.report && <ToolActivity turn={turn} />}
          {!turn.report && turn.plan && (
            <InvestigationProgress
              plan={turn.plan}
              queries={turn.trace.flatMap((event) =>
                event.type === 'observation' && event.execution ? [event.execution] : [],
              )}
            />
          )}
          {turn.status === 'running' &&
            !turn.content &&
            !turn.plan &&
            (!turn.trace.length || turn.trace.at(-1)?.type === 'observation') && (
              <p className="detective-thinking" role="status">
                {turn.trace.length ? '正在整理回复' : '正在看你的问题'}
              </p>
            )}
          {!turn.report && paced.visible && (
            <div className="detective-prose">
              <ReactMarkdown
                urlTransform={(url) => safeUrl(url) ?? ''}
                components={markdownComponents}
                rehypePlugins={paced.revealedAt.length ? [[rehypeStreamReveal, paced]] : []}
              >
                {paced.visible}
              </ReactMarkdown>
            </div>
          )}
          {turn.report && <EvidenceReport report={turn.report} />}
          {!!turn.recommendations?.length && <RecommendationCards items={turn.recommendations} />}
          {!turn.report && <Sources items={turn.sources} />}
          {turn.error && (
            <p
              className="detective-turn__error"
              role={turn.status === 'error' ? 'alert' : 'status'}
            >
              {turn.error}
            </p>
          )}
        </div>
      </div>
    </article>
  )
}
