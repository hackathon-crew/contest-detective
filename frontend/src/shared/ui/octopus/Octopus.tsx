import { useEffect, useRef, useState } from 'react'
import fallbackImage from '@/shared/assets/mascot/octo-search.png'
import { mountOctopus, type Mood, type OctopusHandle } from './inkpaw-octopus'

interface Props {
  size: number
  mood?: Mood
  bookColor?: string
  shadow?: boolean
  res?: number
  className?: string
  label?: string
}

export function Octopus({
  size,
  mood = 'search',
  bookColor,
  shadow,
  res = 120,
  className,
  label = 'Inkpaw 八爪鱼',
}: Props) {
  const host = useRef<HTMLDivElement>(null)
  const handle = useRef<OctopusHandle | null>(null)
  const [fallback, setFallback] = useState(false)
  const initial = useRef({ size, mood, bookColor, shadow })
  useEffect(() => {
    if (!host.current) return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setFallback(true)
      return
    }
    const options = initial.current
    const renderer = mountOctopus(host.current, {
      cssWidth: options.size,
      w: res,
      h: res,
      mood: options.mood,
      bookColor: options.bookColor,
      shadow: options.shadow,
    })
    handle.current = renderer
    setFallback(!renderer)
    return () => {
      renderer?.stop()
      handle.current = null
    }
  }, [res])
  useEffect(() => {
    handle.current?.set(mood)
  }, [mood])
  useEffect(() => {
    handle.current?.resize(size)
  }, [size])
  useEffect(() => {
    if (bookColor) handle.current?.setBook(bookColor)
  }, [bookColor])
  const scale = Math.max(1, Math.floor(size / res))
  return (
    <div
      ref={host}
      className={className}
      style={{ width: size, height: size, display: 'grid', placeItems: 'center' }}
      role="img"
      aria-label={label}
      onClick={() => handle.current?.poke()}
    >
      {fallback && (
        <img
          src={fallbackImage}
          width={106 * scale}
          height={85 * scale}
          alt=""
          style={{ imageRendering: 'pixelated' }}
        />
      )}
    </div>
  )
}
