import { useId, useState } from 'react'
import { Button } from '@huyanxius/ui'
import type {
  InvestigationPlan,
  InvestigationReport,
  SearchExecution,
  SourceConflict,
} from './verification-contracts'
import {
  downloadReport,
  evidenceKindNames,
  publicReportUrl,
  reportStatusNames,
  sourceLevelNames,
  verdictNames,
} from './verification-report'
import './evidence-report.css'
import { useLocale } from '@/shared/i18n/locale-context'

export function SourceConflicts({ items }: { items: SourceConflict[] }) {
  const { t } = useLocale()
  return items.map((conflict, index) => {
    const selected = conflict.accepted_statement ?? null
    const ordered = conflict.statements
      .map((statement, index) => ({ statement, index }))
      .sort((a, b) => Number(a.index === selected) - Number(b.index === selected))
    return (
      <section className="detective-clash" aria-label={t('来源分歧')} key={index}>
        {ordered.map(({ statement, index }) => (
          <div
            className="detective-clash__row"
            data-superseded={selected !== null && index !== selected}
            key={index}
          >
            <small>
              {t(sourceLevelNames[statement.evidence.source_level])}
              {selected === index ? t(' · 采信原文') : ''}
            </small>
            <span className="detective-clash__quote">「{statement.text}」</span>
            <a href={statement.evidence.url} target="_blank" rel="noreferrer">
              {t('原文 ↗')}
            </a>
          </div>
        ))}
        <div
          className="detective-clash__verdict"
          data-blocking={selected !== null && conflict.blocks_participation}
        >
          <b>
            {selected === null
              ? t('仍有分歧')
              : conflict.blocks_participation
                ? t('不能参赛')
                : t('核对结果')}
          </b>
          <span>{conflict.reason}</span>
        </div>
      </section>
    )
  })
}

export function ExecutionDetails({ execution }: { execution: SearchExecution }) {
  const { t } = useLocale()
  return (
    <div className="detective-report__metadata">
      <p>
        {t('实际查询：')}
        {execution.query}
      </p>
      <p>
        {t('计划步骤：')}
        {execution.step_id}
      </p>
      <p>
        {t('服务：')}
        {t('{provider} · 第 {round} 轮 · {count} 条结果', {
          provider: execution.provider,
          round: execution.round,
          count: execution.result_count,
        })}
      </p>
      <p>
        {t('执行时间：')}
        <time dateTime={execution.executed_at}>{execution.executed_at}</time>
      </p>
      {execution.error_code && <p>{execution.error_code}</p>}
    </div>
  )
}

/** A plan describes intent; only execution receipts describe what actually ran. */
export function InvestigationProgress({
  plan,
  queries,
}: {
  plan?: InvestigationPlan | null
  queries: SearchExecution[]
}) {
  const { t } = useLocale()
  return (
    <div className="detective-report__progress">
      {plan && (
        <details className="detective-report__details" open>
          <summary>{t('调查计划')}</summary>
          <ol>
            {plan.steps.map((step) => (
              <li key={step.id}>
                <strong>{step.purpose}</strong>
                <p>
                  {t('计划查询：')}
                  {step.query}
                </p>
                {!!step.claim_ids.length && (
                  <p>
                    {t('关联说法：')}
                    {step.claim_ids.join('、')}
                  </p>
                )}
              </li>
            ))}
          </ol>
        </details>
      )}
      <details className="detective-report__details" open>
        <summary>{t('实际查询记录')}</summary>
        {!queries.length ? (
          <p>{t('尚无实际查询记录。')}</p>
        ) : (
          <ol>
            {queries.map((execution) => (
              <li key={execution.id}>
                <div className="detective-report__heading">
                  <strong>{execution.id}</strong>
                  <span>{execution.status === 'success' ? t('成功') : t('失败')}</span>
                </div>
                <ExecutionDetails execution={execution} />
              </li>
            ))}
          </ol>
        )}
      </details>
    </div>
  )
}

