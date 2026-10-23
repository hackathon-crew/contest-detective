/**
 * 常驻底部的侦探：接收列表回答不了的问题，查证过程按 SSE 事件逐条显示，
 * 结论里每个日期附出处。事件格式随后端 agent 模块定，这里先只有输入条。
 */
export function DetectiveDock() {
  return (
    <section aria-label="侦探" className="fixed inset-x-4 bottom-4 z-10 mx-auto max-w-[720px]">
      <form
        className="flex items-center gap-2 rounded-2xl border border-rule bg-surface p-2"
        onSubmit={(event) => event.preventDefault()}
      >
        <input
          disabled
          aria-label="问侦探"
          placeholder="问侦探：这周末有哪些线上黑客松"
          className="h-10 min-w-0 flex-1 bg-transparent px-3 text-sm text-ink outline-none placeholder:text-faint"
        />
        <button
          type="submit"
          disabled
          className="h-10 rounded-xl bg-accent px-4 text-sm font-medium text-on-accent disabled:opacity-40"
        >
          查证
        </button>
      </form>
    </section>
  )
}
