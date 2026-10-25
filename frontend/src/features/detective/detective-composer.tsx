import { ArrowUp, ImagePlus, Plus, Square, X } from 'lucide-react'
import { useRef, useState, type FormEvent, type Ref } from 'react'
import { DropdownMenu, Popover } from 'radix-ui'
import githubMark from '@/shared/assets/github-mark.svg'
import { ContestFilterIcon, ProfileIcon } from '@/shared/ui/context-icons'
import { Button } from '@/shared/ui'
import { ScreenshotDialog } from './screenshot-dialog'
import type { ScreenshotConfirmation } from './screenshot-contracts'
import type { VerificationOptions } from './verification-contracts'

export type DetectiveContextAction = 'github' | 'profile' | 'filters'

export function DetectiveComposer({
  value,
  pending,
  onChange,
  onSubmit,
  onStop,
  onAddProfile,
  onVerifyScreenshot,
  inputRef,
  placeholder = '问一个问题',
  profileGuide,
}: {
  value: string
  pending: boolean
  onChange: (value: string) => void
  onSubmit: (event: FormEvent, verification?: VerificationOptions) => void
  onStop: () => void
  onAddProfile?: (section: DetectiveContextAction) => void
  onVerifyScreenshot?: (value: ScreenshotConfirmation) => void
  inputRef?: Ref<HTMLTextAreaElement>
  placeholder?: string
  profileGuide?: { onDismiss: () => void; onCreate: () => void }
}) {
  const [screenshotOpen, setScreenshotOpen] = useState(false)
  const addButton = useRef<HTMLButtonElement>(null)
  return (
    <>
      <form
        className="detective-composer"
        data-multiline={value.includes('\n') || value.length > 40}
        data-filled={value.length > 0}
        onSubmit={(event) => onSubmit(event, { mode: 'deep' })}
      >
        <Popover.Root
          open={!!profileGuide}
          onOpenChange={(open) => {
            if (!open) profileGuide?.onDismiss()
          }}
        >
          <DropdownMenu.Root
            modal={false}
            onOpenChange={(open) => {
              if (open) profileGuide?.onDismiss()
            }}
          >
            <Popover.Anchor asChild>
              <DropdownMenu.Trigger asChild>
                <button
                  ref={addButton}
                  type="button"
                  className="detective-composer__add"
                  aria-label="添加简历或参赛资料"
                  title="添加简历或参赛资料"
                  disabled={pending || (!onAddProfile && !onVerifyScreenshot)}
                >
                  <Plus aria-hidden="true" strokeWidth={1.5} />
                </button>
              </DropdownMenu.Trigger>
            </Popover.Anchor>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                align="start"
                sideOffset={8}
                collisionPadding={24}
                aria-label="添加参赛资料"
                className="z-50 w-64 origin-(--radix-dropdown-menu-content-transform-origin) rounded-3xl border border-rule bg-surface p-2 text-base text-ink shadow-lg outline-none duration-140 ease-out data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95"
              >
                {onVerifyScreenshot && (
                  <DropdownMenu.Item
                    className="flex min-h-12 cursor-pointer items-center gap-3 rounded-2xl px-3 outline-none transition-colors duration-140 data-highlighted:bg-surface-strong"
                    onSelect={() => setScreenshotOpen(true)}
                  >
                    <ImagePlus className="size-5" aria-hidden="true" strokeWidth={1.5} />
                    截图查证
                  </DropdownMenu.Item>
                )}
                {onAddProfile && (
                  <>
                    <DropdownMenu.Item
                      className="flex min-h-12 cursor-pointer items-center gap-3 rounded-2xl px-3 outline-none transition-colors duration-140 data-highlighted:bg-surface-strong"
                      onSelect={() => onAddProfile?.('github')}
                    >
                      <img src={githubMark} alt="" className="size-5 shrink-0 dark:invert" />
                      连接到 GitHub
                    </DropdownMenu.Item>
                    <DropdownMenu.Item
                      className="flex min-h-12 cursor-pointer items-center gap-3 rounded-2xl px-3 outline-none transition-colors duration-140 data-highlighted:bg-surface-strong"
                      onSelect={() => onAddProfile?.('profile')}
                    >
                      <ProfileIcon className="size-5" />
                      添加画像
                    </DropdownMenu.Item>
                    <DropdownMenu.Item
                      className="flex min-h-12 cursor-pointer items-center gap-3 rounded-2xl px-3 outline-none transition-colors duration-140 data-highlighted:bg-surface-strong"
                      onSelect={() => onAddProfile?.('filters')}
                    >
                      <ContestFilterIcon className="size-5" />
                      添加比赛筛选
                    </DropdownMenu.Item>
                  </>
                )}
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
          <Popover.Portal>
            <Popover.Content
              side="bottom"
              align="start"
              sideOffset={12}
              collisionPadding={24}
              aria-label="建立参赛画像"
              className="z-50 grid w-85 max-w-(--radix-popover-content-available-width) origin-(--radix-popover-content-transform-origin) gap-3 rounded-3xl bg-surface p-6 text-ink-soft shadow-lg outline-none duration-140 ease-out data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:pointer-events-none data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95"
              onOpenAutoFocus={(event) => event.preventDefault()}
              onCloseAutoFocus={(event) => event.preventDefault()}
            >
              <header className="flex items-center justify-between gap-2">
                <h3 className="text-base font-medium text-ink">建立参赛画像</h3>
                <Popover.Close asChild>
                  <Button type="button" variant="ghost" size="icon" aria-label="关闭画像提示">
                    <X aria-hidden="true" />
                  </Button>
                </Popover.Close>
              </header>
              <p className="text-sm">点击加号，导入简历或连接 GitHub，让比赛推荐更适合你。</p>
              <div className="flex items-center justify-between gap-2">
                <Popover.Close asChild>
                  <Button type="button" variant="ghost" size="sm">
                    稍后再说
                  </Button>
                </Popover.Close>
                <Button type="button" size="sm" onClick={profileGuide?.onCreate}>
                  建立画像
                </Button>
              </div>
              <Popover.Arrow width={16} height={8} className="fill-surface" aria-hidden="true" />
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
        <textarea
          ref={inputRef}
          aria-label="问侦探"
          placeholder={placeholder}
          value={value}
          rows={1}
          disabled={pending}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (
              event.key === 'Enter' &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing &&
              event.keyCode !== 229
            ) {
              event.preventDefault()
              event.currentTarget.form?.requestSubmit()
            }
          }}
        />
        <button
          type={pending ? 'button' : 'submit'}
          className="detective-composer__send"
          aria-label={pending ? '停止查证' : '查证'}
          title={pending ? '停止查证' : '查证'}
          disabled={!pending && !value.trim()}
          onClick={pending ? onStop : undefined}
        >
          {pending ? (
            <Square aria-hidden="true" fill="currentColor" />
          ) : (
            <ArrowUp aria-hidden="true" />
          )}
        </button>
      </form>
      {screenshotOpen && onVerifyScreenshot && (
        <ScreenshotDialog
          onConfirm={onVerifyScreenshot}
          onClose={() => {
            setScreenshotOpen(false)
            requestAnimationFrame(() => addButton.current?.focus({ preventScroll: true }))
          }}
        />
      )}
    </>
  )
}
