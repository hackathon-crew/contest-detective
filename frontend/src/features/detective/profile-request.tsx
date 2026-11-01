import { Button } from '@/shared/ui'

export function ProfileRequestMessage({
  question,
  onConnect,
}: {
  question: string
  onConnect: () => void
}) {
  return (
    <article className="detective-turn" aria-label={`关于${question}的对话`}>
      <div className="detective-turn__question">
        <p>{question}</p>
      </div>
      <div className="detective-profile-request">
        <p>连上 GitHub，我按你的项目和技术栈接着找。</p>
        <Button size="sm" onClick={onConnect}>
          连接 GitHub
        </Button>
      </div>
    </article>
  )
}
