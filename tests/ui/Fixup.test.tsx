// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChapterInfo, PracticeIndexEntry } from '../../scripts/build-content.ts'
import type { ProgressMark } from '../../server/archive.ts'
import { addDays, localDate } from '../../src/core/days.ts'
import { FIXUP_WINDOW_DAYS } from '../../src/core/fixup.ts'
import type { FixupLists, FixupPattern, FixupWord } from '../../src/core/fixup.ts'
import { chapterStates } from '../../src/core/progress.ts'
import type { ResultsByMode } from '../../src/core/progress.ts'
import type { Progress } from '../../src/state/progress.tsx'
import { Fixup, runHref } from '../../src/ui/Fixup.tsx'
import { stubContent } from './helpers/practice-rig.tsx'

vi.mock('../../src/api.ts', () => ({ getFixup: vi.fn() }))
const api = await import('../../src/api.ts')
const getFixup = vi.mocked(api.getFixup)

const fake = vi.hoisted(() => ({ value: null as Progress | null }))
vi.mock('../../src/state/progress.tsx', async (importActual) => {
  const actual = await importActual<typeof import('../../src/state/progress.tsx')>()
  return { ...actual, useProgress: () => fake.value ?? actual.useProgress() }
})

const CHAPTERS: ChapterInfo[] = [
  { chapter: 4, pageId: 'ch04', title: 'Chapter 4', gate: 'stage0', passMark: { accuracy: 0.9, maxMinutes: 10 }, listIds: [] },
  { chapter: 5, pageId: 'ch05', title: 'Chapter 5', gate: 'read', listIds: ['5-cvc'] },
  { chapter: 20, pageId: 'ch20', title: 'Chapter 20', gate: 'read', listIds: ['20-far'] },
]
const INDEX: PracticeIndexEntry[] = [
  { id: '5-cvc', chapter: 5, items: 6 },
  { id: '20-far', chapter: 20, items: 6 },
]

function progress(opts: { status?: Progress['status']; index?: PracticeIndexEntry[] } = {}): Progress {
  const status = opts.status ?? 'ready'
  const results: ResultsByMode = { stage0: [], section: [], 'chapter-test': [] }
  // Chapter 4 is cleared, so Chapter 5 is the one being taught: its list is reached, Chapter 20's is not.
  const marks: ProgressMark[] = [{ chapter: 4, kind: 'override', at: 1 }]
  return {
    status,
    chapters: CHAPTERS,
    index: opts.index ?? INDEX,
    results,
    marks,
    states: status === 'ready' ? chapterStates(CHAPTERS, results, marks) : new Map(),
    reload: async () => {},
    setMark: async () => {},
    setMarks: async () => {},
    clearMark: async () => {},
  }
}

const NOW = new Date(2026, 9, 30, 12).getTime()
const DAY = 86_400_000

function word(prompt: string, rate: number, extra: Partial<FixupWord> = {}): FixupWord {
  return { prompt, outlines: [`${prompt.toUpperCase()}`, 'X'], kind: 'word', attempts: 10, misses: Math.round(rate * 10), rate, lastTsMs: NOW, ...extra }
}

const WORDS = [word('sap', 0.5), word('tap', 0.4, { lastTsMs: NOW - DAY }), word('a,b', 0.3, { lastTsMs: NOW - 3 * DAY })]

const MIXUP: FixupPattern = { kind: 'mixup', pressed: '-T', needed: '-S', id: 'mixup:-T>-S', count: 6, required: 40, rate: 0.15, lastTsMs: NOW }
const MISSING: FixupPattern = { kind: 'missing', needed: 'R-', id: 'missing:R-', count: 4, required: 32, rate: 0.125, lastTsMs: NOW - DAY }

function lists(words: FixupWord[], patterns: FixupPattern[]): FixupLists {
  return { from: '2026-10-01', to: '2026-10-30', words, patterns }
}

