// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { Octopus } from './Octopus'
import { mountOctopus } from './inkpaw-octopus'
vi.mock('./inkpaw-octopus', () => ({ mountOctopus: vi.fn() }))
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})
it('keeps a visible brand image when WebGL cannot initialize', () => {
  vi.mocked(mountOctopus).mockReturnValue(null)
  render(<Octopus size={240} />)
  const image = screen.getByRole('img', { name: 'Inkpaw 八爪鱼' })
  expect(image.querySelector('img')?.getAttribute('src')).toContain('octo-search')
})
it('reuses the renderer for mood and size changes and releases it on unmount', () => {
  const canvas = document.createElement('canvas')
  const handle = {
    canvas,
    set: vi.fn(),
    resize: vi.fn(),
    poke: vi.fn(),
    setBook: vi.fn(),
    stop: vi.fn(() => canvas.remove()),
  }
  vi.mocked(mountOctopus).mockImplementation((host) => {
    host.append(canvas)
    return handle
  })
  const view = render(<Octopus size={360} mood="search" />)
  view.rerender(<Octopus size={240} mood="read" />)
  expect(mountOctopus).toHaveBeenCalledTimes(1)
  expect(handle.set).toHaveBeenLastCalledWith('read')
  expect(handle.resize).toHaveBeenLastCalledWith(240)
  view.unmount()
  expect(handle.stop).toHaveBeenCalledOnce()
  expect(document.querySelector('canvas')).toBeNull()
})
