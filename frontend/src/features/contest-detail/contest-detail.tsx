import ReactMarkdown from 'react-markdown'
import {
  dateFields,
  fieldNames,
  formatDate,
  LevelBadge,
  modeNames,
  safeUrl,
  useContest,
} from '@/entities/contest'
import { Dialog, EmptyState, ErrorState, Skeleton } from '@/shared/ui'
export interface ContestDetailProps {
  contestId: string
  onClose: () => void
}
export function ContestDetail({ contestId, onClose }: ContestDetailProps) {
  const query = useContest(contestId)
  return (
    <Dialog title={query.data?.name ?? '赛事详情'} onClose={onClose}>
      {query.isPending ? (
        <Skeleton />
      ) : query.isError ? (
        <ErrorState error={query.error} retry={() => void query.refetch()} />
      ) : (
        <div className="space-y-6">
          <dl className="divide-y divide-rule">
            {Object.entries(fieldNames).map(([field, label]) => {
              const item = query.data.fields[field]
              const value = item?.value
              const sources = item?.sources ?? []
              return (
                <div key={field} className="py-4">
                  <dt className="mb-2 flex items-center gap-3 text-sm font-semibold text-ink">
                    {label}
                    <LevelBadge level={item?.level ?? 'not_found'} />
                  </dt>
                  <dd className="space-y-3 break-words text-sm">
                    {value && (
                      <p>
                        {dateFields.includes(field) ? (
                          formatDate(value)
                        ) : field === 'mode' ? (
                          (modeNames[value] ?? value)
                        ) : field === 'registration_url' && safeUrl(value) ? (
                          <a
                            href={safeUrl(value)}
                            target="_blank"
                            rel="noreferrer"
                            className="underline underline-offset-4"
                          >
                            去报名
                          </a>
                        ) : (
                          value
                        )}
                      </p>
                    )}
                    {sources.length ? (
                      <ul className="space-y-3">
                        {sources.map((source, index) => (
                          <li
                            key={`${source.url}-${index}`}
                            className={`space-y-1 text-xs text-muted ${source.stale ? 'line-through' : ''}`}
                          >
                            <a
                              href={safeUrl(source.url)}
                              target="_blank"
                              rel="noreferrer"
                              className="underline underline-offset-4"
                            >
                              {source.title || source.site}
                            </a>
                            <p>{source.excerpt}</p>
                          </li>
                        ))}
                      </ul>
                    ) : value ? (
                      <EmptyState>没有可显示的出处。</EmptyState>
                    ) : null}
                  </dd>
                </div>
              )
            })}
          </dl>
          {query.data.summary && (
            <div className="space-y-3 break-words text-sm">
              <ReactMarkdown urlTransform={(url) => safeUrl(url) ?? ''}>
                {query.data.summary}
              </ReactMarkdown>
            </div>
          )}
        </div>
      )}
    </Dialog>
  )
}
