import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useCurrentUser } from '@/entities/user'
import { useFollows } from '@/features/follow'
import { contestCity, libraryDate, modeNames, normalizedPrize } from '@/entities/contest'
import { apiClient } from '@/shared/api'
import type { CalendarRead, FollowRead, PushRead } from '@/shared/api/generated'
import { copy, failure, Ic, Row, useNotice } from './components'
import { WatchPanel } from './watch-panel'

export function FollowsPanel() {
  const { data: user } = useCurrentUser(),
    follows = useFollows(),
    notice = useNotice()
  const calendar = useQuery({
    queryKey: ['account-calendar', user?.id],
    enabled: !!user,
    queryFn: ({ signal }) => apiClient.request<CalendarRead>('/account/calendar', { signal }),
  })
  const push = useQuery({
    queryKey: ['account-push', user?.id],
    enabled: !!user,
    queryFn: ({ signal }) => apiClient.request<PushRead>('/account/push', { signal }),
  })
  const [endedOpen, setEndedOpen] = useState(false),
    [exiting, setExiting] = useState<FollowRead[]>([]),
    [error, setError] = useState('')
  const rows = [
    ...follows.rows,
    ...exiting.filter((row) => !follows.rows.some((other) => other.contest.id === row.contest.id)),
  ]
    .map((row) => {
      const date = libraryDate(row.contest)
      return { row, due: date?.start ? null : date }
    })
    .sort((a, b) => (a.due?.left ?? 999) - (b.due?.left ?? 999))
  const live = rows.filter(
      ({ row, due }) => row.contest.status !== 'ended' && (!due || due.left >= 0),
    ),
    ended = rows.filter((row) => !live.includes(row)),
    soon = live.filter(({ due }) => due && due.left <= 7).length
  async function remind(row: FollowRead) {
    try {
      await follows.setReminders(row.contest.id, !row.reminders)
      notice(
        row.reminders
          ? `不再提醒「${row.contest.name}」的截止`
          : `会在截止前提醒「${row.contest.name}」`,
      )
    } catch (e) {
      setError(failure(e))
    }
  }
  async function remove(row: FollowRead) {
    setExiting((current) => [...current, row])
    setError('')
    try {
      await Promise.all([
        follows.setFollow(row.contest.id, false),
        new Promise((resolve) =>
          setTimeout(
            resolve,
            window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 0 : 240,
          ),
        ),
      ])
      setExiting((current) => current.filter((item) => item.contest.id !== row.contest.id))
      notice('已取消关注', {
        label: '撤销',
        run: () => {
          void follows
            .setFollow(row.contest.id, true, row.reminders)
            .catch((e) => setError(failure(e)))
        },
      })
    } catch (e) {
      setExiting((current) => current.filter((item) => item.contest.id !== row.contest.id))
      setError(failure(e))
    }
  }
  function items(values: typeof rows) {
    return values.map(({ row, due }) => {
      const c = row.contest,
        closed = !live.some((item) => item.row.contest.id === c.id),
        days = [...(push.data?.settings.reminder_days ?? [])].sort((a, b) => b - a)
      const reminder = closed
        ? ''
        : !row.reminders
          ? '不提醒'
          : days.length
            ? `截止前 ${days.join('、')} 天提醒`
            : '只在信息变动时提醒'
      const meta = [
        c.fields.mode?.value === 'hybrid' ? '线上+线下' : modeNames[c.fields.mode?.value ?? ''],
        contestCity(c),
        normalizedPrize(c.fields.prize?.value),
      ]
        .filter(Boolean)
        .join(' · ')
      const near = !due
        ? ''
        : closed
          ? '已截止'
          : due.left === 0
            ? '今天截止'
            : `还有 ${due.left} 天`
      return (
        <li
          className={
            'fol' +
            (closed ? ' ended' : '') +
            (exiting.some((item) => item.contest.id === c.id) ? ' out' : '')
          }
          key={c.id}
        >
          {c.cover_url ? (
            <img className="f-cover" src={c.cover_url} alt="" loading="lazy" />
          ) : (
            <span className="f-cover" />
          )}
          <div className="f-main">
            <p className="f-name">{c.name}</p>
            <p className="f-meta">{meta}</p>
            {reminder && <p className="f-rem">{reminder}</p>}
          </div>
          <div className="f-date">
            {due ? (
              <>
                <b>
                  {+due.day.slice(5, 7)}月{+due.day.slice(8, 10)}日
                </b>
                <span className="k">
                  {due.field === 'registration_deadline'
                    ? '报名截止'
                    : due.field === 'submission_deadline'
                      ? '作品提交截止'
                      : '截止'}
                </span>
              </>
            ) : (
              <b className="f-unknown">没写截止</b>
            )}
            {near && (
              <span className={'soon' + (!closed && due && due.left <= 2 ? ' hot' : '')}>
                {near}
              </span>
            )}
          </div>
          <div className="f-acts">
            {!closed && (
              <button
                className="iconbtn bell"
                type="button"
                aria-pressed={row.reminders}
                aria-label={(row.reminders ? '关掉' : '打开') + '这场的截止提醒'}
                disabled={follows.pending}
                onClick={() => void remind(row)}
              >
                <Ic name={row.reminders ? 'bell' : 'bell-off'} />
              </button>
            )}
            <button
              className="iconbtn unfollow"
              type="button"
              aria-label="取消关注"
              disabled={follows.pending}
              onClick={() => void remove(row)}
            >
              <Ic name="bookmark" />
            </button>
          </div>
        </li>
      )
    })
  }
  return (
    <section
      className="panel"
      id="p-follows"
      aria-labelledby="h-follows"
      aria-busy={follows.pending}
    >
      <div className="p-head">
        <div>
          <h2 id="h-follows">关注的比赛</h2>
          <p className="p-lead">
            {follows.pending && !rows.length
              ? '正在读取关注的比赛…'
              : live.length
                ? `关注了 ${live.length} 场还没截止的比赛${soon ? `，${soon} 场 7 天内截止` : ''}。`
                : '还没有关注的比赛。在赛事库里点书签就会出现在这里。'}
          </p>
        </div>
      </div>
      {(follows.error || error) && (
        <p className="grp-note" role="alert">
          {error || follows.error}
        </p>
      )}
      <ul id="fols">{items(live)}</ul>
      {ended.length > 0 && (
        <div id="fols-ended-wrap">
          <button
            className="ended-toggle"
            type="button"
            aria-expanded={endedOpen}
            onClick={() => setEndedOpen(!endedOpen)}
          >
            已截止 {ended.length} 场<Ic name="chev-down" />
          </button>
          <ul hidden={!endedOpen}>{items(ended)}</ul>
        </div>
      )}
      <WatchPanel followedIds={follows.rows.map((row) => row.contest.id)} />
      <div className="grp">
        <div className="grp-head">
          <h3>订阅到日历</h3>
        </div>
        <Row label="订阅链接" small="Apple 日历、Google 日历、Outlook 都能用">
          <div className="copyrow">
            <input
              className="inp"
              readOnly
              value={calendar.data?.url ?? ''}
              aria-label="日历订阅链接"
            />
            <button
              className="btn btn-outline"
              type="button"
              disabled={!calendar.data}
              onClick={() => void copy(calendar.data!.url, notice)}
            >
              <Ic name="copy" />
              复制
            </button>
          </div>
          <p className="field-msg">关注的比赛的截止日期会出现在你的日历里，取消关注后自动移除。</p>
          {calendar.error && (
            <p className="field-msg err" role="alert">
              {failure(calendar.error)}
            </p>
          )}
        </Row>
      </div>
    </section>
  )
}