// -S words: four in chapter 5, enough for the mix-up; R- gets one word in chapter 5 and the rest in chapter 20 (not reached).
const CONTENT: Record<string, unknown> = {
  '/content/practice/5-cvc.json': {
    id: '5-cvc',
    items: [
      { prompt: 'sap', outlines: ['SAP'] },
      { prompt: 'pass', outlines: ['PAS'] },
      { prompt: 'tops', outlines: ['TOPS'] },
      { prompt: 'cats', outlines: ['KAT/-S'] },
      { prompt: 'bus', outlines: ['PWUS'] },
      { prompt: 'rat', outlines: ['RAT'] },
    ],
  },
  '/content/practice/20-far.json': {
    id: '20-far',
    items: [
      { prompt: 'run', outlines: ['RUPB'] },
      { prompt: 'red', outlines: ['RED'] },
      { prompt: 'rib', outlines: ['RIB'] },
      { prompt: 'rod', outlines: ['ROD'] },
    ],
  },
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  fake.value = progress()
  getFixup.mockReset().mockResolvedValue(lists(WORDS, [MIXUP, MISSING]))
  stubContent(CONTENT)
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const picks = (href: string | null): string[] => new URLSearchParams(new URL(href ?? '', 'http://x').search).getAll('pick')
const start = (): HTMLElement => screen.getByText('Start slowly')

describe('runHref', () => {
  it('round-trips awkward prompts through the query string', () => {
    const awkward = ['a,b', 'x&y', '#', '/', 'two words', '100%', '=']
    const href = runHref('words', awkward)
    expect(href.startsWith('/practice/fixup/run/words?')).toBe(true)
    expect(picks(href)).toEqual(awkward)
  })

  it('builds the patterns run path', () => {
    expect(runHref('patterns', ['mixup:-T>-S'])).toMatch(/^\/practice\/fixup\/run\/patterns\?/)
    expect(picks(runHref('patterns', ['mixup:-T>-S', 'missing:R-']))).toEqual(['mixup:-T>-S', 'missing:R-'])
  })
})

describe('Fixup page', () => {
  it('asks for the last 30 local days', async () => {
    render(<Fixup tab="words" />)
    await screen.findByRole('table')
    expect(getFixup).toHaveBeenCalledWith(addDays(localDate(NOW), -(FIXUP_WINDOW_DAYS - 1)), localDate(NOW))
  })

  it('lists the words in rank order with a ticked box, outline, miss percent and last seen', async () => {
    render(<Fixup tab="words" />)
    const table = await screen.findByRole('table', { name: /words/i })
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows).toHaveLength(3)
    const first = within(rows[0])
    expect((first.getByRole('checkbox', { name: 'Include sap' }) as HTMLInputElement).checked).toBe(true)
    expect(first.getByText('sap')).toBeTruthy()
    expect(first.getByText('SAP')).toBeTruthy()
    expect(first.getByText('50%')).toBeTruthy()
    expect(first.getByText('today')).toBeTruthy()
    expect(within(rows[1]).getByText('yesterday')).toBeTruthy()
    expect(within(rows[2]).getByText('3 days ago')).toBeTruthy()
    expect(within(rows[2]).getByText('30%')).toBeTruthy()
  })

  it('shows at most ten rows', async () => {
    getFixup.mockResolvedValue(lists(Array.from({ length: 12 }, (_, i) => word(`w${i}`, 0.5)), []))
    render(<Fixup tab="words" />)
    const table = await screen.findByRole('table')
    expect(within(table).getAllByRole('row')).toHaveLength(11)
  })

  it('starts the ticked words, and unticking changes the pick list', async () => {
    render(<Fixup tab="words" />)
    await screen.findByRole('table')
    expect(picks(start().getAttribute('href'))).toEqual(['sap', 'tap', 'a,b'])
    fireEvent.click(screen.getByRole('checkbox', { name: 'Include tap' }))
    expect(picks(start().getAttribute('href'))).toEqual(['sap', 'a,b'])
    fireEvent.click(screen.getByRole('checkbox', { name: 'Include tap' }))
    expect(picks(start().getAttribute('href'))).toEqual(['sap', 'tap', 'a,b'])
  })

  it('disables Start when everything is unticked', async () => {
    render(<Fixup tab="words" />)
    await screen.findByRole('table')
    for (const box of screen.getAllByRole('checkbox')) fireEvent.click(box)
    const button = screen.getByRole('button', { name: 'Start slowly' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    expect(screen.queryByRole('link', { name: 'Start slowly' })).toBeNull()
  })

  it('says plainly when there is nothing to fix, with no Start', async () => {
    getFixup.mockResolvedValue(lists([], []))
    render(<Fixup tab="words" />)
    expect(await screen.findByText('Nothing to fix here: no word has been missed often enough yet.')).toBeTruthy()
    expect(screen.queryByText('Start slowly')).toBeNull()
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('says the same for patterns', async () => {
    getFixup.mockResolvedValue(lists(WORDS, []))
    render(<Fixup tab="patterns" />)
    expect(await screen.findByText('Nothing to fix here: no stroke pattern has been missed often enough yet.')).toBeTruthy()
    expect(screen.queryByText('Start slowly')).toBeNull()
  })

  it('shows a calm line when the lists cannot be fetched', async () => {
    getFixup.mockRejectedValue(new Error('offline'))
    render(<Fixup tab="words" />)
    expect(await screen.findByText(/Couldn.t load the fix-up lists/)).toBeTruthy()
    expect(screen.queryByText('Start slowly')).toBeNull()
  })

  it('marks the current tab and links both', async () => {
    render(<Fixup tab="patterns" />)
    const strip = screen.getByRole('navigation', { name: 'Fix-up lists' })
    const words = within(strip).getByRole('link', { name: 'Words' })
    const patterns = within(strip).getByRole('link', { name: 'Patterns' })
    expect(words.getAttribute('href')).toBe('/practice/fixup')
    expect(patterns.getAttribute('href')).toBe('/practice/fixup/patterns')
    expect(patterns.getAttribute('aria-current')).toBe('page')
    expect(words.getAttribute('aria-current')).toBeNull()
    await screen.findByRole('table')
  })
})

describe('Fixup patterns tab', () => {
  it('lists the pattern in words with its drillable word count, rate and count', async () => {
    render(<Fixup tab="patterns" />)
    const table = await screen.findByRole('table', { name: /patterns/i })
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows).toHaveLength(2)
    const first = within(rows[0])
    expect(first.getByText('-T typed for -S')).toBeTruthy()
    expect(first.getByText('15%')).toBeTruthy()
    expect(first.getByText('6 of 40')).toBeTruthy()
    // pass, tops, cats (second stroke) and bus use -S
    expect(first.getByText('4')).toBeTruthy()
    expect((first.getByRole('checkbox', { name: 'Include -T typed for -S' }) as HTMLInputElement).checked).toBe(true)
    expect(within(rows[1]).getByText('R- missing')).toBeTruthy()
  })

  it('counts words only from the chapters reached', async () => {
    // Chapter 5 is reached and chapter 20 is not, so R- has only rat.
    render(<Fixup tab="patterns" />)
    const table = await screen.findByRole('table')
    const row = within(within(table).getAllByRole('row')[2])
    expect(row.getByText('R- missing')).toBeTruthy()
    expect(row.getByText('not enough words in the chapters you\'ve reached')).toBeTruthy()
    const box = row.getByRole('checkbox') as HTMLInputElement
    expect(box.checked).toBe(false)
    expect(box.disabled).toBe(true)
  })

  it('starts only the ticked, drillable patterns', async () => {
    render(<Fixup tab="patterns" />)
    await screen.findByRole('table')
    expect(picks(start().getAttribute('href'))).toEqual(['mixup:-T>-S'])
    expect(start().getAttribute('href')).toMatch(/^\/practice\/fixup\/run\/patterns\?/)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Include -T typed for -S' }))
    expect((screen.getByRole('button', { name: 'Start slowly' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('fetches the list files for the reached chapters only on this tab', async () => {
    const fetch = stubContent(CONTENT)
    render(<Fixup tab="words" />)
    await screen.findByRole('table')
    expect(fetch).not.toHaveBeenCalled()
    cleanup()
    render(<Fixup tab="patterns" />)
    await screen.findByRole('table')
    expect(fetch.mock.calls.map((c) => c[0]).sort()).toEqual(['/content/practice/5-cvc.json'])
  })

  it('says the word lists could not load when a list file fails, and the Words tab still works', async () => {
    stubContent({ ...CONTENT, '/content/practice/5-cvc.json': 'fail' })
    render(<Fixup tab="patterns" />)
    expect(await screen.findByText(/Couldn.t load the word lists/)).toBeTruthy()
    expect(screen.queryByText('Start slowly')).toBeNull()
    cleanup()
    render(<Fixup tab="words" />)
    expect(await screen.findByRole('table')).toBeTruthy()
    expect(screen.getByText('Start slowly')).toBeTruthy()
  })

  it('says the word lists could not load when progress failed without an index', async () => {
    fake.value = progress({ status: 'error', index: [] })
    render(<Fixup tab="patterns" />)
    expect(await screen.findByText(/Couldn.t load the word lists/)).toBeTruthy()
  })

  it('waits for progress before fetching the lists', async () => {
    fake.value = progress({ status: 'loading' })
    const fetch = stubContent(CONTENT)
    render(<Fixup tab="patterns" />)
    await waitFor(() => expect(getFixup).toHaveBeenCalled())
    expect(screen.getByText('Loading…')).toBeTruthy()
    expect(fetch).not.toHaveBeenCalled()
  })
})
