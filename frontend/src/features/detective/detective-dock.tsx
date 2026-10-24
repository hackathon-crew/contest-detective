import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import type { Profile } from '@/shared/api'
import type { ProfileMatchSection } from '@/features/profile-match'
import { DetectiveComposer } from './detective-composer'
import { useDetective } from './detective-context'
import './detective-composer.css'

export function DetectiveDock({
  profile,
  onAddProfile,
}: {
  profile?: Profile | null
  onAddProfile?: (section: ProfileMatchSection) => void
}) {
  const [question, setQuestion] = useState('')
  const { send } = useDetective()
  const navigate = useNavigate()
  function submit(event: FormEvent) {
    event.preventDefault()
    if (!question.trim()) return
    const id = send(question, profile)
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
      />
    </section>
  )
}
