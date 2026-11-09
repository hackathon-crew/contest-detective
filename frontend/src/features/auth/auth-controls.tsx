import { useState } from 'react'
import { Link, useLocation } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { currentUserKey, useCurrentUser } from '@/entities/user'
import { apiClient } from '@/shared/api'
import { translateSystemText } from '@/shared/i18n'
import { Button } from '@/shared/ui'
import { User } from 'lucide-react'
import './auth-controls.css'
import { useLocale } from '@/shared/i18n/locale-context'

export function AuthControls({ compact = false }: { compact?: boolean }) {
  const { locale, t } = useLocale()
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
          <Link to="/account" aria-label={t('个人中心')} className="auth-account-link">
            <span>{user.username}</span>
            <User aria-hidden="true" size={20} strokeWidth={1.75} />
          </Link>
          <Button variant="ghost" disabled={pending} onClick={() => void logout()}>
            {t('退出')}
          </Button>
        </>
      ) : (
        <>
          <Button
            variant={compact ? 'default' : 'ghost'}
            className={compact ? 'auth-login' : undefined}
            asChild
          >
            <Link to="/login" state={{ returnTo: location }}>
              {t('登录')}
            </Link>
          </Button>
          {!compact && (
            <Button variant="outline" asChild>
              <Link to="/register" state={{ returnTo: location }}>
                {t('注册')}
              </Link>
            </Button>
          )}
        </>
      )}
      {error && (
        <p role="alert" className="text-sm text-muted">
          {translateSystemText(locale, error)}
        </p>
      )}
    </div>
  )
}
