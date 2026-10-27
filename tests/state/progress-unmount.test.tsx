// @vitest-environment jsdom
import { act, cleanup, render, waitFor } from '@testing-library/preact'
import { h } from 'preact'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProgressMark, SectionResult } from '../../server/archive.ts'
import { ProgressProvider, useProgress } from '../../src/state/progress.tsx'
import type { Progress } from '../../src/state/progress.tsx'

vi.mock('../../src/api.ts', () => ({
  getResults: vi.fn(),
  getProgress: vi.fn(),
  putMark: vi.fn(),
  deleteMark: vi.fn(),
}))

// Records every state update so a test can see one arriving after the provider is gone.
// (Preact ignores them on an unmounted component, so the rendered output cannot show it.)
const stateSets: unknown[] = []
vi.mock('preact/hooks', async (importActual) => {
  const actual = await importActual<typeof import('preact/hooks')>()
  return {
    ...actual,
    useState: (initial: unknown) => {
      const [value, set] = actual.useState(initial)
      return [value, (next: unknown) => (stateSets.push(next), set(next as never))]
    },
  }
})
const api = await import('../../src/api.ts')
const getResults = vi.mocked(api.getResults)
const getProgress = vi.mocked(api.getProgress)
const putMark = vi.mocked(api.putMark)

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

function mount(): { out: { latest: Progress | undefined }; unmount: () => void } {
  const out: { latest: Progress | undefined } = { latest: undefined }
  function Probe() {
    out.latest = useProgress()
    return null
  }
  const view = render(h(ProgressProvider, null, h(Probe, null)))
  return { out, unmount: view.unmount }
}

/** A real macrotask, so Response bodies and every pending promise have had time to settle. */
const settle = (): Promise<void> => act(() => new Promise<void>((resolve) => setTimeout(resolve, 30)))

beforeEach(() => {
  stateSets.length = 0
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('[]', { status: 200 })),
  )
  getResults.mockReset().mockResolvedValue([])
  getProgress.mockReset().mockResolvedValue([])
  putMark.mockReset().mockResolvedValue({ chapter: 4, kind: 'override', at: 1 })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('ProgressProvider after unmount', () => {
  it('sets no state when the initial load finishes after the unmount', async () => {
    const slow = deferred<SectionResult[]>()
    getResults.mockReturnValue(slow.promise)
    const { out, unmount } = mount()
    expect(out.latest?.status).toBe('loading')
    unmount()
    stateSets.length = 0
    slow.resolve([])
    await settle()
    expect(getResults).toHaveBeenCalled()
    expect(stateSets).toEqual([])
  })

  it('sets no state when a failing initial load finishes after the unmount', async () => {
    const slow = deferred<SectionResult[]>()
    getResults.mockReturnValue(slow.promise.then(() => Promise.reject(new Error('down'))))
    const { unmount } = mount()
    unmount()
    stateSets.length = 0
    slow.resolve([])
    await settle()
    expect(stateSets).toEqual([])
  })

  it('sets no state when setMark is in flight at the unmount, even though it still reloads', async () => {
    const { out, unmount } = mount()
    await waitFor(() => expect(out.latest?.status).toBe('ready'))
    const write = deferred<ProgressMark>()
    putMark.mockReturnValue(write.promise)
    const done = out.latest!.setMark(4, 'override')
    unmount()
    stateSets.length = 0
    const callsBefore = getProgress.mock.calls.length
    write.resolve({ chapter: 4, kind: 'override', at: 1 })
    await act(async () => {
      await done
    })
    await settle()
    expect(getProgress.mock.calls.length).toBeGreaterThan(callsBefore) // the reload did run
    expect(stateSets).toEqual([])
  })
})
