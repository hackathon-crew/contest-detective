import ReactMarkdown from 'react-markdown'
import { useRef, type ReactNode } from 'react'
import {
  ContestCover,
  coverageLabel,
  dateFields,
  fieldNames,
  formatDate,
  VerificationLevel,
  modeNames,
  safeUrl,
  useContest,
  dateText,
} from '@/entities/contest'
import { ErrorState, Skeleton } from '@/shared/ui'
import { Dialog, DialogContent, DialogTitle } from '@/shared/ui/dialog'
import { Icon } from '@/shared/ui/site-icon'
import { ContestDocuments, ContestIntroductionSection, CoverageEvidence } from './content'
import './contest-detail.css'
export interface ContestDetailProps {
  contestId: string
  open?: boolean
  onClose: () => void
  action?: ReactNode
  onAsk?: (question: string) => void
  variant?: 'default' | 'library'
}
export function ContestDetail({
  contestId,
  open = true,
  onClose,
  action,
  onAsk,
  variant = 'default',
}: ContestDetailProps) {
  const query = useContest(contestId, open)
  const title = useRef<HTMLHeadingElement>(null)
  const contest = query.data
  const registration = safeUrl(contest?.fields.registration_url?.value)
  const library = variant === 'library'
  const names = library
    ? {
        ...fieldNames,
        registration_deadline: '报名截止',
        submission_deadline: '提交截止',
        start_at: '开赛',
        end_at: '结束',
        venue: '地点',
        prize: '奖金',
      }
    : fieldNames
  const order = library
    ? [
        'registration_deadline',
        'submission_deadline',
        'deadline_unspecified',
        'start_at',
        'end_at',
        'mode',
        'city',
        'venue',
        'prize',
        'organizer',
        ...Object.keys(fieldNames).filter(
          (field) =>
            ![
              'registration_deadline',
              'submission_deadline',
              'deadline_unspecified',
              'start_at',
              'end_at',
              'mode',
              'city',
              'venue',
              'prize',
              'organizer',
            ].includes(field),
        ),
      ]
    : Object.keys(fieldNames)
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value) onClose()
      }}
    >
      <DialogContent
        className={'contest-detail' + (library ? ' contest-detail--library' : '')}
        aria-describedby={undefined}
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          title.current?.focus()
        }}
      >
        {contest?.cover_url && <ContestCover contest={contest} className="contest-detail-cover" />}
        <div className="contest-detail-body">
          <div>
            <DialogTitle ref={title} tabIndex={-1}>
              {contest?.name ?? '赛事详情'}
            </DialogTitle>
            {contest?.fields.organizer?.value && (
              <p className="contest-detail-organizer">{contest.fields.organizer.value}</p>
            )}
          </div>
          {query.isPending ? (
            <Skeleton />
          ) : query.isError ? (
            <ErrorState error={query.error} retry={() => void query.refetch()} />
          ) : (
            contest && (
              <>
                <ContestIntroductionSection contest={contest} />
                <dl className="contest-detail-fields">
                  {order.map((field) => {
                    const label = names[field]
                    const item = contest.fields[field]
                    const value = item?.value
                    const observation = contest.coverage?.fields?.[field]
                    return (
                      <div key={field}>
                        <dt>{label}</dt>
                        <dd>
                          <p>
                            {value ? (
                              dateFields.includes(field) ? (
                                library ? (
                                  item.precision === 'day' ? (
                                    Number(value.slice(0, 4)) + '年' + dateText(item)
                                  ) : (
                                    formatDate(value, item.precision, true)
                                  )
                                ) : (
                                  formatDate(value, item.precision)
                                )
                              ) : field === 'mode' ? (
                                (modeNames[value] ?? value)
                              ) : field === 'registration_url' && safeUrl(value) ? (
                                <a href={safeUrl(value)} target="_blank" rel="noopener noreferrer">
                                  去报名
                                </a>
                              ) : (
                                value
                              )
                            ) : (
                              <span className="text-faint">{coverageLabel(observation)}</span>
                            )}
                          </p>
                          {value && observation && observation.state !== 'found' && (
                            <p className="contest-detail-coverage">{coverageLabel(observation)}</p>
                          )}
                          <CoverageEvidence observation={observation} />
                          {!library &&
                            item?.sources?.map((source, index) => (
                              <div
                                className={
                                  'contest-detail-source' + (source.stale ? ' line-through' : '')
                                }
                                key={source.url + index}
                              >
                                <a
                                  href={safeUrl(source.url)}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  {source.title || source.site}
                                </a>
                                <p>{source.excerpt}</p>
                              </div>
                            ))}
                          {library && !!item?.sources?.length && (
                            <details className="contest-detail-evidence">
                              <summary>查看原文摘录</summary>
                              {item.sources.map((source, index) => (
                                <div
                                  className={
                                    'contest-detail-source' + (source.stale ? ' line-through' : '')
                                  }
                                  key={source.url + index}
                                >
                                  <a href={safeUrl(source.url)} target="_blank" rel="noreferrer">
                                    {source.title || source.site}
                                  </a>
                                  <p>{source.excerpt}</p>
                                </div>
                              ))}
                            </details>
                          )}
                          {value && !item?.sources?.length && (
                            <p className="contest-detail-source">没有可显示的出处。</p>
                          )}
                        </dd>
                        {library ? (
                          <span className="contest-detail-first-source">
                            <VerificationLevel level={item?.level ?? 'not_found'} />
                            {item?.sources?.[0] && (
                              <a
                                href={safeUrl(item.sources[0].url)}
                                target="_blank"
                                rel="noreferrer"
                              >
                                {item.sources[0].site || item.sources[0].title}
                                <Icon name="arrow-right" />
                              </a>
                            )}
                          </span>
                        ) : (
                          <VerificationLevel level={item?.level ?? 'not_found'} />
                        )}
                      </div>
                    )
                  })}
                </dl>
                <div className="contest-detail-actions">
                  {registration && (
                    <a
                      className="site-button site-button--primary"
                      href={registration}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      去报名 <Icon name="arrow-right" />
                    </a>
                  )}
                  {onAsk && (
                    <button
                      type="button"
                      className="site-button site-button--outline"
                      onClick={() => onAsk(`帮我核实一下「${contest.name}」的截止时间`)}
                    >
                      问侦探这场比赛
                    </button>
                  )}
                  {action}
                </div>
                <ContestDocuments contest={contest} />
                {contest.summary && (
                  <section className="contest-detail-summary" aria-label="历史资料">
                    <h2>历史资料</h2>
                    <p className="contest-detail-empty">保留的历史摘要，不代表本次来源核实结果。</p>
                    <ReactMarkdown urlTransform={(url) => safeUrl(url) ?? ''}>
                      {contest.summary}
                    </ReactMarkdown>
                  </section>
                )}
              </>
            )
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
