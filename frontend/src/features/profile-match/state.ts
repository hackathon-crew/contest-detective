import type { Profile } from '@/shared/api'

export const CONFIRMED_PROFILE_KEY = 'contest-detective.profile'

function strings(value: unknown) {
  return (
    value === undefined || (Array.isArray(value) && value.every((item) => typeof item === 'string'))
  )
}

export function loadConfirmedProfile(): Profile | null {
  try {
    const text = localStorage.getItem(CONFIRMED_PROFILE_KEY)
    if (!text) return null
    const value: unknown = JSON.parse(text)
    if (typeof value !== 'object' || !value || Array.isArray(value)) return null
    const profile = value as Record<string, unknown>
    if (
      ['identity', 'available_time', 'city', 'github', 'github_last_active_at'].some(
        (key) => profile[key] != null && typeof profile[key] !== 'string',
      )
    )
      return null
    if (
      profile.identity_kind != null &&
      !['student', 'professional'].includes(String(profile.identity_kind))
    )
      return null
    if (!strings(profile.skills) || !strings(profile.topics) || !strings(profile.preferred_modes))
      return null
    if (
      Array.isArray(profile.preferred_modes) &&
      profile.preferred_modes.some((mode) => !['online', 'offline', 'hybrid'].includes(mode))
    )
      return null
    if (profile.availability !== undefined) {
      if (typeof profile.availability !== 'object' || !profile.availability) return null
      const time = profile.availability as Record<string, unknown>
      if (
        time.weekdays !== undefined &&
        (!Array.isArray(time.weekdays) ||
          !time.weekdays.every((day) => Number.isInteger(day) && day >= 0 && day <= 6))
      )
        return null
      if (
        time.windows !== undefined &&
        (!Array.isArray(time.windows) ||
          !time.windows.every(
            (window) =>
              typeof window === 'object' &&
              window &&
              typeof window.start_at === 'string' &&
              typeof window.end_at === 'string',
          ))
      )
        return null
    }
    return profile as Profile
  } catch {
    return null
  }
}

export function saveConfirmedProfile(profile: Profile) {
  try {
    localStorage.setItem(CONFIRMED_PROFILE_KEY, JSON.stringify(profile))
  } catch {
    throw new Error('浏览器保存空间不足，请清理后重试。')
  }
}

export function mergeDraft(current: Profile, next: Profile, source: 'github' | 'resume'): Profile {
  const skills = [...new Set([...(current.skills ?? []), ...(next.skills ?? [])])].slice(0, 50)
  const topics = [...new Set([...(current.topics ?? []), ...(next.topics ?? [])])].slice(0, 50)
  if (source === 'github')
    return {
      ...current,
      skills,
      topics,
      github: next.github,
      github_evidence: next.github_evidence,
      language_repo_share: next.language_repo_share,
      github_last_active_at: next.github_last_active_at,
    }
  return {
    ...current,
    skills,
    topics,
    identity: next.identity ?? current.identity,
    identity_kind: next.identity_kind ?? current.identity_kind,
    city: next.city ?? current.city,
    available_time: next.available_time ?? current.available_time,
    preferred_modes: next.preferred_modes?.length ? next.preferred_modes : current.preferred_modes,
    availability: {
      weekdays: next.availability?.weekdays?.length
        ? next.availability.weekdays
        : current.availability?.weekdays,
      windows: next.availability?.windows?.length
        ? next.availability.windows
        : current.availability?.windows,
      max_consecutive_days:
        next.availability?.max_consecutive_days ?? current.availability?.max_consecutive_days,
    },
  }
}
