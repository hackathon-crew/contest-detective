import { format } from 'date-fns'
import { zhCN } from 'date-fns/locale'
import { TZDate } from '@date-fns/tz'
export function formatDate(value: string | null | undefined) {
  if (!value) return '未找到'
  const date = new TZDate(value, 'Asia/Shanghai')
  return Number.isNaN(date.getTime()) ? '未找到' : format(date, 'M月d日 HH:mm', { locale: zhCN })
}
