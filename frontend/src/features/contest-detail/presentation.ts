import {
  dateFields,
  fieldNames,
  formatDate,
  libraryDate,
  modeNames,
  safeUrl,
  usableCitations,
  type ContestDetail,
  type FieldValue,
} from '@/entities/contest'

export const detailLabels: Record<string, string> = {
  ...fieldNames,
  eligibility: '参赛资格',
  entry_requirements: '参赛与作品要求',
  mode: '参赛方式',
  prize: '奖励',
  deadline_unspecified: '截止日期（类型待确认）',
}

export function hasConflict(contest: ContestDetail, field: string): boolean {
  return (
    contest.fields[field]?.level === 'conflict' ||
    contest.coverage?.fields?.[field]?.state === 'conflict'
  )
}

/** A visible fact still needs a usable source; a populated string is not verification. */
export function supportedValue(contest: ContestDetail, field: string): string | null {
  const item = contest.fields[field]
  if (!item?.value?.trim() || item.level === 'not_found' || hasConflict(contest, field)) return null
  if (dateFields.includes(field) && !Number.isFinite(Date.parse(item.value))) return null
  const hasSource = item.sources?.some((source) => !source.stale && safeUrl(source.url))
  const hasCitation = usableCitations(contest.coverage?.fields?.[field]?.citations).length > 0
  return hasSource || hasCitation ? item.value.trim() : null
}

export function showField(contest: ContestDetail, field: string): boolean {
  return Boolean(supportedValue(contest, field)) || hasConflict(contest, field)
}

export function displayField(field: string, item: FieldValue | undefined): string {
  if (!item?.value) return ''
  if (dateFields.includes(field)) return formatDate(item.value, item.precision, true)
  if (field === 'mode') return modeNames[item.value] ?? item.value
  return item.value
}

export function nextDetailDate(contest: ContestDetail, now = new Date()) {
  // The existing deterministic date selection is retained, but unresolved claims cannot win it.
  const fields = { ...contest.fields }
  for (const field of dateFields) {
    if (!supportedValue(contest, field)) delete fields[field]
  }
  return libraryDate({ ...contest, fields }, now)
}

export interface PendingFact {
  field: string
  label: string
  message: string
  generic: boolean
}

export function pendingFact(contest: ContestDetail, field: string, label: string): PendingFact {
  const observation = contest.coverage?.fields?.[field]
  if (observation?.state === 'not_found_in_source')
    return { field, label, message: `已查来源中暂未找到${label}说明`, generic: false }
  if (
    observation?.state === 'source_unpublished' &&
    usableCitations(observation.citations).length > 0
  )
    return { field, label, message: `来源明确注明${label}尚未公布`, generic: false }
  return { field, label, message: `${label}待确认`, generic: true }
}

export function criticalUnknowns(contest: ContestDetail): PendingFact[] {
  const pending: PendingFact[] = []
  const registration = supportedValue(contest, 'registration_deadline')
  const submission = supportedValue(contest, 'submission_deadline')
  const unspecified = supportedValue(contest, 'deadline_unspecified')
  if (
    !registration &&
    !hasConflict(contest, 'registration_deadline') &&
    !hasConflict(contest, 'deadline_unspecified')
  ) {
    pending.push(
      pendingFact(
        contest,
        'registration_deadline',
        submission || unspecified ? '报名截止' : '截止时间',
      ),
    )
  }
  for (const [field, label] of [
    ['eligibility', '参赛资格'],
    ['entry_fee', '费用'],
  ]) {
    if (!supportedValue(contest, field!) && !hasConflict(contest, field!))
      pending.push(pendingFact(contest, field!, label!))
  }
  return pending
}

export function conflictValues(contest: ContestDetail, field: string) {
  const seen = new Set<string>()
  return (contest.fields[field]?.sources ?? []).flatMap((source) => {
    if (!safeUrl(source.url) || !source.value?.trim() || source.stale) return []
    const value = displayField(field, {
      value: source.value,
      level: 'conflict',
      precision: source.precision ?? contest.fields[field]?.precision,
    })
    if (seen.has(value)) return []
    seen.add(value)
    return [{ value, site: source.site || source.title || '来源' }]
  })
}
