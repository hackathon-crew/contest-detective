import { Check, CircleAlert, Dot, Minus } from 'lucide-react'
import type { FieldValue } from './api'

// 只有冲突是彩色的，其余等级用墨色深浅区分。
const levels = {
  official: [Check, '官方原文'],
  reposted: [Dot, '转载'],
  conflict: [CircleAlert, '说法不一'],
  not_found: [Minus, '未找到'],
} as const
const levelColors = {
  official: 'text-level-official',
  reposted: 'text-level-reposted',
  conflict: 'text-level-conflict',
  not_found: 'text-level-not-found',
}

export function Level({ level }: { level: FieldValue['level'] }) {
  const [Icon, text] = levels[level] ?? levels.not_found
  return (
    <span className={'inline-flex items-center gap-0.5 whitespace-nowrap ' + levelColors[level]}>
      <Icon aria-hidden="true" className="size-3" strokeWidth={2.25} />
      {text}
    </span>
  )
}
