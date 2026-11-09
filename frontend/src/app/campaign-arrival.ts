import { apiClient } from '@/shared/api'

const campaign = 'inkpaw_launch_202611'
const channels = ['x', 'xiaohongshu', 'reddit', 'github'] as const
const visitorKey = 'inkpaw:campaign-visitor'

export async function recordCampaignArrival(search: string) {
  const params = new URLSearchParams(search)
  if (params.get('utm_campaign') !== campaign) return
  const source = channels.find((channel) => channel === params.get('utm_source'))
  if (!source) return
  const content = params.get('utm_content') ?? ''

  try {
    let visitorId = localStorage.getItem(visitorKey)
    if (!visitorId) {
      visitorId = crypto.randomUUID()
      localStorage.setItem(visitorKey, visitorId)
    }
    await apiClient.request<null>('/auth/campaign-visit', {
      method: 'POST',
      json: {
        campaign,
        visitor_id: visitorId,
        source,
        content: /^[a-z0-9_-]{0,48}$/.test(content) ? content : '',
      },
    })
  } catch (error) {
    console.warn('Could not record campaign arrival', error)
  }
}
