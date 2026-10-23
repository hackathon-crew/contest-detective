import { createParser } from 'eventsource-parser'

/** 协议层事件；业务载荷由各 feature 校验。 */
export interface ServerSentEvent {
  event: string
  data: string
  id: string | null
}

/** 取消迭代时取消底层连接；未以空行结束的最后半帧留给解析器丢弃。 */
export async function* readEventStream(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<ServerSentEvent> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  const queue: ServerSentEvent[] = []
  const parser = createParser({
    maxBufferSize: 1_048_576,
    onEvent: (event) =>
      queue.push({ event: event.event ?? 'message', data: event.data, id: event.id ?? null }),
    onError: (error) => {
      if (error.type === 'max-buffer-size-exceeded') throw error
    },
  })
  let finished = false
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) {
        finished = true
        return
      }
      parser.feed(decoder.decode(value, { stream: true }))
      for (const event of queue.splice(0)) yield event
    }
  } finally {
    if (!finished) await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}
