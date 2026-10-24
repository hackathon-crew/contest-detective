import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import ReactMarkdown from 'react-markdown'
import { X } from 'lucide-react'

import type { MatchItem, Profile, PublicUser } from '@/shared/api'
import { formatDate } from '@/shared/lib/date'
import {
  Badge,
  Button,
  Dialog,
  ErrorState,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/ui'
import { confirmAccountProfile, githubDraft, matchProfile, resumeDraft } from './api'
import { loadConfirmedProfile, mergeDraft, saveConfirmedProfile } from './state'

function Tags({
  label,
  values,
  onChange,
  disabled,
}: {
  label: string
  values: string[]
  onChange: (value: string[]) => void
  disabled: boolean
}) {
  const id = useId()
  const [value, setValue] = useState('')
  function add(event: FormEvent) {
    event.preventDefault()
    const next = value.trim()
    if (next && values.length < 50 && !values.includes(next)) onChange([...values, next])
    setValue('')
  }
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="text-sm">
        {label}
      </label>
      <div className="flex flex-wrap gap-2">
        {values.map((item) => (
          <Badge key={item} variant="outline" className="max-w-full gap-1 rounded-lg text-sm">
            <span className="min-w-0 whitespace-normal break-all">{item}</span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`移除${label} ${item}`}
              disabled={disabled}
              onClick={() => onChange(values.filter((value) => value !== item))}
            >
              <X className="size-4" strokeWidth={1.5} />
            </Button>
          </Badge>
        ))}
      </div>
      <form onSubmit={add} className="flex gap-2">
        <Input
          id={id}
          aria-label={`添加${label}`}
          className="h-10 rounded-xl"
          value={value}
          maxLength={80}
          disabled={disabled}
          onChange={(event) => setValue(event.target.value)}
        />
        <Button
          type="submit"
          variant="outline"
          disabled={disabled || !value.trim() || values.length >= 50}
          aria-label={`添加${label}`}
        >
          添加
        </Button>
      </form>
    </div>
  )
}

const modes = [
  ['online', '线上'],
  ['offline', '线下'],
  ['hybrid', '混合'],
] as const
const days = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']

interface ProfileMatchDialogProps {
  open?: boolean
  user?: PublicUser | null
  onClose: () => void
  onConfirmed?: (profile: Profile) => void
}

export function ProfileMatchDialog({ open = true, ...props }: ProfileMatchDialogProps) {
  return (
    <Dialog open={open} title="按我的情况挑比赛" onClose={props.onClose}>
      <ProfileMatchForm {...props} active={open} />
    </Dialog>
  )
}

