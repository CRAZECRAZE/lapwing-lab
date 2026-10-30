// @vitest-environment jsdom
import type { JSX } from 'preact'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { StrokeRecord, TestRow, TestSummary } from '../../../server/archive.ts'
import type { StatsMode } from '../../../server/stats.ts'
import type { RangeId } from '../../../src/core/progressview.ts'
import { RhythmPanel } from '../../../src/ui/progress/RhythmPanel.tsx'
import { useRhythm } from '../../../src/ui/progress/useRhythm.ts'
import { even, strokesOf, summary, T0, testRow } from './rhythmFixtures.ts'
import { ready } from './fixtures.ts'

vi.mock('../../../src/api.ts', () => ({ listTests: vi.fn(), getTest: vi.fn() }))
const { listTests, getTest } = await import('../../../src/api.ts')
const list = vi.mocked(listTests)
const get = vi.mocked(getTest)

type Loaded = { test: TestRow; strokes: StrokeRecord[] } | null

/** What the Progress page does: the state lives above the panel, which only shows it. */
function Harness({ mode, range }: { mode: StatsMode; range?: RangeId }): JSX.Element {
  const rhythm = useRhythm(mode)
  return <RhythmPanel data={ready({ mode, range })} rhythm={rhythm} />
}
const shown = (mode: StatsMode, range?: RangeId): JSX.Element => <Harness mode={mode} range={range} />

/** The archive: newest first, answering by `limit` and `beforeId` like the server. */
function serve(all: TestSummary[]): void {
  list.mockImplementation(async (q = {}) =>
    all.filter((t) => q.beforeId === undefined || t.id < q.beforeId).slice(0, q.limit ?? 50),
  )
}

/** Runs for ids 60 down to 1: every tenth unfinished, then abandoned, section, no strokes; the rest free. */
function mixed(): TestSummary[] {
  const runs: TestSummary[] = []
  for (let id = 60; id >= 1; id--) {
    const kind = id % 10
    runs.push(
      summary(id, {
        ...(kind === 0 ? { endedAt: null, wpm: null, accuracy: null } : {}),
        ...(kind === 1 ? { meta: { abandoned: true } } : {}),
        ...(kind === 2 ? { mode: 'section', section: 'rows-vowels' } : {}),
        ...(kind === 3 ? { strokeCount: 0 } : {}),
        ...(kind === 4 ? { mode: 'chapter-test', chapter: 5, section: null } : {}),
        ...(kind === 5 ? { mode: 'stage0', section: 'rows-vowels' } : {}),
      }),
    )
  }
  return runs
}
const isFree = (id: number): boolean => ![0, 1, 2, 3, 4, 5].includes(id % 10)
const isDrill = (id: number): boolean => [2, 4, 5].includes(id % 10)

const options = (): HTMLOptionElement[] => Array.from(screen.getByLabelText('Run').querySelectorAll('option'))
const barCount = (c: Element): number => c.querySelectorAll('.rhythm__strip rect.rhythm__bar').length
const pick = (id: number): void => {
  fireEvent.change(screen.getByLabelText('Run'), { target: { value: String(id) } })
}

/** getTest answers with a run whose stroke count is its id (so the view says which run it shows). */
function answerWithIdStrokes(): void {
  get.mockImplementation(async (id: number): Promise<Loaded> => ({
    test: testRow({ id }),
    strokes: strokesOf(even(id), { testId: id }),
  }))
}

beforeEach(() => {
  list.mockReset()
  get.mockReset()
  history.replaceState(null, '', '/progress')
})
afterEach(cleanup)

