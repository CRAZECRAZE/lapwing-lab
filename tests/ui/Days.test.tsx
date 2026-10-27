// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/preact'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DayStat, TestSummary } from '../../server/archive.ts'
import { Days } from '../../src/ui/Days.tsx'

vi.mock('../../src/api.ts', () => ({
  getDays: vi.fn(),
  listTests: vi.fn(),
  listJournal: vi.fn(),
  getJournal: vi.fn(),
}))
const api = await import('../../src/api.ts')
const getDays = vi.mocked(api.getDays)
const listTests = vi.mocked(api.listTests)
const listJournal = vi.mocked(api.listJournal)
const getJournal = vi.mocked(api.getJournal)

const MIN = 60000
const stat = (date: string, tests: number, activeMin: number): DayStat => ({
  date,
  tests,
  strokes: 50 * tests,
  activeMs: activeMin * MIN,
})
const OCTOBER: DayStat[] = [
  stat('2026-10-05', 2, 5),
  stat('2026-10-12', 1, 15),
  stat('2026-10-26', 3, 45),
  stat('2026-10-27', 1, 10),
]

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: Error) => void } {
  let resolve!: (v: T) => void
  let reject!: (e: Error) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const flush = (): Promise<void> => act(async () => {})

function summary(id: number, first: number): TestSummary {
  return {
    id,
    sessionId: 1,
    startedAt: first,
    endedAt: first + MIN,
    mode: 'drill',
    chapter: 4,
    section: 'row',
    itemCount: 10,
    wpm: 30,
    accuracy: 0.9,
    meta: null,
    strokeCount: 12,
    firstStrokeAt: first,
    lastStrokeAt: first + MIN,
  } as unknown as TestSummary
}

const cell = (date: string): HTMLElement =>
  document.querySelector(`a[href="/days/${date}"]`) as HTMLElement

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 27, 12, 0, 0))
  for (const fn of [getDays, listTests, listJournal, getJournal]) fn.mockReset()
  // Answers a range from the fixed October list; the streak asks for a long range, so it sees all of it.
  getDays.mockImplementation(async (from, to) => OCTOBER.filter((d) => d.date >= from && d.date <= to))
  listJournal.mockResolvedValue([{ date: '2026-10-12', chars: 40 }])
  listTests.mockResolvedValue([])
  getJournal.mockResolvedValue('')
  history.replaceState(null, '', '/days')
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  history.replaceState(null, '', '/')
})

