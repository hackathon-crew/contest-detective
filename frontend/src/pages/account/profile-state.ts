import type { Profile } from '@/shared/api/generated'
import { defaultLocale, translate, type Locale } from '@/shared/i18n'

const weekdays = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'] as const
const englishList = new Intl.ListFormat('en')
const joinCn = (a: string[]) =>
  a.length <= 1 ? a[0] || '' : a.slice(0, -1).join('、') + '和' + a[a.length - 1]
export function profileSummary(p: Profile, locale: Locale = defaultLocale) {
  const t = translate.bind(null, locale)
  const separator = locale === 'en' ? ', ' : '、'
  const who =
    p.identity?.trim() ||
    (p.identity_kind === 'student'
      ? t('学生')
      : p.identity_kind === 'professional'
        ? t('在职')
        : '')
  const a = [who].filter(Boolean),
    sk = p.skills ?? []
  if (sk.length)
    a.push(
      t('会 {skills}{more}', {
        skills: sk.slice(0, 3).join(separator),
        more: sk.length > 3 ? t(' 等 {count} 项技能', { count: sk.length }) : '',
      }),
    )
  if (p.topics?.length)
    a.push(
      t('关注{topics}', {
        topics:
          locale === 'en'
            ? englishList.format(p.topics)
            : (/^[A-Za-z0-9]/.test(p.topics[0]!) ? ' ' : '') + joinCn(p.topics),
      }),
    )
  const b = [],
    m = p.preferred_modes ?? [],
    city = p.city?.trim(),
    on = m.includes('online') || m.includes('hybrid'),
    off = m.includes('offline') || m.includes('hybrid')
  if (on && off) b.push(t('线上或{city}线下都能参加', { city: city || t('本地') }))
  else if (on) b.push(t('想线上参加'))
  else if (off) b.push(t('想在{city}线下参加', { city: city || t('本地') }))
  const d = [...(p.availability?.weekdays ?? [])].sort()
  if (d.length === 7) b.push(t('每天都有空'))
  else if (d.join() === '5,6') b.push(t('周末有空'))
  else if (d.join() === '0,1,2,3,4') b.push(t('工作日有空'))
  else if (d.length)
    b.push(t('{days}有空', { days: d.map((day) => t(weekdays[day])).join(separator) }))
  if (p.availability?.max_consecutive_days)
    b.push(t('最多连续投入 {days} 天', { days: p.availability.max_consecutive_days }))
  if (locale === 'en') return [...a, ...b].map((part) => part + '.').join(' ')
  return (a.length ? a.join('，') + '。' : '') + (b.length ? b.join('，') + '。' : '')
}
export function dirtyFields(a: Profile, b: Profile) {
  return Object.keys({ ...a, ...b }).filter((k) => {
    const norm = (v: unknown) =>
      JSON.stringify(Array.isArray(v) && typeof v[0] !== 'object' ? [...v].sort() : v)
    return norm(a[k as keyof Profile]) !== norm(b[k as keyof Profile])
  }).length
}
export function mergeDraft(current: Profile, draft: Profile): Profile {
  const skills = [...new Set([...(current.skills ?? []), ...(draft.skills ?? [])])].slice(0, 50)
  return {
    ...current,
    ...Object.fromEntries(
      Object.entries(draft).filter(
        ([k, v]) =>
          !['skills', 'skill_sources', 'topics', 'availability'].includes(k) &&
          v != null &&
          v !== '' &&
          (!Array.isArray(v) || v.length),
      ),
    ),
    skills,
    topics: [...new Set([...(current.topics ?? []), ...(draft.topics ?? [])])].slice(0, 50),
    skill_sources: Object.fromEntries(
      skills.map((skill) => [
        skill,
        [
          ...new Set([
            ...(current.skill_sources?.[skill] ?? []),
            ...(draft.skill_sources?.[skill] ?? []),
          ]),
        ],
      ]),
    ),
    availability: current.availability,
  }
}
