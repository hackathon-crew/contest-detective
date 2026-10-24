import { useEffect, useRef, useState } from 'react'
import { Link, Navigate, NavLink, useLocation, useNavigate, useParams } from 'react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { currentUserKey, useCurrentUser } from '@/entities/user'
import { AppearanceControl } from '@/features/appearance'
import { apiClient } from '@/shared/api'
import mark from '@/shared/assets/inkpaw-mark-56.webp'
import folder from '@/shared/assets/stickers/folder.png'
import { Ic, failure, NoticeContext, type NoticeAction } from './components'
import { accountTabs } from './contracts'
import { ProfilePanel } from './profile-panel'
import { PushPanel } from './push-panel'
import { FollowsPanel } from './follows-panel'
import { KeysPanel } from './keys-panel'
import { SettingsPanel } from './settings-panel'
import './account.css'

const panels = {
  profile: ProfilePanel,
  push: PushPanel,
  follows: FollowsPanel,
  keys: KeysPanel,
  settings: SettingsPanel,
}
const year = new Date().getFullYear()
const github = 'https://github.com/hackathon-crew/contest-detective'
function Brand() {
  return (
    <Link className="brand" to="/" aria-label="Inkpaw 首页">
      <img className="px" src={mark} width={48} height={42} alt="" />
      <span className="wm">Inkpaw</span>
    </Link>
  )
}
const groups = [
  [
    '产品',
    [
      ['赛事库', '/contests'],
      ['问侦探', '/detective'],
      ['画像匹配', '/account/profile'],
      ['MCP 接入', '/#mcp'],
    ],
  ],
  [
    '资源',
    [
      ['使用说明', github + '#readme'],
      ['更新记录', github + '/releases'],
      ['问题反馈', github + '/issues'],
      ['参与开发', github + '/blob/main/CONTRIBUTING.md'],
    ],
  ],
  [
    '团队',
    [
      ['黑客松', 'https://github.com/hackathon-crew'],
      ['huyan', 'https://github.com/huyanxius'],
      ['SilasVista', 'https://github.com/xiaocheny214'],
    ],
  ],
  [
    '联系',
    [
      ['【团队邮箱】', ''],
      ['提交问题', github + '/issues/new'],
      ['GitHub 仓库', github],
    ],
  ],
] as const
export function AccountPage() {
  const { data: user, isPending, error } = useCurrentUser(),
    { tab = 'profile' } = useParams(),
    location = useLocation(),
    navigate = useNavigate(),
    client = useQueryClient()
  const [notice, setNotice] = useState<{ text: string; action?: NoticeAction } | null>(null),
    [loggingOut, setLoggingOut] = useState(false)
  useEffect(() => {
    const title = document.title
    document.title = '个人中心 · Inkpaw'
    return () => {
      document.title = title
    }
  }, [])
  const timeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    panel = useRef<HTMLDivElement>(null)
  function notify(text: string, action?: NoticeAction) {
    setNotice({ text, action })
    clearTimeout(timeout.current)
    timeout.current = setTimeout(() => setNotice(null), action ? 5000 : 2600)
  }
  useEffect(() => () => clearTimeout(timeout.current), [])
  useEffect(() => {
    const el = panel.current
    if (!el) return
    el.classList.add('enter')
    const a = requestAnimationFrame(() => requestAnimationFrame(() => el.classList.remove('enter')))
    document
      .querySelector('.tab[aria-current="page"]')
      ?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
    return () => cancelAnimationFrame(a)
  }, [tab, user?.id])
  const summary = useQuery({
    queryKey: ['account-summary', user?.id],
    enabled: !!user,
    queryFn: ({ signal }) =>
      apiClient.request<{ follows: number; tracks: number }>('/account/summary', { signal }),
  })
  if (isPending)
    return (
      <div className="account-root">
        <main className="wrap head">
          <p>正在读取账号…</p>
        </main>
      </div>
    )
  if (error)
    return (
      <div className="account-root">
        <main className="wrap head">
          <p role="alert">{failure(error)}</p>
        </main>
      </div>
    )
  if (!user) return <Navigate to="/login" replace state={{ returnTo: location }} />
  if (!(tab in panels)) return <Navigate to="/account/profile" replace />
  async function logout() {
    setLoggingOut(true)
    try {
      await apiClient.request('/auth/logout', { method: 'POST' })
      await client.cancelQueries()
      client.clear()
      client.setQueryData(currentUserKey, null)
      navigate('/')
    } catch (e) {
      notify(failure(e))
    } finally {
      setLoggingOut(false)
    }
  }
  return (
    <NoticeContext.Provider value={notify}>
      <div className="account-root">
        <header className="top">
          <div className="wrap">
            <Brand />
            <nav className="nav" aria-label="主导航">
              <div className="links">
                <Link className="btn btn-ghost" to="/contests">
                  赛事库
                </Link>
                <Link className="btn btn-ghost" to="/detective">
                  侦探
                </Link>
                <Link
                  className="btn btn-ghost"
                  to={{ pathname: location.pathname, hash: '#mcp' }}
                  aria-haspopup="dialog"
                >
                  MCP
                </Link>
              </div>
              <a
                className="btn btn-ghost btn-icon"
                href={github}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="GitHub 仓库"
              >
                <Ic name="github" large />
              </a>
              <Link
                className="btn btn-ghost acct"
                to="/account/profile"
                aria-current="page"
                aria-label="个人中心"
              >
                <span className="acct-mail">{user.username}</span>
                <span className="acct-ic">
                  <Ic name="user" large />
                </span>
              </Link>
              <button className="btn btn-ghost" onClick={() => void logout()} disabled={loggingOut}>
                退出
              </button>
            </nav>
          </div>
        </header>
        <main>
          <section className="wrap head">
            <h1>个人中心</h1>
            <p className="head-lead">
              {user.username} · 关注 <b>{summary.data?.follows ?? '—'}</b> 场 · 追踪{' '}
              <b>{summary.data?.tracks ?? '—'}</b> 组条件
            </p>
          </section>
          <div className="wrap shell">
            <nav className="tabs" aria-label="个人中心">
              {accountTabs.map(([key, text, icon]) => (
                <NavLink className="tab" key={key} to={'/account/' + key}>
                  <Ic name={icon} />
                  {text}
                  {key === 'follows' && !!summary.data?.follows && (
                    <span className="n">{summary.data.follows}</span>
                  )}
                </NavLink>
              ))}
            </nav>
            <div className="panel" ref={panel}>
              {accountTabs.map(([key]) => {
                const Panel = panels[key]
                return (
                  <div
                    key={key}
                    hidden={key !== 'profile' && tab !== key}
                    className={
                      key === 'profile' && tab !== key ? 'account-profile-inactive' : undefined
                    }
                  >
                    <Panel />
                  </div>
                )
              })}
            </div>
          </div>
        </main>
        <footer>
          <img
            className="stk px"
            src={folder}
            width={158}
            height={150}
            alt=""
            style={{ right: 'max(24px, calc((100vw - 1200px) / 2 + 24px))', top: -104 }}
          />
          <div className="wrap">
            <div className="foot">
              <div className="foot-brand">
                <Brand />
                <p>帮大学生找比赛、核对截止时间的侦探。每条信息都附原文链接。</p>
              </div>
              {groups.map(([title, links]) => (
                <div className="foot-col" key={title}>
                  <h3>{title}</h3>
                  <ul>
                    {links.map(([label, href]) => (
                      <li key={label}>
                        {href.startsWith('/') ? (
                          <Link to={href}>{label}</Link>
                        ) : href ? (
                          <a href={href} target="_blank" rel="noopener noreferrer">
                            {label}
                          </a>
                        ) : (
                          <span className="sel-all">{label}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
            <div className="foot-bottom">
              <span>
                © {year} Inkpaw · {import.meta.env.VITE_BUILD_VERSION}
              </span>
              <span className="src">
                赛事信息整理自 Devpost、HackerTrip、WaytoAGI 和主办方公众号
              </span>
              <AppearanceControl segmented />
            </div>
          </div>
        </footer>
        <div className={'toast' + (notice ? ' show' : '')} role="status" aria-live="polite">
          <Ic name="check" />
          <span>{notice?.text}</span>
          {notice?.action && (
            <button
              className="linkbtn"
              onClick={() => {
                notice.action!.run()
                setNotice(null)
              }}
            >
              {notice.action.label}
            </button>
          )}
        </div>
      </div>
    </NoticeContext.Provider>
  )
}
