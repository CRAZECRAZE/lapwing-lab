// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/preact'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TestSummary } from '../../server/archive.ts'
import { Journal } from '../../src/ui/Journal.tsx'
import { __resetPendingSavesForTests, ORPHAN_RETRY_MS } from '../../src/ui/useAutosave.ts'

vi.mock('../../src/api.ts', () => ({
  listJournal: vi.fn(),
  getJournal: vi.fn(),
  putJournal: vi.fn(),
  listTests: vi.fn(),
}))
const api = await import('../../src/api.ts')
const listJournal = vi.mocked(api.listJournal)
const getJournal = vi.mocked(api.getJournal)
const putJournal = vi.mocked(api.putJournal)
const listTests = vi.mocked(api.listTests)

/** Lets pending promises and the given amount of fake time run, inside act. */
async function advance(ms = 0): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

function deferred(): { promise: Promise<void>; resolve: () => void; reject: (e: Error) => void } {
  let resolve!: () => void
  let reject!: (e: Error) => void
  const promise = new Promise<void>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const box = (label = 'Journal for Tue 27 Oct 2026'): HTMLTextAreaElement =>
  screen.getByRole('textbox', { name: label }) as HTMLTextAreaElement

function type(el: HTMLTextAreaElement, value: string): void {
  fireEvent.input(el, { target: { value } })
}

function hide(): void {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
  document.dispatchEvent(new Event('visibilitychange'))
}

function summary(id: number, first: number, last: number): TestSummary {
  return {
    id,
    sessionId: 1,
    startedAt: first,
    endedAt: last,
    mode: 'drill',
    chapter: 4,
    section: 'row',
    itemCount: 10,
    wpm: 30,
    accuracy: 0.9,
    meta: null,
    strokeCount: 12,
    firstStrokeAt: first,
    lastStrokeAt: last,
  } as unknown as TestSummary
}

describe('Journal', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 9, 27, 12, 0, 0))
    listJournal.mockReset()
    getJournal.mockReset()
    putJournal.mockReset()
    listTests.mockReset()
    listJournal.mockResolvedValue([])
    getJournal.mockResolvedValue('Stored words.')
    putJournal.mockResolvedValue(undefined)
    listTests.mockResolvedValue([])
  })
  afterEach(() => {
    cleanup()
    __resetPendingSavesForTests()
    // @ts-expect-error -- remove the per-test override so jsdom's own getter shows again
    delete document.visibilityState
    vi.useRealTimers()
  })

  it('loads and shows the stored note, then saves once 800 ms after the last keystroke', async () => {
    render(<Journal />)
    expect(box().readOnly).toBe(true)
    await advance()
    expect(getJournal).toHaveBeenCalledWith('2026-10-27')
    expect(box().value).toBe('Stored words.')
    expect(box().readOnly).toBe(false)
    expect(screen.getByRole('heading', { name: 'Tue 27 Oct 2026' })).toBeTruthy()

    type(box(), 'Stored words. More')
    await advance(500)
    type(box(), 'Stored words. More words')
    await advance(799)
    expect(putJournal).not.toHaveBeenCalled()
    await advance(1)
    expect(putJournal).toHaveBeenCalledTimes(1)
    expect(putJournal).toHaveBeenCalledWith('2026-10-27', 'Stored words. More words')
    expect(screen.getByText('Saved')).toBeTruthy()
    await advance(10000)
    expect(putJournal).toHaveBeenCalledTimes(1)
  })

  it('never saves when nothing was edited', async () => {
    const { unmount } = render(<Journal />)
    await advance()
    fireEvent.blur(box())
    hide()
    type(box(), 'Stored words.')
    await advance(10000)
    unmount()
    await advance()
    expect(putJournal).not.toHaveBeenCalled()
  })

  it('saves at once on blur and on the page being hidden', async () => {
    render(<Journal />)
    await advance()
    type(box(), 'one')
    fireEvent.blur(box())
    await advance()
    expect(putJournal).toHaveBeenCalledTimes(1)
    expect(putJournal).toHaveBeenLastCalledWith('2026-10-27', 'one')

    type(box(), 'one two')
    hide()
    await advance()
    expect(putJournal).toHaveBeenCalledTimes(2)
    expect(putJournal).toHaveBeenLastCalledWith('2026-10-27', 'one two')
    await advance(2000)
    expect(putJournal).toHaveBeenCalledTimes(2)
  })

  it('serializes saves: edits during a save go out right after it settles', async () => {
    const first = deferred()
    putJournal.mockReturnValueOnce(first.promise)
    render(<Journal />)
    await advance()
    type(box(), 'a')
    fireEvent.blur(box())
    expect(screen.getByText('Saving…')).toBeTruthy()
    type(box(), 'ab')
    fireEvent.blur(box())
    type(box(), 'abc')
    await advance(800)
    hide()
    await advance()
    expect(putJournal).toHaveBeenCalledTimes(1)

    first.resolve()
    await advance()
    expect(putJournal).toHaveBeenCalledTimes(2)
    expect(putJournal).toHaveBeenLastCalledWith('2026-10-27', 'abc')
    await advance(10000)
    expect(putJournal).toHaveBeenCalledTimes(2)
    expect(screen.getByText('Saved')).toBeTruthy()
  })

  it('saves unsaved text to its own date when it unmounts', async () => {
    const { unmount } = render(<Journal date="2026-10-26" />)
    await advance()
    expect(getJournal).toHaveBeenCalledWith('2026-10-26')
    type(box('Journal for Mon 26 Oct 2026'), 'first')
    type(box('Journal for Mon 26 Oct 2026'), 'first and last')
    unmount()
    expect(putJournal).toHaveBeenCalledTimes(1)
    expect(putJournal).toHaveBeenCalledWith('2026-10-26', 'first and last')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('switching days via the key flushes the old day to the old date', async () => {
    const { rerender } = render(<Journal key="2026-10-26" date="2026-10-26" />)
    await advance()
    type(box('Journal for Mon 26 Oct 2026'), 'monday words')
    rerender(<Journal key="2026-10-27" date="2026-10-27" />)
    expect(putJournal).toHaveBeenCalledTimes(1)
    expect(putJournal).toHaveBeenCalledWith('2026-10-26', 'monday words')
  })

  it('a save in flight at unmount is followed by the latest text to the same date', async () => {
    const first = deferred()
    putJournal.mockReturnValueOnce(first.promise)
    const { unmount } = render(<Journal date="2026-10-26" />)
    await advance()
    type(box('Journal for Mon 26 Oct 2026'), 'x')
    fireEvent.blur(box('Journal for Mon 26 Oct 2026'))
    type(box('Journal for Mon 26 Oct 2026'), 'xy')
    unmount()
    expect(putJournal).toHaveBeenCalledTimes(1)
    first.resolve()
    await advance()
    expect(putJournal).toHaveBeenCalledTimes(2)
    expect(putJournal).toHaveBeenLastCalledWith('2026-10-26', 'xy')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('a failed load stays read-only, never writes, and Try again enables it', async () => {
    getJournal.mockRejectedValueOnce(new Error('down'))
    const { unmount } = render(<Journal />)
    await advance()
    expect(screen.getByText("Couldn't load this day's note.")).toBeTruthy()
    expect(box().readOnly).toBe(true)
    type(box(), 'typed while broken')
    fireEvent.blur(box())
    hide()
    await advance(10000)
    expect(putJournal).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await advance()
    expect(getJournal).toHaveBeenCalledTimes(2)
    expect(box().readOnly).toBe(false)
    expect(box().value).toBe('Stored words.')
    expect(screen.queryByText("Couldn't load this day's note.")).toBeNull()
    unmount()
    expect(putJournal).not.toHaveBeenCalled()
  })

  it('never writes after a failed load, even at unmount', async () => {
    getJournal.mockRejectedValueOnce(new Error('down'))
    const { unmount } = render(<Journal />)
    await advance()
    type(box(), 'typed while broken')
    unmount()
    await advance(10000)
    expect(putJournal).not.toHaveBeenCalled()
  })

  it('a failed save keeps the text, says so, and retries every 5 s until it succeeds', async () => {
    putJournal.mockRejectedValueOnce(new Error('down')).mockRejectedValueOnce(new Error('down'))
    render(<Journal />)
    await advance()
    type(box(), 'keep me')
    await advance(800)
    expect(putJournal).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Not saved — will retry')).toBeTruthy()
    expect(box().value).toBe('keep me')

    await advance(4999)
    expect(putJournal).toHaveBeenCalledTimes(1)
    await advance(1)
    expect(putJournal).toHaveBeenCalledTimes(2)
    expect(screen.getByText('Not saved — will retry')).toBeTruthy()

    await advance(5000)
    expect(putJournal).toHaveBeenCalledTimes(3)
    expect(putJournal).toHaveBeenLastCalledWith('2026-10-27', 'keep me')
    expect(screen.getByText('Saved')).toBeTruthy()
    await advance(20000)
    expect(putJournal).toHaveBeenCalledTimes(3)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('unmounting while saves fail keeps retrying the latest text until the server recovers', async () => {
    putJournal.mockRejectedValue(new Error('down'))
    const { unmount } = render(<Journal date="2026-10-26" />)
    await advance()
    type(box('Journal for Mon 26 Oct 2026'), 'pending')
    await advance(800)
    expect(screen.getByText('Not saved — will retry')).toBeTruthy()
    type(box('Journal for Mon 26 Oct 2026'), 'pending more')
    unmount()
    await advance()
    expect(putJournal).toHaveBeenCalledTimes(2)
    expect(putJournal).toHaveBeenLastCalledWith('2026-10-26', 'pending more')

    await advance(5000)
    expect(putJournal).toHaveBeenCalledTimes(3)
    putJournal.mockReset()
    putJournal.mockResolvedValue(undefined)
    await advance(5000)
    expect(putJournal).toHaveBeenCalledTimes(1)
    expect(putJournal).toHaveBeenCalledWith('2026-10-26', 'pending more')
    expect(vi.getTimerCount()).toBe(0)
    await advance(60000)
    expect(putJournal).toHaveBeenCalledTimes(1)
  })

  it('stops retrying a closed day after the orphan limit and leaves no timers', async () => {
    putJournal.mockRejectedValue(new Error('down'))
    const { unmount } = render(<Journal />)
    await advance()
    type(box(), 'doomed')
    unmount()
    await advance(ORPHAN_RETRY_MS + 10000)
    const tries = putJournal.mock.calls.length
    expect(tries).toBeGreaterThan(100)
    expect(vi.getTimerCount()).toBe(0)
    await advance(60000)
    expect(putJournal).toHaveBeenCalledTimes(tries)
  })

  it('reopening the same day waits for the closing save before loading', async () => {
    let disk = 'Stored words.'
    getJournal.mockImplementation(async () => disk)
    const first = deferred()
    putJournal.mockImplementationOnce(async (_date, text) => {
      await first.promise
      disk = text
    })
    const a = render(<Journal date="2026-10-26" />)
    await advance()
    type(box('Journal for Mon 26 Oct 2026'), 'flushed words')
    a.unmount()
    expect(putJournal).toHaveBeenCalledWith('2026-10-26', 'flushed words')

    render(<Journal date="2026-10-26" />)
    await advance()
    expect(getJournal).toHaveBeenCalledTimes(1)
    expect(box('Journal for Mon 26 Oct 2026').readOnly).toBe(true)

    first.resolve()
    await advance()
    expect(box('Journal for Mon 26 Oct 2026').readOnly).toBe(false)
    expect(box('Journal for Mon 26 Oct 2026').value).toBe('flushed words')
    fireEvent.blur(box('Journal for Mon 26 Oct 2026'))
    await advance(10000)
    expect(putJournal).toHaveBeenCalledTimes(1)
  })

  it('reopening a day whose closing save is still failing shows the unsaved text and keeps retrying', async () => {
    getJournal.mockResolvedValue('old file text')
    putJournal.mockRejectedValue(new Error('down'))
    const a = render(<Journal date="2026-10-26" />)
    await advance()
    type(box('Journal for Mon 26 Oct 2026'), 'newer words')
    a.unmount()
    await advance()

    render(<Journal date="2026-10-26" />)
    await advance()
    expect(getJournal).toHaveBeenCalledTimes(1)
    expect(box('Journal for Mon 26 Oct 2026').value).toBe('newer words')
    expect(box('Journal for Mon 26 Oct 2026').readOnly).toBe(false)
    expect(screen.getByText('Not saved — will retry')).toBeTruthy()

    type(box('Journal for Mon 26 Oct 2026'), 'newer words, more')
    putJournal.mockReset()
    putJournal.mockResolvedValue(undefined)
    await advance(800)
    expect(putJournal).toHaveBeenCalledTimes(1)
    expect(putJournal).toHaveBeenCalledWith('2026-10-26', 'newer words, more')
    expect(screen.getByText('Saved')).toBeTruthy()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('shows No such day. for a date that is not on the calendar, without fetching', () => {
    render(<Journal date="2026-02-30" />)
    expect(screen.getByText('No such day.')).toBeTruthy()
    expect(screen.getByRole('link', { name: /journal/i }).getAttribute('href')).toBe('/journal')
    expect(getJournal).not.toHaveBeenCalled()
    expect(listJournal).not.toHaveBeenCalled()
    expect(listTests).not.toHaveBeenCalled()
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('lists today first even without a note, then noted days newest first, marking the current one', async () => {
    listJournal.mockResolvedValue([
      { date: '2026-10-20', chars: 5 },
      { date: '2026-10-27', chars: 3 },
      { date: '2026-10-25', chars: 9 },
    ])
    render(<Journal date="2026-10-25" />)
    await advance()
    const days = screen.getByRole('navigation', { name: 'Journal days' })
    const links = Array.from(days.querySelectorAll('a'))
    expect(links.map((a) => a.textContent)).toEqual(['Today', 'Sun 25 Oct 2026', 'Tue 20 Oct 2026'])
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['/journal', '/journal/2026-10-25', '/journal/2026-10-20'])
    expect(links[1].getAttribute('aria-current')).toBe('page')
    expect(links[0].getAttribute('aria-current')).toBeNull()
    expect(screen.getByRole('link', { name: 'Previous day' }).getAttribute('href')).toBe('/journal/2026-10-24')
    expect(screen.getByRole('link', { name: 'Next day' }).getAttribute('href')).toBe('/journal/2026-10-26')
  })

  it('shows Today alone and current when there are no notes, and still works when the list fails', async () => {
    listJournal.mockRejectedValue(new Error('down'))
    render(<Journal />)
    await advance()
    const links = Array.from(screen.getByRole('navigation', { name: 'Journal days' }).querySelectorAll('a'))
    expect(links.map((a) => a.textContent)).toEqual(['Today'])
    expect(links[0].getAttribute('aria-current')).toBe('page')
    expect(box().readOnly).toBe(false)
  })

  it('shows the results of the day with totals', async () => {
    const t0 = new Date(2026, 9, 27, 9, 0, 0).getTime()
    listTests.mockResolvedValue([summary(2, t0 + 600000, t0 + 600000 + 5 * 60000), summary(1, t0, t0 + 4 * 60000)])
    render(<Journal />)
    await advance()
    expect(listTests).toHaveBeenCalledWith({ limit: 200, date: '2026-10-27' })
    const region = screen.getByRole('region', { name: 'Results this day' })
    expect(region.querySelectorAll('.tests li').length).toBe(2)
    expect(screen.getByText('2 tests · 9 min')).toBeTruthy()
  })

  it('says when no practice was recorded', async () => {
    render(<Journal />)
    await advance()
    expect(screen.getByText('No practice recorded this day.')).toBeTruthy()
  })

  it('a results failure shows Try again and does not block the editor', async () => {
    listTests.mockRejectedValueOnce(new Error('down'))
    render(<Journal />)
    await advance()
    expect(screen.getByText("Couldn't load this day's results.")).toBeTruthy()
    expect(box().readOnly).toBe(false)
    type(box(), 'still writing')
    await advance(800)
    expect(putJournal).toHaveBeenCalledWith('2026-10-27', 'still writing')

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await advance()
    expect(screen.getByText('No practice recorded this day.')).toBeTruthy()
  })
})
