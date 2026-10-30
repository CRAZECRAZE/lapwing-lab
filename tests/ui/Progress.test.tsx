// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/preact'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DayStat } from '../../server/archive.ts'
import type { DayQuality, StatsResponse } from '../../server/stats.ts'
import type { Progress as ChapterProgress } from '../../src/state/progress.tsx'
import { Progress } from '../../src/ui/Progress.tsx'

// The chapter ladder reads the chapter results through `useProgress`; here it gets a ready value with no chapters
// unless a test sets `chapterProgress.value`.
const chapterProgress = vi.hoisted(() => ({ value: null as ChapterProgress | null }))
vi.mock('../../src/state/progress.tsx', async (importActual) => {
  const actual = await importActual<typeof import('../../src/state/progress.tsx')>()
  return { ...actual, useProgress: () => chapterProgress.value ?? NO_CHAPTERS }
})
const NO_CHAPTERS: ChapterProgress = {
  status: 'ready',
  chapters: [],
  index: [],
  results: { stage0: [], section: [], 'chapter-test': [] },
  marks: [],
  states: new Map(),
  reload: async () => undefined,
  setMark: async () => undefined,
  setMarks: async () => undefined,
  clearMark: async () => undefined,
}

// 2026-10-28 is a Wednesday: this week began Mon 26 Oct, the previous full week is 19 to 25 Oct,
// the last 7 days are 22 to 28 Oct and the 7 days before are 15 to 21 Oct.
const TODAY = '2026-10-28'
const MIN = 60000

const day = (date: string, minutes: number, strokes: number): DayStat => ({
  date,
  tests: 1,
  strokes,
  activeMs: minutes * MIN,
})
const quality = (
  date: string,
  runs: number,
  words: number,
  wpm: number | null,
  accuracy: number | null,
): DayQuality => ({ date, runs, words, wpm, accuracy, steadiness: null })

const statsOf = (days: DayQuality[], over: Partial<StatsResponse> = {}): StatsResponse => ({
  from: '',
  to: '',
  mode: 'free',
  days,
  keys: [],
  mixups: [],
  allTimeStrokes: 48902,
  ...over,
})

// This week 4 h 36 min and 11,284 strokes; last week 3 h 11 min and 10,080 strokes (+1 h 25 min, +1,204).
const DAYS: DayStat[] = [
  day('2026-10-20', 191, 10080),
  day('2026-10-26', 120, 5000),
  day('2026-10-27', 156, 6284),
]
// Last 7 days: 15.4 wpm and 94.6 % over 4 runs; the 7 days before: 14.0 wpm and 92.5 % over 3 runs.
const QUALITY: DayQuality[] = [
  quality('2026-10-20', 3, 200, 14, 0.925),
  quality('2026-10-26', 2, 100, 15, 0.94),
  quality('2026-10-27', 2, 100, 15.8, 0.952),
]

type Params = URLSearchParams
type Spec = {
  stats?: (p: Params) => unknown
  days?: (p: Params) => unknown
  tests?: (url: URL) => unknown
  settings?: (method: string, body: unknown) => unknown
}

/** Stubs fetch for the two routes. A handler may return a Response, a promise, or the JSON body itself. */
function stub(spec: Spec = {}): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input, 'http://localhost')
    if (url.pathname.startsWith('/api/tests')) {
      const found = await (spec.tests ?? (() => []))(url)
      return found instanceof Response ? found : new Response(JSON.stringify(found), { status: 200 })
    }
    if (url.pathname === '/api/settings') {
      const found = await (spec.settings ?? (() => ({})))(init?.method ?? 'GET', init?.body ? JSON.parse(String(init.body)) : undefined)
      return found instanceof Response ? found : new Response(JSON.stringify(found), { status: 200 })
    }
    const handler = url.pathname === '/api/stats' ? (spec.stats ?? (() => statsOf(QUALITY))) : (spec.days ?? (() => DAYS))
    const body = await handler(url.searchParams)
    return body instanceof Response ? body : new Response(JSON.stringify(body), { status: 200 })
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

/** The year the heatmap asks for: the 365 days ending today, whatever the range. */
const isYear = (p: Params): boolean => p.get('from') === '2025-10-29' && p.get('to') === TODAY

const allCalls = (fn: ReturnType<typeof vi.fn>, path: string): Params[] =>
  fn.mock.calls
    .map(([u]) => new URL(String(u), 'http://localhost'))
    .filter((u) => u.pathname === path)
    .map((u) => u.searchParams)

/** The requests of the page's own data; the heatmap's year is counted apart (`yearCalls`). */
const calls = (fn: ReturnType<typeof vi.fn>, path: string): Params[] =>
  allCalls(fn, path).filter((p) => !(path === '/api/days' && isYear(p)) && !(path === '/api/stats' && isPlateauWindow(p)))
/** The plateau notice's own request: the 56 free-type days ending today, whatever the switches say. */
const isPlateauWindow = (p: Params): boolean =>
  p.get('from') === '2026-09-03' && p.get('to') === TODAY && p.get('mode') === 'free'
