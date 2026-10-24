import { useState } from 'react'
import { Globe } from 'lucide-react'

/** 只把来源的站点交给 favicon 服务；不发送具体页面路径和查询参数。 */
export function SourceIcon({ url }: { url: string }) {
  const origin = new URL(url).origin
  const [failedOrigin, setFailedOrigin] = useState<string | null>(null)
  return failedOrigin === origin ? (
    <Globe className="size-4 shrink-0" aria-hidden="true" strokeWidth={1.5} />
  ) : (
    <img
      src={`https://www.google.com/s2/favicons?domain_url=${encodeURIComponent(origin)}&sz=64`}
      alt=""
      width={16}
      height={16}
      className="size-4 shrink-0 object-contain"
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailedOrigin(origin)}
    />
  )
}
