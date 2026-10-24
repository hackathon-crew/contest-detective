import { useState } from 'react'
import { Link, useLocation } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { currentUserKey, useCurrentUser } from '@/entities/user'
import { apiClient } from '@/shared/api'
import { Button } from '@/shared/ui'

export function AuthControls({ compact = false }: { compact?: boolean }) {
  const { data: user } = useCurrentUser()
  const client = useQueryClient()
  const location = useLocation()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
            variant={compact ? 'default' : 'ghost'}
            className={compact ? 'px-4 hover:bg-accent-hover' : undefined}
            asChild
          >
            <Link to="/login" state={{ returnTo: location }}>
              登录
            </Link>
          </Button>
          {!compact && (
            <Button variant="outline" asChild>
              <Link to="/register" state={{ returnTo: location }}>
                注册
              </Link>
            </Button>
          )}
        </>
      )}
      {error && (
        <p role="alert" className="text-sm text-muted">
          {error}
        </p>
      )}
    </div>
  )
}
