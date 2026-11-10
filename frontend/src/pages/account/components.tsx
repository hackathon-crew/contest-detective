import { Collapsible, CollapsibleContent, ToggleGroup, ToggleGroupItem } from '@huyanxius/ui'
import { createContext, useContext, useState, type ReactNode } from 'react'
import {
  ArrowRight,
  Bell,
  BellOff,
  Bookmark,
  Calendar,
  Check,
  ChevronDown,
  Copy,
  Cpu,
  Download,
  Eye,
  EyeOff,
  FileText,
  Globe,
  KeyRound,
  Mail,
  Minus,
  Plus,
  RefreshCw,
  Search,
  Send,
  Settings,
  Upload,
  User,
  X,
} from 'lucide-react'
import { useLocale } from '@/shared/i18n/locale-context'

const icons = {
  'arrow-right': ArrowRight,
  bell: Bell,
  'bell-off': BellOff,
  bookmark: Bookmark,
  calendar: Calendar,
  check: Check,
  'chev-down': ChevronDown,
  copy: Copy,
  cpu: Cpu,
  download: Download,
  eye: Eye,
  'eye-off': EyeOff,
  file: FileText,
  globe: Globe,
  key: KeyRound,
  mail: Mail,
  minus: Minus,
  plus: Plus,
  refresh: RefreshCw,
  search: Search,
  send: Send,
  settings: Settings,
  upload: Upload,
  user: User,
  x: X,
}
export function Ic({
  name,
  large = false,
  label,
}: {
  name: keyof typeof icons | 'github'
  large?: boolean
  label?: string
}) {
  if (name === 'github')
    return (
      <svg
        className={large ? 'ic ic-20' : 'ic'}
        viewBox="0 0 24 24"
        aria-hidden={label ? undefined : true}
        aria-label={label}
        role={label ? 'img' : undefined}
      >
        <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4" />
        <path d="M9 18c-4.51 2-5-2-7-2" />
      </svg>
    )
  const Component = icons[name]
  return (
    <Component
      className={large ? 'ic ic-20' : 'ic'}
      strokeWidth={1.75}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? 'img' : undefined}
    />
  )
}
export type NoticeAction = { label: string; run: () => void }
export const NoticeContext = createContext<(text: string, action?: NoticeAction) => void>(() => {})
export const useNotice = () => useContext(NoticeContext)
export function Row({
  label,
  small,
  children,
}: {
  label: string
  small?: string
  children: ReactNode
}) {
  return (
    <div className="row">
      <div className="lbl">
        {label}
        {small && <small>{small}</small>}
      </div>
      <div className="ctl">{children}</div>
    </div>
  )
}
export function Segments<T extends string | number>({
  values,
  value,
  change,
  label,
  id,
}: {
  values: readonly (readonly [T, string])[]
  value: T | undefined | null
  change: (v: T) => void
  label: string
  id?: string
}) {
  return (
    <ToggleGroup
      type="single"
      unstyled
      className="seg"
      aria-label={label}
      id={id}
      value={value == null ? '' : String(value)}
      onValueChange={(next) => {
        if (next) change(values.find(([v]) => String(v) === next)![0])
      }}
    >
      {values.map(([v, text]) => (
        <ToggleGroupItem key={v} value={String(v)}>
          {text}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}
export function Chips<T extends string | number>({
  values,
  selected,
  change,
  label,
}: {
  values: readonly (readonly [T, string])[]
  selected: readonly T[]
  change: (v: T[]) => void
  label?: string
}) {
  return (
    <ToggleGroup
      type="multiple"
      unstyled
      className="chips"
      aria-label={label}
      value={selected.map(String)}
      onValueChange={(next) =>
        change(next.map((key) => values.find(([v]) => String(v) === key)![0]))
      }
    >
      {values.map(([v, text]) => (
        <ToggleGroupItem className="cchip" key={v} value={String(v)}>
          {text}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}
export function Tags({
  values,
  change,
  placeholder,
  sources,
}: {
  values: string[]
  change: (v: string[]) => void
  placeholder: string
  sources?: Record<string, ('github' | 'resume' | 'manual')[]>
}) {
  const { t } = useLocale()
  const [input, setInput] = useState('')
  function add() {
    const v = input.trim().replace(/[,，]$/, '')
    if (v && !values.includes(v) && values.length < 50) change([...values, v])
    setInput('')
  }
  return (
    <div className="tags">
      {values.map((v) => (
        <span
          className="chipx"
          key={v}
          title={
            sources?.[v]
              ?.map((s) =>
                s === 'github'
                  ? t('从 GitHub 仓库读出')
                  : s === 'resume'
                    ? t('从简历读出')
                    : t('自己填的'),
              )
              .join('、') || t('自己填的')
          }
        >
          {sources?.[v]?.includes('github') && <Ic name="github" label={t('来自 GitHub')} />}
          {sources?.[v]?.includes('resume') && <Ic name="file" label={t('来自简历')} />}
          {v}
          <button
            type="button"
            aria-label={t('去掉{value}', { value: v })}
            onClick={() => change(values.filter((x) => x !== v))}
          >
            <Ic name="x" />
          </button>
        </span>
      ))}
      <input
        className="tag-add"
        value={input}
        maxLength={80}
        placeholder={placeholder}
        aria-label={placeholder}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return
          if (['Enter', ',', '，'].includes(e.key)) {
            e.preventDefault()
            add()
          } else if (e.key === 'Backspace' && !input) change(values.slice(0, -1))
        }}
      />
    </div>
  )
}
export function Expand({ open, children }: { open: boolean; children: ReactNode }) {
  return (
    <Collapsible className="expand" open={open} inert={!open}>
      <CollapsibleContent forceMount>
        <div className="expand-in">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  )
}
export function SecretField({
  label,
  value,
  change,
  placeholder,
}: {
  label: string
  value: string
  change: (s: string) => void
  placeholder?: string
}) {
  const { t } = useLocale()
  const [shown, setShown] = useState(false)
  return (
    <span className="inp-wrap w-md">
      <input
        className="inp"
        type={shown ? 'text' : 'password'}
        value={value}
        onChange={(e) => change(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        aria-label={label}
      />
      <button
        className="iconbtn"
        type="button"
        aria-label={shown ? t('隐藏密钥') : t('显示密钥')}
        onClick={() => setShown(!shown)}
      >
        <Ic name={shown ? 'eye-off' : 'eye'} />
      </button>
    </span>
  )
}
export async function copy(value: string, notice: (s: string) => void) {
  try {
    await navigator.clipboard.writeText(value)
    notice('已复制')
  } catch {
    notice('复制失败，请选择文本复制')
  }
}
export const failure = (e: unknown) => (e instanceof Error ? e.message : '操作失败，请重试')