const plateauCalls = (fn: ReturnType<typeof vi.fn>): Params[] => allCalls(fn, '/api/stats').filter(isPlateauWindow)
const yearCalls = (fn: ReturnType<typeof vi.fn>): Params[] => allCalls(fn, '/api/days').filter(isYear)

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

// A macrotask turn: every fetch, json() and promise hop has settled by then.
const flush = (): Promise<void> => act(async () => new Promise<void>((done) => setTimeout(done, 0)))
const click = (name: string): void => {
  fireEvent.click(screen.getByRole('button', { name }))
}
const tile = (label: string): HTMLElement => screen.getByText(label).closest('article') as HTMLElement
const failed = (): Response => new Response('{}', { status: 500 })

async function mount(today: string = TODAY): Promise<void> {
  render(<Progress today={today} />)
  await flush()
}

beforeEach(() => {
  history.replaceState(null, '', '/progress')
  chapterProgress.value = null
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  history.replaceState(null, '', '/')
})

describe('Progress page structure', () => {
  it('has a heading and two named groups of toggle buttons with the defaults pressed', async () => {
    stub()
    await mount()
    expect(screen.getByRole('heading', { name: 'Progress', level: 1 })).toBeTruthy()
    const range = screen.getByRole('group', { name: 'Range' })
    const mode = screen.getByRole('group', { name: 'Mode' })
    expect(within(range).getAllByRole('button').map((b) => b.textContent)).toEqual(['4 weeks', '3 months', 'All time'])
    expect(within(mode).getAllByRole('button').map((b) => b.textContent)).toEqual([
      'Free type',
      'Drills and tests',
      'Everything',
    ])
    const pressed = (name: string): string | null => screen.getByRole('button', { name }).getAttribute('aria-pressed')
    expect(pressed('4 weeks')).toBe('true')
    expect(pressed('3 months')).toBe('false')
    expect(pressed('All time')).toBe('false')
    expect(pressed('Free type')).toBe('true')
    expect(pressed('Drills and tests')).toBe('false')
    expect(pressed('Everything')).toBe('false')
  })

  it('shows the four tiles as a list of articles, each with its label', async () => {
    stub()
    await mount()
    const list = screen.getByRole('list', { name: 'Headline figures' })
    const articles = within(list).getAllByRole('article')
    expect(articles).toHaveLength(4)
    expect(articles.map((a) => a.getAttribute('aria-labelledby')).every((id) => id && document.getElementById(id))).toBe(
      true,
    )
    expect(screen.getByText('This week')).toBeTruthy()
    expect(screen.getByText('Strokes this week')).toBeTruthy()
    expect(screen.getByText('7-day average')).toBeTruthy()
    expect(screen.getByText('First-try accuracy')).toBeTruthy()
  })

  it('says which tiles cover all modes', async () => {
    stub()
    await mount()
    expect(within(tile('This week')).getByText('all modes')).toBeTruthy()
    expect(within(tile('Strokes this week')).getByText('all modes')).toBeTruthy()
    // the two quality tiles follow the mode, so in Free type they say free type, not all modes
    expect(within(tile('7-day average')).queryByText('all modes')).toBeNull()
    expect(within(tile('First-try accuracy')).queryByText('all modes')).toBeNull()
  })
})

describe('Progress requests', () => {
  it('asks for the last 28 days in free mode, and for the days covering the previous full week', async () => {
    const fn = stub()
    await mount()
    expect(calls(fn, '/api/stats').map((p) => Object.fromEntries(p))).toEqual([
      { from: '2026-10-01', to: '2026-10-28', mode: 'free' },
    ])
    const days = calls(fn, '/api/days').map((p) => Object.fromEntries(p))
    expect(days).toEqual([{ from: '2026-10-01', to: '2026-10-28' }])
    // the span covers the previous Monday-week (19 Oct) and the 7 days before the last 7 (15 Oct)
    expect(days[0]!.from! <= '2026-10-15').toBe(true)
  })

  it('defaults today to the local date at mount', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 9, 28, 23, 30, 0))
    const fn = stub()
    render(<Progress />)
    await flush()
    expect(Object.fromEntries(calls(fn, '/api/stats')[0]!)).toEqual({ from: '2026-10-01', to: '2026-10-28', mode: 'free' })
  })

  it('refetches with the new bounds when 3 months is chosen, and aria-pressed follows', async () => {
    const fn = stub()
    await mount()
    click('3 months')
    await flush()
    expect(calls(fn, '/api/stats').map((p) => Object.fromEntries(p))).toEqual([
      { from: '2026-10-01', to: '2026-10-28', mode: 'free' },
      { from: '2026-07-30', to: '2026-10-28', mode: 'free' },
    ])
    expect(calls(fn, '/api/days').map((p) => Object.fromEntries(p))).toEqual([
      { from: '2026-10-01', to: '2026-10-28' },
      { from: '2026-07-30', to: '2026-10-28' },
    ])
    expect(screen.getByRole('button', { name: '3 months' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: '4 weeks' }).getAttribute('aria-pressed')).toBe('false')
  })

  it('refetches with the new mode when Everything is chosen, keeping the range', async () => {
    const fn = stub()
    await mount()
    click('Everything')
    await flush()
    const stats = calls(fn, '/api/stats').map((p) => Object.fromEntries(p))
    expect(stats[1]).toEqual({ from: '2026-10-01', to: '2026-10-28', mode: 'all' })
    expect(screen.getByRole('button', { name: 'Everything' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'Free type' }).getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByRole('button', { name: '4 weeks' }).getAttribute('aria-pressed')).toBe('true')
    click('Drills and tests')
    await flush()
    expect(Object.fromEntries(calls(fn, '/api/stats')[2]!).mode).toBe('drills')
  })

  it('does not read the clock after mount; the injected today rules every later request', async () => {
    const fn = stub()
    await mount()
    const real = Date.now.bind(Date)
    const stacks: string[] = []
    // jsdom reads the clock to stamp events; only reads made from the app's own code count
    vi.spyOn(Date, 'now').mockImplementation(() => {
      stacks.push(new Error().stack!)
      return real()
    })
    click('3 months')
    await flush()
    click('Drills and tests')
    await flush()
    expect(stacks.filter((s) => /\/src\/(ui|core)\//.test(s))).toEqual([])
    expect(Object.fromEntries(calls(fn, '/api/stats')[2]!)).toEqual({
      from: '2026-07-30',
      to: '2026-10-28',
      mode: 'drills',
    })
  })
})

