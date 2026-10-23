/** 一条 SSE 事件。只做协议层解析，事件里装什么由各业务自己定。 */
export interface ServerSentEvent {
  /** 事件名；后端没写 `event:` 行时按协议记为 message。 */
  event: string
  /** 多行 `data:` 按换行拼起来的原文，JSON 由调用方自己解析。 */
  data: string
  /** 后端写了 `id:` 行才有，否则为 null。 */
  id: string | null
}

function parseBlock(block: string): ServerSentEvent | null {
  let event = 'message'
  let id: string | null = null
  const data: string[] = []

  for (const line of block.split('\n')) {
    // 冒号开头是注释，后端常用它做心跳，不产生事件
    if (line.startsWith(':')) continue
    const separator = line.indexOf(':')
    const field = separator < 0 ? line : line.slice(0, separator)
    const raw = separator < 0 ? '' : line.slice(separator + 1)
    const value = raw.startsWith(' ') ? raw.slice(1) : raw
    if (field === 'event') event = value
    else if (field === 'data') data.push(value)
    else if (field === 'id') id = value
  }

  // 没有 data 行的块按协议不派发，例如只有注释的心跳
  return data.length === 0 ? null : { event, data: data.join('\n'), id }
}

/**
 * 把响应体解析成事件序列。事件以空行分隔，可能被网络拆在任意位置，所以先攒进缓冲区，
 * 凑齐一个空行才解析一块。流结束时缓冲区里没收到空行的半块按协议丢弃。
 * 调用方提前 break 时会取消底层的流，连接随之关闭。
 */
export async function* readEventStream(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<ServerSentEvent> {
  const reader = body.getReader()
  // stream 模式下，被拆在两块之间的多字节汉字会等下一块到了再一起解码
  const decoder = new TextDecoder()
  let buffer = ''
  let finished = false

  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) {
        finished = true
        return
      }

      buffer += decoder.decode(value, { stream: true })
      // 行尾统一成 \n。末尾单独一个 \r 可能是被拆开的 \r\n，留到下一块再处理，
      // 否则 \r 和下一块开头的 \n 会被当成两次换行，凭空多出一个事件边界。
      const heldBack = buffer.endsWith('\r') ? '\r' : ''
      buffer = (heldBack ? buffer.slice(0, -1) : buffer).replace(/\r\n?/g, '\n')

      let boundary = buffer.indexOf('\n\n')
      while (boundary >= 0) {
        const event = parseBlock(buffer.slice(0, boundary))
        buffer = buffer.slice(boundary + 2)
        if (event) yield event
        boundary = buffer.indexOf('\n\n')
      }
      buffer += heldBack
    }
  } finally {
    // 流已经出错时 cancel 会以同一个错误拒绝，原错误已经在往外抛，这里不再重复
    if (!finished) await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}
