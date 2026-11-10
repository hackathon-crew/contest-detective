import { Button } from '@huyanxius/ui'
import { useLocale } from '@/shared/i18n/locale-context'

export function ProfileRequestMessage({
  question,
  onConnect,
}: {
  question: string
  onConnect: () => void
}) {
  const { t } = useLocale()
  return (
    <article className="detective-turn" aria-label={t('关于{topic}的对话', { topic: question })}>
      <div className="detective-turn__question">
        <p>{question}</p>
      </div>
      <div className="detective-profile-request">
        <p>{t('连上 GitHub，我按你的项目和技术栈接着找。')}</p>
        <Button size="sm" onClick={onConnect}>
          {t('连接 GitHub')}
        </Button>
      </div>
    </article>
  )
}
