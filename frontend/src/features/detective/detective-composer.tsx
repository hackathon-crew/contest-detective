import { ArrowUp, Plus, Square } from 'lucide-react'
import type { FormEvent, Ref } from 'react'
import { DropdownMenu } from 'radix-ui'
import githubMark from '@/shared/assets/github-mark.svg'
import { ContestFilterIcon, ProfileIcon } from '@/shared/ui/context-icons'

export type DetectiveContextAction = 'github' | 'profile' | 'filters'

export function DetectiveComposer({
  value,
  pending,
  onChange,
  onSubmit,
  onStop,
  onAddProfile,
  inputRef,
  placeholder = '问一个问题',
}: {
  value: string
  pending: boolean
  onChange: (value: string) => void
  onSubmit: (event: FormEvent) => void
  onStop: () => void
  onAddProfile?: (section: DetectiveContextAction) => void
  inputRef?: Ref<HTMLTextAreaElement>
  placeholder?: string
}) {
  return (
    <form
      className="detective-composer"
      data-multiline={value.includes('\n') || value.length > 40}
      data-filled={value.length > 0}
      onSubmit={onSubmit}
    >
      <DropdownMenu.Root modal={false}>
        <DropdownMenu.Trigger asChild>
          <button
            type="button"
            className="detective-composer__add"
            aria-label="添加简历或参赛资料"
            title="添加简历或参赛资料"
            disabled={pending || !onAddProfile}
          >
            <Plus aria-hidden="true" strokeWidth={1.5} />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="start"
            sideOffset={8}
            collisionPadding={24}
            aria-label="添加参赛资料"
            className="z-50 w-64 origin-(--radix-dropdown-menu-content-transform-origin) rounded-3xl border border-rule bg-surface p-2 text-base text-ink shadow-lg outline-none duration-140 ease-out data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95"
          >
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
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
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
  )
}
