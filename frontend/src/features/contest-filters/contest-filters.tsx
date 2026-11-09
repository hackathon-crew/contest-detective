import { useEffect, useRef, type ReactNode } from 'react'
import { Check, X } from 'lucide-react'
import {
  countFilter,
  type FilterKey,
  type LibraryContest,
  type LibraryFilters,
} from '@/entities/contest'
import { useLocale } from '@/shared/i18n/locale-context'

export function ContestFilters({
  contests,
  filters,
  follows,
  cities,
  onChange,
  onClear,
  activeCount,
  total,
  open,
  onClose,
  calendar,
  actions,
}: {
  contests: LibraryContest[]
  filters: LibraryFilters
  follows: string[]
  cities: string[]
  onChange: (patch: Partial<LibraryFilters>) => void
  onClear: () => void
  activeCount: number
  total: number
  open: boolean
  onClose: () => void
  calendar: ReactNode
  actions?: ReactNode
}) {
  const { t } = useLocale()
  const aside = useRef<HTMLElement>(null)
  useEffect(() => {
    if (!open) return
    const previous = document.activeElement as HTMLElement | null
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    aside.current?.querySelector<HTMLButtonElement>('.sheet-x')?.focus({ preventScroll: true })
    function keydown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
      if (event.key !== 'Tab') return
      const controls = [
        ...(aside.current?.querySelectorAll<HTMLElement>('button,a,input') ?? []),
      ].filter((el) => el.getClientRects().length > 0)
      const first = controls[0],
        last = controls.at(-1)
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last?.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first?.focus()
      }
    }
    document.addEventListener('keydown', keydown)
    return () => {
      document.body.style.overflow = overflow
      document.removeEventListener('keydown', keydown)
      previous?.focus({ preventScroll: true })
    }
  }, [open, onClose])
  function option(
    key: FilterKey,
    value: string | boolean,
    label: string,
    kind: 'radio' | 'multi' | 'toggle' | 'chips',
  ) {
    const selected =
      kind === 'multi' || kind === 'chips'
        ? (filters[key] as string[]).includes(String(value))
        : kind === 'toggle'
          ? !!filters[key]
          : filters[key] === value
    const count = countFilter(contests, filters, key, value, follows)
    return (
      <button
        key={key + String(value)}
        className={
          (kind === 'chips' ? 'cchip' : 'opt' + (kind === 'radio' ? ' radio' : '')) +
          (count === 0 && !selected ? ' zero' : '')
        }
        type="button"
        aria-pressed={selected}
        onClick={() => {
          const next =
            kind === 'multi' || kind === 'chips'
              ? selected
                ? (filters[key] as string[]).filter((v) => v !== value)
                : [...(filters[key] as string[]), String(value)]
              : kind === 'toggle'
                ? !selected
                : value
          onChange({ [key]: next })
        }}
      >
        {kind !== 'chips' && (
          <span className="box">
            <Check className="ic" />
          </span>
        )}
        {label}
        <span className="n">{count}</span>
      </button>
    )
  }
  return (
    <>
      <div className={'sheet-scrim' + (open ? ' open' : '')} aria-hidden="true" onClick={onClose} />
      <aside
        ref={aside}
        className={'side' + (open ? ' open' : '')}
        aria-label={t('筛选')}
        role={open ? 'dialog' : undefined}
        aria-modal={open ? true : undefined}
      >
        {calendar}
        <div className="side-head">
          <h2>{t('筛选')}</h2>
          {activeCount > 0 && (
            <button className="linkbtn" type="button" onClick={onClear}>
              {t('清除全部')}
            </button>
          )}
          <button className="sheet-x" type="button" aria-label={t('关闭筛选')} onClick={onClose}>
            <X className="ic ic-20" />
          </button>
        </div>
        {actions}
        <div className="groups">
          <div className="fg">
            <h3>{t('状态')}</h3>
            {[
              ['all', t('全部')],
              ['upcoming', t('即将开始')],
              ['ongoing', t('进行中')],
              ['ended', t('已结束')],
            ].map(([value, label]) => option('status', value!, label!, 'radio'))}
          </div>
          <div className="fg">
            <h3>{t('截止时间')}</h3>
            {[
              ['all', t('不限')],
              ['0', t('今天截止')],
              ['7', t('7 天内')],
              ['30', t('30 天内')],
              ['later', t('30 天以后')],
              ['none', t('没写截止时间')],
            ].map(([value, label]) => option('due', value!, label!, 'radio'))}
          </div>
          <div className="fg">
            <h3>{t('参赛形式')}</h3>
            {[
              ['online', t('线上')],
              ['offline', t('线下')],
              ['hybrid', t('线上+线下')],
            ].map(([value, label]) => option('modes', value!, label!, 'multi'))}
          </div>
          {!!cities.length && (
            <div className="fg">
              <h3>{t('城市')}</h3>
              <div className="cities">
                {cities.map((city) => option('cities', city, city, 'chips'))}
              </div>
            </div>
          )}
          <div className="fg">
            <h3>{t('其他')}</h3>
            {option('prize', true, t('写明了奖金'), 'toggle')}
            {option('official', true, t('截止时间对过原文'), 'toggle')}
            {option('mine', true, t('只看我关注的'), 'toggle')}
          </div>
        </div>
        <div className="sheet-foot">
          <button className="site-button site-button--primary" type="button" onClick={onClose}>
            {t(total === 1 ? '看 1 场' : '看 {count} 场', { count: total })}
          </button>
        </div>
      </aside>
    </>
  )
}
