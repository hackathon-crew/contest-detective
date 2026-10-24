import ReactMarkdown from 'react-markdown'
import { useRef, type ReactNode } from 'react'
import {
  ContestCover,
  dateFields,
  fieldNames,
  formatDate,
  VerificationLevel,
  modeNames,
  safeUrl,
  useContest,
} from '@/entities/contest'
import { ErrorState, Skeleton } from '@/shared/ui'
import { Dialog, DialogContent, DialogTitle } from '@/shared/ui/dialog'
import { Icon } from '@/shared/ui/site-icon'
import './contest-detail.css'
export interface ContestDetailProps {
  contestId: string
  open?: boolean
  onClose: () => void
  action?: ReactNode
  onAsk?: (question: string) => void
}
export function ContestDetail({
  contestId,
  open = true,
  onClose,
  action,
  onAsk,
}: ContestDetailProps) {
  const query = useContest(contestId, open)
  const title = useRef<HTMLHeadingElement>(null)
  const contest = query.data
  const registration = safeUrl(contest?.fields.registration_url?.value)
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value) onClose()
      }}
    >
      <DialogContent
        className="contest-detail"
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
                <dl className="contest-detail-fields">
                  {Object.entries(fieldNames).map(([field, label]) => {
                    const item = contest.fields[field]
                    const value = item?.value
                    return (
                      <div key={field}>
                        <dt>{label}</dt>
                        <dd>
                          <p>
                            {value ? (
                              dateFields.includes(field) ? (
                                formatDate(value, item.precision)
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
                              <span className="text-faint">未找到</span>
                            )}
                          </p>
                          {item?.sources?.map((source, index) => (
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
                          {value && !item?.sources?.length && (
                            <p className="contest-detail-source">没有可显示的出处。</p>
                          )}
                        </dd>
                        <VerificationLevel level={item?.level ?? 'not_found'} />
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
                {contest.summary && (
                  <div className="contest-detail-summary">
                    <ReactMarkdown urlTransform={(url) => safeUrl(url) ?? ''}>
                      {contest.summary}
                    </ReactMarkdown>
                  </div>
                )}
              </>
            )
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
