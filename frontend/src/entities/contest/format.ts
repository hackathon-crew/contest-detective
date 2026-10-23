export const fieldNames: Record<string, string> = {
  start_at: '比赛开始',
  end_at: '比赛结束',
  registration_deadline: '报名截止',
  submission_deadline: '作品提交截止',
  deadline_unspecified: '截止（未注明类型）',
  city: '城市',
  mode: '参赛形式',
  prize: '奖励',
  registration_url: '报名入口',
  organizer: '主办方',
}
export const statusNames = { upcoming: '即将开始', ongoing: '进行中', ended: '已结束' }
export const modeNames: Record<string, string> = { online: '线上', offline: '线下', hybrid: '混合' }
export const dateFields = [
  'start_at',
  'end_at',
  'registration_deadline',
  'submission_deadline',
  'deadline_unspecified',
]
export { formatDate } from '@/shared/lib/date'
export function remainingDays(value: string | null | undefined, now = new Date()) {
  if (!value) return ''
  const diff = new Date(value).getTime() - now.getTime()
  return diff <= 0 ? '已截止' : `还剩 ${Math.ceil(diff / 86_400_000)} 天`
}
export function safeUrl(value: string | null | undefined) {
  if (!value) return undefined
  try {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol) ? value : undefined
  } catch {
    return undefined
  }
}
