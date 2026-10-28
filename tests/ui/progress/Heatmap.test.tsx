// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/preact'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DayStat } from '../../../server/archive.ts'
import { addDays, currentStreak, dayLevel, longestStreak } from '../../../src/core/days.ts'
import { Heatmap } from '../../../src/ui/progress/Heatmap.tsx'
import { badNumbers, MIN, stat, TODAY } from './fixtures.ts'

// 2026-10-28 is a Wednesday. The year is 2025-10-29 (a Wednesday) to today; the first column is the week of
// Mon 27 Oct 2025 (two blank cells above Wednesday), the last is the week of Mon 26 Oct 2026 (four blank below).
const FIRST = '2025-10-29'

const flush = (): Promise<void> => act(async () => new Promise<void>((done) => setTimeout(done, 0)))

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function stub(handler: (p: URLSearchParams) => unknown): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async (input: string) => {
    const body = await handler(new URL(input, 'http://localhost').searchParams)
    return body instanceof Response ? body : new Response(JSON.stringify(body), { status: 200 })
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

async function mount(days: DayStat[] = [], today: string = TODAY): Promise<ReturnType<typeof render>> {
  stub(() => days)
  const view = render(<Heatmap today={today} />)
  await flush()
  return view
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const weeks = (c: Element): Element[] => [...c.querySelectorAll('.heat__week')]
const cells = (c: Element): HTMLElement[] => [...c.querySelectorAll<HTMLElement>('[data-date]')]
const cell = (c: Element, date: string): HTMLElement => c.querySelector<HTMLElement>(`[data-date="${date}"]`)!
const stops = (c: Element): string[] =>
  cells(c).flatMap((el) => (el.getAttribute('tabindex') === '0' ? [el.getAttribute('data-date')!] : []))
const focus = (el: HTMLElement): void => {
  act(() => el.focus())
}
const key = (el: Element, k: string): void => {
  fireEvent.keyDown(el, { key: k })
}

// A run of 7 days in September, and the last 4 days up to today: the longest streak is 7, the current 4.
const RUN = Array.from({ length: 7 }, (_, i) => addDays('2026-09-01', i))
const RECENT = ['2026-10-25', '2026-10-26', '2026-10-27', '2026-10-28']
const FIXTURE: DayStat[] = [
  ...RUN.map((d) => stat(d, 12, 300)),
  stat('2026-10-20', 5, 100), // a lone day
  ...RECENT.map((d, i) => stat(d, [5, 15, 45, 25][i], [100, 200, 900, 458][i])),
]

describe('Heatmap: the grid', () => {
  it('has the title, 53 week columns of 7 rows, and blanks before the first day and after today', async () => {
    const { container } = await mount()
    expect(screen.getByRole('heading', { level: 2, name: 'Practice, all modes' })).toBeTruthy()
    const cols = weeks(container)
    expect(cols).toHaveLength(53)
    for (const col of cols) expect(col.children).toHaveLength(7)
    const real = (col: Element): boolean[] => [...col.children].map((el) => el.hasAttribute('data-date'))
    expect(real(cols[0])).toEqual([false, false, true, true, true, true, true]) // Mon, Tue blank; Wed 29 Oct 2025 first
    expect(real(cols[52])).toEqual([true, true, true, false, false, false, false]) // Mon 26 to Wed 28 Oct 2026
    for (const col of cols.slice(1, 52)) expect(real(col)).toEqual(Array(7).fill(true))
    expect(cells(container)).toHaveLength(365)
    expect(cells(container)[0].getAttribute('data-date')).toBe(FIRST)
    expect(cells(container)[364].getAttribute('data-date')).toBe(TODAY)
    // rows are Monday to Sunday: the cell in row 2 of the first column is the Wednesday
    expect(cols[0].children[2].getAttribute('data-date')).toBe(FIRST)
  })

  it('puts a Sunday today in the last row of the last column', async () => {
    const { container } = await mount([], '2026-11-01')
    const cols = weeks(container)
    expect(cols).toHaveLength(53)
    expect(cols[52].children[6].getAttribute('data-date')).toBe('2026-11-01')
    expect(cells(container)).toHaveLength(365)
  })

  it('asks for the 365 days ending today, whatever else is on the page', async () => {
    const fn = stub(() => [])
    render(<Heatmap today={TODAY} />)
    await flush()
    const urls = fn.mock.calls.map(([u]) => new URL(String(u), 'http://localhost'))
    expect(urls).toHaveLength(1)
    expect(urls[0].pathname).toBe('/api/days')
    expect(urls[0].searchParams.get('from')).toBe(FIRST)
    expect(urls[0].searchParams.get('to')).toBe(TODAY)
  })

  it('shades every day with the Days-tab steps and a day without practice is level 0', async () => {
    const { container } = await mount([
      stat('2026-10-01', 0.5, 5),
      stat('2026-10-02', 9.99, 5),
      stat('2026-10-03', 10, 5),
      stat('2026-10-04', 29.99, 5),
      stat('2026-10-05', 30, 5),
      stat('2026-10-06', 600, 5),
    ])
    const level = (d: string): string | null => cell(container, d).getAttribute('data-level')
    expect(['01', '02', '03', '04', '05', '06'].map((d) => level(`2026-10-${d}`))).toEqual(['1', '1', '2', '2', '3', '3'])
    expect(level('2026-10-07')).toBe('0')
    expect(level(FIRST)).toBe('0')
    expect(level(TODAY)).toBe('0')
    for (const ms of [1, 5 * MIN, 10 * MIN, 29 * MIN, 30 * MIN, 90 * MIN]) {
      const { container: c } = await mount([{ date: '2026-10-10', tests: 1, strokes: 9, activeMs: ms }])
      expect(Number(cell(c, '2026-10-10').getAttribute('data-level'))).toBe(dayLevel(ms))
      cleanup()
    }
  })

  it('shades a day with strokes but no measured time as level 1, and counts several rows for one date together', async () => {
    const { container } = await mount([
      { date: '2026-10-10', tests: 1, strokes: 40, activeMs: 0 },
      { date: '2026-10-11', tests: 1, strokes: 10, activeMs: 6 * MIN },
      { date: '2026-10-11', tests: 1, strokes: 10, activeMs: 6 * MIN },
    ])
    expect(cell(container, '2026-10-10').getAttribute('data-level')).toBe('1')
    expect(cell(container, '2026-10-11').getAttribute('data-level')).toBe('2')
    expect(cell(container, '2026-10-11').getAttribute('aria-label')).toBe('Oct 11: 12 min, 20 strokes')
  })

  it('ignores days outside the year', async () => {
    const { container } = await mount([stat('2025-10-28', 20, 100), stat('2026-10-29', 20, 100), stat('2026-10-20', 20, 100)])
    expect(container.querySelectorAll('[data-level="2"]')).toHaveLength(1)
    expect(container.textContent).toContain('Longest streak: 1 day')
  })

  it('labels each cell with the date, the time and the strokes, or says no practice', async () => {
    const { container } = await mount(FIXTURE)
    expect(cell(container, '2026-10-23')).toBeTruthy()
    expect(cell(container, '2026-10-28').getAttribute('aria-label')).toBe('Oct 28: 25 min, 458 strokes')
    expect(cell(container, '2026-10-24').getAttribute('aria-label')).toBe('Oct 24: no practice')
    expect(cell(container, '2026-10-27').getAttribute('aria-label')).toBe('Oct 27: 45 min, 900 strokes')
    expect(cell(container, '2026-10-20').getAttribute('aria-label')).toBe('Oct 20: 5 min, 100 strokes')
    expect(cell(container, FIRST).getAttribute('aria-label')).toBe('Oct 29: no practice')
  })

  it('writes 1 stroke, under a minute and thousands plainly', async () => {
    const { container } = await mount([
      { date: '2026-10-10', tests: 1, strokes: 1, activeMs: 20000 },
      { date: '2026-10-11', tests: 1, strokes: 12345, activeMs: 90 * MIN },
    ])
    expect(cell(container, '2026-10-10').getAttribute('aria-label')).toBe('Oct 10: <1 min, 1 stroke')
    expect(cell(container, '2026-10-11').getAttribute('aria-label')).toBe('Oct 11: 1 h 30 min, 12,345 strokes')
  })

  it('has the weekday labels Mon, Wed and Fri, month labels (at most one per month) and a legend', async () => {
    const { container } = await mount()
    const weekdays = [...container.querySelectorAll('.heat__weekday')].map((el) => el.textContent)
    expect(weekdays.filter(Boolean)).toEqual(['Mon', 'Wed', 'Fri'])
    const months = [...container.querySelectorAll('.heat__month')].map((el) => el.textContent!)
    expect(months).toHaveLength(12)
    expect(new Set(months).size).toBe(months.length)
    expect(months[0]).toBe('Nov') // 1 Nov 2025 is in the first column
    expect(months[months.length - 1]).toBe('Oct')
    expect(screen.getByText('Less')).toBeTruthy()
    expect(screen.getByText('More')).toBeTruthy()
    expect(container.querySelectorAll('.heat__swatch')).toHaveLength(4)
    // the legend swatches are not days
    expect(container.querySelectorAll('[data-level]')).toHaveLength(365)
  })

  it('puts each month label over the column that holds the first day of that month', async () => {
    const { container } = await mount()
    const labelOf = (date: string): string | null =>
      cell(container, date).closest('.heat__col')!.querySelector('.heat__month')?.textContent ?? null
    expect(labelOf('2025-11-01')).toBe('Nov') // a Saturday, in the first column
    expect(labelOf('2025-12-01')).toBe('Dec')
    expect(labelOf('2026-10-01')).toBe('Oct')
    expect(labelOf('2025-12-10')).toBeNull()
    expect(container.querySelectorAll('.heat__month')).toHaveLength(12)
  })
})

describe('Heatmap: streaks', () => {
  it('shows the current and longest streak the page counts from the days with practice', async () => {
    const { container } = await mount(FIXTURE)
    const active = new Set(FIXTURE.map((d) => d.date))
    expect(currentStreak(active, TODAY)).toBe(4)
    expect(longestStreak(active)).toBe(7)
    expect(screen.getByText('Current streak: 4 days')).toBeTruthy()
    expect(screen.getByText('Longest streak: 7 days')).toBeTruthy()
    expect(container.textContent).toContain('A day counts when you practiced in it')
  })

  it('counts a current streak that ends yesterday, and says 0 days with no practice', async () => {
    await mount([stat('2026-10-26', 10, 100), stat('2026-10-27', 10, 100)])
    expect(screen.getByText('Current streak: 2 days')).toBeTruthy()
    cleanup()
    await mount([])
    expect(screen.getByText('Current streak: 0 days')).toBeTruthy()
    expect(screen.getByText('Longest streak: 0 days')).toBeTruthy()
  })

  it('writes 1 day, not 1 days', async () => {
    await mount([stat('2026-10-28', 10, 100)])
    expect(screen.getByText('Current streak: 1 day')).toBeTruthy()
    expect(screen.getByText('Longest streak: 1 day')).toBeTruthy()
  })

  it('counts a day with strokes but no time, and not a row of zeros', async () => {
    await mount([
      { date: '2026-10-27', tests: 1, strokes: 30, activeMs: 0 },
      { date: '2026-10-28', tests: 1, strokes: 0, activeMs: 0 },
    ])
    // today has only zeros, so it does not count; yesterday had strokes, so the streak runs to yesterday
    expect(screen.getByText('Current streak: 1 day')).toBeTruthy()
    expect(screen.getByText('Longest streak: 1 day')).toBeTruthy()
    cleanup()
    await mount([{ date: '2026-10-28', tests: 1, strokes: 0, activeMs: 0 }])
    expect(screen.getByText('Current streak: 0 days')).toBeTruthy()
    expect(screen.getByText('Longest streak: 0 days')).toBeTruthy()
  })

  it('says in a muted note that streaks count within the last year when the longest one touches the first day', async () => {
    const run = Array.from({ length: 9 }, (_, i) => stat(addDays(FIRST, i), 10, 100))
    const { container } = await mount(run)
    expect(screen.getByText('Longest streak: 9 days')).toBeTruthy()
    expect(container.textContent).toContain('Streaks are counted within the last year only')
    cleanup()
    const { container: other } = await mount(FIXTURE)
    expect(other.textContent).not.toContain('within the last year only')
  })
})

describe('Heatmap: one tab stop and the keys', () => {
  it('has exactly one tabindex 0 (today) and every other real cell -1', async () => {
    const { container } = await mount(FIXTURE)
    expect(stops(container)).toEqual([TODAY])
    expect(cells(container).filter((el) => el.getAttribute('tabindex') === '-1')).toHaveLength(364)
    expect(container.querySelectorAll('[tabindex="0"]').length).toBe(1)
  })

  it('moves by a week with ArrowLeft and ArrowRight (same weekday) and by a day with ArrowUp and ArrowDown', async () => {
    const { container } = await mount()
    focus(cell(container, '2026-10-14'))
    expect(stops(container)).toEqual(['2026-10-14']) // focusing a cell makes it the stop
    key(document.activeElement!, 'ArrowRight')
    expect(document.activeElement).toBe(cell(container, '2026-10-21'))
    expect(stops(container)).toEqual(['2026-10-21'])
    key(document.activeElement!, 'ArrowLeft')
    key(document.activeElement!, 'ArrowLeft')
    expect(document.activeElement).toBe(cell(container, '2026-10-07'))
    key(document.activeElement!, 'ArrowDown')
    expect(document.activeElement).toBe(cell(container, '2026-10-08'))
    key(document.activeElement!, 'ArrowUp')
    key(document.activeElement!, 'ArrowUp')
    expect(document.activeElement).toBe(cell(container, '2026-10-06'))
    expect(stops(container)).toEqual(['2026-10-06'])
  })

  it('goes to the first and last day with Home and End', async () => {
    const { container } = await mount()
    focus(cell(container, '2026-03-03'))
    key(document.activeElement!, 'Home')
    expect(document.activeElement).toBe(cell(container, FIRST))
    expect(stops(container)).toEqual([FIRST])
    key(document.activeElement!, 'End')
    expect(document.activeElement).toBe(cell(container, TODAY))
    expect(stops(container)).toEqual([TODAY])
  })

  it('stops at the ends: no wrap, and a week step that overshoots lands on the end', async () => {
    const { container } = await mount()
    focus(cell(container, TODAY))
    key(document.activeElement!, 'ArrowRight') // a week after today does not exist
    expect(document.activeElement).toBe(cell(container, TODAY))
    key(document.activeElement!, 'ArrowDown')
    expect(document.activeElement).toBe(cell(container, TODAY))
    expect(stops(container)).toEqual([TODAY])
    focus(cell(container, FIRST))
    key(document.activeElement!, 'ArrowUp')
    expect(document.activeElement).toBe(cell(container, FIRST))
    key(document.activeElement!, 'ArrowLeft')
    expect(document.activeElement).toBe(cell(container, FIRST))
    focus(cell(container, '2025-11-02'))
    key(document.activeElement!, 'ArrowLeft') // 2025-10-26 is before the year: clamps to the first day
    expect(document.activeElement).toBe(cell(container, FIRST))
    focus(cell(container, '2026-10-25'))
    key(document.activeElement!, 'ArrowRight') // 2026-11-01 is after today
    expect(document.activeElement).toBe(cell(container, TODAY))
    expect(stops(container)).toEqual([TODAY])
  })

  it('ignores other keys and leaves them to the browser', async () => {
    const { container } = await mount()
    focus(cell(container, '2026-10-14'))
    const event = new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true })
    document.activeElement!.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
    expect(document.activeElement).toBe(cell(container, '2026-10-14'))
    const arrow = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })
    document.activeElement!.dispatchEvent(arrow)
    expect(arrow.defaultPrevented).toBe(true)
  })

  it('shows a tooltip for the focused cell, which is the same words as its label', async () => {
    const { container } = await mount(FIXTURE)
    expect(container.querySelector('.heat__tip')).toBeNull()
    focus(cell(container, '2026-10-28'))
    const tip = container.querySelector('.heat__tip')!
    expect(tip.textContent).toBe('Oct 28: 25 min, 458 strokes')
    expect(tip.getAttribute('aria-hidden')).toBe('true')
    key(document.activeElement!, 'ArrowDown')
    expect(container.querySelector('.heat__tip')).toBeTruthy()
    fireEvent.blur(document.activeElement!)
    expect(container.querySelector('.heat__tip')).toBeNull()
    fireEvent.mouseEnter(cell(container, '2026-10-20'))
    expect(container.querySelector('.heat__tip')!.textContent).toBe('Oct 20: 5 min, 100 strokes')
    fireEvent.mouseLeave(cell(container, '2026-10-20'))
    expect(container.querySelector('.heat__tip')).toBeNull()
  })

  it('draws the days as images, not buttons, and keeps the label, level, tab stop and focus on them', async () => {
    const { container } = await mount(FIXTURE)
    expect(container.querySelectorAll('[data-date]')).toHaveLength(365)
    for (const el of cells(container)) {
      expect(el.getAttribute('role')).toBe('img')
      expect(el.tagName).not.toBe('BUTTON')
      expect(el.getAttribute('aria-label')).toBeTruthy()
    }
    expect(screen.getAllByRole('img', { name: /: (no practice|\d)/ }).length).toBe(365)
    // the only button of the panel is none while loaded: nothing announces as a button
    expect(container.querySelectorAll('button')).toHaveLength(0)
  })

  it('has the grid in a scrolling container that is a labelled group', async () => {
    const { container } = await mount()
    const group = screen.getByRole('group', { name: 'Practice in the last year' })
    expect(group.querySelectorAll('[data-date]')).toHaveLength(365)
    expect(container.querySelector('.heat__scroll')).toBeTruthy()
  })
})

