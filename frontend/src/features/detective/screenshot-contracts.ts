/** Screenshot input is untrusted text, not source evidence or a verdict. */
export type ScreenshotMime = 'image/png' | 'image/jpeg' | 'image/webp'

export interface ScreenshotClaimCandidate {
  id: string
  text: string
  recognition_confidence: number | null
}

export interface ScreenshotExtraction {
  status: 'review_required' | 'no_text'
  text: string
  claims: ScreenshotClaimCandidate[]
  recognition_confidence: number | null
  quality: 'usable' | 'low_confidence' | 'no_text'
  warnings: ('low_confidence' | 'small_text')[]
  source: { width: number; height: number; content_type: ScreenshotMime }
}

export interface ScreenshotRecognitionOptions {
  signal: AbortSignal
  onProgress?: (progress: number) => void
}

/** Implementations recognize local image bytes and do not perform verification. */
export type ScreenshotRecognizer = (
  file: File,
  options: ScreenshotRecognitionOptions,
) => Promise<ScreenshotExtraction>

/** Only selected, corrected text is forwarded after explicit user confirmation. */
export interface ScreenshotConfirmation {
  question: string
  mode: 'realtime' | 'deep'
  confirmed_claims: { id: string; text: string; origin: 'screenshot' }[]
}
