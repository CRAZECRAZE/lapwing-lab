// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { StrokeRecord, TestRow, TestSummary } from '../../../server/archive.ts'
import { RhythmPanel } from '../../../src/ui/progress/RhythmPanel.tsx'
import { even, strokesOf, summary, T0, testRow } from './rhythmFixtures.ts'
import { ready } from './fixtures.ts'

vi.mock('../../../src/api.ts', () => ({ listTests: vi.fn(), getTest: vi.fn() }))
const { listTests, getTest } = await import('../../../src/api.ts')
const list = vi.mocked(listTests)
const get = vi.mocked(getTest)

type Loaded = { test: TestRow; strokes: StrokeRecord[] } | null

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
    list.mockResolvedValue([summary(7)])
    answerWithIdStrokes()
    const { container } = render(<RhythmPanel data={ready({ mode: 'free' })} />)
    const heading = await screen.findByRole('heading', { level: 2, name: 'Rhythm: how steady you type' })
    expect(heading.closest('section')!.getAttribute('aria-labelledby')).toBe(heading.id)
    expect(container.querySelector('.panel__scope')!.textContent).toBe('free type')
    expect(container.textContent).toContain('The day-by-day steadiness is in the chart above.')
  })

  it('asks for the latest 100 runs once and lists at most 20 finished, non-abandoned runs of the mode, newest first', async () => {
    list.mockResolvedValue(mixed())
    answerWithIdStrokes()
    render(<RhythmPanel data={ready({ mode: 'free' })} />)
    await screen.findByLabelText('Run')
    expect(list).toHaveBeenCalledTimes(1)
    expect(list).toHaveBeenCalledWith({ limit: 100 })
    const ids = options().map((o) => Number(o.value))
    expect(ids).toHaveLength(20)
    const expected = Array.from({ length: 60 }, (_, i) => 60 - i).filter(isFree).slice(0, 20)
    expect(ids).toEqual(expected)
  })

  it('defaults to the newest run and loads its strokes', async () => {
    list.mockResolvedValue(mixed())
    answerWithIdStrokes()
    const { container } = render(<RhythmPanel data={ready({ mode: 'free' })} />)
    await waitFor(() => expect(barCount(container)).toBe(59)) // the newest free run is id 59
    expect(get).toHaveBeenCalledWith(59)
    expect((screen.getByLabelText('Run') as HTMLSelectElement).value).toBe('59')
  })

  it('labels a run with its date, name and wpm', async () => {
    list.mockResolvedValue([summary(9, { firstStrokeAt: T0, wpm: 16.24, mode: 'free', section: null })])
    answerWithIdStrokes()
    render(<RhythmPanel data={ready({ mode: 'free' })} />)
    await screen.findByLabelText('Run')
    expect(options()[0].textContent).toBe('Oct 28, 14:05 · Free type · 16.2 wpm')
  })

  it('loads the strokes of another run when it is picked', async () => {
    list.mockResolvedValue(mixed())
    answerWithIdStrokes()
    const { container } = render(<RhythmPanel data={ready({ mode: 'free' })} />)
    await waitFor(() => expect(barCount(container)).toBe(59))
    pick(56)
    await waitFor(() => expect(barCount(container)).toBe(56))
    expect(get).toHaveBeenLastCalledWith(56)
    expect(list).toHaveBeenCalledTimes(1)
  })

  it('does not let a late answer for an earlier pick replace a newer one', async () => {
    list.mockResolvedValue(mixed())
    const pending = new Map<number, (v: Loaded) => void>()
    get.mockImplementation((id: number) => new Promise<Loaded>((resolve) => pending.set(id, resolve)))
    const { container } = render(<RhythmPanel data={ready({ mode: 'free' })} />)
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
    list.mockResolvedValue(mixed())
    const pending = new Map<number, (v: Loaded) => void>()
    get.mockImplementation((id: number) =>
      id === 59 ? Promise.resolve({ test: testRow({ id }), strokes: strokesOf(even(59)) }) : new Promise<Loaded>((r) => pending.set(id, r)),
    )
    const { container } = render(<RhythmPanel data={ready({ mode: 'free' })} />)
    await waitFor(() => expect(barCount(container)).toBe(59))
    pick(56)
    await waitFor(() => expect(container.textContent).toContain('Loading…'))
    expect(barCount(container)).toBe(0)
  })

  it('says it could not load the run, and tries again', async () => {
    list.mockResolvedValue([summary(7)])
    get.mockRejectedValueOnce(new Error('HTTP 500 secret'))
    const { container } = render(<RhythmPanel data={ready({ mode: 'free' })} />)
    expect(await screen.findByText(/Couldn't load this run\./)).toBeTruthy()
    expect(container.textContent).not.toContain('secret')
    answerWithIdStrokes()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(barCount(container)).toBe(7))
    expect(screen.queryByText(/Couldn't load this run\./)).toBeNull()
  })

  it('says it could not load the runs, and tries again', async () => {
    list.mockRejectedValueOnce(new Error('down'))
    render(<RhythmPanel data={ready({ mode: 'free' })} />)
    expect(await screen.findByText(/Couldn't load your runs\./)).toBeTruthy()
    list.mockResolvedValue([summary(7)])
    answerWithIdStrokes()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByLabelText('Run')).toBeTruthy()
    expect(list).toHaveBeenCalledTimes(2)
  })

  it('says there is no finished run yet', async () => {
    list.mockResolvedValue([summary(1, { endedAt: null }), summary(2, { meta: { abandoned: true } }), summary(3, { mode: 'section' })])
    render(<RhythmPanel data={ready({ mode: 'free' })} />)
    expect(await screen.findByText('No finished run yet.')).toBeTruthy()
    expect(screen.queryByLabelText('Run')).toBeNull()
    expect(get).not.toHaveBeenCalled()
  })

  it('lists the drill and test modes for Drills and tests, and every mode for Everything', async () => {
    list.mockResolvedValue(mixed())
    answerWithIdStrokes()
    const { rerender } = render(<RhythmPanel data={ready({ mode: 'drills' })} />)
    await screen.findByLabelText('Run')
    const drills = Array.from({ length: 60 }, (_, i) => 60 - i).filter(isDrill)
    expect(options().map((o) => Number(o.value))).toEqual(drills.slice(0, 20))
    rerender(<RhythmPanel data={ready({ mode: 'all' })} />)
    await waitFor(() => expect(options()).toHaveLength(20))
    const finished = Array.from({ length: 60 }, (_, i) => 60 - i).filter((id) => ![0, 1, 3].includes(id % 10))
    expect(options().map((o) => Number(o.value))).toEqual(finished.slice(0, 20))
  })

  it('goes back to the newest run of the new mode when the mode changes, and asks again', async () => {
    list.mockResolvedValue(mixed())
    answerWithIdStrokes()
    const { container, rerender } = render(<RhythmPanel data={ready({ mode: 'free' })} />)
    await waitFor(() => expect(barCount(container)).toBe(59))
    pick(56)
    await waitFor(() => expect(barCount(container)).toBe(56))
    rerender(<RhythmPanel data={ready({ mode: 'drills' })} />)
    await waitFor(() => expect((screen.getByLabelText('Run') as HTMLSelectElement).value).toBe('55'))
    await waitFor(() => expect(barCount(container)).toBe(55))
    expect(list).toHaveBeenCalledTimes(2)
    expect(container.querySelector('.panel__scope')!.textContent).toBe('drills and tests')
  })

  it('does not ask for the runs again when the data is replaced but the mode is the same', async () => {
    list.mockResolvedValue(mixed())
    answerWithIdStrokes()
    const { container, rerender } = render(<RhythmPanel data={ready({ mode: 'free' })} />)
    await waitFor(() => expect(barCount(container)).toBe(59))
    pick(56)
    await waitFor(() => expect(barCount(container)).toBe(56))
    rerender(<RhythmPanel data={ready({ mode: 'free', range: '3m' })} />)
    expect(list).toHaveBeenCalledTimes(1)
    expect((screen.getByLabelText('Run') as HTMLSelectElement).value).toBe('56')
  })

  it('has a link to the full run in History', async () => {
    list.mockResolvedValue([summary(7)])
    answerWithIdStrokes()
    render(<RhythmPanel data={ready({ mode: 'free' })} />)
    const link = await screen.findByRole('link', { name: 'Open this run in History' })
    expect(link.getAttribute('href')).toBe('/history/7')
    fireEvent.click(link)
    expect(location.pathname).toBe('/history/7')
  })
})
