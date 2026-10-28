import { render } from '@testing-library/react'
import { StrictMode, useEffect } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Link, MemoryRouter, Route, Routes } from 'react-router'
import { vi } from 'vitest'
import { currentUserKey } from '@/entities/user'
import type { Profile } from '@/shared/api'
import { DetectiveDock } from './detective-dock'
import { DetectivePage } from '@/pages/detective'
import { DetectiveProvider } from './detective-provider'
import { useDetective } from './detective-context'
import type { DetectiveSession } from './sessions'

let renderedSessions: DetectiveSession[] = []
export function readRenderedSessions() {
  return renderedSessions
}
function CaptureSessions() {
  const { sessions } = useDetective()
  useEffect(() => {
    renderedSessions = sessions
  }, [sessions])
  return null
}

vi.mock('@/shared/ui/octopus/inkpaw-octopus', () => ({ mountOctopus: () => null }))

export function stubResizeObserver() {
  if (typeof ResizeObserver !== 'undefined') return
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
}

export function renderDetective(
  props: { profile?: Profile; onAddProfile?: () => void; savedSessions?: DetectiveSession[] } = {},
  path = '/',
) {
  stubResizeObserver()
  const { savedSessions = [], ...dockProps } = props
  const remote = [...savedSessions]
  const transport = globalThis.fetch
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).endsWith('/account/conversations/import')) {
      remote.push(...JSON.parse(String(init?.body)).sessions)
      return Response.json({ code: 200, message: 'ok', data: null })
    }
    if (String(input).endsWith('/account/conversations'))
      return Response.json({ code: 200, message: 'ok', data: remote })
    return transport(input, init)
  })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(currentUserKey, {
    id: 'test-account',
    username: 'test@example.org',
    profile: props.profile ?? {},
  })
  return render(
    <StrictMode>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[path]}>
          <DetectiveProvider scope="test-account">
            <CaptureSessions />
            <Routes>
              <Route
                path="/"
                element={
                  <>
                    <Link to="/detective">侦探</Link>
                    <DetectiveDock {...dockProps} />
                  </>
                }
              />
              <Route path="/contests" element={<Link to="/detective">侦探</Link>} />
              <Route path="/detective" element={<DetectivePage />} />
              <Route path="/detective/:conversationId" element={<DetectivePage />} />
            </Routes>
          </DetectiveProvider>
        </MemoryRouter>
      </QueryClientProvider>
    </StrictMode>,
  )
}
