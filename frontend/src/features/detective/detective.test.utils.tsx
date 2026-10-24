import { render } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Link, MemoryRouter, Route, Routes } from 'react-router'
import { vi } from 'vitest'
import { currentUserKey } from '@/entities/user'
import type { Profile } from '@/shared/api'
import { DetectiveDock } from './detective-dock'
import { DetectivePage } from '@/pages/detective'
import { DetectiveProvider } from './detective-provider'

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
  props: { profile?: Profile; onAddProfile?: () => void } = {},
  path = '/',
) {
  stubResizeObserver()
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(currentUserKey, null)
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <DetectiveProvider scope="guest">
          <Routes>
            <Route
              path="/"
              element={
                <>
                  <Link to="/detective">侦探</Link>
                  <DetectiveDock {...props} />
                </>
              }
            />
            <Route path="/contests" element={<Link to="/detective">侦探</Link>} />
            <Route path="/detective" element={<DetectivePage />} />
            <Route path="/detective/:conversationId" element={<DetectivePage />} />
          </Routes>
        </DetectiveProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}