describe('Heatmap: the numbers', () => {
  it('lists only days with practice, newest first, under Show the numbers', async () => {
    const { container } = await mount(FIXTURE)
    const details = container.querySelector('details.chart__numbers')!
    expect(within(details as HTMLElement).getByText('Show the numbers')).toBeTruthy()
    const rows = [...details.querySelectorAll('tbody tr')].map((tr) => [...tr.children].map((c) => c.textContent))
    expect(rows).toHaveLength(FIXTURE.length)
    expect(rows[0]).toEqual(['Oct 28 2026', '25 min', '458'])
    expect(rows[1]).toEqual(['Oct 27 2026', '45 min', '900'])
    expect(rows[rows.length - 1]).toEqual(['Sep 1 2026', '12 min', '300'])
    const dates = rows.map((r) => r[0]!)
    expect(dates).toEqual([...dates].sort((a, b) => (new Date(a) < new Date(b) ? 1 : -1)))
    expect(details.querySelector('caption')!.textContent).toMatch(/days without practice are left out/i)
    expect(details.querySelector('caption')!.textContent).toMatch(/newest first/i)
  })

  it('has an empty table body when nothing was practiced', async () => {
    const { container } = await mount()
    expect(container.querySelectorAll('details.chart__numbers tbody tr')).toHaveLength(0)
  })
})

