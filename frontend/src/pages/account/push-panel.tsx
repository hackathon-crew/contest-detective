import { useState } from 'react'
import { Link } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCurrentUser } from '@/entities/user'
import { apiClient } from '@/shared/api'
import type {
  MailPreview,
  MailRead,
  PushRead,
  PushSettings,
  TrackRead,
  TrackingConditions,
} from '@/shared/api/generated'
import { Chips, failure, Ic, Row, Segments, Switch, useNotice } from './components'
import { AccountModal } from './modal'
const wd = '一二三四五六日'
function dateParts(value: string) {
  return Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(new Date(value))
      .map((p) => [p.type, p.value]),
  )
}
function clock(value: string) {
  const p = dateParts(value),
    day = new Date(`${p.year}-${p.month}-${p.day}T00:00:00Z`)
  return `${+p.month!}月${+p.day!}日 周${wd[(day.getUTCDay() + 6) % 7]} ${p.hour}:${p.minute}`
}
function nextLabel(value: string) {
  const p = dateParts(value),
    today = dateParts(new Date().toISOString()),
    day = `${p.year}-${p.month}-${p.day}`,
    now = `${today.year}-${today.month}-${today.day}`,
    left = Math.round((Date.parse(day) - Date.parse(now)) / 864e5)
  if (left === 0) return `今天 ${p.hour}:${p.minute}`
  if (left === 1) return `明天（${+p.month!}月${+p.day!}日）`
  return `${+p.month!}月${+p.day!}日（周${wd[(new Date(day + 'T00:00:00Z').getUTCDay() + 6) % 7]}）`
}

