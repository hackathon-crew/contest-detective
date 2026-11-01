import { useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { X } from 'lucide-react'
import read from '@/shared/assets/mascot/octo-read.png'
import { Icon } from '@/shared/ui/site-icon'
import type { ProfileMatchSection } from './profile-match-dialog'
import './profile-nudge.css'

export function ProfileNudge({
  open,
  onClose,
  onChoose,
  anchor,
  wall,
  onPresent,
}: {
  open: boolean
  onClose: () => void
  onChoose: (section: ProfileMatchSection) => void
  anchor?: RefObject<HTMLElement | null>
  wall?: RefObject<HTMLElement | null>
  onPresent?: (present: boolean) => void
}) {
  const card = useRef<HTMLElement>(null)
  const [position, setPosition] = useState<{
    kind: 'speech' | 'corner' | 'blocked'
    top?: number
    right?: number
  }>({ kind: 'corner' })
  useLayoutEffect(() => {
    if (!open) {
      onPresent?.(false)
      return
    }
    function place() {
      if (anchor?.current && window.innerWidth > 760 && window.scrollY < 120) {
        const canvas = anchor.current.querySelector('canvas, img') ?? anchor.current
        const rect = canvas.getBoundingClientRect()
        const top = rect.top + rect.height * 0.66
        const node = card.current!
        const previous = node.dataset.placement!
        node.dataset.placement = 'speech'
        const height = node.offsetHeight
        node.dataset.placement = previous
        const fits = top + height + 12 <= wall!.current!.getBoundingClientRect().top
        setPosition({
          kind: fits ? 'speech' : 'blocked',
          top,
          right: window.innerWidth - rect.left - rect.width / 2 - 144,
        })
        onPresent?.(fits)
      } else {
        setPosition({ kind: 'corner' })
        onPresent?.(true)
      }
    }
    place()
    window.addEventListener('scroll', place, { passive: true })
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('scroll', place)
      window.removeEventListener('resize', place)
    }
  }, [open, anchor, wall, onPresent])
  return (
    <aside
      ref={card}
      className="profile-nudge"
      data-placement={position.kind}
      data-open={open}
      inert={!open || position.kind === 'blocked'}
      aria-label="添加画像"
      aria-hidden={!open || position.kind === 'blocked'}
      style={position.kind === 'corner' ? undefined : { top: position.top, right: position.right }}
    >
      <img className="pixel-art" src={read} alt="" width={56} height={56} />
      <h3>先让我认识一下你</h3>
      <p>登录后按你的项目挑，查过的都帮你存着。</p>
      <div className="profile-nudge__actions">
        <button type="button" className="profile-nudge__primary" onClick={() => onChoose('github')}>
          <Icon name="github" />
          登录并连接 GitHub
        </button>
        <button
          type="button"
          className="profile-nudge__secondary"
          onClick={() => onChoose('profile')}
        >
          上传简历
        </button>
      </div>
      <button
        type="button"
        className="profile-nudge__close"
        aria-label="关闭画像提醒"
        onClick={onClose}
      >
        <X aria-hidden="true" size={16} strokeWidth={1.75} />
      </button>
    </aside>
  )
}
