import type { Profile } from '@/shared/api/generated'
const weekdays = '一二三四五六日'
const joinCn = (a: string[]) =>
  a.length <= 1 ? a[0] || '' : a.slice(0, -1).join('、') + '和' + a[a.length - 1]
export function profileSummary(p: Profile) {
  const who =
    p.identity?.trim() ||
    (p.identity_kind === 'student' ? '学生' : p.identity_kind === 'professional' ? '在职' : '')
  const a = [who].filter(Boolean),
    sk = p.skills ?? []
  if (sk.length)
    a.push(`会 ${sk.slice(0, 3).join('、')}${sk.length > 3 ? ` 等 ${sk.length} 项技能` : ''}`)
  if (p.topics?.length)
    a.push(`关注${/^[A-Za-z0-9]/.test(p.topics[0]!) ? ' ' : ''}${joinCn(p.topics)}`)
  const b = [],
    m = p.preferred_modes ?? [],
    city = p.city?.trim(),
    on = m.includes('online') || m.includes('hybrid'),
    off = m.includes('offline') || m.includes('hybrid')
  if (on && off) b.push(`线上或${city || '本地'}线下都能参加`)
  else if (on) b.push('想线上参加')
  else if (off) b.push(`想在${city || '本地'}线下参加`)
  const d = [...(p.availability?.weekdays ?? [])].sort()
  if (d.length === 7) b.push('每天都有空')
  else if (d.join() === '5,6') b.push('周末有空')
  else if (d.join() === '0,1,2,3,4') b.push('工作日有空')
  else if (d.length) b.push(d.map((x) => '周' + weekdays[x]).join('、') + '有空')
  if (p.availability?.max_consecutive_days)
    b.push(`最多连续投入 ${p.availability.max_consecutive_days} 天`)
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
