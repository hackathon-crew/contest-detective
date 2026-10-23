import { parseAsInteger, parseAsString, parseAsStringLiteral, useQueryStates } from 'nuqs'
import type { ReactNode } from 'react'
import { ContestCard, useContests, type ContestSummary } from '@/entities/contest'
import {
  Button,
  EmptyState,
  ErrorState,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
} from '@/shared/ui'

export function ContestBrowser({
  renderAction,
}: {
  renderAction?: (contest: ContestSummary) => ReactNode
}) {
  const [filters, setFilters] = useQueryStates(
    {
      keyword: parseAsString.withDefault(''),
      status: parseAsStringLiteral(['upcoming', 'ongoing', 'ended'] as const),
      mode: parseAsStringLiteral(['online', 'offline', 'hybrid'] as const),
      sort: parseAsStringLiteral(['deadline', 'start'] as const).withDefault('deadline'),
      page: parseAsInteger.withDefault(1),
    },
    { history: 'replace', shallow: false },
  )
  const query = useContests({
    keyword: filters.keyword || undefined,
    status: filters.status ?? undefined,
    mode: filters.mode ?? undefined,
    sort: filters.sort,
    page: Math.max(1, filters.page),
    page_size: 20,
  })
  return (
    <section aria-labelledby="contest-browser-title" className="min-w-0 space-y-5 py-8">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 id="contest-browser-title" className="text-2xl font-bold text-ink">
          全部赛事
        </h2>
        {query.data && <span className="text-xs text-muted">共 {query.data.total} 场</span>}
      </header>
      <div className="grid gap-3 sm:grid-cols-3">
        <Input
          type="search"
          aria-label="搜索赛事"
          placeholder="搜索赛事名称"
          value={filters.keyword}
          className="w-full sm:col-span-3"
          onChange={(event) => void setFilters({ keyword: event.target.value, page: 1 })}
        />
        <Select
          value={filters.status ?? 'all'}
          onValueChange={(value) =>
            void setFilters({
              status: value === 'all' ? null : (value as 'upcoming' | 'ongoing' | 'ended'),
              page: 1,
            })
          }
        >
          <SelectTrigger aria-label="赛事状态" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部状态</SelectItem>
            <SelectItem value="upcoming">即将开始</SelectItem>
            <SelectItem value="ongoing">进行中</SelectItem>
            <SelectItem value="ended">已结束</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={filters.mode ?? 'all'}
          onValueChange={(value) =>
            void setFilters({
              mode: value === 'all' ? null : (value as 'online' | 'offline' | 'hybrid'),
              page: 1,
            })
          }
        >
          <SelectTrigger aria-label="参赛形式" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部形式</SelectItem>
            <SelectItem value="online">线上</SelectItem>
            <SelectItem value="offline">线下</SelectItem>
            <SelectItem value="hybrid">混合</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={filters.sort}
          onValueChange={(value) =>
            void setFilters({ sort: value as 'deadline' | 'start', page: 1 })
          }
        >
          <SelectTrigger aria-label="排序" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="deadline">截止优先</SelectItem>
            <SelectItem value="start">开赛时间</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {query.isPending ? (
        <Skeleton />
      ) : query.isError ? (
        <ErrorState error={query.error} retry={() => void query.refetch()} />
      ) : query.data.items.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="grid gap-3">
          {query.data.items.map((contest) => (
            <ContestCard key={contest.id} contest={contest} action={renderAction?.(contest)} />
          ))}
        </div>
      )}
      {query.data && query.data.total > 20 && (
        <nav aria-label="赛事分页" className="flex items-center justify-between gap-3">
          <Button
            disabled={filters.page <= 1}
            onClick={() => void setFilters({ page: filters.page - 1 })}
          >
            上一页
          </Button>
          <span className="text-xs text-muted">第 {Math.max(1, filters.page)} 页</span>
          <Button
            disabled={filters.page * 20 >= query.data.total}
            onClick={() => void setFilters({ page: filters.page + 1 })}
          >
            下一页
          </Button>
        </nav>
      )}
    </section>
  )
}
