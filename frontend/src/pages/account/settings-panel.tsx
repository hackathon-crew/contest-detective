import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCurrentUser } from '@/entities/user'
import { apiClient } from '@/shared/api'
import type { AccountRead } from '@/shared/api/generated'
import { Expand, failure, Ic, useNotice } from './components'
import { AccountModal } from './modal'

function date(value: string, year = false) {
  const parts = new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    timeZone: 'Asia/Shanghai',
  }).formatToParts(new Date(value))
  const part = (key: string) => parts.find((p) => p.type === key)?.value
  return (year ? part('year') + ' 年 ' : '') + part('month') + ' 月 ' + part('day') + ' 日'
}
export function SettingsPanel() {
  const { data: user } = useCurrentUser(),
    client = useQueryClient(),
    notice = useNotice(),
    navigate = useNavigate(),
    [searchParams, setSearchParams] = useSearchParams()
  const verifiedFlag = searchParams.get('email_verified')
  const accountKey = ['account-settings', user?.id]
  const account = useQuery({
    queryKey: accountKey,
    enabled: !!user,
    queryFn: ({ signal }) => apiClient.request<AccountRead>('/account/settings', { signal }),
  })
  const [emailOpen, setEmailOpen] = useState(false),
    [passwordOpen, setPasswordOpen] = useState(false),
    [deleting, setDeleting] = useState(false)
  const [email, setEmail] = useState(''),
    [password, setPassword] = useState(''),
    [newPassword, setNewPassword] = useState(''),
    [confirmation, setConfirmation] = useState(''),
    [busy, setBusy] = useState('')
  const confirmInput = useRef<HTMLInputElement>(null)
  const loginEmail = account.data?.email ?? user?.username ?? ''
  const handledVerification = useRef(false)
  useEffect(() => {
    if (!deleting) return
    const timer = setTimeout(() => confirmInput.current?.focus(), 240)
    return () => clearTimeout(timer)
  }, [deleting])
  useEffect(() => {
    if (!verifiedFlag || handledVerification.current) return
    if (account.isPending || account.isFetching) return
    handledVerification.current = true
    if (verifiedFlag === '1' && account.data?.email_verified) {
      notice('邮箱已验证')
      void client.invalidateQueries({ queryKey: ['account-push', user?.id] })
    } else {
      notice('验证链接无效或已过期，请重新发送验证邮件')
    }
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current)
        next.delete('email_verified')
        return next
      },
      { replace: true },
    )
  }, [
    verifiedFlag,
    account.data?.email_verified,
    account.isPending,
    account.isFetching,
    client,
    notice,
    setSearchParams,
    user?.id,
  ])
  async function sendVerification() {
    if (busy) return
    setBusy('verify')
    try {
      await apiClient.request('/account/email/verification', { method: 'POST' })
      notice('验证邮件已发到 ' + loginEmail + '，20 分钟内有效')
    } catch (e) {
      notice(failure(e))
    } finally {
      setBusy('')
    }
  }
  async function changeEmail(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setBusy('email')
    try {
      await apiClient.request('/account/email', { method: 'POST', json: { email: email.trim() } })
      setEmailOpen(false)
      notice('验证邮件已发到 ' + email.trim() + '，点开链接后生效')
      setEmail('')
    } catch (e) {
      notice(failure(e))
    } finally {
      setBusy('')
    }
  }
  async function changePassword(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setBusy('password')
    try {
      await apiClient.request('/account/password', {
        method: 'POST',
        json: { current_password: password, new_password: newPassword },
      })
      setPasswordOpen(false)
      setPassword('')
      setNewPassword('')
      await client.invalidateQueries({ queryKey: accountKey })
      notice('密码已修改，其他设备需要重新登录')
    } catch (e) {
      notice(failure(e))
    } finally {
      setBusy('')
    }
  }
  async function exportData() {
    setBusy('export')
    try {
      const data = await apiClient.request('/account/export')
      const href = URL.createObjectURL(
        new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
      )
      const a = document.createElement('a')
      a.href = href
      a.download = 'inkpaw-我的数据.json'
      a.click()
      setTimeout(() => URL.revokeObjectURL(href), 1000)
      notice('已导出')
    } catch (e) {
      notice(failure(e))
    } finally {
      setBusy('')
    }
  }
  async function remove(event: FormEvent) {
    event.preventDefault()
    if (busy || confirmation.trim() !== loginEmail) return
    setBusy('delete')
    try {
      await apiClient.request('/account', {
        method: 'DELETE',
        json: { email: confirmation.trim() },
      })
      await client.cancelQueries()
      client.clear()
      navigate('/')
    } catch (e) {
      notice(failure(e))
      setBusy('')
    }
  }
  return (
    <>
      <div className="p-head">
        <div>
          <h2>账号</h2>
          <p className="p-lead">
            {account.data ? date(account.data.created_at, true) + '注册' : '正在读取账号…'}
          </p>
        </div>
      </div>
      {account.error && (
        <p className="grp-note" role="alert">
          {failure(account.error)}
        </p>
      )}
      <div className="grp" style={{ marginTop: 24 }}>
        <div className="arow" id="email">
          <div>
            <b>登录邮箱</b>
            <p>
              {loginEmail} ·{' '}
              {account.data?.email_verified ? '已验证' : account.data ? '未验证' : '读取中'}
            </p>
          </div>
          <div className="arow-actions">
            {account.data && !account.data.email_verified && (
              <button
                className="btn btn-ghost btn-sm"
                type="button"
                disabled={!!busy}
                onClick={() => void sendVerification()}
              >
                {busy === 'verify' ? '正在发送…' : '发送验证邮件'}
              </button>
            )}
            <button
              className="btn btn-ghost btn-sm"
              type="button"
              onClick={() => setEmailOpen(!emailOpen)}
            >
              修改
            </button>
          </div>
          <div style={{ gridColumn: '1/-1' }}>
            <Expand open={emailOpen}>
              <form
                className="prov-form"
                style={{ paddingLeft: 0, maxWidth: 400 }}
                onSubmit={(e) => void changeEmail(e)}
              >
                <label>
                  新邮箱
                  <input
                    className="inp"
                    type="email"
                    required
                    maxLength={320}
                    placeholder="name@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </label>
                <div className="acts">
                  <button className="btn btn-primary btn-sm" type="submit" disabled={!!busy}>
                    发验证邮件
                  </button>
                  <button
                    className="btn btn-ghost btn-sm"
                    type="button"
                    onClick={() => setEmailOpen(false)}
                  >
                    取消
                  </button>
                </div>
              </form>
            </Expand>
          </div>
        </div>
        <div className="arow">
          <div>
            <b>密码</b>
            <p>
              {account.data
                ? '上次修改是 ' + date(account.data.password_changed_at ?? account.data.created_at)
                : '正在读取…'}
            </p>
          </div>
          <button
            className="btn btn-ghost btn-sm"
            type="button"
            onClick={() => setPasswordOpen(!passwordOpen)}
          >
            修改密码
          </button>
          <div style={{ gridColumn: '1/-1' }}>
            <Expand open={passwordOpen}>
              <form
                className="prov-form"
                style={{ paddingLeft: 0, maxWidth: 400 }}
                onSubmit={(e) => void changePassword(e)}
              >
                <label>
                  现在的密码
                  <input
                    className="inp"
                    type="password"
                    required
                    maxLength={128}
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </label>
                <label>
                  新密码
                  <input
                    className="inp"
                    type="password"
                    required
                    minLength={8}
                    maxLength={128}
                    placeholder="至少 8 位"
                    autoComplete="new-password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                  />
                </label>
                <div className="acts">
                  <button className="btn btn-primary btn-sm" type="submit" disabled={!!busy}>
                    保存
                  </button>
                  <button
                    className="btn btn-ghost btn-sm"
                    type="button"
                    onClick={() => {
                      setPasswordOpen(false)
                      setPassword('')
                      setNewPassword('')
                    }}
                  >
                    取消
                  </button>
                </div>
              </form>
            </Expand>
          </div>
        </div>
        <div className="arow">
          <div>
            <b>导出我的数据</b>
            <p>画像、关注、追踪条件和推送设置，导出成一个 JSON 文件</p>
          </div>
          <button
            className="btn btn-ghost btn-sm"
            type="button"
            disabled={!!busy}
            onClick={() => void exportData()}
          >
            <Ic name="download" />
            导出
          </button>
        </div>
        <div className="arow danger">
          <div>
            <b>删除账号</b>
            <p>画像、关注、追踪条件和推送设置会一起删掉，没法恢复。</p>
          </div>
          <button
            className="btn btn-danger-line btn-sm"
            type="button"
            onClick={() => {
              setConfirmation('')
              setDeleting(true)
            }}
          >
            删除账号
          </button>
        </div>
      </div>
      <AccountModal open={deleting} close={() => setDeleting(false)} titleId="del-title" narrow>
        <form className="dlg-pad" onSubmit={(e) => void remove(e)}>
          <h3 id="del-title">删除这个账号？</h3>
          <p>
            画像、{account.data?.follows_count ?? '—'}{' '}
            场关注、追踪条件和推送设置会一起删掉，没法恢复。输入登录邮箱确认。
          </p>
          <input
            className="inp"
            ref={confirmInput}
            autoComplete="off"
            aria-label="输入登录邮箱确认"
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
          />
          <div className="dlg-acts">
            <button className="btn btn-ghost" type="button" onClick={() => setDeleting(false)}>
              取消
            </button>
            <button
              className="btn btn-danger"
              type="submit"
              disabled={!loginEmail || confirmation.trim() !== loginEmail || !!busy}
            >
              删除账号
            </button>
          </div>
        </form>
      </AccountModal>
    </>
  )
}
