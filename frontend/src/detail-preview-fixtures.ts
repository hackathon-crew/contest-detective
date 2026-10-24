import type { ContestDetail } from '@/shared/api'
import fullSnapshot from '../preview/detail-full-public-snapshot.json'
import conflictSnapshot from '../preview/detail-conflict-public-snapshot.json'
import longRewardSnapshot from '../preview/detail-long-reward-public-snapshot.json'
import fullCover from '../preview/covers/detail-huairou.webp'
import conflictCover from '../preview/covers/detail-calhacks.png'
import longRewardCover from '../preview/covers/detail-mcd.webp'
import historyImage1 from '../preview/covers/detail-mcd-history-1.png'
import historyImage2 from '../preview/covers/detail-mcd-history-2.png'
import historyImage3 from '../preview/covers/detail-mcd-history-3.png'
import historyImage4 from '../preview/covers/detail-mcd-history-4.webp'

// The JSON files retain the complete public API response and its capture metadata.
// Only image transport changes to local, byte-identical copies for offline CI.
const localHistoryImages: Record<string, string> = {
  'https://cdn-waic.waytoagi.com/covers/85b39e5adfc9963d.png': historyImage1,
  'https://cdn-waic.waytoagi.com/covers/f02c30f91efef0ec.png': historyImage2,
  'https://cdn-waic.waytoagi.com/covers/a13451aa13669815.png': historyImage3,
  'https://cdn-waic.waytoagi.com/covers/27f1475a93d96e3e.webp': historyImage4,
}
const localHistory = Object.entries(localHistoryImages).reduce(
  (summary, [source, asset]) => summary.replaceAll(source, new URL(asset, location.origin).href),
  longRewardSnapshot.response.data.summary,
)
export const previewClock = '2026-10-24T21:35:51Z'
export const publicFull: ContestDetail = {
  ...(fullSnapshot.response.data as ContestDetail),
  cover_url: new URL(fullCover, location.origin).href,
}
export const publicConflict: ContestDetail = {
  ...(conflictSnapshot.response.data as ContestDetail),
  cover_url: new URL(conflictCover, location.origin).href,
}
export const publicLongReward: ContestDetail = {
  ...(longRewardSnapshot.response.data as ContestDetail),
  cover_url: new URL(longRewardCover, location.origin).href,
  summary: localHistory,
}

// This boundary sample is deliberately synthetic, named as such wherever rendered.
// Missing information is not represented as an organizer's confirmed nonpublication.
export const sparseSample: ContestDetail = {
  id: 'preview-sparse-only',
  name: '信息待完善的比赛 · 预览样本',
  cover_url: null,
  status: 'upcoming',
  fields: {
    registration_deadline: { value: null, level: 'not_found', sources: [] },
    submission_deadline: { value: null, level: 'not_found', sources: [] },
    mode: { value: null, level: 'not_found', sources: [] },
    eligibility: { value: null, level: 'not_found', sources: [] },
    entry_fee: { value: null, level: 'not_found', sources: [] },
  },
  introduction: null,
  coverage: {
    introduction: { state: 'not_fetched' },
    fields: {
      registration_deadline: { state: 'not_fetched' },
      submission_deadline: { state: 'not_fetched' },
      mode: { state: 'not_fetched' },
      eligibility: { state: 'not_fetched' },
      entry_fee: { state: 'fetch_failed' },
    },
    sources: {},
  },
  documents: [],
  summary: null,
}

export const detailPreviewScenarios = {
  full: publicFull,
  conflict: publicConflict,
  sparse: sparseSample,
  'long-reward': publicLongReward,
} as const
export type DetailPreviewScenario = keyof typeof detailPreviewScenarios
