import { useEffect, useRef, useState } from 'react'
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import { useCurrentUser } from '@/entities/user'
import { dateFields, fieldNames, formatDate, safeUrl } from '@/entities/contest'
import { apiClient } from '@/shared/api'
import type { FieldValue, NotificationRead, StatusRead, WatchRead } from '@/shared/api/generated'
import { failure, Row, Switch } from './components'

const states: Record<StatusRead['state'], string> = {
  paused: '已暂停盯梢',
  scheduler_paused: '订阅已开启，自动检查暂停',
  scheduled: '已开启盯梢',
  no_source: '暂无可检查的来源',
}
const outcomes = {
  changed: '发现变化',
  unchanged: '未发现字段变化',
  failed: '检查失败',
  no_source: '没有可检查的来源，未抓取页面',
}
const levels = {
  official: '官方原文',
  reposted: '转载',
  conflict: '说法不一',
  not_found: '未核实',
}
function time(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? '时间未知'
    : new Intl.DateTimeFormat('zh-CN', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }).format(date)
}
function Time({ value }: { value: string }) {
  return <time dateTime={value}>{time(value)}</time>
}
function stable(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']'
  if (value && typeof value === 'object') {
    return (
      '{' +
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => JSON.stringify(key) + ':' + stable(item))
        .join(',') +
      '}'
    )
  }
  return JSON.stringify(value) ?? 'null'
}
function Evidence({ label, field, name }: { label: string; field?: FieldValue; name: string }) {
  const value =
    field?.value && dateFields.includes(name)
      ? formatDate(field.value, field.precision, true)
      : (field?.value ?? '未记录')
  const sources = (field?.sources ?? []).filter((source) => safeUrl(source.url))
  return (
    <div className="min-w-0 max-w-full [overflow-wrap:anywhere]">
      <p className="field-msg">
        {label}：{value}
        {field?.value && ` · ${sources.length ? levels[field.level] : '未核实'}`}
      </p>
      {sources.length > 0 && (
        <ul className="t-meta" aria-label={label + '来源'}>
          {sources.map((source, index) => (
            <li className="min-w-0 max-w-full" key={source.url + ':' + index}>
              <a href={safeUrl(source.url)} target="_blank" rel="noopener noreferrer">
                {source.title || source.site || new URL(source.url).hostname}
              </a>
              {' · ' + (source.is_official ? '官方' : '转载')}
              {source.stale && ' · 旧来源'}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
function Changes({ notification }: { notification: NotificationRead }) {
  const { before, after } = notification.change
  if (!before || !after)
    return <p className="field-msg">这条记录缺少完整前后证据，无法展示变化。</p>
  const beforeFields = before.fields ?? {},
    afterFields = after.fields ?? {},
    changed = [...new Set([...Object.keys(beforeFields), ...Object.keys(afterFields)])].filter(
      (key) => stable(beforeFields[key]) !== stable(afterFields[key]),
    )
  return (
    <div>
      {before.name !== after.name && (
        <Row label="比赛名称">
          <p className="field-msg">变更前：{before.name}</p>
          <p className="field-msg">变更后：{after.name}</p>
        </Row>
      )}
      {changed.map((key) => (
        <Row key={key} label={fieldNames[key] ?? key}>
          <Evidence label="变更前" name={key} field={beforeFields[key]} />
          <Evidence label="变更后" name={key} field={afterFields[key]} />
        </Row>
      ))}
      {!changed.length && before.name === after.name && (
        <p className="field-msg">这条记录没有可展示的字段变化。</p>
      )}
    </div>
  )
}

export function WatchPanel({ followedIds = [] }: { followedIds?: string[] }) {
  const { data: user } = useCurrentUser()
  // Remount private state when identity changes; never carry another account's pages or actions.
  return user ? (
    <AccountWatch
      key={user.id}
      userId={user.id}
      followKey={JSON.stringify([...followedIds].sort())}
    />
  ) : null
}

function AccountWatch({ userId, followKey }: { userId: string; followKey: string }) {
  const client = useQueryClient(),
    key = ['account-watch', userId, followKey],
    [error, setError] = useState(''),
    [pending, setPending] = useState(''),
    action = useRef<AbortController | null>(null)
  useEffect(
    () => () => {
      action.current?.abort()
    },
    [],
  )
  const watch = useInfiniteQuery({
    queryKey: key,
    initialPageParam: undefined as number | undefined,
    queryFn: ({ signal, pageParam }) =>
      apiClient.request<WatchRead>('/account/watch', {
        signal,
        query: { before_event_id: pageParam },
      }),
    getNextPageParam: (page) =>
      page.has_more_notifications ? page.notifications.at(-1)?.event_id : undefined,
    gcTime: 0,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  })
  const state = watch.data?.pages[0],
    notifications = [
      ...new Map(
        (watch.data?.pages.flatMap((page) => page.notifications ?? []) ?? []).map((item) => [
          item.event_id,
          item,
        ]),
      ).values(),
    ],
    busy = !!pending || watch.isFetching

  async function run(name: string, operation: (signal: AbortSignal) => Promise<unknown>) {
    if (action.current || watch.isFetching) return
    const controller = new AbortController()
    action.current = controller
    setPending(name)
    setError('')
    try {
      await operation(controller.signal)
      if (!controller.signal.aborted) {
        await client.invalidateQueries({ queryKey: key, exact: true })
      }
    } catch (e) {
      if (!controller.signal.aborted) setError(failure(e))
    } finally {
      if (!controller.signal.aborted) {
        action.current = null
        setPending('')
      }
    }
  }
  return (
    <section className="grp" aria-labelledby="h-watch" aria-busy={busy}>
      <div className="grp-head">
        <h3 id="h-watch">比赛盯梢</h3>
        <span className="note">仅当前账号可见 · 时间为北京时间</span>
      </div>
      <p className="grp-note">为关注的比赛单独开启。这里保留有来源的前后变化，不发送邮件。</p>
      {(error || watch.error) && (
        <p className="field-msg err" role="alert">
          {error || failure(watch.error)}
        </p>
      )}
      {watch.isPending ? (
        <p className="t-empty">正在读取盯梢状态…</p>
      ) : !state && watch.error ? (
        <button className="btn btn-ghost btn-sm" type="button" onClick={() => void watch.refetch()}>
          重试读取
        </button>
      ) : (
        <>
          <ul aria-label="关注比赛的盯梢状态">
            {(state?.items ?? []).map((item) => {
              const check = item.last_check,
                source = safeUrl(check?.source_url)
              return (
                <li className="track" key={item.contest_id}>
                  <div className="t-main">
                    <p className="t-name">{item.contest_name}</p>
                    <p className="t-meta">{states[item.state]}</p>
                    <p className="t-meta">
                      {check ? (
                        <>
                          {check.completed_at ? '最近记录：' : '最近尝试：'}
                          <Time value={check.completed_at ?? check.checked_at} />
                          {' · ' + (check.completed_at ? outcomes[check.outcome] : '未完成')}
                          {source && (
                            <a href={source} target="_blank" rel="noopener noreferrer">
                              检查来源
                            </a>
                          )}
                        </>
                      ) : (
                        '尚未实际检查'
                      )}
                    </p>
                    {item.last_success_at && (
                      <p className="t-meta">
                        最近成功检查：
                        <Time value={item.last_success_at} />
                      </p>
                    )}
                    {item.state === 'scheduled' && item.next_check_at && (
                      <p className="t-meta">
                        预计下次：约 <Time value={item.next_check_at} />
                        （随队列调整）
                      </p>
                    )}
                  </div>
                  <Switch
                    on={item.enabled ?? false}
                    label={`盯梢「${item.contest_name}」`}
                    disabled={busy}
                    change={(enabled) =>
                      void run('toggle:' + item.contest_id, (signal) =>
                        apiClient.request<StatusRead>(
                          '/account/watch/' + encodeURIComponent(item.contest_id),
                          { method: 'PUT', json: { enabled }, signal },
                        ),
                      )
                    }
                  />
                </li>
              )
            })}
          </ul>
          {state && !state.items?.length && (
            <p className="t-empty">还没有可盯梢的比赛，先在赛事库关注一场。</p>
          )}
          <div className="grp-head">
            <h3>最近变动</h3>
            <span className="note">
              已加载 {notifications.filter((item) => !item.read_at).length} 条未读
            </span>
          </div>
          <ul aria-label="比赛变动记录">
            {notifications.map((item) => (
              <li key={item.event_id}>
                <div className="track">
                  <div className="t-main">
                    <p className="t-name">
                      {item.change.after?.name ?? item.change.before?.name ?? '比赛变动'}
                    </p>
                    <p className="t-meta">
                      <Time value={item.occurred_at} />
                      <span>{item.read_at ? '已读' : '未读'}</span>
                    </p>
                  </div>
                  {!item.read_at && (
                    <button
                      className="btn btn-ghost btn-sm"
                      type="button"
                      disabled={busy}
                      aria-label={`标记「${item.change.after?.name ?? item.change.before?.name ?? '比赛变动'}」${time(item.occurred_at)}的变动已读`}
                      onClick={() =>
                        void run('read:' + item.event_id, (signal) =>
                          apiClient.request(
                            '/account/watch/notifications/' + item.event_id + '/read',
                            {
                              method: 'POST',
                              signal,
                            },
                          ),
                        )
                      }
                    >
                      {pending === 'read:' + item.event_id ? '保存中…' : '标为已读'}
                    </button>
                  )}
                </div>
                <Changes notification={item} />
              </li>
            ))}
          </ul>
          {state && !notifications.length && (
            <p className="t-empty">暂无变动记录。仅记录开启盯梢之后、保留完整前后证据的变化。</p>
          )}
          <div className="p-acts">
            {state?.has_more && (
              <button
                className="btn btn-outline btn-sm"
                type="button"
                disabled={busy}
                onClick={() =>
                  void run('consume', (signal) =>
                    apiClient.request('/account/watch/consume', { method: 'POST', signal }),
                  )
                }
              >
                {pending === 'consume' ? '正在处理…' : '继续处理待收取变动'}
              </button>
            )}
            {watch.hasNextPage && (
              <button
                className="btn btn-ghost btn-sm"
                type="button"
                disabled={busy}
                onClick={() => {
                  if (!action.current && !watch.isFetching)
                    void watch.fetchNextPage({ cancelRefetch: false })
                }}
              >
                {watch.isFetchingNextPage ? '正在读取…' : '查看更早变动'}
              </button>
            )}
            {state && watch.error && (
              <button
                className="btn btn-ghost btn-sm"
                type="button"
                disabled={busy}
                onClick={() => void watch.refetch()}
              >
                重试读取
              </button>
            )}
          </div>
        </>
      )}
    </section>
  )
}
