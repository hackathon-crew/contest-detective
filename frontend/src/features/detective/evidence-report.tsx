import { useId, useState } from 'react'
import { Button } from '@/shared/ui'
import type {
  InvestigationPlan,
  InvestigationReport,
  SearchExecution,
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

export function ExecutionDetails({ execution }: { execution: SearchExecution }) {
  return (
    <div className="detective-report__metadata">
      <p>实际查询：{execution.query}</p>
      <p>计划步骤：{execution.step_id}</p>
      <p>
        服务：{execution.provider} · 第 {execution.round} 轮 · {execution.result_count} 条结果
      </p>
      <p>
        执行时间：<time dateTime={execution.executed_at}>{execution.executed_at}</time>
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
  return (
    <div className="detective-report__progress">
      {plan && (
        <details className="detective-report__details" open>
          <summary>调查计划</summary>
          <ol>
            {plan.steps.map((step) => (
              <li key={step.id}>
                <strong>{step.purpose}</strong>
                <p>计划查询：{step.query}</p>
                {!!step.claim_ids.length && <p>关联说法：{step.claim_ids.join('、')}</p>}
              </li>
            ))}
          </ol>
        </details>
      )}
      <details className="detective-report__details" open>
        <summary>实际查询记录</summary>
        {!queries.length ? (
          <p>尚无实际查询记录。</p>
        ) : (
          <ol>
            {queries.map((execution) => (
              <li key={execution.id}>
                <div className="detective-report__heading">
                  <strong>{execution.id}</strong>
                  <span>{execution.status === 'success' ? '成功' : '失败'}</span>
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
  const prefix = useId()
  const [exportError, setExportError] = useState<string | null>(null)
  const evidenceId = (id: string) => `${prefix}-evidence-${encodeURIComponent(id)}`
  function download(format: 'json' | 'markdown') {
    try {
      downloadReport(report, format)
      setExportError(null)
    } catch {
      setExportError('报告未通过安全检查或浏览器无法下载，请重新查证后再试。')
    }
  }
  return (
    <section className="detective-report" aria-label="查证报告">
      <header>
        <div className="detective-report__heading">
          <h2>{report.mode === 'deep' ? '深度调查报告' : '实时查证报告'}</h2>
          <span>{reportStatusNames[report.status]}</span>
        </div>
        <p className="detective-report__metadata">
          生成时间：<time dateTime={report.generated_at}>{report.generated_at}</time>
        </p>
      </header>
      <div className="detective-report__claims">
        {report.claims.length ? (
          report.claims.map((claim) => (
            <article className="detective-report__claim" key={claim.id}>
              <p className="detective-report__metadata">说法 {claim.id}</p>
              <h3>{claim.text}</h3>
              <dl>
                <div>
                  <dt>结论：</dt>
                  <dd>{verdictNames[claim.verdict]}</dd>
                </div>
                <div>
                  <dt>来源等级：</dt>
                  <dd>{sourceLevelNames[claim.source_level]}</dd>
                </div>
              </dl>
              <p>{claim.comparison || '尚无可用比对。'}</p>
              {claim.evidence_ids.length ? (
                <ul className="detective-report__references" aria-label={`说法 ${claim.id} 的证据`}>
                  {claim.evidence_ids.map((id) => (
                    <li key={id}>
                      <a href={`#${evidenceId(id)}`}>证据 {id}</a>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="detective-report__metadata">无可用证据。</p>
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
          <p>没有可用的说法核对结果。</p>
        )}
      </div>
      {!!report.limitations.length && (
        <section aria-label="查证限制">
          <h3>限制</h3>
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
          <summary>证据来源</summary>
          {report.evidence.map((evidence) => (
            <article
              id={evidenceId(evidence.id)}
              className="detective-report__evidence"
              key={evidence.id}
            >
              <p className="detective-report__metadata">证据 {evidence.id}</p>
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
                来源等级：{sourceLevelNames[evidence.source_level]}
              </p>
              <p className="detective-report__metadata">
                {evidenceKindNames[evidence.evidence_kind]}
              </p>
              <p className="detective-report__excerpt">{evidence.excerpt || '无可用摘录。'}</p>
              <div className="detective-report__metadata">
                <p>
                  获取时间：
                  {evidence.retrieved_at ? (
                    <time dateTime={evidence.retrieved_at}>{evidence.retrieved_at}</time>
                  ) : (
                    '未记录'
                  )}
                </p>
                {evidence.provider && <p>服务：{evidence.provider}</p>}
                <p>关联查询：{evidence.query_ids.join('、') || '无'}</p>
                <p>
                  {evidence.source_lineage
                    ? `来源谱系：${evidence.source_lineage}`
                    : '来源独立性未确认。'}
                </p>
                {evidence.content_hash && <p>内容校验：{evidence.content_hash}</p>}
                {evidence.historical && <p>历史资料</p>}
              </div>
            </article>
          ))}
        </details>
      )}
      <footer className="detective-report__downloads">
        <Button type="button" variant="outline" size="sm" onClick={() => download('markdown')}>
          下载 Markdown
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => download('json')}>
          下载 JSON
        </Button>
      </footer>
      {exportError && (
        <p className="detective-turn__error" role="status">
          {exportError}
        </p>
      )}
    </section>
  )
}
