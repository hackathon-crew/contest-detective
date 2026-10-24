import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { currentUserKey, useCurrentUser } from '@/entities/user'
import { apiClient } from '@/shared/api'
import type { MatchItem, Profile, PublicUser } from '@/shared/api/generated'
import { Chips, Expand, failure, Ic, Row, Segments, Tags, useNotice } from './components'
import { dirtyFields, mergeDraft, profileSummary } from './profile-state'

const Octopus = lazy(() =>
  import('@/shared/ui/octopus/Octopus').then((m) => ({ default: m.Octopus })),
)
const wd = '一二三四五六日'
const topics = ['教育', '公益', '健康', '金融科技', '区块链', '硬件', '设计']
const modes = [
  ['online', '线上'],
  ['offline', '线下'],
  ['hybrid', '线上+线下'],
] as const
const md = (s: string | undefined | null) =>
  s
    ? new Intl.DateTimeFormat('zh-CN', {
        month: 'numeric',
        day: 'numeric',
        timeZone: 'Asia/Shanghai',
      }).format(new Date(s))
    : ''
export function ProfilePanel() {
  const { data: user } = useCurrentUser()
  if (!user)
    return (
      <section className="panel" aria-busy="true">
        <p className="p-lead">正在读取画像…</p>
      </section>
    )
  return <ProfileEditor key={user.id} user={user} />
}
function ProfileEditor({ user }: { user: PublicUser }) {
  const client = useQueryClient(),
    notice = useNotice()
  const [draft, setDraft] = useState<Profile | null>(user.profile),
    [saved, setSaved] = useState<Profile | null>(user.profile)
  const [github, setGithub] = useState(user.profile.github ?? ''),
    [evidence, setEvidence] = useState(false),
    [busy, setBusy] = useState<string | null>(null),
    [error, setError] = useState('')
  const file = useRef<HTMLInputElement>(null)
  const dirty = draft && saved ? dirtyFields(draft, saved) : 0
  const nextSummary = profileSummary(draft ?? {}),
    [summary, setSummary] = useState(nextSummary),
    [fading, setFading] = useState(false)
  const [mood, setMood] = useState<'search' | 'think' | 'happy'>('search')
  useEffect(() => {
    if (nextSummary === summary) return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setSummary(nextSummary)
      return
    }
    setFading(true)
    const t = setTimeout(() => {
      setSummary(nextSummary)
      setFading(false)
    }, 140)
    return () => clearTimeout(t)
  }, [nextSummary, summary])
  useEffect(() => {
    const el = document.querySelector('.account-root')
    el?.classList.toggle('lift', !!dirty)
    return () => el?.classList.remove('lift')
  }, [dirty])
  useEffect(() => {
    if (!dirty) return
    setMood('think')
    const t = setTimeout(() => setMood('search'), 1600)
    return () => clearTimeout(t)
  }, [draft, dirty])
  useEffect(() => {
    if (mood !== 'happy') return
    const t = setTimeout(() => setMood('search'), 1600)
    return () => clearTimeout(t)
  }, [mood])

  useEffect(() => {
    const prevent = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault()
    }
    window.addEventListener('beforeunload', prevent)
    return () => window.removeEventListener('beforeunload', prevent)
  }, [dirty])
  const [matchDraft, setMatchDraft] = useState<Profile | null>(null)
  useEffect(() => {
    const t = setTimeout(() => setMatchDraft(draft), 240)
    return () => clearTimeout(t)
  }, [draft])
  const matches = useQuery({
    queryKey: ['account-matches', matchDraft],
    enabled: !!matchDraft,
    queryFn: ({ signal }) =>
      apiClient.request<MatchItem[]>('/match', { method: 'POST', json: matchDraft, signal }),
  })
  if (!draft)
    return (
      <section className="panel" aria-busy="true">
        <p className="p-lead">正在读取画像…</p>
      </section>
    )
  const p = draft,
    availability = p.availability ?? { weekdays: [], windows: [], max_consecutive_days: null }
  function field<K extends keyof Profile>(key: K, value: Profile[K]) {
    setDraft((prev) => (prev ? { ...prev, [key]: value } : prev))
  }
  async function run(kind: string, action: () => Promise<void>) {
    setBusy(kind)
    setError('')
    try {
      await action()
    } catch (e) {
      setError(failure(e))
    } finally {
      setBusy(null)
    }
  }
  async function readGithub() {
    await run('github', async () => {
      const next = await apiClient.request<Profile>('/profile/github', {
        method: 'POST',
        json: { username: github },
      })
      setDraft((prev) => mergeDraft(prev!, next))
      notice('读完了，保存前还能改')
    })
  }
  async function readResume(f: File) {
    await run('resume', async () => {
      if (f.size > 2 * 1024 * 1024) throw Error('简历不能超过 2MiB')
      const ext = f.name.split('.').at(-1)?.toLowerCase()
      if (!ext || !['pdf', 'docx', 'txt'].includes(ext)) throw Error('请上传 PDF、DOCX 或 TXT 简历')
      const next = await apiClient.request<Profile>('/profile/resume', {
        method: 'POST',
        body: f,
        query: { filename: 'resume.' + ext },
        headers: { 'content-type': 'application/octet-stream' },
      })
      setDraft((prev) => mergeDraft(prev!, { ...next, resume_name: f.name }))
      notice('简历读完了，已经加到下面')
    })
    if (file.current) file.current.value = ''
  }
  async function save() {
    await run('save', async () => {
      const snapshot = draft!
      const next = await apiClient.request<PublicUser>('/user/profile', {
        method: 'PUT',
        json: snapshot,
      })
      await client.cancelQueries({ queryKey: currentUserKey })
      client.setQueryData(currentUserKey, next)
      setSaved(next.profile)
      setDraft((current) => (current === snapshot ? next.profile : current))
      setMood('happy')
      notice('画像已保存，下一封推送按新画像挑')
    })
  }
  const n = availability.max_consecutive_days ?? 0
  return (
    <>
      <section className="panel" aria-labelledby="h-profile" id="p-profile">
        <div className="p-head">
          <div>
            <h2 id="h-profile">我的画像</h2>
            <p className="p-lead">侦探按这份画像挑比赛、写推荐理由、决定给你推送什么。</p>
          </div>
        </div>
        <div className="hero">
          <div>
            <p className="hero-k">
              侦探眼中的你{dirty > 0 && <span className="edited">· 有改动没保存</span>}
            </p>
            <p className={'hero-sum' + (fading ? ' fade' : '')}>{summary}</p>
            <div className="hero-meta">
              <span>
                按这份画像，现在有 <b>{matches.data?.length ?? '—'}</b> 场合适
              </span>
              <Link to="/contests">
                在赛事库里看 <Ic name="arrow-right" />
              </Link>
            </div>
            {matches.error && (
              <p className="field-msg" role="alert">
                {failure(matches.error)}
              </p>
            )}
          </div>
          <div className="hero-octo" title="点一下它">
            <Suspense fallback={null}>
              <Octopus size={120} mood={busy === 'resume' ? 'read' : busy ? 'think' : mood} />
            </Suspense>
          </div>
        </div>
        <div className="grp">
          <div className="grp-head">
            <h3>从哪里读</h3>
            <span className="note">读出来的内容会合并到下面，保存前都能改</span>
          </div>
          <div className="src-row">
            <div className="src-ic">
              <Ic name="github" large />
            </div>
            <div className="src-main">
              {p.github ? (
                <>
                  <b>{p.github}</b>
                  <p>
                    {p.github_public_repos ?? p.github_evidence?.length ?? 0} 个公开仓库
                    {p.github_last_active_at ? ` · 最近活跃 ${md(p.github_last_active_at)}` : ''}
                    {p.github_read_at ? ` · ${md(p.github_read_at)}读取` : ''}
                  </p>
                </>
              ) : (
                <>
                  <b>GitHub</b>
                  <p>读公开仓库的语言和项目，生成技能和方向</p>
                </>
              )}
            </div>
            <div className="src-acts">
              {p.github ? (
                <>
                  <button
                    className="btn btn-ghost btn-sm"
                    type="button"
                    aria-expanded={evidence}
                    onClick={() => setEvidence(!evidence)}
                  >
                    {evidence ? '收起依据' : '看依据'}
                  </button>
                  <button
                    className="btn btn-ghost btn-sm"
                    disabled={!!busy}
                    onClick={() => void readGithub()}
                  >
                    <Ic name="refresh" />
                    {busy === 'github' ? '正在读公开仓库…' : '重新读取'}
                  </button>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => {
                      field('github', null)
                      setEvidence(false)
                      notice('已断开 GitHub，画像里读出来的技能还留着')
                    }}
                  >
                    断开
                  </button>
                </>
              ) : (
                <form
                  className="src-form"
                  onSubmit={(e) => {
                    e.preventDefault()
                    void readGithub()
                  }}
                >
                  <input
                    className="inp"
                    value={github}
                    onChange={(e) => setGithub(e.target.value)}
                    placeholder="GitHub 用户名"
                    aria-label="GitHub 用户名"
                    autoComplete="off"
                    required
                  />
                  <button className="btn btn-outline btn-sm" disabled={!!busy || !github.trim()}>
                    {busy === 'github' ? '正在读取…' : '读取'}
                  </button>
                </form>
              )}
            </div>
            <Expand open={evidence}>
              <div className="evid">
                <div>
                  <h4>仓库语言</h4>
                  <div className="langs">
                    {Object.entries(p.language_repo_share ?? {}).map(([lang, share]) => (
                      <div className="lang" key={lang}>
                        <span>{lang}</span>
                        <div className="bar">
                          <i style={{ transform: `scaleX(${evidence ? share : 0})` }} />
                        </div>
                        <span>{Math.round(share * 100)}%</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <h4>最近更新的仓库</h4>
                  <div className="repos">
                    {(p.github_evidence ?? []).slice(0, 5).map((repo) => (
                      <a
                        className="repo"
                        href={repo.url}
                        key={repo.url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <div className="repo-top">
                          <b>{repo.name}</b>
                          <span>
                            {[repo.language, md(repo.pushed_at)].filter(Boolean).join(' · ')}
                          </span>
                        </div>
                        <p>{repo.description ?? repo.topics?.join(' · ')}</p>
                      </a>
                    ))}
                  </div>
                </div>
              </div>
            </Expand>
          </div>
          <div className="src-row">
            <div className="src-ic">
              <Ic name="file" large />
            </div>
            <div className="src-main">
              <b>{p.resume_name ?? '简历'}</b>
              <p>
                {busy === 'resume'
                  ? '正在读简历…'
                  : p.resume_name
                    ? '读出来的内容已经加到下面'
                    : 'PDF 或 Word，读出技能、经历和获奖'}
              </p>
            </div>
            <div className="src-acts">
              <button
                className="btn btn-outline btn-sm"
                type="button"
                disabled={!!busy}
                onClick={() => file.current?.click()}
              >
                <Ic name="upload" />
                {p.resume_name ? '换一份' : '导入简历'}
              </button>
              <input
                ref={file}
                type="file"
                accept=".pdf,.docx,.txt"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) void readResume(f)
                }}
              />
            </div>
          </div>
        </div>
        <div className="grp">
          <div className="grp-head">
            <h3>画像内容</h3>
          </div>
          <Row label="身份">
            <Segments
              label="身份"
              values={
                [
                  ['student', '学生'],
                  ['professional', '在职'],
                ] as const
              }
              value={p.identity_kind}
              change={(v) => field('identity_kind', v)}
            />
            <input
              className="inp w-md"
              aria-label="身份说明"
              maxLength={500}
              placeholder="比如：大二，计算机专业"
              value={p.identity ?? ''}
              onChange={(e) => field('identity', e.target.value)}
            />
          </Row>
          <Row label="技能" small="带 GitHub 标的是从仓库读出来的">
            <Tags
              values={p.skills ?? []}
              sources={p.skill_sources}
              placeholder="加一项技能，回车"
              change={(skills) => {
                setDraft((prev) => ({
                  ...prev!,
                  skills,
                  skill_sources: Object.fromEntries(
                    skills.map((s) => [s, prev?.skill_sources?.[s] ?? ['manual']]),
                  ),
                }))
              }}
            />
          </Row>
          <Row label="感兴趣的方向">
            <Tags
              values={p.topics ?? []}
              change={(v) => field('topics', v)}
              placeholder="加一个方向，回车"
            />
            <div className="sugg">
              <span>常见方向</span>
              {topics
                .filter((t) => !p.topics?.includes(t))
                .map((t) => (
                  <button key={t} onClick={() => field('topics', [...(p.topics ?? []), t])}>
                    <Ic name="plus" />
                    {t}
                  </button>
                ))}
            </div>
          </Row>
          <Row label="所在城市" small="线下比赛按这里算远近">
            <input
              className="inp w-sm"
              aria-label="所在城市"
              maxLength={80}
              placeholder="比如：上海"
              value={p.city ?? ''}
              onChange={(e) => field('city', e.target.value.trim() || null)}
            />
          </Row>
          <Row label="参赛形式" small="可以多选">
            <Chips
              values={modes}
              selected={p.preferred_modes ?? []}
              change={(v) => field('preferred_modes', v)}
            />
          </Row>
          <Row label="可投入时间">
            <Chips
              label="哪几天有空"
              values={[...wd].map((d, i) => [i, d] as const)}
              selected={availability.weekdays ?? []}
              change={(weekdays) => field('availability', { ...availability, weekdays })}
            />
            <div className="ctl-line">
              <span>最多连续投入</span>
              <div className="step">
                <button
                  aria-label="少一天"
                  disabled={!n}
                  onClick={() =>
                    field('availability', {
                      ...availability,
                      max_consecutive_days: n > 1 ? n - 1 : null,
                    })
                  }
                >
                  <Ic name="minus" />
                </button>
                <output>{n ? `${n} 天` : '不限'}</output>
                <button
                  aria-label="多一天"
                  disabled={n >= 30}
                  onClick={() =>
                    field('availability', {
                      ...availability,
                      max_consecutive_days: Math.min(30, n + 1),
                    })
                  }
                >
                  <Ic name="plus" />
                </button>
              </div>
            </div>
            <input
              className="inp"
              aria-label="可投入时间说明"
              maxLength={500}
              placeholder="补充说明，比如：12 月 22 日到 1 月 10 日期末，不参加"
              value={p.available_time ?? ''}
              onChange={(e) => field('available_time', e.target.value)}
            />
          </Row>
        </div>
        {error && (
          <p role="alert" className="grp-note">
            {error}
          </p>
        )}
      </section>
      <div
        className={'savebar' + (dirty ? ' show' : '')}
        role="region"
        aria-label="保存画像"
        inert={!dirty}
      >
        <span>画像有 {dirty} 处改动</span>
        <button
          className="btn btn-ghost"
          type="button"
          disabled={!!busy}
          onClick={() => setDraft(saved)}
        >
          撤销
        </button>
        <button
          className="btn btn-primary"
          type="button"
          disabled={!!busy || !dirty}
          onClick={() => void save()}
        >
          {busy === 'save' ? (
            <>
              <span className="spin" />
              保存中
            </>
          ) : (
            '保存画像'
          )}
        </button>
      </div>
    </>
  )
}
