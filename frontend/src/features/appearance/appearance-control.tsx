import { useEffect, useSyncExternalStore } from 'react'
import { Moon, Sun } from 'lucide-react'
import { Button } from '@/shared/ui'
import '@/shared/ui/site.css'
type Theme = 'system' | 'light' | 'dark'
const key = 'contest-detective.theme'
const changed = 'contest-detective-theme'
let memory: Theme = 'system'
function read(): Theme {
  try {
    const value = localStorage.getItem(key)
    return value === 'dark' || value === 'light' ? value : 'system'
  } catch {
    return memory
  }
}
function subscribe(notify: () => void) {
  const storage = (event: StorageEvent) => {
    if (event.key === key || event.key === null) notify()
  }
  window.addEventListener(changed, notify)
  window.addEventListener('storage', storage)
  return () => {
    window.removeEventListener(changed, notify)
    window.removeEventListener('storage', storage)
  }
}
function select(theme: Theme) {
  memory = theme
  try {
    localStorage.setItem(key, theme)
  } catch {
    /* 本次访问仍可切换外观。 */
  }
  window.dispatchEvent(new Event(changed))
}
export function AppearanceControl({ segmented = false }: { segmented?: boolean }) {
  const theme = useSyncExternalStore(subscribe, read)
  useEffect(() => {
    if (theme === 'system') delete document.documentElement.dataset.theme
    else document.documentElement.dataset.theme = theme
  }, [theme])
  const dark =
    theme === 'dark' ||
    (theme === 'system' && !!window.matchMedia?.('(prefers-color-scheme: dark)').matches)
  if (segmented)
    return (
      <div className="site-seg" role="group" aria-label="外观">
        {(
          [
            ['system', '跟随系统'],
            ['light', '浅色'],
            ['dark', '深色'],
          ] as const
        ).map(([value, label]) => (
          <button
            type="button"
            key={value}
            aria-pressed={theme === value}
            onClick={() => select(value)}
          >
            {label}
          </button>
        ))}
      </div>
    )
  const label = dark ? '切换到浅色' : '切换到深色'
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={label}
      title={label}
      onClick={() => select(dark ? 'light' : 'dark')}
    >
      {dark ? <Sun /> : <Moon />}
    </Button>
  )
}
