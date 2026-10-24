import { Button } from '@/shared/ui'
import type { FollowController } from './model'
import { Bookmark } from 'lucide-react'
import { useState } from 'react'

export function FollowButton({
  contestId,
  follows,
  iconOnly = false,
}: {
  contestId: string
  follows: FollowController
  iconOnly?: boolean
}) {
  const followed = follows.ids.includes(contestId)
  const [popping, setPopping] = useState(false)
  if (iconOnly)
    return (
      <button
        type="button"
        className={'follow' + (popping ? ' pop' : '')}
        aria-label={followed ? '取消关注' : '关注'}
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
      {followed ? '已关注' : '关注'}
    </Button>
  )
}
