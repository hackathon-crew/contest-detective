import type { ReactNode } from 'react'
import { CalendarDays, ChevronLeft, ChevronRight, List, SlidersHorizontal, X } from 'lucide-react'
import { ContestCard, ContestSeriesRow, type LibraryRow } from '@/entities/contest'
import { ErrorState, Skeleton } from '@/shared/ui'
import { activeFilters, type ContestBrowserModel } from './browser-state'

export function LibraryRows({
  rows,
  renderAction,
  reasons,
}: {
  rows: LibraryRow[]
  renderAction?: (id: string) => ReactNode
  reasons?: Map<string, string>
}) {
  return (
    <div className="items">
      {rows.map((row, index) =>
        row.type === 'series' ? (
          <ContestSeriesRow key={row.id} row={row} index={index} />
        ) : (
          <ContestCard
            key={row.id}
            contest={row.contests[0]!}
            index={index}
            action={renderAction?.(row.id)}
            reason={reasons?.get(row.id)}
          />
        ),
      )}
    </div>
  )
}
export function ContestBrowser({
  browser,
  onOpenFilters,
  calendar,
  profile,
  exportAction,
  renderAction,
  reasons,
}: {
  browser: ContestBrowserModel
  onOpenFilters: () => void
  calendar: ReactNode
  profile?: ReactNode
  exportAction?: ReactNode
  renderAction?: (id: string) => ReactNode
  reasons?: Map<string, string>
}) {
  const { filters, query, rows, params, page, pages, setParams, change, clear, total } = browser
  const active = activeFilters(filters)
  const empty = filters.mine && !browser.hasFollows
  return (
    <div className="results" aria-busy={query.isFetching}>
      <div className="res-bar">
        <div className="res-left">
          <span className="res-count" aria-live="polite">
            共 <b>{total}</b> 场
          </span>
          <div className="actives">
            {active.map((item) => (
              <button
                className="achip"
                type="button"
                key={item.key}
                aria-label={'去掉 ' + item.label}
                onClick={() => change(item.patch)}
              >
                {item.label}
                <X className="ic" />
              </button>
            ))}
          </div>
        </div>
        <div className="res-tools">
          <button
            className="site-button site-button--ghost filter-btn"
            type="button"
            onClick={onOpenFilters}
          >
            <SlidersHorizontal className="ic" />
            筛选
            {active.filter((item) => item.key !== 'keyword').length > 0 && (
              <span className="badge">
                {active.filter((item) => item.key !== 'keyword').length}
              </span>
            )}
          </button>
          <div className="seg" role="group" aria-label="排序">
            {[
              ['deadline', '截止最近'],
              ['start', '开赛最早'],
            ].map(([sort, label]) => (
              <button
                type="button"
                key={sort}
                aria-pressed={params.sort === sort}
                onClick={() => void setParams({ sort: sort as 'deadline' | 'start', page: 1 })}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="seg" role="group" aria-label="视图" id="view">
            <button
              type="button"
              aria-label="列表"
              aria-pressed={params.view === 'list'}
              onClick={() => void setParams({ view: 'list' })}
            >
              <List className="ic" />
              <span className="v-txt">列表</span>
            </button>
            <button
              type="button"
              aria-label="日历"
              aria-pressed={params.view !== 'list'}
              onClick={() => void setParams({ view: 'calendar' })}
            >
              <CalendarDays className="ic" />
              <span className="v-txt">日历</span>
            </button>
          </div>
          {exportAction}
        </div>
      </div>
      {profile}
      {query.isPending || (query.isFetching && !!filters.keyword) ? (
        <Skeleton className="mt-4 h-32 w-full" />
      ) : query.isError ? (
        <ErrorState error={query.error} retry={() => void query.refetch()} />
      ) : !total ? (
        <div className="empty">
          <b>{empty ? '还没有关注的比赛' : '没有符合条件的比赛'}</b>
          <span>
            {empty
              ? '点每场右边的书签就能关注，关注的比赛在日历上标成蓝色。'
              : '放宽截止时间或参赛形式再看看。'}
          </span>
          <button
            className="site-button site-button--outline"
            type="button"
            onClick={() => (empty ? change({ mine: false }) : clear())}
          >
            {empty ? '看全部比赛' : '清除筛选'}
          </button>
        </div>
      ) : params.view !== 'list' ? (
        <div className="view" key="calendar">
          {calendar}
        </div>
      ) : (
        <div className="view" key="list">
          <LibraryRows
            rows={rows.slice((page - 1) * 20, page * 20)}
            renderAction={renderAction}
            reasons={reasons}
          />
          {pages > 1 && (
            <nav className="pager" aria-label="赛事分页">
              <button
                type="button"
                aria-label="上一页"
                disabled={page <= 1}
                onClick={() => void setParams({ page: page - 1 })}
              >
                <ChevronLeft className="ic" />
              </button>
              {Array.from({ length: pages }, (_, i) => (
                <button
                  type="button"
                  key={i}
                  aria-current={page === i + 1 ? 'page' : undefined}
                  onClick={() => void setParams({ page: i + 1 })}
                >
                  {i + 1}
                </button>
              ))}
              <button
                type="button"
                aria-label="下一页"
                disabled={page >= pages}
                onClick={() => void setParams({ page: page + 1 })}
              >
                <ChevronRight className="ic" />
              </button>
            </nav>
          )}
        </div>
      )}
    </div>
  )
}