describe('Progress tiles', () => {
  it('shows the values for a fixture', async () => {
    stub()
    await mount()
    expect(within(tile('This week')).getByText('4 h 36 min')).toBeTruthy()
    const strokes = tile('Strokes this week')
    expect(within(strokes).getByText('11,284')).toBeTruthy()
    expect(within(strokes).getByText('48,902 all time')).toBeTruthy()
    expect(within(tile('7-day average')).getByText('15.4 wpm')).toBeTruthy()
    expect(within(tile('First-try accuracy')).getByText('94.6%')).toBeTruthy()
  })

  it('shows each change against the earlier window when both have data', async () => {
    stub()
    await mount()
    expect(within(tile('This week')).getByText('+1 h 25 min vs last week')).toBeTruthy()
    expect(within(tile('Strokes this week')).getByText('+1,204 vs last week')).toBeTruthy()
    expect(within(tile('7-day average')).getByText('+1.4 wpm vs the 7 days before')).toBeTruthy()
    expect(within(tile('First-try accuracy')).getByText('+2.1 points vs the 7 days before')).toBeTruthy()
  })

  it('shows decreases with a minus sign and an equal figure as the same', async () => {
    stub({
      days: () => [day('2026-10-20', 100, 5000), day('2026-10-26', 88, 5000)],
      stats: () => statsOf([quality('2026-10-20', 3, 100, 20, 0.9), quality('2026-10-27', 3, 100, 18.5, 0.88)]),
    })
    await mount()
    expect(within(tile('This week')).getByText('-12 min vs last week')).toBeTruthy()
    expect(within(tile('Strokes this week')).getByText('same as last week')).toBeTruthy()
    expect(within(tile('7-day average')).getByText('-1.5 wpm vs the 7 days before')).toBeTruthy()
    expect(within(tile('First-try accuracy')).getByText('-2.0 points vs the 7 days before')).toBeTruthy()
  })

  it('shows no change line when the earlier window has no data', async () => {
    stub({
      days: () => [day('2026-10-26', 120, 5000)],
      stats: () => statsOf([quality('2026-10-26', 4, 100, 15, 0.94)]),
    })
    await mount()
    expect(within(tile('This week')).getByText('2 h 00 min')).toBeTruthy()
    expect(within(tile('7-day average')).getByText('15.0 wpm')).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/vs last week|vs the 7 days before/)
  })

  it('shows no change line when this window has no data but the earlier one has', async () => {
    stub({
      days: () => [day('2026-10-20', 120, 5000)],
      stats: () => statsOf([quality('2026-10-20', 4, 100, 15, 0.94)]),
    })
    await mount()
    expect(document.body.textContent).not.toMatch(/vs last week|vs the 7 days before/)
  })

  it('shows — and not enough data yet for a window resting on fewer than 3 runs', async () => {
    stub({ stats: () => statsOf([quality('2026-10-20', 3, 200, 14, 0.925), quality('2026-10-27', 2, 100, 15.8, 0.952)]) })
    await mount()
    for (const label of ['7-day average', 'First-try accuracy']) {
      const t = tile(label)
      expect(within(t).getByText('—')).toBeTruthy()
      expect(within(t).getByText('not enough data yet')).toBeTruthy()
      expect(within(t).queryByText(/vs the 7 days before/)).toBeNull()
    }
    // practice time and strokes are not subject to the 3-run rule
    expect(within(tile('This week')).getByText('4 h 36 min')).toBeTruthy()
    expect(within(tile('This week')).queryByText('not enough data yet')).toBeNull()
  })

  it('shows a value but no change when only the earlier window has fewer than 3 runs', async () => {
    stub({ stats: () => statsOf([quality('2026-10-20', 2, 200, 14, 0.925), quality('2026-10-27', 3, 100, 15.8, 0.952)]) })
    await mount()
    const t = tile('7-day average')
    expect(within(t).getByText('15.8 wpm')).toBeTruthy()
    expect(within(t).queryByText('not enough data yet')).toBeNull()
    expect(within(t).queryByText(/vs the 7 days before/)).toBeNull()
  })

  it('treats a window with 3 runs but no words as no data', async () => {
    stub({ stats: () => statsOf([quality('2026-10-20', 3, 200, 14, 0.925), quality('2026-10-27', 3, 0, null, null)]) })
    await mount()
    expect(within(tile('7-day average')).getByText('—')).toBeTruthy()
    expect(within(tile('7-day average')).getByText('not enough data yet')).toBeTruthy()
    expect(within(tile('First-try accuracy')).getByText('—')).toBeTruthy()
  })

  it('weights the average by words, not by day', async () => {
    stub({
      stats: () =>
        statsOf([
          quality('2026-10-26', 3, 300, 10, 0.9),
          quality('2026-10-27', 3, 100, 20, 0.5),
        ]),
    })
    await mount()
    expect(within(tile('7-day average')).getByText('12.5 wpm')).toBeTruthy() // (10*300 + 20*100) / 400
    expect(within(tile('First-try accuracy')).getByText('80.0%')).toBeTruthy() // (0.9*300 + 0.5*100) / 400
  })

  it('puts a Sunday in the earlier week and a Monday in this one, and ignores older and future days', async () => {
    stub({
      days: () => [
        day('2026-10-18', 100, 1000), // the Sunday before last week: in neither
        day('2026-10-19', 10, 10), // Monday: last week
        day('2026-10-25', 20, 20), // Sunday: last week
        day('2026-10-26', 5, 5), // Monday: this week
        day('2026-10-28', 7, 7), // today
        day('2026-10-29', 500, 500), // after today: in neither
      ],
    })
    await mount()
    expect(within(tile('This week')).getByText('12 min')).toBeTruthy()
    expect(within(tile('This week')).getByText('-18 min vs last week')).toBeTruthy()
    expect(within(tile('Strokes this week')).getByText('12')).toBeTruthy()
    expect(within(tile('Strokes this week')).getByText('-18 vs last week')).toBeTruthy()
  })

  it('takes the 7-day windows as the 7 days ending today and the 7 days before them', async () => {
    stub({
      stats: () =>
        statsOf([
          quality('2026-10-14', 3, 100, 100, 1), // 14 days back: in neither
          quality('2026-10-15', 3, 100, 10, 0.5), // earliest day of the earlier window
          quality('2026-10-21', 3, 100, 20, 0.5), // latest day of the earlier window
          quality('2026-10-22', 3, 100, 30, 0.9), // earliest day of the last 7
          quality('2026-10-28', 3, 100, 40, 0.9), // today
          quality('2026-10-29', 3, 100, 200, 0.1), // after today: in neither
        ]),
    })
    await mount()
    const wpm = tile('7-day average')
    expect(within(wpm).getByText('35.0 wpm')).toBeTruthy()
    expect(within(wpm).getByText('+20.0 wpm vs the 7 days before')).toBeTruthy()
    const accuracy = tile('First-try accuracy')
    expect(within(accuracy).getByText('90.0%')).toBeTruthy()
    expect(within(accuracy).getByText('+40.0 points vs the 7 days before')).toBeTruthy()
  })

  it('shows accuracy to a tenth, so two figures that round to the same whole percent differ', async () => {
    stub({ stats: () => statsOf([quality('2026-10-27', 3, 100, 15, 0.946)]) })
    await mount()
    expect(within(tile('First-try accuracy')).getByText('94.6%')).toBeTruthy()
    cleanup()
    stub({ stats: () => statsOf([quality('2026-10-27', 3, 100, 15, 0.951)]) })
    await mount()
    expect(within(tile('First-try accuracy')).getByText('95.1%')).toBeTruthy()
  })

  it('formats thousands the same everywhere', async () => {
    stub({ stats: () => statsOf(QUALITY, { allTimeStrokes: 1234567 }) })
    await mount()
    expect(within(tile('Strokes this week')).getByText('1,234,567 all time')).toBeTruthy()
  })
})

