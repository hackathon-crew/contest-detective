import { useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router'
import { X } from 'lucide-react'
import type { PublicUser } from '@/entities/user'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/shared/ui/dialog'
import searchFrame from '@/shared/assets/mascot/octo-search.png'
import readingFrame from '@/shared/assets/mascot/octo-read.png'
import watchFrame from '@/shared/assets/mascot/octo-peer.png'
import './detective-onboarding.css'

export const detectiveOnboardingKey = 'inkpaw.detective.onboarding.seen.v1'

export function useDetectiveOnboarding(user: PublicUser | null | undefined, ready: boolean) {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!ready) return
    let seen = false
    try {
      seen = localStorage.getItem(detectiveOnboardingKey) === '1'
      // 首次访问按浏览器记录；登录用户也记为已访问，退出后不再补弹。
      if (!seen) localStorage.setItem(detectiveOnboardingKey, '1')
    } catch {
      // 浏览器禁止持久化时，仍允许关闭引导并正常使用侦探。
    }
    if (user) setOpen(false)
    else if (!seen) setOpen(true)
  }, [ready, user])
  return { open: open && ready && user === null, close: () => setOpen(false) }
}

const cards = [
  {
    image: searchFrame,
    label: '深度搜索',
    title: '一句话找比赛',
    lines: ['深度搜索并核实比赛信息。', '登录后，按你的参赛画像推荐。'],
  },
  {
    image: readingFrame,
    label: '参赛画像',
    title: '建立参赛画像',
    lines: ['导入简历或连接 GitHub，', '按技能、兴趣和空闲时间匹配比赛。'],
  },
  {
    image: watchFrame,
    label: '盯梢与推送',
    title: '盯梢与推送',
    lines: ['保存条件，持续盯梢新比赛。', '邮件接收比赛推荐和截止提醒。'],
  },
]

export function DetectiveOnboarding({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [step, setStep] = useState(0)
  const title = useRef<HTMLHeadingElement>(null)
  const previousFocus = useRef<HTMLElement | null>(null)
  const location = useLocation()
  const card = cards[step]!
  const last = step === cards.length - 1

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value) onClose()
      }}
    >
      <DialogContent
        className="detective-onboarding"
        showCloseButton={false}
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          previousFocus.current = document.activeElement as HTMLElement | null
          title.current?.focus({ preventScroll: true })
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          previousFocus.current?.focus({ preventScroll: true })
        }}
      >
        <Button
          className="detective-onboarding__close"
          variant="ghost"
          size="icon"
          type="button"
          aria-label="关闭"
          onClick={onClose}
        >
          <X aria-hidden="true" strokeWidth={1.5} />
        </Button>
        <div className="detective-onboarding__artwork">
          {cards.map((item, index) => (
            <img
              key={item.label}
              className="detective-onboarding__art"
              src={item.image}
              alt=""
              width={192}
              height={192}
              hidden={index !== step}
            />
          ))}
          <nav className="detective-onboarding__steps" aria-label="使用指南步骤">
            {cards.map((item, index) => (
              <button
                key={item.label}
                type="button"
                aria-label={item.label}
                aria-current={index === step ? 'step' : undefined}
                onClick={() => setStep(index)}
              />
            ))}
          </nav>
        </div>
        <div className="detective-onboarding__body">
          <div key={step} className="detective-onboarding__copy">
            <DialogTitle ref={title} tabIndex={-1} className="detective-onboarding__title">
              {card.title}
            </DialogTitle>
            <DialogDescription className="detective-onboarding__description">
              {card.lines[0]}
              <br />
              {card.lines[1]}
            </DialogDescription>
          </div>
          <div className="detective-onboarding__actions">
            {last ? (
              <>
                <Button className="detective-onboarding__primary" asChild>
                  <Link to="/register" state={{ returnTo: location }} onClick={onClose}>
                    注册 / 登录
                  </Link>
                </Button>
                <Button className="detective-onboarding__guest" variant="ghost" onClick={onClose}>
                  直接使用
                </Button>
              </>
            ) : (
              <Button
                className="detective-onboarding__primary"
                onClick={() => {
                  setStep(step + 1)
                  requestAnimationFrame(() => title.current?.focus({ preventScroll: true }))
                }}
              >
                下一步
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
