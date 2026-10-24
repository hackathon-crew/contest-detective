import { ArrowUp, Plus, Square } from 'lucide-react'
import type { FormEvent, Ref } from 'react'

export function DetectiveComposer({
  value,
  pending,
  onChange,
  onSubmit,
  onStop,
  onAddProfile,
  inputRef,
}: {
  value: string
  pending: boolean
  onChange: (value: string) => void
  onSubmit: (event: FormEvent) => void
  onStop: () => void
  onAddProfile?: () => void
  inputRef?: Ref<HTMLTextAreaElement>
}) {
  return (
    <form
      className="detective-composer"
      data-multiline={value.includes('\n') || value.length > 40}
      data-filled={value.length > 0}
      onSubmit={onSubmit}
    >
      <button
        type="button"
        className="detective-composer__add"
        aria-label="添加简历或参赛资料"
        title="添加简历或参赛资料"
        disabled={pending || !onAddProfile}
        onClick={onAddProfile}
      >
        <Plus aria-hidden="true" strokeWidth={1.5} />
      </button>
      <textarea
        ref={inputRef}
        aria-label="问侦探"
        placeholder="问一个问题"
        value={value}
        rows={1}
        disabled={pending}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (
            event.key === 'Enter' &&
            !event.shiftKey &&
            !event.nativeEvent.isComposing &&
            event.keyCode !== 229
          ) {
            event.preventDefault()
            event.currentTarget.form?.requestSubmit()
          }
        }}
      />
      <button
        type={pending ? 'button' : 'submit'}
        className="detective-composer__send"
        aria-label={pending ? '停止查证' : '查证'}
        title={pending ? '停止查证' : '查证'}
        disabled={!pending && !value.trim()}
        onClick={pending ? onStop : undefined}
      >
        {pending ? (
          <Square aria-hidden="true" fill="currentColor" />
        ) : (
          <ArrowUp aria-hidden="true" />
        )}
      </button>
    </form>
  )
}
