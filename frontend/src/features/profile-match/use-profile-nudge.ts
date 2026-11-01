import { useEffect, useRef, useState } from 'react'
import type { Profile } from '@/shared/api'

let cooldownUntil = 0

export function hasProfileData(profile: Profile | null | undefined) {
  return Boolean(
    profile?.github ||
    profile?.skills?.length ||
    profile?.topics?.length ||
    profile?.identity ||
    profile?.identity_kind ||
    profile?.city ||
    profile?.available_time ||
    profile?.preferred_modes?.length ||
    profile?.availability?.weekdays?.length ||
    profile?.availability?.windows?.length ||
    profile?.availability?.max_consecutive_days,
  )
}

/** 加号提示与角色提示共用关闭冷却；切页后仍沿用同一次关闭。 */
export function useProfileNudge({
  profile,
  enabled = true,
  guideEligible = false,
  answerId,
}: {
  profile: Profile | null | undefined
  enabled?: boolean
  guideEligible?: boolean
  answerId?: string
}) {
  const [requested, setRequested] = useState(false)
  const [guideDismissed, setGuideDismissed] = useState(false)
  const [coolingUntil, setCoolingUntil] = useState(cooldownUntil)
  const [now, setNow] = useState(Date.now)
  const previousAnswer = useRef(answerId)
  const hasProfile = hasProfileData(profile)
  useEffect(() => {
    if (!enabled || hasProfile) return
    const first = setTimeout(() => setRequested(true), 1200)
    const repeat = setInterval(() => setRequested(true), 60_000)
    return () => {
      clearTimeout(first)
      clearInterval(repeat)
    }
  }, [enabled, hasProfile])
  useEffect(() => {
    if (answerId && answerId !== previousAnswer.current) setRequested(true)
    previousAnswer.current = answerId
  }, [answerId])
  useEffect(() => {
    const timer = setTimeout(() => setNow(Date.now()), Math.max(0, coolingUntil - Date.now()))
    return () => clearTimeout(timer)
  }, [coolingUntil])
  function cool() {
    cooldownUntil = Date.now() + 45_000
    setCoolingUntil(cooldownUntil)
    setNow(Date.now())
    setGuideDismissed(true)
  }
  const cooling = now < coolingUntil
  const guideVisible = enabled && !hasProfile && guideEligible && !guideDismissed && !cooling
  return {
    hasProfile,
    guideVisible,
    visible: enabled && !hasProfile && requested && !guideVisible && !cooling,
    request() {
      cooldownUntil = 0
      setCoolingUntil(0)
      setGuideDismissed(true)
      setRequested(true)
    },
    dismiss() {
      setRequested(false)
      cool()
    },
    dismissGuide: cool,
  }
}
