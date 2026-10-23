import { format } from 'date-fns'
import { zhCN } from 'date-fns/locale'
import { TZDate } from '@date-fns/tz'
export function formatDate(
  value: string | null | undefined,
  precision: 'day' | 'datetime' = 'datetime',
  showYear = false,
) {
  if (!value) return '未找到'
  const date = new TZDate(value, precision === 'day' ? 'UTC' : 'Asia/Shanghai')
  if (Number.isNaN(date.getTime())) return '未找到'
  const day = showYear ? 'yyyy年M月d日' : 'M月d日'
  return precision === 'day'
    ? `${format(date, day, { locale: zhCN })}（时刻未核实）`
    : format(date, `${day} HH:mm`, { locale: zhCN })
}
