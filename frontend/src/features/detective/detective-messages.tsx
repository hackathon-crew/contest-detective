import { Check, ChevronRight, LoaderCircle, Square } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkCjkFriendly from 'remark-cjk-friendly'
import { Link } from 'react-router'
import { Button } from '@/shared/ui/button'
import { ContestReference } from './contest-reference'
import { useDetective } from './detective-context'
import { safeUrl } from '@/entities/contest'
import { translateSystemText } from '@/shared/i18n'
import inkpawMark from '@/shared/assets/inkpaw-mark-32.webp'
import type { DetectiveTurn } from './conversation'
import type { TraceSource } from './events'
import { rehypeStreamReveal } from './rehype-stream-reveal'
import { useStreamPacer } from './use-stream-pacer'
import { SourceIcon } from './source-icon'
import {
  EvidenceReport,
  ExecutionDetails,
  InvestigationProgress,
  SourceConflicts,
} from './evidence-report'
import type { SearchExecution } from './verification-contracts'
import { reportStatusNames } from './verification-report'
import { ProfileFileAttachment, RecommendationCards } from './detective-results'
import type { ReactNode } from 'react'
import type { ContestRecommendation } from './conversation'
import { useLocale } from '@/shared/i18n/locale-context'

function Sources({ items }: { items: TraceSource[] }) {
  const { t } = useLocale()
  const cited = [
    ...new Map(
      items.filter((source) => safeUrl(source.url)).map((source) => [source.url, source]),
    ).values(),
  ]
  if (!cited.length) return null
  return (
    <footer aria-label={t('引用来源')}>
      <ul className="detective-sources">
        {cited.map((source, index) => (
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
  const { locale, t } = useLocale()
  const steps: {
    label: string
    tool: string
    summary?: string
    status?: 'success' | 'continuing'
    sources: TraceSource[]
    execution?: SearchExecution
  }[] = []
  for (const event of turn.trace) {
    if (event.type === 'step') steps.push({ label: event.label, tool: event.tool, sources: [] })
    else {
      const step = steps.findLast((item) => item.tool === event.tool && item.summary === undefined)
      if (step) {
        step.summary = event.summary
        step.status = event.status
        step.sources = event.sources
        step.execution = event.execution
      }
    }
  }
  if (!steps.length) return null
  const active = turn.status === 'running' && !turn.content && steps.at(-1)!.summary === undefined
  const completed = steps.filter(
    (step) =>
      step.summary !== undefined &&
      step.status !== 'continuing' &&
      step.execution?.status !== 'failure',
  ).length
  const failed = steps.some((step) => step.execution?.status === 'failure')
  const unfinished = steps.some((step) => step.summary === undefined)
  const label = turn.report
    ? t(reportStatusNames[turn.report.status])
    : active
      ? t('正在{step}', { step: translateSystemText(locale, steps.at(-1)!.label) })
      : turn.status === 'stopped'
        ? t('已停止，完成 {count} 项检索', { count: completed })
        : turn.status === 'error'
          ? t('检索未完成')
          : failed || unfinished
            ? t('检索未完成，成功 {count} 项', { count: completed })
            : t('已完成 {count} 项检索', { count: completed })
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
              <strong>{translateSystemText(locale, step.label)}</strong>
              {step.execution?.status === 'failure' ? (
                <span>{t('失败')}</span>
              ) : step.status === 'continuing' ? (
                <ChevronRight aria-label={t('继续查找')} />
              ) : step.summary !== undefined ? (
                <Check aria-label={t('已完成')} />
              ) : turn.status === 'running' ? (
                <LoaderCircle className="detective-spin" aria-label={t('进行中')} />
              ) : (
                <Square aria-label={t('已停止')} />
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

function RetryInvestigation({ turnId }: { turnId: string }) {
  const { t } = useLocale()
  const { retry } = useDetective()
  return (
    <Button variant="outline" size="sm" onClick={() => retry(turnId)}>
      {t('一键重查')}
    </Button>
  )
}

export function DetectiveMessage({
  turn,
  recommendationAction,
  saveAction,
  onProvideLink,
}: {
  turn: DetectiveTurn
  recommendationAction?: (contest: ContestRecommendation['contest']) => ReactNode
  saveAction?: ReactNode
  onProvideLink?: () => void
}) {
  const { locale, t } = useLocale()
  const paced = useStreamPacer(turn.content, turn.status === 'running')
  return (
    <article
      className="detective-turn"
      aria-label={t('关于{topic}的对话', { topic: turn.question })}
    >
      <div className="detective-turn__question">
        {turn.profileFile && <ProfileFileAttachment file={turn.profileFile} />}
        {turn.request?.contest && (
          <div className="w-80 max-w-full">
            <ContestReference contest={turn.request.contest} />
          </div>
        )}
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
                {turn.trace.length ? t('正在查找资料') : t('正在看你的问题')}
              </p>
            )}
          {(!turn.report || turn.report.status !== 'complete') && paced.visible && (
            <div className="detective-prose">
              <ReactMarkdown
                urlTransform={(url) => safeUrl(url) ?? ''}
                components={markdownComponents}
                remarkPlugins={[remarkCjkFriendly]}
                rehypePlugins={paced.revealedAt.length ? [[rehypeStreamReveal, paced]] : []}
              >
                {paced.visible}
              </ReactMarkdown>
            </div>
          )}
          {turn.report && <EvidenceReport report={turn.report} />}
          {!turn.report && <SourceConflicts items={turn.conflicts ?? []} />}
          {!!turn.recommendations?.length && (
            <RecommendationCards items={turn.recommendations} action={recommendationAction} />
          )}
          {!turn.report && <Sources items={turn.sources} />}
          {saveAction}
          {turn.error && (
            <p
              className="detective-turn__error"
              role={turn.status === 'error' ? 'alert' : 'status'}
            >
              {translateSystemText(locale, turn.error)}
            </p>
          )}
          {turn.action === 'settings' && (
            <Button asChild variant="outline" size="sm">
              <Link to="/account/keys">{t('账户设置')}</Link>
            </Button>
          )}
          {turn.action === 'retry' && turn.status !== 'running' && (
            <RetryInvestigation turnId={turn.id} />
          )}
          {turn.action === 'provide_link' && (
            <Button
              variant="outline"
              size="sm"
              onClick={
                onProvideLink ??
                (() =>
                  document
                    .querySelector<HTMLTextAreaElement>('textarea[data-detective-input]')
                    ?.focus())
              }
            >
              {t('贴官网链接')}
            </Button>
          )}
        </div>
      </div>
    </article>
  )
}
