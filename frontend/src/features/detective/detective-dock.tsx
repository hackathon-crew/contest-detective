import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import type { Profile } from '@/shared/api'
import type { VerificationOptions } from './verification-contracts'
import { DetectiveComposer, type DetectiveContextAction } from './detective-composer'
import { useDetective } from './detective-context'
import './detective-composer.css'

export function DetectiveDock({
  profile,
  onAddProfile,
}: {
  profile?: Profile | null
  onAddProfile?: (section: DetectiveContextAction) => void
}) {
  const [question, setQuestion] = useState('')
  const { send } = useDetective()
  const navigate = useNavigate()
  function submit(event: FormEvent, verification?: VerificationOptions) {
    event.preventDefault()
    if (!question.trim()) return
    const id = send(question, profile, undefined, verification)
    setQuestion('')
    navigate(`/detective/${id}`)
  }
  return (
    <section aria-label="侦探" className="detective-dock fixed inset-x-6 bottom-4 z-10 mx-auto">
      <DetectiveComposer
        value={question}
        pending={false}
        onChange={setQuestion}
        onSubmit={submit}
        onStop={() => {}}
        onAddProfile={onAddProfile}
        onVerifyScreenshot={({ question: screenshotQuestion, ...verification }) => {
          const id = send(screenshotQuestion, profile, undefined, verification)
          navigate(`/detective/${id}`)
        }}
      />
    </section>
  )
}