export function EvidenceReport({ report }: { report: InvestigationReport }) {
  const { t } = useLocale()
  const prefix = useId()
  const [exportError, setExportError] = useState(false)
  const evidenceId = (id: string) => `${prefix}-evidence-${encodeURIComponent(id)}`
  function download(format: 'json' | 'markdown') {
    try {
      downloadReport(report, format)
      setExportError(false)
    } catch {
      setExportError(true)
    }
  }
  return (
    <section className="detective-report" aria-label={t('查证报告')}>
      <header>
        <div className="detective-report__heading">
          <h2>{report.mode === 'deep' ? t('深度调查报告') : t('实时查证报告')}</h2>
          <span>{t(reportStatusNames[report.status])}</span>
        </div>
        <p className="detective-report__metadata">
          {t('生成时间：')}
          <time dateTime={report.generated_at}>{report.generated_at}</time>
        </p>
      </header>
      <SourceConflicts items={report.conflicts ?? []} />
      <div className="detective-report__claims">
        {report.claims.length ? (
          report.claims.map((claim) => (
            <article className="detective-report__claim" key={claim.id}>
              <p className="detective-report__metadata">
                {t('说法')} {claim.id}
              </p>
              <h3>{claim.text}</h3>
              <dl>
                <div>
                  <dt>{t('结论：')}</dt>
                  <dd>{t(verdictNames[claim.verdict])}</dd>
                </div>
                <div>
                  <dt>{t('来源等级：')}</dt>
                  <dd>{t(sourceLevelNames[claim.source_level])}</dd>
                </div>
              </dl>
              <p>{claim.comparison || t('尚无可用比对。')}</p>
              {claim.evidence_ids.length ? (
                <ul
                  className="detective-report__references"
                  aria-label={t('说法 {number} 的证据', { number: claim.id })}
                >
                  {claim.evidence_ids.map((id) => (
                    <li key={id}>
                      <a href={`#${evidenceId(id)}`}>
                        {t('证据')} {id}
                      </a>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="detective-report__metadata">{t('无可用证据。')}</p>
              )}
              {!!claim.limitations.length && (
                <ul>
                  {claim.limitations.map((limitation, index) => (
                    <li key={index}>{limitation}</li>
                  ))}
                </ul>
              )}
            </article>
          ))
        ) : (
          <p>{t('没有可用的说法核对结果。')}</p>
        )}
      </div>
      {!!report.limitations.length && (
        <section aria-label={t('查证限制')}>
          <h3>{t('限制')}</h3>
          <ul>
            {report.limitations.map((limitation, index) => (
              <li key={index}>{limitation}</li>
            ))}
          </ul>
        </section>
      )}
      <InvestigationProgress plan={report.plan} queries={report.queries} />
      {!!report.evidence.length && (
        <details className="detective-report__details" open>
          <summary>{t('证据来源')}</summary>
          {report.evidence.map((evidence) => (
            <article
              id={evidenceId(evidence.id)}
              className="detective-report__evidence"
              key={evidence.id}
            >
              <p className="detective-report__metadata">
                {t('证据')} {evidence.id}
              </p>
              <h3>
                {publicReportUrl(evidence.url) ? (
                  <a href={evidence.url} target="_blank" rel="noreferrer">
                    {evidence.title || evidence.id}
                  </a>
                ) : (
                  evidence.title || evidence.id
                )}
              </h3>
              <p className="detective-report__metadata">
                {t('来源等级：')}
                {t(sourceLevelNames[evidence.source_level])}
              </p>
              <p className="detective-report__metadata">
                {t(evidenceKindNames[evidence.evidence_kind])}
              </p>
              <p className="detective-report__excerpt">{evidence.excerpt || t('无可用摘录。')}</p>
              <div className="detective-report__metadata">
                <p>
                  {t('获取时间：')}
                  {evidence.retrieved_at ? (
                    <time dateTime={evidence.retrieved_at}>{evidence.retrieved_at}</time>
                  ) : (
                    t('未记录')
                  )}
                </p>
                {evidence.provider && (
                  <p>
                    {t('服务：')}
                    {evidence.provider}
                  </p>
                )}
                <p>
                  {t('关联查询：')}
                  {evidence.query_ids.join('、') || t('无')}
                </p>
                <p>
                  {evidence.source_lineage
                    ? t('来源谱系：{lineage}', { lineage: evidence.source_lineage })
                    : t('来源独立性未确认。')}
                </p>
                {evidence.content_hash && (
                  <p>
                    {t('内容校验：')}
                    {evidence.content_hash}
                  </p>
                )}
                {evidence.historical && <p>{t('历史资料')}</p>}
              </div>
            </article>
          ))}
        </details>
      )}
      <footer className="detective-report__downloads">
        <Button type="button" variant="outline" size="sm" onClick={() => download('markdown')}>
          {t('下载 Markdown')}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => download('json')}>
          {t('下载 JSON')}
        </Button>
      </footer>
      {exportError && (
        <p className="detective-turn__error" role="status">
          {t('报告未通过安全检查或浏览器无法下载，请重新查证后再试。')}
        </p>
      )}
    </section>
  )
}
