import { useState } from 'react'
import { apiClient } from '@/shared/api'
import type { InviteCreated } from '@/shared/api/generated'
import { translateSystemText } from '@/shared/i18n'
import { useLocale } from '@/shared/i18n/locale-context'
import { failure } from './components'

export function InvitePanel() {
  const { locale, t } = useLocale()
  const [code, setCode] = useState('')
  const [copied, setCopied] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')

  async function generate() {
    setPending(true)
    setError('')
    try {
      const invite = await apiClient.request<InviteCreated>('/account/invites', {
        method: 'POST',
      })
      setCode(invite.code)
      setCopied(false)
    } catch (cause) {
      setError(failure(cause))
    } finally {
      setPending(false)
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setError('')
    } catch {
      setError(t('请选中邀请码后复制。'))
    }
  }

  return (
    <section className="grp" aria-label={t('邀请码')}>
      <div className="arow">
        <div>
          <b>{t('邀请码')}</b>
          <p>{t('每个邀请码可注册一个账号。')}</p>
        </div>
        <button
          className="btn btn-primary btn-sm"
          type="button"
          disabled={pending}
          onClick={() => void generate()}
        >
          {pending ? t('正在生成…') : t('生成邀请码')}
        </button>
      </div>
      {code && (
        <div className="arow">
          <div className="min-w-0">
            <b>{t('新邀请码')}</b>
            <p>
              <output className="font-mono select-all">{code}</output>
            </p>
          </div>
          <button className="btn btn-ghost btn-sm" type="button" onClick={() => void copy()}>
            {copied ? t('已复制') : t('复制')}
          </button>
        </div>
      )}
      {error && (
        <p className="grp-note" role="alert">
          {translateSystemText(locale, error)}
        </p>
      )}
    </section>
  )
}
