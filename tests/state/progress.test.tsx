// @vitest-environment jsdom
import { act, cleanup, render, waitFor } from '@testing-library/preact'
import { h } from 'preact'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChapterInfo, PracticeIndexEntry } from '../../scripts/build-content.ts'
import type { ProgressMark, SectionResult } from '../../server/archive.ts'
import { isLocked, ProgressProvider, useProgress } from '../../src/state/progress.tsx'
import type { Progress } from '../../src/state/progress.tsx'

vi.mock('../../src/api.ts', () => ({
  getResults: vi.fn(),
  getProgress: vi.fn(),
  putMark: vi.fn(),
  deleteMark: vi.fn(),
}))
const api = await import('../../src/api.ts')
const getResults = vi.mocked(api.getResults)
const getProgress = vi.mocked(api.getProgress)
const putMark = vi.mocked(api.putMark)
const deleteMark = vi.mocked(api.deleteMark)

const chapters: ChapterInfo[] = [
  { chapter: 4, pageId: 'ch-4', title: 'Chapter 4', gate: 'stage0', passMark: { accuracy: 0.9 }, listIds: [] },
  { chapter: 5, pageId: 'ch-5', title: 'Chapter 5', gate: 'drills', listIds: ['5-a'] },
]
const index: PracticeIndexEntry[] = [{ id: '5-a', chapter: 5, items: 10 }]
const passed = (section: string): SectionResult => ({
  section,
  runs: 1,
  passed: true,
  best: { accuracy: 0.95, wpm: 30 },
  last: { accuracy: 0.95, wpm: 30, endedAt: 1, passed: true },
})
const override4: ProgressMark = { chapter: 4, kind: 'override', at: 1 }

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: Error) => void } {
  let resolve!: (v: T) => void
  let reject!: (e: Error) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

let failContent = false
let fetchMock: ReturnType<typeof vi.fn>

function mount(): { out: { latest: Progress | undefined }; unmount: () => void } {
  const out: { latest: Progress | undefined } = { latest: undefined }
  function Probe() {
    out.latest = useProgress()
    return null
  }
  const view = render(h(ProgressProvider, null, h(Probe, null)))
  return { out, unmount: view.unmount }
}

const flush = (): Promise<void> => act(async () => {})
/** Waits for the first load to finish (the content comes through real Response bodies, which take a few ticks). */
const settled = (out: { latest: Progress | undefined }): Promise<void> =>
  waitFor(() => expect(out.latest?.status).not.toBe('loading'))

beforeEach(() => {
  failContent = false
  fetchMock = vi.fn(async (url: string) => {
    if (failContent) return new Response('boom', { status: 500 })
    if (url === '/content/chapters.json') return new Response(JSON.stringify(chapters), { status: 200 })
    if (url === '/content/practice-index.json') return new Response(JSON.stringify(index), { status: 200 })
    return new Response('{}', { status: 404 })
  })
  vi.stubGlobal('fetch', fetchMock)
  getResults.mockReset().mockResolvedValue([])
  getProgress.mockReset().mockResolvedValue([])
  putMark.mockReset().mockResolvedValue(override4)
  deleteMark.mockReset().mockResolvedValue(undefined)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('ProgressProvider', () => {
  it('is loading, then ready with the content and the chapter states', async () => {
    const { out } = mount()
    expect(out.latest?.status).toBe('loading')
    expect(out.latest?.states.size).toBe(0)
    await settled(out)
    expect(out.latest?.status).toBe('ready')
    expect(out.latest?.chapters).toEqual(chapters)
    expect(out.latest?.index).toEqual(index)
    expect([...out.latest!.states.keys()]).toEqual([4, 5])
    expect(out.latest!.states.get(5)).toMatchObject({ locked: true, blockedBy: 4 })
    expect(isLocked(out.latest!, 5)).toBe(true)
    expect(isLocked(out.latest!, 4)).toBe(false)
    expect(isLocked(out.latest!, 99)).toBe(false)
    expect(getResults.mock.calls.map((c) => c[0]).sort()).toEqual(['chapter-test', 'section', 'stage0'])
  })

  it('exposes results and marks as loaded', async () => {
    getResults.mockImplementation(async (mode) => (mode === 'stage0' ? [passed('pseudo-test')] : []))
    getProgress.mockResolvedValue([override4])
    const { out } = mount()
    await settled(out)
    expect(out.latest?.results.stage0).toEqual([passed('pseudo-test')])
    expect(out.latest?.results.section).toEqual([])
    expect(out.latest?.marks).toEqual([override4])
    expect(out.latest!.states.get(4)?.cleared).toBe(true)
  })

  it('a failed results call is an error with no states, nothing locked, and reload recovers', async () => {
    getResults.mockRejectedValueOnce(new Error('down'))
    const { out } = mount()
    await settled(out)
    expect(out.latest?.status).toBe('error')
    expect(out.latest?.states.size).toBe(0)
    expect(isLocked(out.latest!, 5)).toBe(false)
    await act(async () => {
      await out.latest!.reload()
    })
    expect(out.latest?.status).toBe('ready')
    expect(isLocked(out.latest!, 5)).toBe(true)
  })

  it('a failed progress call is an error with no states', async () => {
    getProgress.mockRejectedValueOnce(new Error('down'))
    const { out } = mount()
    await settled(out)
    expect(out.latest?.status).toBe('error')
    expect(out.latest?.states.size).toBe(0)
  })

  it('a failed content fetch is an error, and a later reload retries it', async () => {
    failContent = true
    const { out } = mount()
    await settled(out)
    expect(out.latest?.status).toBe('error')
    expect(out.latest?.states.size).toBe(0)
    expect(isLocked(out.latest!, 5)).toBe(false)
    failContent = false
    await act(async () => {
      await out.latest!.reload()
    })
    expect(out.latest?.status).toBe('ready')
    expect(out.latest?.chapters).toEqual(chapters)
  })

  it('keeps the loaded content when only the progress call fails, with no states, and reload recovers without the static files', async () => {
    getProgress.mockRejectedValueOnce(new Error('down'))
    const { out } = mount()
    await settled(out)
    expect(out.latest?.status).toBe('error')
    expect(out.latest?.chapters).toEqual(chapters)
    expect(out.latest?.index).toEqual(index)
    expect(out.latest?.states.size).toBe(0)
    expect(isLocked(out.latest!, 5)).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    await act(async () => {
      await out.latest!.reload()
    })
    expect(out.latest?.status).toBe('ready')
    expect(out.latest?.chapters).toEqual(chapters)
    expect(isLocked(out.latest!, 5)).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('keeps the loaded content when only a results call fails, and through a second failure', async () => {
    getResults.mockRejectedValue(new Error('down'))
    const { out } = mount()
    await settled(out)
    expect(out.latest?.status).toBe('error')
    expect(out.latest?.chapters).toEqual(chapters)
    expect(out.latest?.index).toEqual(index)
    expect(out.latest?.states.size).toBe(0)
    expect(isLocked(out.latest!, 5)).toBe(false)
    await act(async () => {
      await out.latest!.reload()
    })
    expect(out.latest?.status).toBe('error')
    expect(out.latest?.chapters).toEqual(chapters)
    expect(out.latest?.states.size).toBe(0)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    getResults.mockResolvedValue([])
    await act(async () => {
      await out.latest!.reload()
    })
    expect(out.latest?.status).toBe('ready')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('has no content when the static fetch fails, and a later reload fetches the static files again', async () => {
    failContent = true
    const { out } = mount()
    await settled(out)
    expect(out.latest?.status).toBe('error')
    expect(out.latest?.chapters).toEqual([])
    expect(out.latest?.index).toEqual([])
    expect(out.latest?.states.size).toBe(0)
    const before = fetchMock.mock.calls.length
    failContent = false
    await act(async () => {
      await out.latest!.reload()
    })
    expect(fetchMock.mock.calls.length).toBe(before + 2)
    expect(out.latest?.status).toBe('ready')
    expect(out.latest?.chapters).toEqual(chapters)
    expect(out.latest?.index).toEqual(index)
  })

  it('a content file that is not a list is an error', async () => {
    fetchMock.mockImplementation(async () => new Response('{}', { status: 200 }))
    const { out } = mount()
    await settled(out)
    expect(out.latest?.status).toBe('error')
  })

  it('reload refetches only the dynamic resources once the content has loaded', async () => {
    const { out } = mount()
    await settled(out)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    await act(async () => {
      await out.latest!.reload()
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(getResults).toHaveBeenCalledTimes(6)
    expect(getProgress).toHaveBeenCalledTimes(2)
  })

  it('keeps status ready, with the previous data, while a reload is in flight', async () => {
    const { out } = mount()
    await settled(out)
    const slow = deferred<ProgressMark[]>()
    getProgress.mockReturnValueOnce(slow.promise)
    let done!: Promise<void>
    await act(async () => {
      done = out.latest!.reload()
    })
    expect(out.latest?.status).toBe('ready')
    expect(isLocked(out.latest!, 5)).toBe(true)
    slow.resolve([override4])
    await act(async () => {
      await done
    })
    expect(out.latest?.status).toBe('ready')
    expect(isLocked(out.latest!, 5)).toBe(false)
  })

  it('a slow earlier reload cannot overwrite a newer one', async () => {
    const { out } = mount()
    await settled(out)
    const slow = deferred<ProgressMark[]>()
    getProgress.mockReturnValueOnce(slow.promise)
    let first!: Promise<void>
    let second!: Promise<void>
    await act(async () => {
      first = out.latest!.reload()
    })
    getProgress.mockResolvedValueOnce([override4])
    await act(async () => {
      second = out.latest!.reload()
      await second
    })
    expect(out.latest?.marks).toEqual([override4])
    expect(isLocked(out.latest!, 5)).toBe(false)
    slow.resolve([])
    await act(async () => {
      await first
    })
    expect(out.latest?.marks).toEqual([override4])
    expect(isLocked(out.latest!, 5)).toBe(false)
  })

  it('a slow failure of an earlier reload cannot turn a newer ready state into an error', async () => {
    const { out } = mount()
    await settled(out)
    const slow = deferred<ProgressMark[]>()
    getProgress.mockReturnValueOnce(slow.promise)
    let first!: Promise<void>
    await act(async () => {
      first = out.latest!.reload()
    })
    await act(async () => {
      await out.latest!.reload()
    })
    slow.reject(new Error('late'))
    await act(async () => {
      await first
    })
    expect(out.latest?.status).toBe('ready')
  })

  it('setMark writes, then the new state is visible', async () => {
    const { out } = mount()
    await settled(out)
    expect(isLocked(out.latest!, 5)).toBe(true)
    getProgress.mockResolvedValue([override4])
    await act(async () => {
      await out.latest!.setMark(4, 'override')
    })
    expect(putMark).toHaveBeenCalledWith(4, 'override')
    expect(out.latest?.marks).toEqual([override4])
    expect(isLocked(out.latest!, 5)).toBe(false)
  })

  it('clearMark deletes, then the new state is visible', async () => {
    getProgress.mockResolvedValue([override4])
    const { out } = mount()
    await settled(out)
    expect(isLocked(out.latest!, 5)).toBe(false)
    getProgress.mockResolvedValue([])
    await act(async () => {
      await out.latest!.clearMark(4)
    })
    expect(deleteMark).toHaveBeenCalledWith(4)
    expect(isLocked(out.latest!, 5)).toBe(true)
  })

  it('a failed write rejects and leaves the state unchanged', async () => {
    const { out } = mount()
    await settled(out)
    putMark.mockRejectedValueOnce(new Error('nope'))
    let error: unknown
    await act(async () => {
      await out.latest!.setMark(4, 'override').catch((e: unknown) => (error = e))
    })
    expect((error as Error).message).toBe('nope')
    expect(out.latest?.status).toBe('ready')
    expect(isLocked(out.latest!, 5)).toBe(true)
    expect(getProgress).toHaveBeenCalledTimes(1)

    deleteMark.mockRejectedValueOnce(new Error('nope again'))
    error = undefined
    await act(async () => {
      await out.latest!.clearMark(4).catch((e: unknown) => (error = e))
    })
    expect((error as Error).message).toBe('nope again')
    expect(out.latest?.status).toBe('ready')
  })

  it('a failed reload after setMark is an error with no states, keeping the content', async () => {
    const { out } = mount()
    await settled(out)
    getProgress.mockRejectedValueOnce(new Error('down'))
    await act(async () => {
      await out.latest!.setMark(4, 'override')
    })
    expect(putMark).toHaveBeenCalled()
    expect(out.latest?.status).toBe('error')
    expect(out.latest?.states.size).toBe(0)
    expect(isLocked(out.latest!, 5)).toBe(false)
    expect(out.latest?.chapters).toEqual(chapters)
    expect(out.latest?.index).toEqual(index)
  })

  it('a reload started while the initial load is still in flight wins', async () => {
    const slow = deferred<ProgressMark[]>()
    getProgress.mockReturnValueOnce(slow.promise)
    const { out } = mount()
    expect(out.latest?.status).toBe('loading')
    getProgress.mockResolvedValueOnce([override4])
    await act(async () => {
      await out.latest!.reload()
    })
    expect(out.latest?.status).toBe('ready')
    expect(out.latest?.marks).toEqual([override4])
    slow.resolve([])
    await flush()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(out.latest?.marks).toEqual([override4])
    expect(isLocked(out.latest!, 5)).toBe(false)
  })
})

describe('useProgress', () => {
  it('throws outside a provider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    function Probe() {
      useProgress()
      return null
    }
    expect(() => render(h(Probe, null))).toThrow(/ProgressProvider/)
    spy.mockRestore()
  })
})

describe('isLocked', () => {
  it('is false when the chapter is unknown or the state is not ready', () => {
    const base = { states: new Map([[5, { chapter: 5, cleared: false, locked: true }]]) } as unknown as Progress
    expect(isLocked(base, 5)).toBe(true)
    expect(isLocked(base, 6)).toBe(false)
    expect(isLocked({ states: new Map() } as unknown as Progress, 5)).toBe(false)
  })
})
