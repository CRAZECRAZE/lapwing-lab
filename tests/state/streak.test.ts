// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/preact'
import { h } from 'preact'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStreak } from '../../src/state/streak.ts'

vi.mock('../../src/api.ts', () => ({ getDays: vi.fn() }))
const api = await import('../../src/api.ts')
const getDays = vi.mocked(api.getDays)

const day = (date: string) => ({ date, tests: 1, strokes: 10, activeMs: 60000 })

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: Error) => void } {
  let resolve!: (v: T) => void
  let reject!: (e: Error) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/** Mounts a component that mirrors the hook into `out.latest`. */
function mount(key: string): { out: { latest: number | null | undefined }; rerender: (key: string) => void } {
  const out: { latest: number | null | undefined } = { latest: undefined }
  function Probe({ k }: { k: string }) {
    out.latest = useStreak(k)
    return null
  }
  const view = render(h(Probe, { k: key }))
  return { out, rerender: (k) => view.rerender(h(Probe, { k })) }
}

const flush = (): Promise<void> => act(async () => {})

describe('useStreak', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 9, 27, 12, 0, 0))
    getDays.mockReset()
  })
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('asks for the last 400 days and is null while loading', async () => {
    getDays.mockReturnValue(new Promise(() => {}))
    const { out } = mount('/a')
    await flush()
    expect(out.latest).toBeNull()
    expect(getDays).toHaveBeenCalledWith('2025-09-22', '2026-10-27')
  })

  it('counts today when today has practice', async () => {
    getDays.mockResolvedValue([day('2026-10-25'), day('2026-10-26'), day('2026-10-27')])
    const { out } = mount('/a')
    await flush()
    expect(out.latest).toBe(3)
  })

  it('counts from yesterday when today is still empty', async () => {
    getDays.mockResolvedValue([day('2026-10-25'), day('2026-10-26')])
    const { out } = mount('/a')
    await flush()
    expect(out.latest).toBe(2)
  })

  it('is 0 when there is no recent practice', async () => {
    getDays.mockResolvedValue([day('2026-10-20')])
    const { out } = mount('/a')
    await flush()
    expect(out.latest).toBe(0)
  })

  it('is null when the load fails', async () => {
    getDays.mockRejectedValue(new Error('down'))
    const { out } = mount('/a')
    await flush()
    expect(out.latest).toBeNull()
  })

  it('reloads when the key changes and keeps the old value while it does', async () => {
    getDays.mockResolvedValueOnce([day('2026-10-27')])
    const { out, rerender } = mount('/a')
    await flush()
    expect(out.latest).toBe(1)

    const second = deferred<ReturnType<typeof day>[]>()
    getDays.mockReturnValueOnce(second.promise)
    rerender('/b')
    await flush()
    expect(getDays).toHaveBeenCalledTimes(2)
    expect(out.latest).toBe(1)
    second.resolve([day('2026-10-26'), day('2026-10-27')])
    await flush()
    expect(out.latest).toBe(2)
  })

  it('does not reload for a re-render with the same key', async () => {
    getDays.mockResolvedValue([day('2026-10-27')])
    const { rerender } = mount('/a')
    await flush()
    rerender('/a')
    await flush()
    expect(getDays).toHaveBeenCalledTimes(1)
  })

  it('evaluates today when the load starts, not when the app opened', async () => {
    getDays.mockResolvedValue([])
    const { rerender } = mount('/a')
    await flush()
    vi.setSystemTime(new Date(2026, 9, 28, 9, 0, 0))
    rerender('/b')
    await flush()
    expect(getDays).toHaveBeenLastCalledWith('2025-09-23', '2026-10-28')
  })

  it('ignores a slower earlier response that arrives after a later one', async () => {
    const slow = deferred<ReturnType<typeof day>[]>()
    const fast = deferred<ReturnType<typeof day>[]>()
    getDays.mockReturnValueOnce(slow.promise).mockReturnValueOnce(fast.promise)
    const { out, rerender } = mount('/a')
    rerender('/b')
    await flush()
    fast.resolve([day('2026-10-26'), day('2026-10-27')])
    await flush()
    expect(out.latest).toBe(2)
    slow.resolve([day('2026-10-27')])
    await flush()
    expect(out.latest).toBe(2)
  })

  it('ignores a response that arrives after unmount', async () => {
    const pending = deferred<ReturnType<typeof day>[]>()
    getDays.mockReturnValue(pending.promise)
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    mount('/a')
    cleanup()
    pending.resolve([day('2026-10-27')])
    await flush()
    expect(logged).not.toHaveBeenCalled()
    logged.mockRestore()
  })
})
