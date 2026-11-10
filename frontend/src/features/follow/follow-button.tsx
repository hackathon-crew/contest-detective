import { Button } from '@huyanxius/ui'
import type { FollowController } from './model'
import { Bookmark, Eye } from 'lucide-react'
import { useEffect, useState } from 'react'
import './follow-button.css'
import { useLocale } from '@/shared/i18n/locale-context'

export function FollowButton({
  contestId,
  follows,
  iconOnly = false,
  watch = false,
  onFollow,
}: {
  contestId: string
  follows: FollowController
  iconOnly?: boolean
  watch?: boolean
  onFollow?: () => void
}) {
  const { t } = useLocale()
  const followed = follows.ids.includes(contestId)
  const [popping, setPopping] = useState(false)
  const [requested, setRequested] = useState(false)
  useEffect(() => {
    if (!requested || !followed) return
    setRequested(false)
    setPopping(true)
    onFollow?.()
  }, [followed, requested, onFollow])
  if (watch)
    return (
      <button
        type="button"
        className="detective-watch"
        data-popping={popping}
        aria-pressed={followed}
        disabled={follows.pending}
        onClick={() => {
          setRequested(!followed)
          follows.toggle(contestId)
        }}
        onAnimationEnd={() => setPopping(false)}
      >
        <Eye aria-hidden="true" strokeWidth={1.5} />
        {followed ? t('已盯上') : t('帮我盯着')}
      </button>
    )
  if (iconOnly)
    return (
      <button
        type="button"
        className={'follow' + (popping ? ' pop' : '')}
        aria-label={followed ? t('取消关注') : t('关注')}
        aria-pressed={followed}
        disabled={follows.pending}
        onClick={() => {
          setPopping(!followed)
          follows.toggle(contestId)
        }}
        onAnimationEnd={() => setPopping(false)}
      >
        <Bookmark className="ic" />
      </button>
    )
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      aria-pressed={followed}
      disabled={follows.pending}
      onClick={() => follows.toggle(contestId)}
    >
      {followed ? t('已关注') : t('关注')}
    </Button>
  )
}