describe('Progress scopes follow the mode', () => {
  const scopeOf = (name: string): string | null => {
    const heading = screen.getAllByRole('heading', { level: 2 }).find((h) => h.textContent === name)!
    return heading.parentElement!.querySelector('.panel__scope')?.textContent ?? null
  }
  const tileScope = (label: string): string | null => tile(label).querySelector('.tile__scope')?.textContent ?? null

  it.each([
    ['Free type', 'free type'],
    ['Drills and tests', 'drills and tests'],
    ['Everything', 'all modes'],
  ])('with %s every panel and tile that follows the mode says %s, in its muted style', async (button, scope) => {
    stub()
    await mount()
    click(button)
    await flush()
    const labels = screen.getAllByRole('article').map((a) => a.querySelector('.tile__name')!.textContent)
    expect(labels).toEqual(['This week', 'Strokes this week', '7-day average', 'First-try accuracy'])
    expect([tileScope('7-day average'), tileScope('First-try accuracy')]).toEqual([scope, scope])
    expect(
      [scopeOf('Wpm by day'), scopeOf('Accuracy and consistency'), scopeOf('Rhythm: how steady you type')],
    ).toEqual([scope, scope, scope])
    // the scope is not said twice: the titles and labels carry no mode of their own
    expect(screen.queryByText(/^Free-type|^Drills and tests (wpm|7-day)/)).toBeNull()
  })

  it('leaves the panels that always cover all modes with their own scope', async () => {
    stub()
    await mount()
    click('Drills and tests')
    await flush()
    expect(tileScope('This week')).toBe('all modes')
    expect(scopeOf('Practice time per week')).toBe('all modes')
  })
})

