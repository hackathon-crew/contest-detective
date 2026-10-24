import { render } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Link, MemoryRouter, Route, Routes } from 'react-router'
import { currentUserKey } from '@/entities/user'
import type { Profile } from '@/shared/api'
import { DetectiveDock } from './detective-dock'
import { DetectivePage } from '@/pages/detective'
import { DetectiveProvider } from './detective-provider'

export function renderDetective(
  props: { profile?: Profile; onAddProfile?: () => void } = {},
  path = '/',
) {
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
            <Route path="/detective" element={<DetectivePage />} />
            <Route path="/detective/:conversationId" element={<DetectivePage />} />
          </Routes>
        </DetectiveProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}
