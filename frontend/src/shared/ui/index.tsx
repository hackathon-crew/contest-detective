import type { ComponentProps, ReactNode } from 'react'
import {
  CenteredDialog,
  EmptyState as EmptyFeedback,
  ErrorState as ErrorFeedback,
} from '@huyanxius/ui'
import { translateSystemText } from '@/shared/i18n'
import { useLocale } from '@/shared/i18n/locale-context'

export function EmptyState({ children }: { children?: ReactNode }) {
  const { t } = useLocale()
  return <EmptyFeedback>{children ?? t('没有找到赛事，换个条件再试试。')}</EmptyFeedback>
}
export function ErrorState({ error, retry }: { error: unknown; retry?: () => void }) {
  const { locale, t } = useLocale()
  return (
    <ErrorFeedback onRetry={retry} retryLabel={t('重试')}>
      {error instanceof Error
        ? translateSystemText(locale, error.message)
        : t('加载失败，请重试。')}
    </ErrorFeedback>
  )
}

export function Dialog(props: Omit<ComponentProps<typeof CenteredDialog>, 'closeLabel'>) {
  const { t } = useLocale()
  return <CenteredDialog {...props} closeLabel={t('关闭')} />
}