/* 表单由弹窗内容托管，退场结束才卸载；下次打开仍从已确认的画像开始。 */
function ProfileMatchForm({
  active,
  user = null,
  onClose,
  onConfirmed,
}: Omit<ProfileMatchDialogProps, 'open'> & { active: boolean }) {
  const [profile, setProfile] = useState<Profile>(
    () => user?.profile ?? loadConfirmedProfile() ?? {},
  )
  const [username, setUsername] = useState(profile.github ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [errorLocation, setErrorLocation] = useState<'source' | 'match'>('source')
  const [results, setResults] = useState<MatchItem[] | null>(null)
  const resultsRef = useRef<HTMLElement | null>(null)
  useEffect(() => {
    if (results !== null) resultsRef.current?.scrollIntoView?.({ block: 'start' })
  }, [results])
  const controller = useRef<AbortController | null>(null)
  useEffect(() => {
    if (!active) controller.current?.abort()
  }, [active])
  useEffect(() => () => controller.current?.abort(), [])
  const id = useId()

  async function perform(
    action: (signal: AbortSignal) => Promise<void>,
    location: 'source' | 'match' = 'match',
  ) {
    controller.current?.abort()
    const active = new AbortController()
    controller.current = active
    setError(null)
    setErrorLocation(location)
    setBusy(true)
    try {
      await action(active.signal)
    } catch (cause) {
      if (!active.signal.aborted) setError(cause)
    } finally {
      if (!active.signal.aborted) setBusy(false)
    }
  }

  function draft(next: Profile) {
    setProfile(next)
    setResults(null)
  }

  function confirmProfile() {
    void perform(async (signal) => {
      const confirmed = user ? (await confirmAccountProfile(profile, signal)).profile : profile
      if (!user) saveConfirmedProfile(confirmed)
      onConfirmed?.(confirmed)
      setResults(await matchProfile(confirmed, signal))
    })
  }

  return (
    <>
      <div className="space-y-6" aria-busy={busy}>
        <div className="grid gap-4 border-b border-rule pb-6 sm:grid-cols-2">
          <form
            className="space-y-2"
            onSubmit={(event) => {
              event.preventDefault()
              void perform(
                async (signal) =>
                  draft(mergeDraft(profile, await githubDraft(username.trim(), signal), 'github')),
                'source',
              )
            }}
          >
            <label htmlFor={`${id}-github`} className="text-sm">
              GitHub 用户名
            </label>
            <Input
              id={`${id}-github`}
              className="h-10 rounded-xl"
              value={username}
              maxLength={39}
              disabled={busy}
              onChange={(event) => setUsername(event.target.value)}
            />
            <Button type="submit" variant="outline" disabled={busy || !username.trim()}>
              读取 GitHub
            </Button>
          </form>
          <div className="space-y-2">
            <label htmlFor={`${id}-resume`} className="text-sm">
              上传简历
            </label>
            <Input
              id={`${id}-resume`}
              type="file"
              className="h-10 rounded-xl"
              accept=".pdf,.docx,.txt"
              disabled={busy}
              onChange={(event) => {
                const file = event.target.files?.[0]
                event.target.value = ''
                if (file)
                  void perform(
                    async (signal) =>
                      draft(mergeDraft(profile, await resumeDraft(file, signal), 'resume')),
                    'source',
                  )
              }}
            />
            <p className="text-xs text-muted">PDF、DOCX 或 TXT，最大 2MiB。解析后丢弃原文。</p>
          </div>
        </div>
        {busy && errorLocation === 'source' && (
          <p role="status" className="text-sm text-muted">
            正在生成画像
          </p>
        )}
        {error != null && errorLocation === 'source' && <ErrorState error={error} />}
        <div className="space-y-4">
          <h3 className="text-2xl font-bold">确认你的画像</h3>
          {profile.github && (
            <p className="break-words text-xs text-muted">
              GitHub：{profile.github} · {profile.github_evidence?.length ?? 0} 个公开仓库
            </p>
          )}
          {!!Object.keys(profile.language_repo_share ?? {}).length && (
            <p className="text-xs text-muted">
              仓库主语言：
              {Object.entries(profile.language_repo_share ?? {})
                .map(([language, share]) => `${language} ${Math.round(share * 100)}%`)
                .join(' · ')}
            </p>
          )}
          {profile.github_last_active_at && (
            <p className="text-xs text-muted">
              最近推送：{formatDate(profile.github_last_active_at, 'datetime', true)}
            </p>
          )}
          <Tags
            label="技能"
            values={profile.skills ?? []}
            disabled={busy}
            onChange={(skills) => draft({ ...profile, skills })}
          />
          <Tags
            label="兴趣方向"
            values={profile.topics ?? []}
            disabled={busy}
            onChange={(topics) => draft({ ...profile, topics })}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm" htmlFor={`${id}-identity`}>
                身份
              </label>
              <Select
                value={profile.identity_kind ?? 'any'}
                disabled={busy}
                onValueChange={(value) =>
                  draft({
                    ...profile,
                    identity_kind: value === 'any' ? null : (value as 'student' | 'professional'),
                  })
                }
              >
                <SelectTrigger id={`${id}-identity`} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">未填写</SelectItem>
                  <SelectItem value="student">在校生</SelectItem>
                  <SelectItem value="professional">职场开发者</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label htmlFor={`${id}-city`} className="text-sm">
                城市
              </label>
              <Input
                id={`${id}-city`}
                className="h-10 rounded-xl"
                value={profile.city ?? ''}
                maxLength={80}
                disabled={busy}
                onChange={(event) => draft({ ...profile, city: event.target.value.trim() || null })}
              />
            </div>
          </div>
          {profile.identity != null && (
            <div className="space-y-2">
              <label htmlFor={`${id}-identity-text`} className="text-sm">
                身份信息
              </label>
              <Input
                id={`${id}-identity-text`}
                className="h-10 rounded-xl"
                maxLength={500}
                value={profile.identity}
                disabled={busy}
                onChange={(event) => draft({ ...profile, identity: event.target.value || null })}
              />
            </div>
          )}
          <fieldset className="space-y-2">
            <legend className="text-sm">参与形式</legend>
            <div className="flex flex-wrap gap-2">
              {modes.map(([mode, label]) => {
                const checked = profile.preferred_modes?.includes(mode) ?? false
                return (
                  <Button
                    key={mode}
                    type="button"
                    variant={checked ? 'default' : 'outline'}
                    size="sm"
                    aria-pressed={checked}
                    disabled={busy}
                    onClick={() =>
                      draft({
                        ...profile,
                        preferred_modes: checked
                          ? profile.preferred_modes?.filter((value) => value !== mode)
                          : [...(profile.preferred_modes ?? []), mode],
                      })
                    }
                  >
                    {label}
                  </Button>
                )
              })}
            </div>
          </fieldset>
          <fieldset className="space-y-2">
            <legend className="text-sm">每周可参加</legend>
            <div className="flex flex-wrap gap-2">
              {days.map((label, day) => {
                const weekdays = profile.availability?.weekdays ?? []
                const checked = weekdays.includes(day)
                return (
                  <Button
                    key={day}
                    type="button"
                    variant={checked ? 'default' : 'outline'}
                    size="sm"
                    aria-pressed={checked}
                    disabled={busy}
                    onClick={() =>
                      draft({
                        ...profile,
                        availability: {
                          ...profile.availability,
                          weekdays: checked
                            ? weekdays.filter((value) => value !== day)
                            : [...weekdays, day],
                        },
                      })
                    }
                  >
                    {label}
                  </Button>
                )
              })}
            </div>
          </fieldset>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label htmlFor={`${id}-days`} className="text-sm">
                最多连续天数
              </label>
              <Input
                id={`${id}-days`}
                className="h-10 rounded-xl"
                type="number"
                min={1}
                max={30}
                value={profile.availability?.max_consecutive_days ?? ''}
                disabled={busy}
                onChange={(event) =>
                  draft({
                    ...profile,
                    availability: {
                      ...profile.availability,
                      max_consecutive_days: event.target.value ? Number(event.target.value) : null,
                    },
                  })
                }
              />
            </div>
            <div className="space-y-2">
              <label htmlFor={`${id}-time`} className="text-sm">
                时间说明
              </label>
              <Input
                id={`${id}-time`}
                className="h-10 rounded-xl"
                value={profile.available_time ?? ''}
                maxLength={500}
                disabled={busy}
                onChange={(event) =>
                  draft({ ...profile, available_time: event.target.value || null })
                }
              />
            </div>
          </div>
          {!!profile.availability?.windows?.length && (
            <div className="space-y-2">
              {profile.availability.windows.map((window, index) => (
                <div
                  key={`${window.start_at}-${index}`}
                  className="flex flex-wrap items-center gap-2 text-sm"
                >
                  <span>
                    {formatDate(window.start_at)} 至 {formatDate(window.end_at)}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      draft({
                        ...profile,
                        availability: {
                          ...profile.availability,
                          windows: profile.availability?.windows?.filter((_, i) => i !== index),
                        },
                      })
                    }
                  >
                    移除
                  </Button>
                </div>
              ))}
            </div>
          )}
          <div className="flex flex-wrap gap-3">
            <Button type="button" disabled={busy} onClick={confirmProfile}>
              {busy ? '正在处理' : '确认并挑比赛'}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                draft({})
                setUsername('')
                setError(null)
              }}
            >
              清空草稿
            </Button>
          </div>
        </div>
        {error != null && errorLocation === 'match' && <ErrorState error={error} />}
        {results !== null && (
          <section ref={resultsRef} className="space-y-4 border-t border-rule pt-6">
            <h3 className="text-2xl font-bold">推荐比赛</h3>
            {results.length === 0 ? (
              <p className="text-sm text-muted">没有找到符合条件的比赛，调整画像后再试。</p>
            ) : (
              <div className="divide-y divide-rule">
                {results.map((item) => (
                  <article key={item.contest.id} className="space-y-2 py-4 first:pt-0">
                    <Link
                      to={`/contests/${encodeURIComponent(item.contest.id)}`}
                      onClick={onClose}
                      className="block break-words text-base font-semibold hover:underline"
                    >
                      {item.contest.name}
                    </Link>
                    <div className="space-y-2 break-words text-sm leading-relaxed">
                      <ReactMarkdown
                        components={{
                          a: ({ children, ...props }) => (
                            <a
                              {...props}
                              className="underline underline-offset-4"
                              target="_blank"
                              rel="noreferrer"
                            >
                              {children}
                            </a>
                          ),
                        }}
                      >
                        {item.reason}
                      </ReactMarkdown>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        )}
      </div>
    </>
  )
}
