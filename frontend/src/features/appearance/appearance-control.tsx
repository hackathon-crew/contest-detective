import { useEffect, useState } from 'react'
import { Moon, Sun } from 'lucide-react'
import { Button } from '@/shared/ui'

type Theme = 'light' | 'dark'
const key = 'contest-detective.theme'
function initialTheme(): Theme {
  try {
    const value = localStorage.getItem(key)
    if (value === 'light' || value === 'dark') return value
  } catch {
    /* 存储被禁用时仍可在本次访问切换。 */
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}
export function AppearanceControl() {
  const [theme, setTheme] = useState<Theme>(initialTheme)
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try {
      localStorage.setItem(key, theme)
    } catch {
      /* 外观不依赖存储可用。 */
    }
  }, [theme])
  const label = theme === 'dark' ? '切换到浅色' : '切换到深色'
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={label}
      title={label}
      onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
    >
      {theme === 'dark' ? <Sun /> : <Moon />}
    </Button>
  )
}
