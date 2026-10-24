import { useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { currentUserKey, useCurrentUser, type PublicUser } from '@/entities/user'
import { apiClient } from '@/shared/api'
import { Button, Dialog, Input } from '@/shared/ui'

export function AuthControls() {
  const { data: user } = useCurrentUser()
  const client = useQueryClient()
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function close() {
    if (pending) return
    setOpen(false)
    setPassword('')
    setError(null)
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (pending || !open) return
    setPending(true)
    setError(null)
    try {
      const json = { email: email.trim(), password }
      if (mode === 'register') await apiClient.request('/auth/register', { method: 'POST', json })
      const current = await apiClient.request<PublicUser>('/auth/login', { method: 'POST', json })
      await client.cancelQueries({ queryKey: currentUserKey })
      client.setQueryData(currentUserKey, current)
      setPassword('')
      setOpen(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '账户请求失败，请重试。')
    } finally {
      setPending(false)
    }
  }

  async function logout() {
    if (pending) return
    setPending(true)
    setError(null)
    try {
      await apiClient.request('/auth/logout', { method: 'POST' })
      await client.cancelQueries({ queryKey: currentUserKey })
      client.setQueryData(currentUserKey, null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '退出失败，请重试。')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="flex items-center gap-2">
      {user ? (
        <>
          <span className="max-w-40 truncate text-sm text-ink">{user.username}</span>
          <Button variant="ghost" disabled={pending} onClick={() => void logout()}>
            退出
          </Button>
        </>
      ) : (
        <>
          <Button
            variant="ghost"
            onClick={() => {
              setError(null)
              setMode('login')
              setOpen(true)
            }}
          >
            登录
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              setError(null)
              setMode('register')
              setOpen(true)
            }}
          >
            注册
          </Button>
        </>
      )}
      {!open && error && (
        <p role="alert" className="text-sm text-muted">
          {error}
        </p>
      )}
      <Dialog open={open} title={mode === 'login' ? '登录' : '注册'} onClose={close}>
        <form className="space-y-5" onSubmit={(event) => void submit(event)}>
          <label className="block space-y-2 text-sm">
            <span>邮箱</span>
            <Input
              type="email"
              autoComplete="email"
              required
              maxLength={320}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <label className="block space-y-2 text-sm">
            <span>密码</span>
            <Input
              type="password"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              required
              minLength={mode === 'register' ? 8 : 1}
              maxLength={128}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          {error && (
            <p role="alert" className="text-sm text-muted">
              {error}
            </p>
          )}
          <Button type="submit" disabled={pending}>
            {pending ? '提交中' : mode === 'login' ? '登录' : '注册'}
          </Button>
        </form>
      </Dialog>
    </div>
  )
}
