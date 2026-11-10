import { ToggleGroup, ToggleGroupItem } from '@huyanxius/ui'
import type { ReactNode } from 'react'
import { CalendarDays, ChevronLeft, ChevronRight, List, SlidersHorizontal, X } from 'lucide-react'
import { ContestCard, ContestSeriesRow, type LibraryRow } from '@/entities/contest'
import { Skeleton } from '@huyanxius/ui'
import { ErrorState } from '@/shared/ui'
import { activeFilters, type ContestBrowserModel } from './browser-state'
import { useLocale } from '@/shared/i18n/locale-context'

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
  const { locale, t } = useLocale()
  const { filters, query, rows, params, page, pages, setParams, change, clear, total } = browser
  const active = activeFilters(filters, locale)
  const empty = filters.mine && !browser.hasFollows
  return (
    <div className="results" aria-busy={query.isFetching}>
      <div className="res-bar">
        <div className="res-left">
          <span className="res-count" aria-live="polite">
            {query.complete ? t('共') : t('已找到')} <b>{total}</b>{' '}
            {locale === 'en' && total === 1 ? 'contest' : t('场')}
          </span>
          <div className="actives">
            {active.map((item) => (
              <button
                className="achip"
                type="button"
                key={item.key}
                aria-label={t('去掉 {filter}', { filter: item.label })}
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
            {t('筛选')}
            {active.filter((item) => item.key !== 'keyword').length > 0 && (
              <span className="badge">
                {active.filter((item) => item.key !== 'keyword').length}
              </span>
            )}
          </button>
          <ToggleGroup
            type="single"
            unstyled
            className="seg"
            aria-label={t('排序')}
            value={params.sort}
            onValueChange={(value) => {
              if (value) void setParams({ sort: value as typeof params.sort, page: 1 })
            }}
          >
            {(
              [
                ['preparation', t('准备时间优先')],
                ['deadline', t('截止最近')],
                ['start', t('开赛最早')],
              ] as const
            ).map(([sort, label]) => (
              <ToggleGroupItem key={sort} value={sort}>
                {label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <ToggleGroup
            type="single"
            unstyled
            className="seg"
            aria-label={t('视图')}
            id="view"
            value={params.view}
            onValueChange={(value) => {
              if (value) void setParams({ view: value as typeof params.view })
            }}
          >
            <ToggleGroupItem aria-label={t('列表')} value="list">
              <List className="ic" />
              <span className="v-txt">{t('列表')}</span>
            </ToggleGroupItem>
            <ToggleGroupItem aria-label={t('日历')} value="calendar">
              <CalendarDays className="ic" />
              <span className="v-txt">{t('日历')}</span>
            </ToggleGroupItem>
          </ToggleGroup>
          {exportAction}
        </div>
      </div>
      {profile}
      {query.data && !query.complete && (
        <p className="note" role="status">
          {t(query.isFetching ? '已加载 {count} 场，继续读取中。' : '已加载 {count} 场。', {
            count: query.data.length,
          })}
        </p>
      )}
      {query.isError && <ErrorState error={query.error} retry={() => void query.refetch()} />}
      {query.isPending ? (
        <Skeleton className="mt-4 h-32 w-full" />
      ) : query.isError && !query.data ? null : !total && !query.complete ? (
        <div className="empty">{t('其余赛事尚未读取完成。')}</div>
      ) : !total ? (
        <div className="empty">
          <b>{empty ? t('还没有关注的比赛') : t('没有符合条件的比赛')}</b>
          <span>
            {empty
              ? t('点每场右边的书签就能关注，关注的比赛在日历上标成蓝色。')
              : t('放宽截止时间或参赛形式再看看。')}
          </span>
          <button
            className="site-button site-button--outline"
            type="button"
            onClick={() => (empty ? change({ mine: false }) : clear())}
          >
            {empty ? t('看全部比赛') : t('清除筛选')}
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
            <nav className="pager" aria-label={t('赛事分页')}>
              <button
                type="button"
                aria-label={t('上一页')}
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
                aria-label={t('下一页')}
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
