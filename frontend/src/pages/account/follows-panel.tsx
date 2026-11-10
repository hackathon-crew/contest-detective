import { PressedToggle } from '@/shared/ui/pressed-toggle'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useCurrentUser } from '@/entities/user'
import { useFollows } from '@/features/follow'
import { monthDay, contestCity, libraryDate, modeNames, normalizedPrize } from '@/entities/contest'
import { apiClient } from '@/shared/api'
import type { CalendarRead, FollowRead, PushRead } from '@/shared/api/generated'
import { copy, failure, Ic, Row, useNotice } from './components'
import { WatchPanel } from './watch-panel'
import { translateSystemText } from '@/shared/i18n'
import { useLocale } from '@/shared/i18n/locale-context'

export function FollowsPanel() {
  const { locale, t } = useLocale()
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
          ? t('不再提醒「{name}」的截止', { name: row.contest.name })
          : t('会在截止前提醒「{name}」', { name: row.contest.name }),
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
          ? t('不提醒')
          : days.length
            ? t(days.length === 1 && days[0] === 1 ? '截止前 1 天提醒' : '截止前 {days} 天提醒', {
                days: days.join(locale === 'en' ? ', ' : '、'),
              })
            : t('只在信息变动时提醒')
      const meta = [
        translateSystemText(
          locale,
          c.fields.mode?.value === 'hybrid'
            ? '线上+线下'
            : (modeNames[c.fields.mode?.value ?? ''] ?? ''),
        ),
        contestCity(c),
        normalizedPrize(c.fields.prize?.value),
      ]
        .filter(Boolean)
        .join(' · ')
      const near = !due
        ? ''
        : closed
          ? t('已截止')
          : due.left === 0
            ? t('今天截止')
            : t(due.left === 1 ? '还有 1 天' : '还有 {days} 天', { days: due.left })
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
                <b>{monthDay(due.day, locale)}</b>
                <span className="k">
                  {due.field === 'registration_deadline'
                    ? t('报名截止')
                    : due.field === 'submission_deadline'
                      ? t('作品提交截止')
                      : t('截止')}
                </span>
              </>
            ) : (
              <b className="f-unknown">{t('没写截止')}</b>
            )}
            {near && (
              <span className={'soon' + (!closed && due && due.left <= 2 ? ' hot' : '')}>
                {near}
              </span>
            )}
          </div>
          <div className="f-acts">
            {!closed && (
              <PressedToggle pressed={row.reminders}>
                <button
                  className="iconbtn bell"
                  type="button"
                  aria-label={t(row.reminders ? '关掉这场的截止提醒' : '打开这场的截止提醒')}
                  disabled={follows.pending}
                  onClick={() => void remind(row)}
                >
                  <Ic name={row.reminders ? 'bell' : 'bell-off'} />
                </button>
              </PressedToggle>
            )}
            <button
              className="iconbtn unfollow"
              type="button"
              aria-label={t('取消关注')}
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
          <h2 id="h-follows">{t('关注的比赛')}</h2>
          <p className="p-lead">
            {follows.pending && !rows.length
              ? t('正在读取关注的比赛…')
              : live.length
                ? t('关注了 {count} 场还没截止的比赛{soon}。', {
                    count: live.length,
                    soon: soon ? t('，{count} 场 7 天内截止', { count: soon }) : '',
                  })
                : t('还没有关注的比赛。在赛事库里点书签就会出现在这里。')}
          </p>
        </div>
      </div>
      {(follows.error || error) && (
        <p className="grp-note" role="alert">
          {translateSystemText(locale, error || follows.error!)}
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
            {t('已截止 {count} 场', { count: ended.length })}
            <Ic name="chev-down" />
          </button>
          <ul hidden={!endedOpen}>{items(ended)}</ul>
        </div>
      )}
      <WatchPanel followedIds={follows.rows.map((row) => row.contest.id)} />
      <div className="grp">
        <div className="grp-head">
          <h3>{t('订阅到日历')}</h3>
        </div>
        <Row label={t('订阅链接')} small={t('Apple 日历、Google 日历、Outlook 都能用')}>
          <div className="copyrow">
            <input
              className="inp"
              readOnly
              value={calendar.data?.url ?? ''}
              aria-label={t('日历订阅链接')}
            />
            <button
              className="btn btn-outline"
              type="button"
              disabled={!calendar.data}
              onClick={() => void copy(calendar.data!.url, notice)}
            >
              <Ic name="copy" />
              {t('复制')}
            </button>
          </div>
          <p className="field-msg">
            {t('关注的比赛的截止日期会出现在你的日历里，取消关注后自动移除。')}
          </p>
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
