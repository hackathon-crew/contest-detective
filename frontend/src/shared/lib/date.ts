import { format } from 'date-fns'
import { enUS, zhCN } from 'date-fns/locale'
import { TZDate } from '@date-fns/tz'
import { defaultLocale, translate, type Locale } from '@/shared/i18n'

export function formatDate(
  value: string | null | undefined,
  precision: 'day' | 'datetime' = 'datetime',
  showYear = false,
  locale: Locale = defaultLocale,
) {
  if (!value) return translate(locale, '未找到')
  const date = new TZDate(value, precision === 'day' ? 'UTC' : 'Asia/Shanghai')
  if (Number.isNaN(date.getTime())) return translate(locale, '未找到')
  const day =
    locale === 'en' ? (showYear ? 'MMM d, yyyy' : 'MMM d') : showYear ? 'yyyy年M月d日' : 'M月d日'
  const options = { locale: locale === 'en' ? enUS : zhCN }
  if (precision === 'day')
    return translate(locale, '{date}（时刻未核实）', { date: format(date, day, options) })
  return format(date, `${day} HH:mm`, options)
}
