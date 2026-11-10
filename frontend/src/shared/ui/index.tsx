import type { ComponentProps, ReactNode } from 'react'
import { Button, CenteredDialog } from '@huyanxius/ui'
import { translateSystemText } from '@/shared/i18n'
import { useLocale } from '@/shared/i18n/locale-context'

export function EmptyState({ children }: { children?: ReactNode }) {
  const { t } = useLocale()
  return (
    <p role="status" className="py-8 text-sm text-muted">
      {children ?? t('没有找到赛事，换个条件再试试。')}
    </p>
  )
}
export function ErrorState({ error, retry }: { error: unknown; retry?: () => void }) {
  const { locale, t } = useLocale()
  return (
    <div role="alert" className="flex flex-wrap items-center gap-3 py-6 text-sm text-muted">
      <p>
        {error instanceof Error
          ? translateSystemText(locale, error.message)
          : t('加载失败，请重试。')}
      </p>
      {retry && <Button onClick={retry}>{t('重试')}</Button>}
    </div>
  )
}

export function Dialog(props: Omit<ComponentProps<typeof CenteredDialog>, 'closeLabel'>) {
  const { t } = useLocale()
  return <CenteredDialog {...props} closeLabel={t('关闭')} />
}
