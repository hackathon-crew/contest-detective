import { apiClient, type MatchItem, type Profile, type PublicUser } from '@/shared/api'

export function githubDraft(username: string, signal: AbortSignal) {
  return apiClient.request<Profile>('/profile/github', {
    method: 'POST',
    json: { username },
    signal,
  })
}

export function resumeDraft(file: File, signal: AbortSignal) {
  if (file.size > 2 * 1024 * 1024) throw new Error('简历不能超过 2MiB')
  const extension = file.name.split('.').at(-1)?.toLowerCase()
  if (!extension || !['pdf', 'docx', 'txt'].includes(extension))
    throw new Error('请上传 PDF、DOCX 或 TXT 简历。')
  return apiClient.request<Profile>('/profile/resume', {
    method: 'POST',
    body: file,
    query: { filename: `resume.${extension}` },
    headers: { 'content-type': 'application/octet-stream' },
    signal,
  })
}

export function confirmAccountProfile(profile: Profile, signal: AbortSignal) {
  return apiClient.request<PublicUser>('/user/profile', { method: 'PUT', json: profile, signal })
}

export function matchProfile(profile: Profile, signal: AbortSignal) {
  return apiClient.request<MatchItem[]>('/match', { method: 'POST', json: profile, signal })
}
