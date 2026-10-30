// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/preact'
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChapterInfo } from '../../scripts/build-content.ts'
import type { DayStat, SectionResult } from '../../server/archive.ts'
import type { DayQuality } from '../../server/stats.ts'
import type { Progress } from '../../src/state/progress.tsx'
import { Report } from '../../src/ui/Report.tsx'
import { __resetPendingSavesForTests } from '../../src/ui/useAutosave.ts'

// The chapters tile reads the results and marks through `useProgress`, as the Progress page does.
const chapterProgress = vi.hoisted(() => ({ value: null as Progress | null }))
vi.mock('../../src/state/progress.tsx', async (importActual) => {
  const actual = await importActual<typeof import('../../src/state/progress.tsx')>()
  return { ...actual, useProgress: () => chapterProgress.value ?? progressWith() }
})

const STAGE0: ChapterInfo = { chapter: 4, pageId: 'ch4', title: 'Stage 0', gate: 'stage0', listIds: [] }

function progressWith(over: Partial<Progress> = {}): Progress {
  return {
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
    ...over,
  }
}

const MIN = 60000
const day = (date: string, minutes: number, strokes: number): DayStat => ({ date, tests: 1, strokes, activeMs: minutes * MIN })
const quality = (
  date: string,
  wpm: number | null,
  accuracy: number | null,
  steadiness: number | null = null,
  runs = 3,
  words = 90,
): DayQuality => ({ date, runs, words, wpm, accuracy, steadiness })

// October: 6 practice days, 10 minutes and 1,000 strokes each; three free-type days (wpm 20/30/40 on 9 runs).
const OCTOBER_DAYS = ['2026-10-02', '2026-10-05', '2026-10-09', '2026-10-14', '2026-10-20', '2026-10-27'].map((d) =>
  day(d, 10, 1000),
)
const OCTOBER_FREE = [
  quality('2026-10-05', 20, 0.9, 60),
  quality('2026-10-14', 30, 0.93, 70),
  quality('2026-10-27', 40, 0.96, 80),
]
// September: 2 practice days, 5 minutes and 500 strokes each; free-type wpm 20 on 3 runs.
const SEPTEMBER_DAYS = [day('2026-09-10', 5, 500), day('2026-09-12', 5, 500)]
const SEPTEMBER_FREE = [quality('2026-09-10', 20, 0.9, 60)]

type World = {
  days?: DayStat[]
  free?: DayQuality[]
  settings?: Record<string, unknown>
  reports?: Record<string, string>
  failStats?: boolean
  failReport?: boolean
  failSettingsPut?: boolean
}

type Call = { method: string; path: string; params: URLSearchParams; body: unknown }

let calls: Call[] = []
let world: World = {}

function stub(w: World = {}): void {
  world = { days: [], free: [], settings: {}, reports: {}, ...w }
  calls = []
  const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status })
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(input, 'http://localhost')
      const method = init?.method ?? 'GET'
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
      calls.push({ method, path: url.pathname, params: url.searchParams, body })
      const from = url.searchParams.get('from') ?? ''
      const to = url.searchParams.get('to') ?? ''
      const inside = (d: { date: string }): boolean => d.date >= from && d.date <= to
      if (url.pathname === '/api/stats') {
        if (world.failStats) return json({}, 500)
        return json({ from, to, mode: 'free', days: world.free!.filter(inside), keys: [], mixups: [], allTimeStrokes: 0 })
      }
      if (url.pathname === '/api/days') {
        if (world.failStats) return json({}, 500)
        return json(world.days!.filter(inside))
      }
      if (url.pathname === '/api/settings') {
        if (method === 'PUT') {
          if (world.failSettingsPut) return json({}, 500)
          world.settings = { ...world.settings, ...body }
        }
        return json(world.settings)
      }
      if (url.pathname.startsWith('/api/reports/')) {
        const month = url.pathname.slice('/api/reports/'.length)
        if (method === 'PUT') {
          world.reports![month] = (body as { text: string }).text
          return json({})
        }
        if (world.failReport) return json({}, 500)
        return json({ text: world.reports![month] ?? '' })
      }
      return json({}, 404)
    }),
  )
}

const flush = (): Promise<void> => act(async () => new Promise<void>((done) => setTimeout(done, 0)))
async function mount(month: string, today: string): Promise<void> {
  render(<Report month={month} today={today} />)
  await flush()
  await flush()
}
const callsTo = (path: string, method = 'GET'): Call[] => calls.filter((c) => c.path === path && c.method === method)
const tileOf = (name: string): HTMLElement => screen.getByRole('article', { name }) as HTMLElement