describe('RhythmPanel', () => {
  it('has the title, the mode suffix and the pointer to the day-by-day chart', async () => {
    serve([summary(7)])
    answerWithIdStrokes()
    const { container } = render(shown('free'))
    const heading = await screen.findByRole('heading', { level: 2, name: 'Rhythm: how steady you type' })
    expect(heading.closest('section')!.getAttribute('aria-labelledby')).toBe(heading.id)
    expect(container.querySelector('.panel__scope')!.textContent).toBe('free type')
    expect(container.textContent).toContain('The day-by-day steadiness is in the chart above.')
  })

  it('asks for a page of the latest tests once and lists at most 20 finished, non-abandoned runs of the mode, newest first', async () => {
    serve(mixed())
    answerWithIdStrokes()
    render(shown('free'))
    await screen.findByLabelText('Run')
    expect(list).toHaveBeenCalledTimes(1)
    expect(list).toHaveBeenCalledWith({ limit: 200 })
    const ids = options().map((o) => Number(o.value))
    expect(ids).toHaveLength(20)
    const expected = Array.from({ length: 60 }, (_, i) => 60 - i).filter(isFree).slice(0, 20)
    expect(ids).toEqual(expected)
  })

  it('defaults to the newest run and loads its strokes', async () => {
    serve(mixed())
    answerWithIdStrokes()
    const { container } = render(shown('free'))
    await waitFor(() => expect(barCount(container)).toBe(59)) // the newest free run is id 59
    expect(get).toHaveBeenCalledWith(59)
    expect((screen.getByLabelText('Run') as HTMLSelectElement).value).toBe('59')
  })

  it('labels a run with its date, name and wpm', async () => {
    serve([summary(9, { firstStrokeAt: T0, wpm: 16.24, mode: 'free', section: null })])
    answerWithIdStrokes()
    render(shown('free'))
    await screen.findByLabelText('Run')
    expect(options()[0].textContent).toBe('Oct 28, 14:05 · Free type · 16.2 wpm')
  })

  it('loads the strokes of another run when it is picked', async () => {
    serve(mixed())
    answerWithIdStrokes()
    const { container } = render(shown('free'))
    await waitFor(() => expect(barCount(container)).toBe(59))
    pick(56)
    await waitFor(() => expect(barCount(container)).toBe(56))
    expect(get).toHaveBeenLastCalledWith(56)
    expect(list).toHaveBeenCalledTimes(1)
  })

  it('does not let a late answer for an earlier pick replace a newer one', async () => {
    serve(mixed())
    const pending = new Map<number, (v: Loaded) => void>()
    get.mockImplementation((id: number) => new Promise<Loaded>((resolve) => pending.set(id, resolve)))
    const { container } = render(shown('free'))
    await waitFor(() => expect(pending.has(59)).toBe(true))
    pick(56)
    await waitFor(() => expect(pending.has(56)).toBe(true))
    const answer = (id: number): Loaded => ({ test: testRow({ id }), strokes: strokesOf(even(id), { testId: id }) })
    await act(async () => pending.get(56)!(answer(56)))
    await waitFor(() => expect(barCount(container)).toBe(56))
    await act(async () => pending.get(59)!(answer(59)))
    expect(barCount(container)).toBe(56)
    expect((screen.getByLabelText('Run') as HTMLSelectElement).value).toBe('56')
  })

  it('does not show the previous run while another one loads', async () => {
    serve(mixed())
    const pending = new Map<number, (v: Loaded) => void>()
    get.mockImplementation((id: number) =>
      id === 59 ? Promise.resolve({ test: testRow({ id }), strokes: strokesOf(even(59)) }) : new Promise<Loaded>((r) => pending.set(id, r)),
    )
    const { container } = render(shown('free'))
    await waitFor(() => expect(barCount(container)).toBe(59))
    pick(56)
    await waitFor(() => expect(container.textContent).toContain('Loading…'))
    expect(barCount(container)).toBe(0)
  })

  it('says it could not load the run, and tries again', async () => {
    serve([summary(7)])
    get.mockRejectedValueOnce(new Error('HTTP 500 secret'))
    const { container } = render(shown('free'))
    expect(await screen.findByText(/Couldn't load this run\./)).toBeTruthy()
    expect(container.textContent).not.toContain('secret')
    answerWithIdStrokes()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(barCount(container)).toBe(7))
    expect(screen.queryByText(/Couldn't load this run\./)).toBeNull()
  })

  it('says it could not load the runs, and tries again', async () => {
    list.mockRejectedValueOnce(new Error('down'))
    render(shown('free'))
    expect(await screen.findByText(/Couldn't load your runs\./)).toBeTruthy()
    serve([summary(7)])
    answerWithIdStrokes()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByLabelText('Run')).toBeTruthy()
    expect(list).toHaveBeenCalledTimes(2)
  })

  it('says there is no finished run yet', async () => {
    serve([summary(1, { endedAt: null }), summary(2, { meta: { abandoned: true } }), summary(3, { mode: 'section' })])
    render(shown('free'))
    expect(await screen.findByText('No finished run yet.')).toBeTruthy()
    expect(screen.queryByLabelText('Run')).toBeNull()
    expect(get).not.toHaveBeenCalled()
  })

  it('lists the drill and test modes for Drills and tests, and every mode for Everything', async () => {
    serve(mixed())
    answerWithIdStrokes()
    const { rerender } = render(shown('drills'))
    await screen.findByLabelText('Run')
    const drills = Array.from({ length: 60 }, (_, i) => 60 - i).filter(isDrill)
    expect(options().map((o) => Number(o.value))).toEqual(drills.slice(0, 20))
    rerender(shown('all'))
    await waitFor(() => expect(options()).toHaveLength(20))
    const finished = Array.from({ length: 60 }, (_, i) => 60 - i).filter((id) => ![0, 1, 3].includes(id % 10))
    expect(options().map((o) => Number(o.value))).toEqual(finished.slice(0, 20))
  })

  it('leaves fix-up runs out of Everything', async () => {
    serve([summary(9, { mode: 'fixup', chapter: null, section: 'words', wpm: 0 }), summary(8), summary(7)])
    answerWithIdStrokes()
    render(shown('all'))
    await screen.findByLabelText('Run')
    expect(options().map((o) => Number(o.value))).toEqual([8, 7])
  })

  it('goes back to the newest run of the new mode when the mode changes, and asks again', async () => {
    serve(mixed())
    answerWithIdStrokes()
    const { container, rerender } = render(shown('free'))
    await waitFor(() => expect(barCount(container)).toBe(59))
    pick(56)
    await waitFor(() => expect(barCount(container)).toBe(56))
    rerender(shown('drills'))
    await waitFor(() => expect((screen.getByLabelText('Run') as HTMLSelectElement).value).toBe('55'))
    await waitFor(() => expect(barCount(container)).toBe(55))
    expect(list).toHaveBeenCalledTimes(2)
    expect(container.querySelector('.panel__scope')!.textContent).toBe('drills and tests')
  })

  it('does not ask for the runs again when the data is replaced but the mode is the same', async () => {
    serve(mixed())
    answerWithIdStrokes()
    const { container, rerender } = render(shown('free'))
    await waitFor(() => expect(barCount(container)).toBe(59))
    pick(56)
    await waitFor(() => expect(barCount(container)).toBe(56))
    rerender(shown('free', '3m'))
    expect(list).toHaveBeenCalledTimes(1)
    expect((screen.getByLabelText('Run') as HTMLSelectElement).value).toBe('56')
  })

  it('has a link to the full run in History', async () => {
    serve([summary(7)])
    answerWithIdStrokes()
    render(shown('free'))
    const link = await screen.findByRole('link', { name: 'Open this run in History' })
    expect(link.getAttribute('href')).toBe('/history/7')
    fireEvent.click(link)
    expect(location.pathname).toBe('/history/7')
  })
})

/** `n` finished runs of a mode with ids from `top` downwards. */
const runsOf = (mode: string, top: number, n: number): TestSummary[] =>
  Array.from({ length: n }, (_, i) => summary(top - i, { mode, section: mode === 'free' ? null : 'rows-vowels' }))

describe('RhythmPanel: looking back for runs of the mode', () => {
  it('pages back through the archive when the newest tests are all of another mode', async () => {
    // 230 section runs on top, then 30 free runs: the 20 free ones come from the second page
    serve([...runsOf('section', 330, 230), ...runsOf('free', 100, 30)])
    answerWithIdStrokes()
    render(shown('free'))
    await screen.findByLabelText('Run')
    expect(list).toHaveBeenCalledTimes(2)
    expect(list).toHaveBeenNthCalledWith(1, { limit: 200 })
    expect(list).toHaveBeenNthCalledWith(2, { limit: 200, beforeId: 131 })
    expect(options().map((o) => Number(o.value))).toEqual(Array.from({ length: 20 }, (_, i) => 100 - i))
    expect(screen.queryByText(/Showing the latest/)).toBeNull()
  })

  it('and the other way round: drills found behind 150 free-type tests', async () => {
    serve([...runsOf('free', 400, 150), ...runsOf('section', 250, 40)])
    answerWithIdStrokes()
    render(shown('drills'))
    await screen.findByLabelText('Run')
    expect(options()).toHaveLength(20)
    expect(options().map((o) => Number(o.value))[0]).toBe(250)
    expect(list).toHaveBeenCalledTimes(1) // 190 tests in the one page
  })

  it('stops after 600 tests and says how many runs it found', async () => {
    // 800 free runs; 5 drills among the 600 newest
    const all = [...runsOf('free', 1000, 500), ...runsOf('section', 500, 5), ...runsOf('free', 495, 295)]
    serve(all)
    answerWithIdStrokes()
    render(shown('drills'))
    await screen.findByLabelText('Run')
    expect(list).toHaveBeenCalledTimes(3) // 3 pages of 200
    expect(options()).toHaveLength(5)
    expect(screen.getByText('Showing the latest 5 runs of this mode.')).toBeTruthy()
  })

  it('says so when 600 tests hold no run of the mode at all', async () => {
    serve(runsOf('free', 1000, 800))
    render(shown('drills'))
    expect(await screen.findByText('No finished run of this mode in your latest tests.')).toBeTruthy()
    expect(list).toHaveBeenCalledTimes(3)
    expect(screen.queryByLabelText('Run')).toBeNull()
    expect(get).not.toHaveBeenCalled()
  })

  it('shows no note when the whole history holds fewer than 20 runs', async () => {
    serve([...runsOf('free', 20, 5), ...runsOf('section', 15, 3)])
    answerWithIdStrokes()
    render(shown('free'))
    await screen.findByLabelText('Run')
    expect(options()).toHaveLength(5)
    expect(list).toHaveBeenCalledTimes(1)
    expect(screen.queryByText(/Showing the latest/)).toBeNull()
  })

  it('shows no note when the 20th run is found exactly at the end of the scan', async () => {
    serve([...runsOf('section', 800, 580), ...runsOf('free', 220, 20)])
    answerWithIdStrokes()
    render(shown('free'))
    await screen.findByLabelText('Run')
    expect(options()).toHaveLength(20)
    expect(screen.queryByText(/Showing the latest/)).toBeNull()
  })

  it('does not let runs of the old mode leak in when the mode changes while it is still paging', async () => {
    const free = [...runsOf('section', 330, 230), ...runsOf('free', 100, 30)] // free is on the second page
    const gate: { release: () => void } = { release: () => undefined }
    list.mockImplementation(async (q = {}) => {
      const page = free.filter((t) => q.beforeId === undefined || t.id < q.beforeId).slice(0, q.limit ?? 50)
      if (q.beforeId === undefined) await new Promise<void>((r) => (gate.release = r)) // the first page is slow
      return page
    })
    answerWithIdStrokes()
    const { rerender } = render(shown('free'))
    await waitFor(() => expect(list).toHaveBeenCalledTimes(1))
    // the user switches to drills; the archive now answers fast
    list.mockImplementation(async (q = {}) => free.filter((t) => q.beforeId === undefined || t.id < q.beforeId).slice(0, q.limit ?? 50))
    rerender(shown('drills'))
    await screen.findByLabelText('Run')
    expect(options().map((o) => o.value)).toEqual(Array.from({ length: 20 }, (_, i) => String(330 - i)))
    const before = list.mock.calls.length
    await act(async () => gate.release()) // the slow free page arrives late
    await new Promise((r) => setTimeout(r, 20))
    expect(options().map((o) => o.value)).toEqual(Array.from({ length: 20 }, (_, i) => String(330 - i)))
    expect(list.mock.calls.length).toBe(before) // it did not go on paging for a mode nobody is looking at
  })
})

describe('RhythmPanel: what is kept', () => {
  it('keeps the list and the picked run when the range changes (nothing is asked for again)', async () => {
    serve(mixed())
    answerWithIdStrokes()
    const { container, rerender } = render(shown('free', '4w'))
    await waitFor(() => expect(barCount(container)).toBe(59))
    pick(56)
    await waitFor(() => expect(barCount(container)).toBe(56))
    const lists = list.mock.calls.length
    const runs = get.mock.calls.length
    rerender(shown('free', '3m'))
    rerender(shown('free', 'all'))
    expect((screen.getByLabelText('Run') as HTMLSelectElement).value).toBe('56')
    expect(barCount(container)).toBe(56)
    expect(list.mock.calls.length).toBe(lists)
    expect(get.mock.calls.length).toBe(runs)
  })

  it('goes back to the newest run on every change of mode, and takes a list it has already from the keep', async () => {
    serve(mixed())
    answerWithIdStrokes()
    const { container, rerender } = render(shown('free'))
    await waitFor(() => expect(barCount(container)).toBe(59))
    pick(56)
    await waitFor(() => expect(barCount(container)).toBe(56))
    rerender(shown('drills'))
    await waitFor(() => expect(barCount(container)).toBe(55))
    expect((screen.getByLabelText('Run') as HTMLSelectElement).value).toBe('55')
    expect(list).toHaveBeenCalledTimes(2)
    // back to free: the list comes from the keep (no new request), the pick of before is gone: the newest again
    rerender(shown('free'))
    await waitFor(() => expect((screen.getByLabelText('Run') as HTMLSelectElement).value).toBe('59'))
    await waitFor(() => expect(barCount(container)).toBe(59))
    expect(list).toHaveBeenCalledTimes(2)
    expect(options().map((o) => Number(o.value))[0]).toBe(59)
  })

  it('asks again for the runs, not for the ones it keeps for another mode, on Try again', async () => {
    serve(mixed())
    answerWithIdStrokes()
    const { container, rerender } = render(shown('free'))
    await waitFor(() => expect(barCount(container)).toBe(59))
    rerender(shown('drills'))
    await waitFor(() => expect(barCount(container)).toBe(55))
    list.mockRejectedValueOnce(new Error('down'))
    rerender(shown('all'))
    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }))
    await screen.findByLabelText('Run')
    expect(list).toHaveBeenCalledTimes(4) // free, drills, all (failed), all again
    // free and drills are still in the keep
    rerender(shown('free'))
    await waitFor(() => expect(barCount(container)).toBe(59))
    expect(list).toHaveBeenCalledTimes(4)
  })

  it('does not ask for the strokes again when the same run is shown again', async () => {
    serve([summary(7)])
    answerWithIdStrokes()
    const { container, rerender } = render(shown('free', '4w'))
    await waitFor(() => expect(barCount(container)).toBe(7))
    rerender(shown('free', '3m'))
    expect(get).toHaveBeenCalledTimes(1)
  })
})