describe('Heatmap: loading, failing and late answers', () => {
  it('shows Loading… with the heading, then the grid', async () => {
    const gate = deferred<DayStat[]>()
    stub(() => gate.promise)
    const { container } = render(<Heatmap today={TODAY} />)
    await flush()
    expect(screen.getByRole('heading', { level: 2, name: 'Practice, all modes' })).toBeTruthy()
    expect(screen.getByText('Loading…')).toBeTruthy()
    expect(container.querySelectorAll('[data-date]')).toHaveLength(0)
    gate.resolve([])
    await flush()
    expect(screen.queryByText('Loading…')).toBeNull()
    expect(container.querySelectorAll('[data-date]')).toHaveLength(365)
  })

  it("says Couldn't load the year. and Try again asks again", async () => {
    let answer: unknown = new Response('{}', { status: 500 })
    const fn = stub(() => answer)
    const { container } = render(<Heatmap today={TODAY} />)
    await flush()
    expect(screen.getByText(/Couldn't load the year\./)).toBeTruthy()
    expect(container.querySelectorAll('[data-date]')).toHaveLength(0)
    answer = [stat('2026-10-28', 10, 100)]
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await flush()
    expect(fn).toHaveBeenCalledTimes(2)
    expect(screen.queryByText(/Couldn't load the year/)).toBeNull()
    expect(screen.getByText('Current streak: 1 day')).toBeTruthy()
  })

  it('ignores an answer that arrives after the page is gone', async () => {
    const gate = deferred<DayStat[]>()
    stub(() => gate.promise)
    const view = render(<Heatmap today={TODAY} />)
    await flush()
    view.unmount()
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    gate.resolve([stat('2026-10-28', 10, 100)])
    await flush()
    expect(errors).not.toHaveBeenCalled()
  })

  it('shows the answer for the day it was asked for, not an earlier one, when today changes', async () => {
    const early = deferred<DayStat[]>()
    const late = deferred<DayStat[]>()
    const answers: Record<string, Promise<DayStat[]>> = { [TODAY]: early.promise, '2026-10-29': late.promise }
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) => {
        const to = new URL(input, 'http://localhost').searchParams.get('to')!
        return new Response(JSON.stringify(await answers[to]), { status: 200 })
      }),
    )
    const view = render(<Heatmap today={TODAY} />)
    await flush()
    view.rerender(<Heatmap today="2026-10-29" />)
    await flush()
    late.resolve([stat('2026-10-29', 40, 100)])
    await flush()
    early.resolve([stat('2026-10-28', 5, 100)])
    await flush()
    expect(view.container.querySelectorAll('[data-level="1"]')).toHaveLength(0)
    expect(cell(view.container, '2026-10-29').getAttribute('data-level')).toBe('3')
  })
})

describe('Heatmap: no NaN or Infinity', () => {
  const FIXTURES: [string, DayStat[]][] = [
    ['empty', []],
    ['one day', [stat(TODAY, 20, 800)]],
    ['zero', [stat(TODAY, 0, 0)]],
    ['odd numbers', [
      { date: '2026-10-10', tests: 1, strokes: Number.MAX_VALUE, activeMs: Number.MAX_VALUE },
      { date: '2026-10-11', tests: 1, strokes: -5, activeMs: -5 },
      { date: '2026-10-12', tests: 1, strokes: 1e308, activeMs: 1e308 },
      { date: '2026-10-12', tests: 1, strokes: 1e308, activeMs: 1e308 },
    ]],
    ['every day', Array.from({ length: 365 }, (_, i) => stat(addDays(FIRST, i), (i % 50) + 1, i * 10 + 1))],
  ]
  for (const [name, days] of FIXTURES) {
    it(`has none in attributes or text: ${name}`, async () => {
      const { container } = await mount(days)
      expect(badNumbers(container)).toEqual([])
    })
  }
})
