import { Button } from '@/shared/ui'
import type { FollowController } from './model'

export function FollowButton({
  contestId,
  follows,
}: {
  contestId: string
  follows: FollowController
}) {
  const followed = follows.ids.includes(contestId)
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