beforeEach(() => {
  chapterProgress.value = null
  history.replaceState(null, '', '/progress/reports/2026-10')
})
afterEach(() => {
  cleanup()
  __resetPendingSavesForTests()
  vi.unstubAllGlobals()
  history.replaceState(null, '', '/')
})

describe('Report page: content', () => {
  it('shows the header, six tiles with their values, the chart with its table, the scopes line and the notes box', async () => {
    stub({ days: OCTOBER_DAYS, free: OCTOBER_FREE })
    await mount('2026-10', '2026-10-28')

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('October 2026 · 6 practice days')
    expect(screen.getByRole('link', { name: /Reports/ }).getAttribute('href')).toBe('/progress/reports')

    const tiles = screen.getAllByRole('article')
    expect(tiles.map((t) => within(t).getByText(/./, { selector: '.tile__name' }).textContent)).toEqual([
      'Practice time',
      'Strokes',
      'Free-type wpm',
      'Accuracy',
      'Steadiness',
      'Chapters passed',
    ])
    expect(tileOf('Practice time').querySelector('.tile__value')!.textContent).toBe('1 h 00 min')
    expect(tileOf('Strokes').querySelector('.tile__value')!.textContent).toBe('6,000')
    expect(tileOf('Free-type wpm').querySelector('.tile__value')!.textContent).toBe('30.0 wpm')
    expect(tileOf('Accuracy').querySelector('.tile__value')!.textContent).toBe('93.0%')
    expect(tileOf('Steadiness').querySelector('.tile__value')!.textContent).toBe('70')
    expect(tileOf('Chapters passed').querySelector('.tile__value')!.textContent).toBe('0')

    expect(screen.getByRole('heading', { name: 'Wpm by day' })).toBeTruthy()
    expect(document.querySelectorAll('g.chart__hit')).toHaveLength(3)
    expect(screen.getByText('Show the numbers')).toBeTruthy()
    expect(
      screen.getByText('Time and strokes cover every mode; speed, accuracy and steadiness cover free type.'),
    ).toBeTruthy()
    expect(screen.getByLabelText('Your notes')).toBeTruthy()
  })

  it('says 1 practice day in the singular', async () => {
    stub({ days: [day('2026-10-05', 10, 1000)], free: [] })
    await mount('2026-10', '2026-10-28')
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('October 2026 · 1 practice day')
  })

  it('counts a day with neither strokes nor time as no practice', async () => {
    stub({ days: [day('2026-10-05', 10, 1000), day('2026-10-06', 0, 0)], free: [] })
    await mount('2026-10', '2026-10-28')
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('October 2026 · 1 practice day')
  })

  it('has no comparison lines in the first month, only the first and last day of speed and accuracy', async () => {
    stub({ days: OCTOBER_DAYS, free: OCTOBER_FREE })
    await mount('2026-10', '2026-10-28')
    const text = document.body.textContent ?? ''
    expect(text).not.toMatch(/ vs |same as/)
    expect(tileOf('Free-type wpm').textContent).toContain('first day 20, last day 40')
    expect(tileOf('Accuracy').textContent).toContain('first day 90.0%, last day 96.0%')
  })

  it('compares with the month before when there is one', async () => {
    stub({ days: [...SEPTEMBER_DAYS, ...OCTOBER_DAYS], free: [...SEPTEMBER_FREE, ...OCTOBER_FREE] })
    await mount('2026-10', '2026-10-28')
    expect(tileOf('Practice time').textContent).toContain('+50 min vs September')
    expect(tileOf('Strokes').textContent).toContain('+5,000 vs September')
    expect(tileOf('Free-type wpm').textContent).toContain('+10.0 wpm vs September')
    expect(tileOf('Accuracy').textContent).toContain('vs September')
    expect(tileOf('Steadiness').textContent).toContain('+10 vs September')
  })

  it('asks for the month, the month before and the days from the start of the reports window', async () => {
    stub({ days: OCTOBER_DAYS, free: OCTOBER_FREE })
    await mount('2026-10', '2026-10-28')
    const stats = callsTo('/api/stats').map((c) => `${c.params.get('from')}..${c.params.get('to')} ${c.params.get('mode')}`)
    expect(stats.sort()).toEqual(['2026-09-01..2026-09-30 free', '2026-10-01..2026-10-31 free'])
    const days = callsTo('/api/days')
    expect(days).toHaveLength(1)
    expect(days[0].params.get('from')).toBe('2023-11-01')
    expect(days[0].params.get('to')).toBe('2026-10-31')
  })

  it('lists a chapter first passed in the month as `ch 4 on the 30th` (local date of a Stage 0 result)', async () => {
    stub({ days: OCTOBER_DAYS, free: OCTOBER_FREE })
    const result: SectionResult = {
      section: 'pseudo-test',
      runs: 1,
      passed: true,
      best: { accuracy: 1, wpm: 20 },
      last: null,
      firstPassedAt: new Date(2026, 9, 30, 9, 0, 0).getTime(),
    }
    chapterProgress.value = progressWith({
      chapters: [STAGE0],
      results: { stage0: [result], section: [], 'chapter-test': [] },
    })
    await mount('2026-10', '2026-10-31')
    const tile = tileOf('Chapters passed')
    expect(tile.querySelector('.tile__value')!.textContent).toBe('1')
    expect(tile.textContent).toContain('ch 4 on the 30th')
  })

  it('leaves out a chapter passed in another month', async () => {
    stub({ days: OCTOBER_DAYS, free: OCTOBER_FREE })
    const result: SectionResult = {
      section: 'pseudo-test',
      runs: 1,
      passed: true,
      best: null,
      last: null,
      firstPassedAt: new Date(2026, 8, 30, 9, 0, 0).getTime(),
    }
    chapterProgress.value = progressWith({
      chapters: [STAGE0],
      results: { stage0: [result], section: [], 'chapter-test': [] },
    })
    await mount('2026-10', '2026-10-31')
    expect(tileOf('Chapters passed').querySelector('.tile__value')!.textContent).toBe('0')
  })

  it('renders a month with no practice with empty tiles and an empty chart state', async () => {
    stub({ days: OCTOBER_DAYS, free: OCTOBER_FREE })
    await mount('2026-08', '2026-10-28')
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('August 2026 · 0 practice days')
    expect(tileOf('Practice time').querySelector('.tile__value')!.textContent).toBe('0 min')
    expect(tileOf('Strokes').querySelector('.tile__value')!.textContent).toBe('0')
    for (const name of ['Free-type wpm', 'Accuracy', 'Steadiness']) {
      expect(tileOf(name).querySelector('.tile__value')!.textContent).toBe('—')
      expect(tileOf(name).textContent).toContain('not enough runs yet')
    }
    expect(document.querySelectorAll('g.chart__hit')).toHaveLength(0)
    expect(screen.getByText(/No finished runs/)).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/NaN|Infinity/)
    expect(screen.getByLabelText('Your notes')).toBeTruthy()
  })

  it('shows a plain not-found line and fetches nothing for a month that has not happened', async () => {
    stub({ days: OCTOBER_DAYS })
    await mount('2026-11', '2026-10-28')
    expect(screen.getByText("That month hasn't happened yet.")).toBeTruthy()
    expect(screen.queryByLabelText('Your notes')).toBeNull()
    expect(calls).toHaveLength(0)
  })

  it('shows a plain not-found line and fetches nothing for something that is not a month', async () => {
    stub()
    for (const month of ['2026-13', '2026-00', '2026-1', 'abc', '2026-10-01']) {
      cleanup()
      await mount(month, '2026-10-28')
      expect(screen.getByText('No such month.')).toBeTruthy()
      expect(screen.getByRole('link', { name: /Back to Reports/ }).getAttribute('href')).toBe('/progress/reports')
      expect(screen.queryByLabelText('Your notes')).toBeNull()
    }
    expect(calls).toHaveLength(0)
  })

  it('shows loading, then an error with a retry when the numbers do not load', async () => {
    stub({ days: OCTOBER_DAYS, free: OCTOBER_FREE, failStats: true })
    render(<Report month="2026-10" today="2026-10-28" />)
    expect(screen.getByText('Loading…')).toBeTruthy()
    await flush()
    await flush()
    const alert = screen.getByText(/Couldn't load this report\./)
    expect(alert).toBeTruthy()
    world.failStats = false
    fireEvent.click(within(alert.closest('[role="alert"]') as HTMLElement).getByRole('button', { name: 'Try again' }))
    await flush()
    await flush()
    expect(screen.queryByText(/Couldn't load this report\./)).toBeNull()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('October 2026 · 6 practice days')
  })

  it('waits for the chapter results before showing the chapters tile', async () => {
    stub({ days: OCTOBER_DAYS, free: OCTOBER_FREE })
    chapterProgress.value = progressWith({ status: 'loading' })
    await mount('2026-10', '2026-10-28')
    expect(screen.getByText('Loading…')).toBeTruthy()
    expect(screen.queryAllByRole('article')).toHaveLength(0)
  })
})

describe('Report page: the wpm chart', () => {
  it('is one tab stop with the other dots reachable by arrow keys', async () => {
    stub({ days: OCTOBER_DAYS, free: OCTOBER_FREE })
    await mount('2026-10', '2026-10-28')
    const dots = Array.from(document.querySelectorAll<HTMLElement>('g.chart__hit'))
    expect(dots.map((d) => d.getAttribute('tabindex'))).toEqual(['0', '-1', '-1'])
    dots[0].focus()
    fireEvent.keyDown(dots[0], { key: 'ArrowRight' })
    expect(document.activeElement).toBe(dots[1])
    expect(dots.map((d) => d.getAttribute('tabindex'))).toEqual(['-1', '0', '-1'])
  })

  it('draws the whole month: the 1st and the 31st are the two ends of the axis', async () => {
    stub({ days: OCTOBER_DAYS, free: [quality('2026-10-01', 20, 0.9), quality('2026-10-31', 30, 0.9)] })
    await mount('2026-10', '2026-10-31')
    const xs = Array.from(document.querySelectorAll('g.chart__hit circle.chart__dot')).map((c) => Number(c.getAttribute('cx')))
    expect(xs).toEqual([56, 530])
  })

  it('has the numbers table behind the summary', async () => {
    stub({ days: OCTOBER_DAYS, free: OCTOBER_FREE })
    await mount('2026-10', '2026-10-28')
    const details = document.querySelector('details.chart__numbers') as HTMLDetailsElement
    details.open = true
    fireEvent(details, new Event('toggle'))
    await flush()
    expect(within(details).getAllByRole('row').length).toBeGreaterThanOrEqual(4)
  })
})

describe('Report page: notes', () => {
  it('autosaves typed words through putReport and shows them again after a remount', async () => {
    stub({ days: OCTOBER_DAYS, free: OCTOBER_FREE })
    await mount('2026-10', '2026-10-28')
    const box = screen.getByLabelText('Your notes') as HTMLTextAreaElement
    expect(box.readOnly).toBe(false)
    fireEvent.input(box, { target: { value: 'A good month.' } })
    fireEvent.blur(box) // a blur saves at once; the debounce is covered by the autosave tests
    await flush()
    await flush()
    const puts = callsTo('/api/reports/2026-10', 'PUT')
    expect(puts).toHaveLength(1)
    expect(puts[0].body).toEqual({ text: 'A good month.' })
    expect(screen.getByText('Saved')).toBeTruthy()

    cleanup()
    await mount('2026-10', '2026-10-28')
    expect((screen.getByLabelText('Your notes') as HTMLTextAreaElement).value).toBe('A good month.')
  })

  it('shows the words of the save status', async () => {
    stub({ days: OCTOBER_DAYS, free: OCTOBER_FREE })
    await mount('2026-10', '2026-10-28')
    expect(screen.getByText('Saved')).toBeTruthy()
  })

  it('shows an error with a retry when the note does not load, and the box cannot be edited until it does', async () => {
    stub({ days: OCTOBER_DAYS, free: OCTOBER_FREE, failReport: true, reports: { '2026-10': 'old words' } })
    await mount('2026-10', '2026-10-28')
    const box = screen.getByLabelText('Your notes') as HTMLTextAreaElement
    expect(box.readOnly).toBe(true)
    const alert = screen.getByText(/Couldn't load your notes\./).closest('[role="alert"]') as HTMLElement
    expect(alert).toBeTruthy()

    fireEvent.input(box, { target: { value: 'typed while broken' } })
    fireEvent.blur(box)
    await flush()
    expect(box.value).toBe('')
    expect(callsTo('/api/reports/2026-10', 'PUT')).toHaveLength(0)

    world.failReport = false
    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }))
    await flush()
    await flush()
    expect(screen.queryByText(/Couldn't load your notes\./)).toBeNull()
    expect(box.readOnly).toBe(false)
    expect(box.value).toBe('old words')
    expect(callsTo('/api/reports/2026-10', 'PUT')).toHaveLength(0)
  })
})

describe('Report page: reportSeen', () => {
  const putsOf = (): unknown[] => callsTo('/api/settings', 'PUT').map((c) => c.body)

  it('stores the month when it is opened on its last day', async () => {
    stub({ days: OCTOBER_DAYS, free: OCTOBER_FREE })
    await mount('2026-10', '2026-10-31')
    expect(putsOf()).toEqual([{ reportSeen: '2026-10' }])
  })

  it('stores nothing when the month is opened before its last day', async () => {
    stub({ days: OCTOBER_DAYS, free: OCTOBER_FREE })
    await mount('2026-10', '2026-10-20')
    expect(putsOf()).toEqual([])
  })

  it('stores a complete month opened later', async () => {
    stub({ days: OCTOBER_DAYS, free: OCTOBER_FREE, settings: { reportSeen: '2026-09' } })
    await mount('2026-10', '2026-11-03')
    expect(putsOf()).toEqual([{ reportSeen: '2026-10' }])
  })

  it('never lowers the stored value when an older month is opened', async () => {
    stub({ days: [...SEPTEMBER_DAYS, ...OCTOBER_DAYS], free: SEPTEMBER_FREE, settings: { reportSeen: '2026-10' } })
    await mount('2026-09', '2026-10-31')
    expect(putsOf()).toEqual([])
  })

  it('does not store the month it already holds', async () => {
    stub({ days: OCTOBER_DAYS, free: OCTOBER_FREE, settings: { reportSeen: '2026-10' } })
    await mount('2026-10', '2026-10-31')
    expect(putsOf()).toEqual([])
  })

  it('stores an older complete month when nothing has been seen', async () => {
    stub({ days: [...SEPTEMBER_DAYS, ...OCTOBER_DAYS], free: SEPTEMBER_FREE })
    await mount('2026-09', '2026-10-05')
    expect(putsOf()).toEqual([{ reportSeen: '2026-09' }])
  })

  it('stores it once, not again on a retry or a re-render', async () => {
    stub({ days: OCTOBER_DAYS, free: OCTOBER_FREE })
    await mount('2026-10', '2026-10-31')
    await flush()
    expect(putsOf()).toHaveLength(1)
  })

  it('a failed write is silent: the page is still shown, with no alert', async () => {
    stub({ days: OCTOBER_DAYS, free: OCTOBER_FREE, failSettingsPut: true })
    await mount('2026-10', '2026-10-31')
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('October 2026 · 6 practice days')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('stores nothing when the numbers did not load', async () => {
    stub({ days: OCTOBER_DAYS, free: OCTOBER_FREE, failStats: true })
    await mount('2026-10', '2026-10-31')
    expect(putsOf()).toEqual([])
  })
})

describe('reports.css: the report page at 360 px', () => {
  const css = readFileSync('src/ui/reports.css', 'utf8') // vitest runs from the project root
  const progressCss = readFileSync('src/ui/progress.css', 'utf8')
  const reader = readFileSync('src/ui/reader.css', 'utf8')
  const tokens = new Set(Array.from(/:root\s*\{([^}]*)\}/.exec(reader)![1].matchAll(/(--[a-z-]+):/g), (m) => m[1]))
  const rules = (source: string): { selector: string; body: string }[] =>
    Array.from(source.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g), (m) => ({
      selector: m[1].trim(),
      body: m[2],
    }))
  const reportRules = rules(css).filter((r) => r.selector.includes('.report__'))
  const bodyOf = (selector: string): string => rules(css).find((r) => r.selector === selector)?.body ?? ''

  it('styles the report page (the guard has something to check)', () => {
    expect(reportRules.length).toBeGreaterThan(3)
  })

  it('uses no fixed width, no horizontal scroll and no colour except the :root tokens', () => {
    for (const { selector, body } of reportRules) {
      expect(body, selector).not.toMatch(/(^|[;\s])(min-)?width:\s*-?[\d.]+(px|rem|em|ch)/)
      expect(body, selector).not.toMatch(/overflow(-x)?:\s*(scroll|auto)/)
      expect(body, selector).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i)
      for (const m of body.matchAll(/var\((--[a-z-]+)\)/g)) expect(tokens.has(m[1]), `${selector} ${m[1]}`).toBe(true)
    }
  })

  it('keeps the report column and the notes box within the page', () => {
    expect(bodyOf('.report')).toMatch(/max-width:\s*40rem/)
    expect(bodyOf('.report__text')).toMatch(/width:\s*100%/)
    expect(bodyOf('.report__text')).toMatch(/resize:\s*vertical/)
  })

  it('lets the tiles wrap to fewer columns: auto-fit with a minimum that fits a 360 px screen', () => {
    const grid = /\.progress__tiles\s*\{[^}]*grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(([\d.]+)rem,\s*1fr\)\)/.exec(
      progressCss,
    )
    expect(grid).not.toBeNull()
    // 360 px less the page padding is about 20 rem at 16 px: one column of this minimum always fits
    expect(Number(grid![1])).toBeLessThanOrEqual(15)
  })

  it('shows a worse change in the neutral colour: the change line is the muted token, not a red one', () => {
    const change = rules(progressCss).find((r) => r.selector.split(',').map((s) => s.trim()).includes('.tile__change'))!
    expect(change.body).toMatch(/color:\s*var\(--muted\)/)
  })
})
