// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStreamPacer } from './use-stream-pacer'

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] })
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }))
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})
const advance = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms)
  })

describe('real stream pacing', () => {
  it('ages existing characters at the current repaint even without another text batch', () => {
    const { result, rerender } = renderHook(() => useStreamPacer('已有文字', true))
    advance(48)
    const before = result.current.now
    advance(20)
    rerender()
    expect(result.current.now - before).toBe(20)
  })
  it('paces source offsets without starvation under rapid deltas, then drains after completion', () => {
    const { result, rerender, unmount } = renderHook(
      ({ answer, streaming }) => useStreamPacer(answer, streaming),
      { initialProps: { answer: '', streaming: true } },
    )
    const answer = '第一段 **粗体**，随后是正文。😀'.repeat(4)
    for (let i = 1; i <= 20; i++) {
      rerender({ answer: answer.slice(0, i), streaming: true })
      advance(5)
    }
    expect(result.current.visible.length).toBeGreaterThan(0)
    expect(result.current.visible.length).toBeLessThan(20)
    rerender({ answer, streaming: false })
    for (let i = 0; i < 100 && result.current.visible !== answer; i++) advance(48)
    expect(result.current.visible).toBe(answer)
    expect(result.current.revealedAt.length).toBe(answer.length)
    for (let i = 1; i < result.current.revealedAt.length; i++)
      expect(result.current.revealedAt[i]).toBeGreaterThanOrEqual(result.current.revealedAt[i - 1])
    advance(1100)
    expect(result.current.revealedAt).toHaveLength(0)
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
  it('never shows half an emoji and cancels all queued work on route unmount', () => {
    const { result, unmount } = renderHook(() => useStreamPacer('甲😀乙😀丙😀丁', true))
    for (let i = 0; i < 6; i++) {
      advance(48)
      expect(result.current.visible).not.toMatch(/[\uD800-\uDBFF]$/)
    }
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
  it('renders history immediately and handles corrections without dropping final content', () => {
    const { result, rerender } = renderHook(
      ({ answer, streaming }) => useStreamPacer(answer, streaming),
      { initialProps: { answer: '历史答案', streaming: false } },
    )
    expect(result.current.visible).toBe('历史答案')
    expect(vi.getTimerCount()).toBe(0)
    rerender({ answer: '更正后的全部内容', streaming: false })
    expect(result.current.visible).toBe('更正后的全部内容')
  })
  it('flushes queued text and removes animation timing when reduced motion is enabled live', () => {
    let notify!: () => void
    const media = {
      matches: false,
      addEventListener: vi.fn((_event, listener) => {
        notify = listener
      }),
      removeEventListener: vi.fn(),
    }
    vi.stubGlobal('matchMedia', () => media)
    const full = '完整回答'.repeat(40)
    const { result, unmount } = renderHook(() => useStreamPacer(full, true))
    advance(48)
    expect(result.current.visible.length).toBeLessThan(full.length)
    act(() => {
      media.matches = true
      notify()
    })
    expect(result.current.visible).toBe(full)
    expect(result.current.revealedAt).toHaveLength(0)
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})
