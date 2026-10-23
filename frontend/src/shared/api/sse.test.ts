import { describe, expect, it } from 'vitest'

import { readEventStream, type ServerSentEvent } from './sse'

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })
}

async function collect(chunks: string[]): Promise<ServerSentEvent[]> {
  const events: ServerSentEvent[] = []
  for await (const event of readEventStream(streamOf(chunks))) events.push(event)
  return events
}

describe('readEventStream', () => {
  it('把拆在任意位置的分块拼回完整事件', async () => {
    const events = await collect(['event: step\nda', 'ta: {"n":1}\n', '\ndata: {"n":2}\n\n'])

    expect(events).toEqual([
      { event: 'step', data: '{"n":1}', id: null },
      { event: 'message', data: '{"n":2}', id: null },
    ])
  })

  it('汉字的字节被拆在两块之间时不出乱码', async () => {
    const bytes = new TextEncoder().encode('data: 侦探\n\n')
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        // 「侦」占 3 个字节，从第 7 个字节处切开，正好劈在它中间
        controller.enqueue(bytes.slice(0, 7))
        controller.enqueue(bytes.slice(7))
        controller.close()
      },
    })
    const events: ServerSentEvent[] = []
    for await (const event of readEventStream(body)) events.push(event)

    expect(events).toEqual([{ event: 'message', data: '侦探', id: null }])
  })

  it('多行 data 用换行拼接', async () => {
    const events = await collect(['data: 第一行\ndata: 第二行\n\n'])

    expect(events).toEqual([{ event: 'message', data: '第一行\n第二行', id: null }])
  })

  it('跳过注释行和只有注释的心跳块', async () => {
    const events = await collect([': ping\n\n', ': 进度\nid: 7\ndata: ok\n\n'])

    expect(events).toEqual([{ event: 'message', data: 'ok', id: '7' }])
  })

  it('CRLF 被拆在两块之间时不会多出事件边界', async () => {
    const events = await collect(['data: a\r', '\ndata: b\r\n\r\n'])

    expect(events).toEqual([{ event: 'message', data: 'a\nb', id: null }])
  })

  it('流结束时没收到空行的半块按协议丢弃', async () => {
    const events = await collect(['data: 完整\n\n', 'data: 半块'])

    expect(events).toEqual([{ event: 'message', data: '完整', id: null }])
  })

  it('提前停止读取时取消底层的流', async () => {
    let cancelled = false
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: 1\n\ndata: 2\n\n'))
      },
      cancel() {
        cancelled = true
      },
    })

    for await (const event of readEventStream(body)) {
      expect(event.data).toBe('1')
      break
    }
    expect(cancelled).toBe(true)
  })
})