describe('Progress loading, failure and empty states', () => {
  it('says Loading… until the data arrives', async () => {
    const gate = deferred<StatsResponse>()
    stub({ stats: () => gate.promise })
    render(<Progress today={TODAY} />)
    await flush()
    expect(screen.getByText('Loading…')).toBeTruthy()
    expect(screen.queryByRole('list', { name: 'Headline figures' })).toBeNull()
    gate.resolve(statsOf(QUALITY))
    await flush()
    expect(screen.queryByText('Loading…')).toBeNull()
    expect(screen.getByRole('list', { name: 'Headline figures' })).toBeTruthy()
  })

  it('shows Couldn’t load your progress. with Try again, which refetches both requests', async () => {
    let ok = false
    const fn = stub({ stats: () => (ok ? statsOf(QUALITY) : failed()) })
    await mount()
    expect(screen.getByText(/Couldn't load your progress\./)).toBeTruthy()
    expect(screen.queryByRole('list', { name: 'Headline figures' })).toBeNull()
    ok = true
    click('Try again')
    await flush()
    expect(calls(fn, '/api/stats')).toHaveLength(2)
    expect(calls(fn, '/api/days')).toHaveLength(2)
    expect(screen.queryByText(/Couldn't load your progress\./)).toBeNull()
    expect(within(tile('This week')).getByText('4 h 36 min')).toBeTruthy()
  })

  it('also fails when only the days request fails', async () => {
    stub({ days: () => failed() })
    await mount()
    expect(screen.getByText(/Couldn't load your progress\./)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
  })

  it('shows No practice recorded yet. when there are no days and no strokes at all', async () => {
    stub({ days: () => [], stats: () => statsOf([], { allTimeStrokes: 0 }) })
    await mount()
    expect(screen.getByText('No practice recorded yet.')).toBeTruthy()
    expect(screen.queryByRole('list', { name: 'Headline figures' })).toBeNull()
  })

  it('does not show the empty state when only the span is empty but older practice exists', async () => {
    stub({ days: () => [], stats: () => statsOf([], { allTimeStrokes: 500 }) })
    await mount()
    expect(screen.queryByText('No practice recorded yet.')).toBeNull()
    expect(within(tile('Strokes this week')).getByText('500 all time')).toBeTruthy()
  })

  it('does not show the empty state when the span has days even if allTimeStrokes is 0', async () => {
    stub({ stats: () => statsOf(QUALITY, { allTimeStrokes: 0 }) })
    await mount()
    expect(screen.queryByText('No practice recorded yet.')).toBeNull()
  })
})

describe('Progress stale responses', () => {
  it('ignores a response that arrives after the page is gone', async () => {
    const gate = deferred<StatsResponse>()
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    stub({ stats: () => gate.promise })
    const view = render(<Progress today={TODAY} />)
    await flush()
    view.unmount()
    gate.resolve(statsOf(QUALITY))
    await flush()
    expect(document.body.textContent).toBe('')
    expect(errors).not.toHaveBeenCalled()
  })

  it('does not let a late response for an earlier switch overwrite a newer one', async () => {
    const old = { stats: deferred<StatsResponse>(), days: deferred<DayStat[]>() }
    const fn = stub({
      stats: (p) =>
        p.get('from') === '2026-10-01'
          ? old.stats.promise
          : statsOf([quality('2026-10-26', 3, 100, 22, 0.8)]), // the 3-month answer: 22.0 wpm
      days: (p) => (p.get('from') === '2026-10-01' ? old.days.promise : [day('2026-10-26', 30, 300)]),
    })
    render(<Progress today={TODAY} />)
    await flush()
    click('3 months')
    await flush()
    expect(within(tile('7-day average')).getByText('22.0 wpm')).toBeTruthy()
    expect(within(tile('This week')).getByText('30 min')).toBeTruthy()
    // the 4-week answers come in late
    old.stats.resolve(statsOf(QUALITY))
    old.days.resolve(DAYS)
    await flush()
    expect(calls(fn, '/api/stats')).toHaveLength(2)
    expect(within(tile('7-day average')).getByText('22.0 wpm')).toBeTruthy()
    expect(within(tile('This week')).getByText('30 min')).toBeTruthy()
    expect(screen.queryByText('15.4 wpm')).toBeNull()
    expect(screen.queryByText('4 h 36 min')).toBeNull()
  })

  it('does not let a late failure for an earlier switch replace newer data', async () => {
    const old = deferred<Response>()
    stub({ stats: (p) => (p.get('from') === '2026-10-01' ? old.promise : statsOf(QUALITY)) })
    render(<Progress today={TODAY} />)
    await flush()
    click('3 months')
    await flush()
    old.resolve(failed())
    await flush()
    expect(screen.queryByText(/Couldn't load your progress\./)).toBeNull()
    expect(within(tile('This week')).getByText('4 h 36 min')).toBeTruthy()
  })

  it('shows Loading… rather than the old range while a switch is pending', async () => {
    const gate = deferred<StatsResponse>()
    stub({ stats: (p) => (p.get('from') === '2026-10-01' ? statsOf(QUALITY) : gate.promise) })
    await mount()
    expect(screen.getByText('15.4 wpm')).toBeTruthy()
    click('3 months')
    await flush()
    expect(screen.getByText('Loading…')).toBeTruthy()
    expect(screen.queryByText('15.4 wpm')).toBeNull()
    expect(screen.getByRole('button', { name: '3 months' }).getAttribute('aria-pressed')).toBe('true')
    gate.resolve(statsOf(QUALITY))
    await flush()
    expect(screen.getByText('15.4 wpm')).toBeTruthy()
  })
})

describe('Progress chart panels', () => {
  const titles = (): string[] =>
    screen
      .getAllByRole('heading', { level: 2 })
      .map((h) => h.textContent ?? '')

  it('shows wpm by day, accuracy and consistency and practice time per week, in that order, after the tiles', async () => {
    stub()
    await mount()
    expect(titles()).toEqual([
      'Wpm by day',
      'Accuracy and consistency',
      'Rhythm: how steady you type',
      'Practice time per week',
      'Weakest keys',
      'Mix-ups',
      'Practice, all modes', // the chapter ladder has no panel without chapter tests
    ])
    const tiles = screen.getByRole('list', { name: 'Headline figures' })
    const wpm = screen.getByRole('heading', { name: 'Wpm by day' })
    expect(tiles.compareDocumentPosition(wpm) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('puts the rhythm of the newest finished run of the mode between accuracy and practice time', async () => {
    const at = new Date(2026, 9, 27, 14, 5).getTime()
    const strokes = Array.from({ length: 30 }, (_, i) => ({
      testId: 7, tsMs: at + i * 600, prompt: 'w', expected: ['SAP'], pressedLevers: [], pressedMask: 0, correct: true, latencyMs: 600, attemptNo: 1,
    }))
    const row = { id: 7, sessionId: 1, startedAt: at, endedAt: at + 60000, mode: 'free', chapter: null, section: null, itemCount: 30, wpm: 20, accuracy: 0.9, meta: { elapsedMs: 18000 } }
    const fn = stub({
      tests: (url) => (url.pathname === '/api/tests' ? [{ ...row, strokeCount: 30, firstStrokeAt: at, lastStrokeAt: at + 18000 }] : { test: row, strokes }),
    })
    await mount()
    await flush() // the runs
    await flush() // the strokes of the newest
    const heading = screen.getByRole('heading', { name: 'Rhythm: how steady you type' })
    const accuracy = screen.getByRole('heading', { name: 'Accuracy and consistency' })
    const weekly = screen.getByRole('heading', { name: 'Practice time per week' })
    expect(accuracy.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(heading.compareDocumentPosition(weekly) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(heading.closest('section')!.querySelectorAll('rect.rhythm__bar')).toHaveLength(30)
    expect(heading.closest('section')!.textContent).toContain('Oct 27, 14:05 · Free type · 20.0 wpm')
    expect(allCalls(fn, '/api/tests/7')).toHaveLength(1)
  })

  it('keeps the picked run when the range is switched, and asks for nothing again', async () => {
    const at = new Date(2026, 9, 27, 14, 5).getTime()
    const rowOf = (id: number) => ({ id, sessionId: 1, startedAt: at + id * 1000, endedAt: at + id * 1000 + 60000, mode: 'free', chapter: null, section: null, itemCount: 30, wpm: 20, accuracy: 0.9, meta: { elapsedMs: 18000 } })
    const strokesOf = (id: number) => Array.from({ length: 30 }, (_, i) => ({ testId: id, tsMs: at + i * 600, prompt: 'w', expected: ['SAP'], pressedLevers: [], pressedMask: 0, correct: true, latencyMs: 600, attemptNo: 1 }))
    const fn = stub({
      tests: (url) => {
        const one = /^\/api\/tests\/(\d+)$/.exec(url.pathname)
        if (one) return { test: rowOf(Number(one[1])), strokes: strokesOf(Number(one[1])) }
        return [7, 6].map((id) => ({ ...rowOf(id), strokeCount: 30, firstStrokeAt: at + id * 1000, lastStrokeAt: at + id * 1000 + 18000 }))
      },
    })
    await mount()
    await flush()
    await flush()
    const select = (): HTMLSelectElement => screen.getByLabelText('Run') as HTMLSelectElement
    expect(select().value).toBe('7')
    fireEvent.change(select(), { target: { value: '6' } })
    await flush()
    await flush()
    expect(allCalls(fn, '/api/tests/6')).toHaveLength(1)
    const lists = allCalls(fn, '/api/tests').length
    const strokes7 = allCalls(fn, '/api/tests/7').length
    click('3 months')
    await flush()
    await flush()
    expect(screen.getByRole('heading', { name: 'Rhythm: how steady you type' })).toBeTruthy() // the panel is back
    expect(select().value).toBe('6')
    expect(allCalls(fn, '/api/tests')).toHaveLength(lists)
    expect(allCalls(fn, '/api/tests/6')).toHaveLength(1)
    expect(allCalls(fn, '/api/tests/7')).toHaveLength(strokes7)
  })

  it('draws the dots of the days practiced and the weeks of the range from the fetched data', async () => {
    stub()
    await mount()
    expect(screen.getByRole('img', { name: 'Oct 27: 15.8 wpm over 2 runs' })).toBeTruthy()
    expect(screen.getByRole('img', { name: 'Week of Oct 19: 3 h 11 min, 10,080 strokes' })).toBeTruthy()
    expect(screen.getByRole('img', { name: 'Week of Oct 26: 4 h 36 min, 11,284 strokes, so far' })).toBeTruthy()
  })

  it('shows no panels for an empty archive', async () => {
    stub({ stats: () => statsOf([], { allTimeStrokes: 0 }), days: () => [] })
    await mount()
    expect(screen.queryAllByRole('heading', { level: 2 })).toHaveLength(0)
  })
})

describe('Progress key, mix-up, ladder and year panels', () => {
  const CHAPTERS = [
    { chapter: 4, pageId: 'ch04', title: 'Chapter 4', gate: 'stage0' as const, passMark: { accuracy: 0.9, maxMinutes: 10 }, listIds: [] },
    {
      chapter: 5,
      pageId: 'ch05',
      title: 'Chapter 5',
      gate: 'test' as const,
      passMark: { accuracy: 0.9, minWpm: 10, maxWpm: 20 },
      testListId: '5-test',
      listIds: [],
    },
  ]
  const withChapters = (): void => {
    chapterProgress.value = {
      ...NO_CHAPTERS,
      chapters: CHAPTERS,
      results: {
        stage0: [],
        section: [],
        'chapter-test': [{ section: '5-test', runs: 2, passed: false, best: { accuracy: 0.95, wpm: 9.96 }, last: null, firstPassedAt: null }],
      },
    }
  }
  const titles = (): string[] => screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent ?? '')
  const keys = [{ slot: '-F' as const, required: 66, missed: 14 }]
  const mixups = [{ pressed: '-P' as const, needed: '-B' as const, count: 9 }]

  it('puts weakest keys, mix-ups, chapter tests and the year after the three day panels, in that order', async () => {
    withChapters()
    stub({ stats: () => statsOf(QUALITY, { keys, mixups }) })
    await mount()
    expect(titles()).toEqual([
      'Wpm by day',
      'Accuracy and consistency',
      'Rhythm: how steady you type',
      'Practice time per week',
      'Weakest keys',
      'Mix-ups',
      'Chapter tests (ignores the mode switch)',
      'Practice, all modes',
    ])
    expect(document.querySelector('.weak__list')!.textContent).toContain('14 of 66')
    expect(screen.getByText(/9 times/)).toBeTruthy()
    expect(screen.getByText('9.9 wpm · 95%')).toBeTruthy()
    expect(document.querySelector('.ladder__verdict')!.textContent).toBe('not yet')
  })

  it('says in the scope of the key and mix-up panels which period the range switch is on', async () => {
    stub({ stats: () => statsOf(QUALITY, { keys, mixups }) })
    await mount()
    const scope = (title: string): string =>
      screen.getByRole('heading', { name: title }).closest('section')!.querySelector('.panel__scope')!.textContent!
    expect([scope('Weakest keys'), scope('Mix-ups')]).toEqual(['all modes, last 4 weeks', 'all modes, last 4 weeks'])
    click('3 months')
    await flush()
    expect([scope('Weakest keys'), scope('Mix-ups')]).toEqual(['all modes, last 3 months', 'all modes, last 3 months'])
    click('All time')
    await flush()
    expect([scope('Weakest keys'), scope('Mix-ups')]).toEqual(['all modes, all time', 'all modes, all time'])
  })

  it('asks for the year once, ending today, whatever the range, and does not ask again on a switch', async () => {
    const fn = stub()
    await mount()
    expect(yearCalls(fn).map((p) => Object.fromEntries(p))).toEqual([{ from: '2025-10-29', to: '2026-10-28' }])
    click('3 months')
    await flush()
    click('Everything')
    await flush()
    expect(yearCalls(fn)).toHaveLength(1)
    expect(document.querySelectorAll('[data-date]')).toHaveLength(365)
  })

  it('keeps the year when a switch is pending, and keeps the key and mix-up panels all-mode', async () => {
    stub({ stats: (p) => statsOf(QUALITY, { keys, mixups, mode: p.get('mode') as 'free' }) })
    await mount()
    const before = document.querySelector('.weak')!.innerHTML
    click('Everything')
    await flush()
    expect(document.querySelector('.weak')!.innerHTML).toBe(before)
  })

  it('draws the same chapter ladder in every mode', async () => {
    withChapters()
    stub()
    await mount()
    const ladder = (): string => screen.getByRole('heading', { name: 'Chapter tests (ignores the mode switch)' }).closest('section')!.innerHTML
    const free = ladder()
    expect(free).toContain('Ch 5')
    click('Drills and tests')
    await flush()
    expect(ladder()).toBe(free)
    click('Everything')
    await flush()
    expect(ladder()).toBe(free)
  })

  it("shows the year's own failure and Try again without hiding the other panels", async () => {
    let ok = false
    const fn = stub({ days: (p) => (isYear(p) && !ok ? failed() : DAYS) })
    await mount()
    expect(screen.getByText(/Couldn't load the year\./)).toBeTruthy()
    expect(screen.getByRole('list', { name: 'Headline figures' })).toBeTruthy()
    ok = true
    click('Try again')
    await flush()
    expect(yearCalls(fn)).toHaveLength(2)
    expect(screen.queryByText(/Couldn't load the year/)).toBeNull()
    expect(document.querySelectorAll('[data-date]')).toHaveLength(365)
  })
})

describe('Progress page: plateau notice', () => {
  const week = (ago: number, wpm: number, accuracy: number, steadiness: number): DayQuality => ({
    date: `2026-10-${String(28 - ago).padStart(2, '0')}`,
    runs: 2,
    words: 100,
    wpm,
    accuracy,
    steadiness,
  })
  // 41.4 wpm this week and 42 and 40 before it (21 and 14 days back are 7 and 14 Oct).
  const FLAT: DayQuality[] = [
    week(1, 41.4, 0.94, 53),
    { ...week(8, 42, 0.92, 48), date: '2026-10-20' },
    { ...week(15, 40, 0.91, 44), date: '2026-10-13' },
  ]
  const flatStats = (p: Params): StatsResponse => (isPlateauWindow(p) ? statsOf(FLAT) : statsOf(QUALITY))
  const title = (): HTMLElement | null => screen.queryByText('Your speed has been flat for 3 weeks')

  it('shows the notice above the tiles with its facts and links', async () => {
    stub({ stats: flatStats })
    await mount()
    const notice = title()!.closest('section') as HTMLElement
    expect(notice).toBeTruthy()
    expect(within(notice).getByText(/Free-type wpm: 41 this week, 42 and 40 the weeks before\./)).toBeTruthy()
    expect(within(notice).getByText(/Plateaus like this are common while learning steno\./)).toBeTruthy()
    expect(within(notice).getByText(/Meanwhile your steadiness rose from 44 to 53 and your accuracy from 91% to 94%\./)).toBeTruthy()
    expect(within(notice).getByRole('link', { name: 'Weakest keys' })).toBeTruthy()
    expect(within(notice).getByRole('link', { name: 'Mix-ups' })).toBeTruthy()
    const tiles = screen.getByRole('list', { name: 'Headline figures' })
    expect(notice.compareDocumentPosition(tiles) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('links scroll to the Weakest keys and Mix-ups panels', async () => {
    stub({ stats: flatStats })
    await mount()
    const scroll = vi.fn()
    const target = document.getElementById('progress-weak')!
    target.scrollIntoView = scroll
    fireEvent.click(screen.getByRole('link', { name: 'Weakest keys' }))
    expect(scroll).toHaveBeenCalledTimes(1)
    expect(document.getElementById('progress-mixups')).toBeTruthy()
  })

  it('shows no notice when the speed is not flat or the request fails', async () => {
    stub()
    await mount()
    expect(title()).toBeNull()
    cleanup()
    stub({ stats: (p) => (isPlateauWindow(p) ? failed() : statsOf(QUALITY)) })
    await mount()
    expect(title()).toBeNull()
    expect(screen.getByRole('list', { name: 'Headline figures' })).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('is asked for once and does not follow the Mode and Range switches', async () => {
    const fn = stub({ stats: flatStats })
    await mount()
    expect(plateauCalls(fn)).toHaveLength(1)
    click('Drills and tests')
    await flush()
    click('3 months')
    await flush()
    click('Everything')
    await flush()
    expect(plateauCalls(fn)).toHaveLength(1)
    expect(title()).toBeTruthy()
    expect(screen.getByText(/41 this week, 42 and 40 the weeks before/)).toBeTruthy()
  })

  it('Not now (14 days) stores today plus 14 days and hides the notice', async () => {
    const puts: unknown[] = []
    stub({
      stats: flatStats,
      settings: (method, body) => {
        if (method === 'PUT') puts.push(body)
        return {}
      },
    })
    await mount()
    click('Not now (14 days)')
    await flush()
    expect(puts).toEqual([{ plateauSnoozedUntil: '2026-11-11' }])
    expect(title()).toBeNull()
  })

  it('stays hidden while snoozed past today and shows again once the snooze has passed', async () => {
    stub({ stats: flatStats, settings: () => ({ plateauSnoozedUntil: '2026-10-29' }) })
    await mount()
    expect(title()).toBeNull()
    cleanup()
    stub({ stats: flatStats, settings: () => ({ plateauSnoozedUntil: '2026-10-28' }) })
    await mount()
    expect(title()).toBeTruthy()
  })
})
