// 只有 CORS 读取成功的图像进入 Canvas，跨域拒绝、超时或损坏都只省掉封面。
const cache = new Map()
export function loadImage(src) {
  if (!src) return Promise.resolve(null)
  if (!cache.has(src))
    cache.set(
      src,
      (async () => {
        let objectUrl
        try {
          const response = await fetch(src, {
            mode: 'cors',
            credentials: 'omit',
            signal: AbortSignal.timeout(3500),
          })
          if (!response.ok) return null
          objectUrl = URL.createObjectURL(await response.blob())
          const image = new Image()
          image.src = objectUrl
          await image.decode()
          return image
        } catch {
          return null
        } finally {
          if (objectUrl) URL.revokeObjectURL(objectUrl)
        }
      })(),
    )
  return cache.get(src)
}
