// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { DetectiveProvider } from './detective-provider'
import { useDetective } from './detective-context'
import type { VerificationOptions } from './verification-contracts'
import { currentUserKey } from '@/entities/user'

beforeEach(() => localStorage.clear())
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function Submit({ options }: { options?: VerificationOptions }) {
  const { send } = useDetective()
  return <button onClick={() => send('核实比赛截止', null, undefined, options)}>发送核验</button>
}

it.each([
  undefined,
  {
    mode: 'deep',
    confirmed_claims: [{ id: 'c1', text: '比赛提交截止 10 月 25 日', origin: 'screenshot' }],
  },
] as (VerificationOptions | undefined)[])('只转发明确选择的核验选项 %j', async (options) => {
  const fetch = vi.fn(
    async (_input?: RequestInfo | URL, _init?: RequestInit) =>
      new Response('event: answer\ndata: {"content":"尚未核实。","sources":[]}\n\n', {
        headers: { 'content-type': 'text/event-stream' },
      }),
  )
  vi.stubGlobal('fetch', fetch)
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) =>
    String(input).endsWith('/account/conversations')
      ? Promise.resolve(Response.json({ code: 200, message: 'ok', data: [] }))
      : fetch(input, init),
  )
  const client = new QueryClient()
  client.setQueryData(currentUserKey, {
    id: 'options-test',
    username: 'options@example.org',
    profile: {},
  })
  render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <DetectiveProvider scope="options-test">
          <Submit options={options} />
        </DetectiveProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  )
  await act(async () => fireEvent.click(screen.getByText('发送核验')))
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
  const body = JSON.parse(
    (fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string,
  )
  expect(body).toEqual({
    investigation_id: expect.any(String),
    conversation_id: expect.any(String),
    turn_id: expect.any(String),
    question: '核实比赛截止',
    ...options,
  })
})