function tags(q: TrackingConditions) {
  return [
    q.city,
    ...(q.library?.cities ?? []),
    ...(q.library?.modes ?? []).map(
      (m) => ({ online: '线上', offline: '线下', hybrid: '线上+线下' })[m],
    ),
    q.library?.keyword && `含「${q.library.keyword}」`,
    q.library?.prize && '写明奖金',
    q.library?.official && '截止时间对过原文',
    q.library?.mine && '我关注的',
    q.library?.date,
    q.library?.due &&
      q.library.due !== 'all' &&
      { '0': '今天截止', '7': '7 天内', '30': '30 天内', later: '30 天以后', none: '没写截止时间' }[
        q.library.due
      ],
    q.library?.status &&
      q.library.status !== 'all' &&
      { upcoming: '即将开始', ongoing: '进行中', ended: '已结束' }[q.library.status],
    q.library?.date_from && `${q.library.date_from.slice(0, 10)} 起`,
    q.library?.date_to && `${q.library.date_to.slice(0, 10)} 前`,
    ...(q.modes ?? []).map((m) => ({ online: '线上', offline: '线下', hybrid: '线上+线下' })[m]),
    ...(q.topics ?? []),
    ...(q.keywords ?? []).map((t) => `含「${t}」`),
    q.has_prize && '写明奖金',
    q.deadline_from && `${q.deadline_from} 起截止`,
    q.deadline_to && `${q.deadline_to} 前截止`,
  ].filter(Boolean)
}
export function PushPanel() {
  const { data: user } = useCurrentUser(),
    client = useQueryClient(),
    notice = useNotice()
  const key = ['account-push', user?.id],
    tracksKey = ['account-tracks', user?.id],
    historyKey = ['account-mail', user?.id]
  const push = useQuery({
    queryKey: key,
    enabled: !!user,
    queryFn: ({ signal }) => apiClient.request<PushRead>('/account/push', { signal }),
  })
  const tracks = useQuery({
    queryKey: tracksKey,
    enabled: !!user,
    queryFn: ({ signal }) => apiClient.request<TrackRead[]>('/account/tracks', { signal }),
  })
  const history = useQuery({
    queryKey: historyKey,
    enabled: !!user,
    queryFn: ({ signal }) => apiClient.request<MailRead[]>('/account/push/history', { signal }),
  })
  const [error, setError] = useState(''),
    [input, setInput] = useState(''),
    [parsing, setParsing] = useState(''),
    [mail, setMail] = useState<MailPreview | null>(null),
    [mailOpen, setMailOpen] = useState(false),
    [busy, setBusy] = useState('')
  const save = useMutation({
    mutationFn: (settings: PushSettings) =>
      apiClient.request<PushRead>('/account/push', { method: 'PUT', json: settings }),
    onSuccess: (data) => {
      client.setQueryData(key, data)
      setError('')
    },
    onError: (e) => setError(failure(e)),
  })
  if (!push.data)
    return (
      <section className="panel" aria-busy={push.isPending}>
        <h2>比赛推送</h2>
        <p className="p-lead" role={push.error ? 'alert' : undefined}>
          {push.error ? failure(push.error) : '正在读取推送设置…'}
        </p>
      </section>
    )
  const state = push.data,
    s = state.settings
  function update(values: Partial<PushSettings>) {
    save.mutate({ ...s, ...values })
  }
  async function run(kind: string, action: () => Promise<void>) {
    setBusy(kind)
    setError('')
    try {
      await action()
    } catch (e) {
      setError(failure(e))
    } finally {
      setBusy('')
    }
  }
  async function test() {
    await run('test', async () => {
      await apiClient.request('/account/push/test', { method: 'POST' })
      await client.invalidateQueries({ queryKey: historyKey })
      notice(`测试邮件已发到 ${state.email}`)
      setMailOpen(false)
    })
    await client.invalidateQueries({ queryKey: historyKey })
  }
  async function preview() {
    await run('preview', async () => {
      setMail(await apiClient.request<MailPreview>('/account/push/preview'))
      setMailOpen(true)
    })
  }
  async function track() {
    const text = input.trim()
    if (!text || parsing) return
    setParsing(text)
    setInput('')
    setError('')
    try {
      await apiClient.request('/account/tracks', { method: 'POST', json: { text } })
      await Promise.all([
        client.invalidateQueries({ queryKey: tracksKey }),
        client.invalidateQueries({ queryKey: ['account-summary', user?.id] }),
      ])
    } catch (e) {
      setInput(text)
      setError(failure(e))
    } finally {
      setParsing('')
    }
  }
  async function changeTrack(item: TrackRead) {
    await run('track:' + item.id, async () => {
      await apiClient.request('/account/tracks/' + item.id, {
        method: 'PATCH',
        json: { enabled: !item.enabled },
      })
      await client.invalidateQueries({ queryKey: tracksKey })
    })
  }
  async function removeTrack(item: TrackRead) {
    await run('track:' + item.id, async () => {
      const receipt = await apiClient.request<{ undo_token: string }>(
        '/account/tracks/' + item.id,
        { method: 'DELETE' },
      )
      await Promise.all([
        client.invalidateQueries({ queryKey: tracksKey }),
        client.invalidateQueries({ queryKey: ['account-summary', user?.id] }),
      ])
      notice(`已删除「${item.text}」`, {
        label: '撤销',
        run: () => {
          void run('restore', async () => {
            await apiClient.request('/account/tracks/restore', { method: 'POST', json: receipt })
            await Promise.all([
              client.invalidateQueries({ queryKey: tracksKey }),
              client.invalidateQueries({ queryKey: ['account-summary', user?.id] }),
            ])
          })
        },
      })
    })
  }
  const when =
    s.frequency === 'daily'
      ? `每天 ${s.time}`
      : s.frequency === 'weekly'
        ? `每周${wd[s.weekday ?? 0]} ${s.time}`
        : '有新比赛时'
  return (
    <section
      className={'panel' + (!s.enabled ? ' off' : '')}
      id="p-push"
      aria-labelledby="h-push"
      aria-busy={save.isPending}
    >
      <div className="p-head">
        <div>
          <h2 id="h-push">比赛推送</h2>
          <p className="p-lead">
            {!s.enabled ? (
              '邮件推送已关闭，截止提醒也不会发。'
            ) : (
              <>
                {when}发到 <b>{state.email}</b>
                {state.next_send_at
                  ? `，下一封在${nextLabel(state.next_send_at)}`
                  : '，一天最多一封'}
                。
              </>
            )}
          </p>
        </div>
        <Switch
          on={s.enabled ?? false}
          label="邮件推送"
          change={(enabled) => update({ enabled })}
          disabled={save.isPending || (!s.enabled && !state.email_verified)}
        />
      </div>
      {error && (
        <p className="grp-note" role="alert">
          {error}
        </p>
      )}
      {!state.email_verified && (
        <p className="grp-note">
          邮箱未验证，验证后才能开启推送或发送测试邮件。{' '}
          <Link to="/account/settings#email">去验证邮箱</Link>
        </p>
      )}
      <div className="p-acts">
        {!s.enabled && (
          <button
            className="btn btn-primary"
            type="button"
            onClick={() => update({ enabled: true })}
            disabled={save.isPending || !state.email_verified}
          >
            开启邮件推送
          </button>
        )}
        <button className="btn btn-outline" onClick={() => void preview()} disabled={!!busy}>
          <Ic name="mail" />
          预览下一封
        </button>
        <button
          className="btn btn-ghost"
          onClick={() => void test()}
          disabled={!!busy || !state.email_verified}
        >
          <Ic name="send" />
          {busy === 'test' ? '正在发送…' : '发一封测试邮件'}
        </button>
      </div>
      <div inert={save.isPending}>
        <div className="grp dep">
          <div className="grp-head">
            <h3>推送什么</h3>
          </div>
          <div className="trow">
            <div>
              <label htmlFor="pu-new">符合画像的新比赛</label>
              <p>赛事库每天同步，新收录的比赛按你的画像挑过再发</p>
            </div>
            <Switch
              id="pu-new"
              label="符合画像的新比赛"
              on={s.new_matches ?? true}
              change={(new_matches) => update({ new_matches })}
            />
          </div>
          <div className="trow">
            <div>
              <label htmlFor="pu-dl">关注的比赛快截止时提醒</label>
              <div className={'sub' + (!s.deadline_reminders ? ' reminders-off' : '')}>
                <span>截止前</span>
                <Chips
                  values={[
                    [7, '7 天'],
                    [3, '3 天'],
                    [1, '1 天'],
                  ]}
                  selected={s.reminder_days ?? []}
                  change={(reminder_days) => update({ reminder_days })}
                />
                <span>各提醒一次</span>
              </div>
            </div>
            <Switch
              id="pu-dl"
              label="关注的比赛快截止时提醒"
              on={s.deadline_reminders ?? true}
              change={(deadline_reminders) => update({ deadline_reminders })}
            />
          </div>
          <div className="trow">
            <div>
              <label htmlFor="pu-chg">关注的比赛信息有变动</label>
              <p>截止时间、地点或奖金改了，或者几个来源说法对不上</p>
            </div>
            <Switch
              id="pu-chg"
              label="关注的比赛信息有变动"
              on={s.changes ?? true}
              change={(changes) => update({ changes })}
            />
          </div>
          <div className="trow">
            <div>
              <label htmlFor="pu-trk">追踪条件出了新比赛</label>
              <p>下面每组追踪条件，侦探每天查一遍</p>
            </div>
            <Switch
              id="pu-trk"
              label="追踪条件出了新比赛"
              on={s.tracking ?? true}
              change={(tracking) => update({ tracking })}
            />
          </div>
        </div>
        <div className="grp dep">
          <div className="grp-head">
            <h3>什么时候发</h3>
          </div>
          <Row label="频率">
            <Segments
              label="频率"
              values={
                [
                  ['daily', '每天'],
                  ['weekly', '每周'],
                  ['instant', '有新比赛就发'],
                ] as const
              }
              value={s.frequency}
              change={(frequency) => update({ frequency })}
            />
            {s.frequency === 'weekly' && (
              <Segments
                id="pu-wd"
                label="每周哪天"
                values={[...wd].map((d, i) => [i, '周' + d] as const)}
                value={s.weekday}
                change={(weekday) => update({ weekday })}
              />
            )}
          </Row>
          {s.frequency !== 'instant' && (
            <Row label="时间" small="北京时间">
              <span className="sel">
                <select
                  className="inp"
                  aria-label="发送时间"
                  value={s.time}
                  onChange={(e) => update({ time: e.target.value })}
                >
                  {Array.from({ length: 16 }, (_, i) => String(i + 7).padStart(2, '0') + ':00').map(
                    (t) => (
                      <option key={t}>{t}</option>
                    ),
                  )}
                </select>
                <Ic name="chev-down" />
              </span>
            </Row>
          )}
          <Row label="收件邮箱">
            <div className="ctl-line">
              <span>{state.email}</span>
              <span className="muted">{state.email_verified ? '已验证' : '未验证'}</span>
              {!state.email_verified && (
                <Link className="linkbtn" to="/account/settings#email">
                  去验证
                </Link>
              )}
              <Link className="linkbtn" to="/account/settings#email">
                换一个
              </Link>
            </div>
          </Row>
          <p className="grp-note">截止提醒和信息变动不等这个时间，到点就发。</p>
        </div>
      </div>
      <div className="grp dep">
        <div className="grp-head">
          <h3>追踪条件</h3>
          <span className="note">
            {tracks.data?.length ? `${tracks.data.filter((t) => t.enabled).length} 组在推送` : ''}
          </span>
        </div>
        <ul>
          {tracks.data?.length
            ? tracks.data.map((t) => (
                <li className={'track' + (!t.enabled ? ' paused' : '')} key={t.id}>
                  <div className="t-main">
                    <p className="t-name">{t.text}</p>
                    <div className="t-tags">
                      {tags(t.conditions).map((tag) => (
                        <span className="tag" key={String(tag)}>
                          {tag}
                        </span>
                      ))}
                    </div>
                    <div className="t-meta">
                      <span>
                        现在 <b>{t.matched_count}</b> 场符合
                      </span>
                      <span>
                        {!t.enabled
                          ? '已暂停'
                          : t.last_sent_at
                            ? `${clock(t.last_sent_at)}推送过`
                            : '刚加的，明早第一次查'}
                      </span>
                      <Link to={'/contests?tracking=' + encodeURIComponent(t.id)}>看这些比赛</Link>
                    </div>
                  </div>
                  <div className="t-acts">
                    <Switch
                      on={t.enabled}
                      label={`推送「${t.text}」`}
                      disabled={!!busy}
                      change={() => void changeTrack(t)}
                    />
                    <button
                      className="iconbtn"
                      aria-label={`删除「${t.text}」`}
                      disabled={!!busy}
                      onClick={() => void removeTrack(t)}
                    >
                      <Ic name="x" />
                    </button>
                  </div>
                </li>
              ))
            : !tracks.isPending && (
                <li className="t-empty">
                  还没有追踪条件。写一句想找的比赛，侦探每天替你查一遍，有新的就发邮件。
                </li>
              )}
          {parsing && (
            <li className="track">
              <div className="t-main">
                <p className="t-name">{parsing}</p>
                <div className="t-tags">
                  <span className="sk" />
                  <span className="sk" />
                  <span className="sk" />
                </div>
                <div className="t-meta">
                  <span className="reading">
                    <span className="spin" />
                    侦探在拆条件…
                  </span>
                </div>
              </div>
            </li>
          )}
        </ul>
        {tracks.error && (
          <p className="grp-note" role="alert">
            {failure(tracks.error)}
          </p>
        )}
        <form
          className="t-add"
          autoComplete="off"
          onSubmit={(e) => {
            e.preventDefault()
            void track()
          }}
        >
          <input
            className="inp"
            maxLength={80}
            placeholder="写一句想找的比赛，比如：12 月截止的线上 AI 比赛"
            aria-label="新的追踪条件"
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
          <button className="btn btn-outline" type="submit" disabled={!input.trim() || !!parsing}>
            <Ic name="plus" />
            追踪
          </button>
        </form>
        <p className="grp-note">在赛事库里筛好条件，也能直接点「追踪这组条件」加到这里。</p>
      </div>
      <div className="grp">
        <div className="grp-head">
          <h3>推送记录</h3>
          <span className="note">最近 30 天</span>
        </div>
        <ul className="hist">
          {history.data?.map((h) => (
            <li key={h.id}>
              <button
                onClick={() => {
                  setMail(h)
                  setMailOpen(true)
                }}
              >
                <span className="h-date">{clock(h.created_at)}</span>
                <span className="h-subj">
                  {h.subject}
                  <span>
                    {{
                      digest: '每周推送',
                      weekly: '每周推送',
                      daily: '每天推送',
                      instant: '即时推送',
                      reminder: '截止提醒',
                      change: '信息变动',
                      test: '测试邮件',
                    }[h.kind] ?? h.kind}
                  </span>
                </span>
                <span className="h-st">
                  {
                    {
                      sent: '已发送',
                      delivered: '已送达',
                      sending: '发送中',
                      failed: '发送失败',
                      bounced: '已退回',
                    }[h.status]
                  }
                </span>
              </button>
            </li>
          ))}
        </ul>
        {!history.isPending && !history.data?.length && <p className="t-empty">还没有推送记录。</p>}
        {history.error && (
          <p className="grp-note" role="alert">
            {failure(history.error)}
          </p>
        )}
      </div>
      <AccountModal open={mailOpen} close={() => setMailOpen(false)} titleId="mail-subj">
        <div className="mail-head">
          <h3 id="mail-subj">{mail?.subject}</h3>
          <span>发件人：{mail?.sender}</span>
          <span>收件人：{mail?.recipient}</span>
        </div>
        <div className="mail-body" dangerouslySetInnerHTML={{ __html: mail?.html ?? '' }} />
        <div className="mail-acts">
          <button className="btn btn-ghost" onClick={() => setMailOpen(false)}>
            关闭
          </button>
          <button
            className="btn btn-outline"
            disabled={!!busy || !state.email_verified}
            onClick={() => void test()}
          >
            <Ic name="send" />
            发到我的邮箱
          </button>
        </div>
      </AccountModal>
    </section>
  )
}
