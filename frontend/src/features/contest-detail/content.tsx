import {
  coverageLabel,
  groundedIntroduction,
  safeUrl,
  usableCitations,
  VerificationLevel,
  type ContentCitation,
  type ContestDetail,
  type CoverageObservation,
} from '@/entities/contest'

export function ContentCitations({
  citations,
  label = '覆盖证据',
}: {
  citations: ContentCitation[] | undefined
  label?: string
}) {
  return usableCitations(citations).map((citation, index) => (
    <div className="contest-detail-source" key={citation.url + citation.content_hash + index}>
      <a href={safeUrl(citation.url)} target="_blank" rel="noopener noreferrer">
        {label} {index + 1}
      </a>
      <p>{citation.excerpt}</p>
    </div>
  ))
}

export function CoverageEvidence({
  observation,
}: {
  observation: CoverageObservation | undefined
}) {
  if (!observation) return null
  const citations = usableCitations(observation.citations)
  const urls = [...new Set(observation.urls ?? [])].filter(
    (url) => safeUrl(url) && !citations.some((citation) => citation.url === url),
  )
  if (!citations.length && !urls.length) return null
  return (
    <details className="contest-detail-evidence">
      <summary>查看覆盖证据</summary>
      <ContentCitations citations={citations} />
      {urls.map((url, index) => (
        <div className="contest-detail-source" key={url}>
          <a href={safeUrl(url)} target="_blank" rel="noopener noreferrer">
            已查来源 {index + 1}
          </a>
        </div>
      ))}
    </details>
  )
}

export function ContestIntroductionSection({ contest }: { contest: ContestDetail }) {
  const introduction = groundedIntroduction(contest)
  const observation = contest.coverage?.introduction
  return (
    <section className="contest-detail-introduction" aria-label="赛事介绍">
      <h2>赛事介绍</h2>
      {introduction ? (
        <>
          <p className="contest-detail-about">{introduction.text}</p>
          <ContentCitations citations={introduction.citations} label="介绍来源" />
        </>
      ) : (
        <p className="contest-detail-empty">尚未获取有出处的赛事介绍。</p>
      )}
      {observation && (!introduction || observation.state !== 'found') && (
        <p className="contest-detail-coverage">{coverageLabel(observation)}</p>
      )}
      {(!introduction || observation?.state !== 'found') && (
        <CoverageEvidence observation={observation} />
      )}
    </section>
  )
}

export function ContestDocuments({ contest }: { contest: ContestDetail }) {
  const documents = contest.documents ?? []
  const sources = Object.entries(contest.coverage?.sources ?? {})
  if (!documents.length && !sources.length) return null
  return (
    <section className="contest-detail-documents" aria-label="来源资料">
      <h2>来源资料</h2>
      <p className="contest-detail-empty">以下为来源摘录，完整内容请查看原文。</p>
      {documents.map((document) => (
        <div
          className="contest-detail-document"
          key={JSON.stringify([
            document.url,
            document.content_hash,
            document.extractor_version,
            document.kind,
            document.representation,
            document.completeness,
          ])}
        >
          <div className="contest-detail-document-heading">
            {safeUrl(document.url) ? (
              <a href={safeUrl(document.url)} target="_blank" rel="noopener noreferrer">
                {document.title || document.site || '查看原文'}
              </a>
            ) : (
              <span>{document.title || document.site || '来源资料'}</span>
            )}
            <VerificationLevel level={document.is_official ? 'official' : 'reposted'} />
          </div>
          <p className="contest-detail-coverage">
            {document.kind === 'search_snippet'
              ? '搜索摘要'
              : document.kind === 'structured'
                ? '结构化来源'
                : document.completeness === 'partial'
                  ? '部分内容'
                  : '原文摘录'}
          </p>
          {(document.excerpts ?? []).map((excerpt, index) => (
            <p className="contest-detail-source" key={index}>
              {excerpt}
            </p>
          ))}
          {!document.excerpts?.length && (
            <p className="contest-detail-empty">没有可展示的摘录，请查看来源链接。</p>
          )}
        </div>
      ))}
      {!!sources.length && (
        <details className="contest-detail-evidence">
          <summary>来源读取情况</summary>
          {sources.map(([url, observation]) => (
            <div className="contest-detail-source" key={url}>
              {safeUrl(url) && (
                <a href={safeUrl(url)} target="_blank" rel="noopener noreferrer">
                  {url}
                </a>
              )}
              <p>{coverageLabel(observation)}</p>
              <ContentCitations citations={observation.citations} />
            </div>
          ))}
        </details>
      )}
    </section>
  )
}
