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
import {
  defaultLocale,
  translate,
  translateSystemText,
  type Locale,
  type Message,
} from '@/shared/i18n'

export const detailLabels: Record<string, Message> = {
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
  return (
    Boolean(supportedValue(contest, field)) ||
    hasConflict(contest, field) ||
    hasPendingEvidence(contest, field)
  )
}

export function hasPendingEvidence(contest: ContestDetail, field: string): boolean {
  return contest.fields[field]?.level === 'not_found' && conflictValues(contest, field).length > 0
}

export function displayField(
  field: string,
  item: FieldValue | undefined,
  locale: Locale = defaultLocale,
): string {
  if (!item?.value) return ''
  if (dateFields.includes(field)) return formatDate(item.value, item.precision, true, locale)
  if (field === 'mode' && modeNames[item.value]) return translate(locale, modeNames[item.value])
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

export function pendingFact(
  contest: ContestDetail,
  field: string,
  name: string,
  locale: Locale = defaultLocale,
): PendingFact {
  const label = translateSystemText(locale, name)
  const observation = contest.coverage?.fields?.[field]
  if (observation?.state === 'not_found_in_source')
    return {
      field,
      label,
      message: translate(locale, '已查来源中暂未找到{field}说明', { field: label }),
      generic: false,
    }
  if (
    observation?.state === 'source_unpublished' &&
    usableCitations(observation.citations).length > 0
  )
    return {
      field,
      label,
      message: translate(locale, '来源明确注明{field}尚未公布', { field: label }),
      generic: false,
    }
  return {
    field,
    label,
    message: translate(locale, '{field}待确认', { field: label }),
    generic: true,
  }
}

export function criticalUnknowns(
  contest: ContestDetail,
  locale: Locale = defaultLocale,
): PendingFact[] {
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
        locale,
      ),
    )
  }
  for (const [field, label] of [
    ['eligibility', '参赛资格'],
    ['entry_fee', '费用'],
  ]) {
    if (!supportedValue(contest, field!) && !hasConflict(contest, field!))
      pending.push(pendingFact(contest, field!, label!, locale))
  }
  return pending
}

export function conflictValues(
  contest: ContestDetail,
  field: string,
  locale: Locale = defaultLocale,
) {
  const seen = new Set<string>()
  return (contest.fields[field]?.sources ?? []).flatMap((source) => {
    if (!safeUrl(source.url) || !source.value?.trim() || source.stale) return []
    const value = displayField(
      field,
      {
        value: source.value,
        level: 'conflict',
        precision: source.precision ?? contest.fields[field]?.precision,
      },
      locale,
    )
    if (seen.has(value)) return []
    seen.add(value)
    return [{ value, site: source.site || source.title || translate(locale, '来源') }]
  })
}