describe('Days month view', () => {
  it('shows the month title, a Monday-first weekday header and every day as a link', async () => {
    render(<Days />)
    await flush()
    expect(screen.getByRole('heading', { name: 'October 2026', level: 1 })).toBeTruthy()
    const header = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => screen.getByText(d))
    for (let i = 1; i < header.length; i++) {
      expect(header[i - 1]!.compareDocumentPosition(header[i]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    }
    // 1 Oct 2026 is a Thursday: three padding cells come first, and they are not links
    const grid = document.querySelector('.days__grid')!
    const cells = [...grid.querySelectorAll('.days__cell')]
    expect(cells.slice(0, 3).every((c) => c.tagName !== 'A' && c.textContent === '')).toBe(true)
    expect(cells[3]!.getAttribute('href')).toBe('/days/2026-10-01')
    expect(grid.querySelectorAll('a.days__cell')).toHaveLength(31)
    expect(cell('2026-10-31').textContent).toContain('31')
  })

  it('sets data-level from the active time and marks today', async () => {
    render(<Days />)
    await flush()
    expect(cell('2026-10-01').getAttribute('data-level')).toBe('0')
    expect(cell('2026-10-05').getAttribute('data-level')).toBe('1') // 5 min
    expect(cell('2026-10-27').getAttribute('data-level')).toBe('2') // 10 min is not under 10
    expect(cell('2026-10-12').getAttribute('data-level')).toBe('2') // 15 min
    expect(cell('2026-10-26').getAttribute('data-level')).toBe('3') // 45 min
    expect(cell('2026-10-27').getAttribute('aria-current')).toBe('date')
    expect(cell('2026-10-26').getAttribute('aria-current')).toBeNull()
  })

  it('puts a dot on days with a note only', async () => {
    render(<Days />)
    await flush()
    expect(cell('2026-10-12').querySelector('.days__dot')).toBeTruthy()
    expect(cell('2026-10-05').querySelector('.days__dot')).toBeNull()
    expect(listJournal).toHaveBeenCalledTimes(1)
  })

  it('shows no dots when the notes list fails, and still works', async () => {
    listJournal.mockRejectedValue(new Error('down'))
    render(<Days />)
    await flush()
    expect(document.querySelector('.days__dot')).toBeNull()
    expect(cell('2026-10-12').getAttribute('data-level')).toBe('2')
  })

  it('names each day for a screen reader, with practice and note', async () => {
    render(<Days />)
    await flush()
    expect(screen.getByRole('link', { name: 'Mon 12 Oct 2026, 15 min, has a note' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Mon 5 Oct 2026, 5 min' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Thu 1 Oct 2026' })).toBeTruthy()
  })

  it('shows the totals and the streak', async () => {
    render(<Days />)
    await flush()
    expect(screen.getByText('4 days practiced · 1 h 15 min · 7 tests')).toBeTruthy()
    expect(screen.getByText('Streak: 2 days')).toBeTruthy()
    expect(getDays).toHaveBeenCalledWith('2026-10-01', '2026-10-31')
  })

  it('uses singular words, and hides the streak when there is none', async () => {
    getDays.mockImplementation(async (from, to) =>
      [stat('2026-10-05', 1, 5)].filter((d) => d.date >= from && d.date <= to),
    )
    render(<Days />)
    await flush()
    expect(screen.getByText('1 day practiced · 5 min · 1 test')).toBeTruthy()
    expect(screen.queryByText(/Streak/)).toBeNull()
  })

  it('does not claim a streak when that load fails, but still shows the month', async () => {
    getDays.mockImplementation(async (from, to) => {
      if (from === '2025-09-22') throw new Error('down')
      return OCTOBER.filter((d) => d.date >= from && d.date <= to)
    })
    render(<Days />)
    await flush()
    expect(screen.queryByText(/Streak/)).toBeNull()
    expect(screen.getByText('4 days practiced · 1 h 15 min · 7 tests')).toBeTruthy()
  })

  it('links a day to its page with plain-click navigation', async () => {
    render(<Days />)
    await flush()
    fireEvent.click(cell('2026-10-12'))
    expect(location.pathname).toBe('/days/2026-10-12')
  })

  it('steps to the previous and next month and loads that range', async () => {
    render(<Days />)
    await flush()
    fireEvent.click(screen.getByRole('button', { name: 'Next month' }))
    await flush()
    expect(screen.getByRole('heading', { name: 'November 2026', level: 1 })).toBeTruthy()
    expect(getDays).toHaveBeenCalledWith('2026-11-01', '2026-11-30')
    expect(document.querySelectorAll('.days__grid a.days__cell')).toHaveLength(30)
    expect(cell('2026-11-01').getAttribute('data-level')).toBe('0')
    expect(screen.getByText('0 days practiced · <1 min · 0 tests')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Previous month' }))
    fireEvent.click(screen.getByRole('button', { name: 'Previous month' }))
    await flush()
    expect(screen.getByRole('heading', { name: 'September 2026', level: 1 })).toBeTruthy()
    expect(getDays).toHaveBeenCalledWith('2026-09-01', '2026-09-30')
  })

  it('rolls over the year in both directions', async () => {
    render(<Days />)
    await flush()
    for (let i = 0; i < 3; i++) fireEvent.click(screen.getByRole('button', { name: 'Next month' }))
    await flush()
    expect(screen.getByRole('heading', { name: 'January 2027', level: 1 })).toBeTruthy()
    expect(getDays).toHaveBeenCalledWith('2027-01-01', '2027-01-31')
    fireEvent.click(screen.getByRole('button', { name: 'Previous month' }))
    fireEvent.click(screen.getByRole('button', { name: 'Previous month' }))
    fireEvent.click(screen.getByRole('button', { name: 'Previous month' }))
    await flush()
    expect(screen.getByRole('heading', { name: 'October 2026', level: 1 })).toBeTruthy()
  })

  it('does not let a slow earlier month overwrite a newer one', async () => {
    render(<Days />)
    await flush()
    const slow = deferred<DayStat[]>()
    const fast = deferred<DayStat[]>()
    getDays.mockImplementation((from) => {
      if (from === '2026-11-01') return slow.promise
      if (from === '2026-12-01') return fast.promise
      return Promise.resolve([])
    })
    fireEvent.click(screen.getByRole('button', { name: 'Next month' }))
    fireEvent.click(screen.getByRole('button', { name: 'Next month' }))
    await flush()
    fast.resolve([stat('2026-12-03', 1, 5)])
    await flush()
    expect(screen.getByText('1 day practiced · 5 min · 1 test')).toBeTruthy()
    slow.resolve([stat('2026-11-03', 4, 50), stat('2026-11-04', 4, 50)])
    await flush()
    expect(screen.getByRole('heading', { name: 'December 2026', level: 1 })).toBeTruthy()
    expect(screen.getByText('1 day practiced · 5 min · 1 test')).toBeTruthy()
    expect(cell('2026-12-03').getAttribute('data-level')).toBe('1')
  })

  it('shows an error with Try again when the month fails to load', async () => {
    let fail = true
    getDays.mockImplementation(async (from, to) => {
      if (from === '2026-10-01' && fail) throw new Error('down')
      return OCTOBER.filter((d) => d.date >= from && d.date <= to)
    })
    render(<Days />)
    await flush()
    expect(screen.getByText(/Couldn't load this month\./)).toBeTruthy()
    expect(screen.queryByText(/days practiced/)).toBeNull()
    fail = false
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await flush()
    expect(screen.queryByText(/Couldn't load this month\./)).toBeNull()
    expect(screen.getByText('4 days practiced · 1 h 15 min · 7 tests')).toBeTruthy()
  })

  it('ignores a response that arrives after it closed', async () => {
    const pending = deferred<DayStat[]>()
    getDays.mockReturnValue(pending.promise)
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<Days />)
    cleanup()
    pending.resolve(OCTOBER)
    await flush()
    expect(logged).not.toHaveBeenCalled()
    logged.mockRestore()
  })
})

describe('Days day view', () => {
  const DATE = '2026-10-12'
  const noon = new Date(2026, 9, 12, 9, 30).getTime()

  it("shows the day's heading, tests, note and links", async () => {
    listTests.mockResolvedValue([summary(7, noon), summary(8, noon + 5 * MIN)])
    getJournal.mockResolvedValue('First line\nSecond line')
    render(<Days date={DATE} />)
    await flush()
    expect(screen.getByRole('heading', { name: 'Mon 12 Oct 2026', level: 1 })).toBeTruthy()
    expect(listTests).toHaveBeenCalledWith({ limit: 200, date: DATE })
    expect(getJournal).toHaveBeenCalledWith(DATE)
    expect(document.querySelectorAll('.tests__row')).toHaveLength(2)
    const note = document.querySelector('.days__note')!
    expect(note.textContent).toBe('First line\nSecond line')
    expect(screen.getByRole('link', { name: 'Back to month' }).getAttribute('href')).toBe('/days')
    expect(screen.getByRole('link', { name: 'Open in Journal' }).getAttribute('href')).toBe('/journal/2026-10-12')
  })

  it('says so when there is no practice and no note', async () => {
    render(<Days date={DATE} />)
    await flush()
    expect(screen.getByText('No practice recorded this day.')).toBeTruthy()
    expect(screen.getByText('No note for this day.')).toBeTruthy()
    expect(document.querySelector('.days__note')).toBeNull()
  })

  it('treats a whitespace-only note as no note', async () => {
    getJournal.mockResolvedValue('  \n ')
    render(<Days date={DATE} />)
    await flush()
    expect(screen.getByText('No note for this day.')).toBeTruthy()
  })

  it('navigates back to the month and to the Journal with plain clicks', async () => {
    render(<Days date={DATE} />)
    await flush()
    fireEvent.click(screen.getByRole('link', { name: 'Open in Journal' }))
    expect(location.pathname).toBe('/journal/2026-10-12')
    fireEvent.click(screen.getByRole('link', { name: 'Back to month' }))
    expect(location.pathname).toBe('/days')
  })

  it('says No such day for a date that is not on the calendar, and fetches nothing', async () => {
    render(<Days date="2026-02-30" />)
    await flush()
    expect(screen.getByText(/No such day\./)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Back to the calendar' }).getAttribute('href')).toBe('/days')
    expect(listTests).not.toHaveBeenCalled()
    expect(getJournal).not.toHaveBeenCalled()
    expect(getDays).not.toHaveBeenCalled()
  })

  it('shows an error for the tests alone, and retries only the tests', async () => {
    listTests.mockRejectedValueOnce(new Error('down'))
    getJournal.mockResolvedValue('A note')
    render(<Days date={DATE} />)
    await flush()
    const alert = screen.getByText(/Couldn't load this day's practice\./)
    expect(within(alert.parentElement!).getByRole('button', { name: 'Try again' })).toBeTruthy()
    expect(document.querySelector('.days__note')!.textContent).toBe('A note')

    listTests.mockResolvedValue([summary(7, noon)])
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await flush()
    expect(listTests).toHaveBeenCalledTimes(2)
    expect(getJournal).toHaveBeenCalledTimes(1)
    expect(document.querySelectorAll('.tests__row')).toHaveLength(1)
  })

  it('shows an error for the note alone, and retries only the note', async () => {
    getJournal.mockRejectedValueOnce(new Error('down'))
    listTests.mockResolvedValue([summary(7, noon)])
    render(<Days date={DATE} />)
    await flush()
    expect(screen.getByText(/Couldn't load this day's note\./)).toBeTruthy()
    expect(document.querySelectorAll('.tests__row')).toHaveLength(1)

    getJournal.mockResolvedValue('Back again')
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await flush()
    expect(getJournal).toHaveBeenCalledTimes(2)
    expect(listTests).toHaveBeenCalledTimes(1)
    expect(document.querySelector('.days__note')!.textContent).toBe('Back again')
  })

  it('does not show a late response for another day after the date changes', async () => {
    const slow = deferred<string>()
    getJournal.mockReturnValueOnce(slow.promise)
    const view = render(<Days date={DATE} />)
    await flush()
    getJournal.mockResolvedValue('Newer day')
    view.rerender(<Days date="2026-10-13" />)
    await flush()
    slow.resolve('Older day')
    await flush()
    expect(document.querySelector('.days__note')!.textContent).toBe('Newer day')
  })
})
