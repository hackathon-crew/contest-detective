import { Check, Globe } from 'lucide-react'
import { DropdownMenu } from 'radix-ui'
import {
  useLanguagePreference,
  useLocale,
  type LanguagePreference,
} from '@/shared/i18n/locale-context'
import { Button } from './button'

export function LanguageControl() {
  const { t } = useLocale()
  const setting = useLanguagePreference()
  if (!setting) return null
  const label = t('界面语言')
  const options = [
    { value: 'browser', name: t('跟随浏览器') },
    { value: 'zh-CN', name: '简体中文', lang: 'zh-CN' },
    { value: 'en', name: 'English', lang: 'en' },
  ] as const
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <Button size="icon" variant="ghost" aria-label={label} title={label}>
          <Globe aria-hidden="true" size={18} strokeWidth={1.75} />
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={8}
          collisionPadding={12}
          aria-label={label}
          className="z-50 min-w-40 origin-(--radix-dropdown-menu-content-transform-origin) rounded-xl border border-rule bg-surface p-1 text-sm text-ink shadow-lg outline-none duration-140 ease-out data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95"
        >
          <DropdownMenu.RadioGroup
            value={setting.preference}
            onValueChange={(value) => setting.choose(value as LanguagePreference)}
          >
            {options.map((option) => (
              <DropdownMenu.RadioItem
                key={option.value}
                value={option.value}
                lang={'lang' in option ? option.lang : undefined}
                className="flex min-h-9 cursor-pointer items-center justify-between gap-3 rounded-lg px-3 outline-none data-highlighted:bg-surface-strong"
              >
                {option.name}
                <DropdownMenu.ItemIndicator>
                  <Check aria-hidden="true" size={16} strokeWidth={1.75} />
                </DropdownMenu.ItemIndicator>
              </DropdownMenu.RadioItem>
            ))}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
