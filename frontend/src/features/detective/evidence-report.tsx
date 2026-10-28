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
      <p>查找内容：{execution.query}</p>
      <p>
        {execution.status === 'success'
          ? `找到 ${execution.result_count} 条线索`
          : '这次没有取得搜索结果，相关信息仍待核实。'}
      </p>
      <p>
        查找时间：<time dateTime={execution.executed_at}>{execution.executed_at}</time>
      </p>
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
          <summary>待核对内容</summary>
          <ol>
            {plan.steps.map((step) => (
              <li key={step.id}>
                <strong>{step.purpose}</strong>
                <p>准备查找：{step.query}</p>
              </li>
            ))}
          </ol>
        </details>
      )}
      <details className="detective-report__details" open>
        <summary>查找记录</summary>
        {!queries.length ? (
          <p>还没有查找结果。</p>
        ) : (
          <ol>
            {queries.map((execution) => (
              <li key={execution.id}>
                <div className="detective-report__heading">
                  <strong>搜索资料</strong>
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
      setExportError('报告未能下载，查证结果仍保留在页面中。你可以先复制需要的内容。')
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
          report.claims.map((claim, index) => (
            <article className="detective-report__claim" key={claim.id}>
              <p className="detective-report__metadata">说法 {index + 1}</p>
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
                <ul
                  className="detective-report__references"
                  aria-label={`说法 ${index + 1} 的证据`}
                >
                  {claim.evidence_ids.map((id) => (
                    <li key={id}>
                      <a href={`#${evidenceId(id)}`}>
                        证据 {report.evidence.findIndex((item) => item.id === id) + 1}
                      </a>
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
          <h3>尚未核实</h3>
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
          {report.evidence.map((evidence, index) => (
            <article
              id={evidenceId(evidence.id)}
              className="detective-report__evidence"
              key={evidence.id}
            >
              <p className="detective-report__metadata">证据 {index + 1}</p>
              <h3>
                {publicReportUrl(evidence.url) ? (
                  <a href={evidence.url} target="_blank" rel="noreferrer">
                    {evidence.title || '原文来源'}
                  </a>
                ) : (
                  evidence.title || '原文来源'
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
                <p>{evidence.source_lineage ? '可追溯到原始来源。' : '来源独立性未确认。'}</p>
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
