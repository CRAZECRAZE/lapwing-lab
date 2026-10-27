// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChapterInfo } from '../../scripts/build-content.ts'
import type { ProgressMark, TestRow } from '../../server/archive.ts'
import { chapterStates } from '../../src/core/progress.ts'
import type { ResultsByMode } from '../../src/core/progress.ts'
import type { Progress } from '../../src/state/progress.tsx'
import { Practice } from '../../src/ui/Practice.tsx'

vi.mock('../../src/api.ts', () => ({ getLastTest: vi.fn() }))
const api = await import('../../src/api.ts')
const getLastTest = vi.mocked(api.getLastTest)

// The Practice tab reads chapter progress through `useProgress`; each test hands it a fake value.
const fake = vi.hoisted(() => ({ value: null as Progress | null }))
vi.mock('../../src/state/progress.tsx', async (importActual) => {
  const actual = await importActual<typeof import('../../src/state/progress.tsx')>()
  return { ...actual, useProgress: () => fake.value ?? actual.useProgress() }
})

const CHAPTERS: ChapterInfo[] = [
  { chapter: 4, pageId: 'ch04', title: 'Chapter 4: The layout', gate: 'stage0', passMark: { accuracy: 0.9, maxMinutes: 10 }, listIds: [] },
  { chapter: 5, pageId: 'ch05', title: 'Chapter 5: First words', gate: 'read', listIds: [] },
  { chapter: 6, pageId: 'ch06', title: 'Chapter 6: Two words', gate: 'drills', listIds: ['6-fqm'] },
]

function progress(status: Progress['status'], opts: { chapters?: ChapterInfo[]; marks?: ProgressMark[] } = {}): Progress {
  const chapters = opts.chapters ?? CHAPTERS
  const marks = opts.marks ?? []
  const results: ResultsByMode = { stage0: [], section: [], 'chapter-test': [] }
  return {
    status,
    chapters,
    index: [],
    results,
    marks,
    states: status === 'ready' ? chapterStates(chapters, results, marks) : new Map(),
    reload: async () => {},
    setMark: async () => {},
    setMarks: async () => {},
    clearMark: async () => {},
  }
}
const override = (chapter: number): ProgressMark => ({ chapter, kind: 'override', at: 1 })

const INDEX = [
  { id: '5-cvc', chapter: 5, items: 1 },
  { id: '8-x', chapter: 8, items: 1 },
]

const row = (over: Partial<TestRow>): TestRow => ({
  id: 1, sessionId: 1, startedAt: 1, endedAt: 2, mode: 'free', chapter: 4, section: 'x', itemCount: 25,
  wpm: 41.2, accuracy: 0.92, meta: {}, ...over,
})

function stubIndex(reply: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url !== '/content/practice-index.json' || reply === 'fail') return { ok: false, status: 500, json: async () => ({}) }
      return { ok: true, status: 200, json: async () => reply }
    }),
  )
}

beforeEach(() => {
  history.replaceState(null, '', '/practice')
  fake.value = progress('ready')
  getLastTest.mockReset().mockImplementation(async (mode, section) => {
    if (mode === 'free' && section === 'pseudo/words-25') return row({ accuracy: 0.92, wpm: 41.2 })
    if (mode === 'free' && section === 'ch-8/words-25') return row({ accuracy: 0.81, wpm: 30.6 })
    return null
  })
})

afterEach(() => {
  cleanup()
  fake.value = null
  vi.unstubAllGlobals()
})

describe('Practice', () => {
  it('offers the sources from the index, pseudo-words first and chosen', async () => {
    stubIndex(INDEX)
    render(<Practice />)
    expect(screen.getByRole('heading', { name: 'Practice' })).toBeTruthy()
    const select = screen.getByRole('combobox', { name: 'Words from' }) as HTMLSelectElement
    await waitFor(() => expect(select.options).toHaveLength(3))
    expect([...select.options].map((o) => [o.value, o.text])).toEqual([
      ['pseudo', 'Chapter 4 pseudo-words'],
      ['ch-5', 'Chapter 5 word lists'],
      ['ch-8', 'Chapters 5–8 word lists'],
    ])
    expect(select.value).toBe('pseudo')
    const modes = within(screen.getByRole('radiogroup', { name: 'Mode' })).getAllByRole('radio') as HTMLInputElement[]
    expect(modes.map((r) => r.value)).toEqual(['words-25', 'words-50', 'time-30', 'time-60'])
    expect(screen.getByRole('radio', { name: '25 words' })).toHaveProperty('checked', true)
  })

  it('falls back to the pseudo-words when the index will not load', async () => {
    stubIndex('fail')
    render(<Practice />)
    const select = screen.getByRole('combobox', { name: 'Words from' }) as HTMLSelectElement
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalled())
    await new Promise((r) => setTimeout(r, 10))
    expect([...select.options].map((o) => o.value)).toEqual(['pseudo'])
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('starts the chosen source and mode', async () => {
    stubIndex(INDEX)
    render(<Practice />)
    const select = screen.getByRole('combobox', { name: 'Words from' }) as HTMLSelectElement
    await waitFor(() => expect(select.options).toHaveLength(3))
    fireEvent.change(select, { target: { value: 'ch-8' } })
    fireEvent.click(screen.getByRole('radio', { name: '60 seconds' }))
    const start = screen.getByRole('link', { name: 'Start' })
    expect(start.getAttribute('href')).toBe('/practice/free/ch-8/time-60')
    fireEvent.click(start)
    expect(location.pathname).toBe('/practice/free/ch-8/time-60')
  })

  it('shows the last result for the chosen combination', async () => {
    stubIndex(INDEX)
    render(<Practice />)
    expect(await screen.findByText('Last: 92% · 41 wpm')).toBeTruthy()
    const select = screen.getByRole('combobox', { name: 'Words from' }) as HTMLSelectElement
    await waitFor(() => expect(select.options).toHaveLength(3))
    fireEvent.change(select, { target: { value: 'ch-8' } })
    expect(await screen.findByText('Last: 81% · 31 wpm')).toBeTruthy()
    expect(getLastTest).toHaveBeenCalledWith('free', 'ch-8/words-25')
    fireEvent.click(screen.getByRole('radio', { name: '50 words' }))
    expect(await screen.findByText('Last: —')).toBeTruthy()
    expect(getLastTest).toHaveBeenCalledWith('free', 'ch-8/words-50')
  })

  it('lists the Chapter 4 drills below', async () => {
    stubIndex(INDEX)
    render(<Practice />)
    const drills = screen.getByRole('region', { name: 'Chapter 4 drills' })
    expect(within(drills).getAllByRole('link')).toHaveLength(9)
    expect(within(drills).getByRole('link', { name: /Vowels/ }).getAttribute('href')).toBe('/drill/stage0/rows-vowels')
    await waitFor(() => expect(getLastTest).toHaveBeenCalledWith('stage0', 'rows-vowels'))
  })

  describe('Where you are', () => {
    const where = (): HTMLElement | null => screen.queryByRole('region', { name: 'Where you are' })

    it('comes first and shows the chapter 4 panel when nothing is cleared', () => {
      stubIndex(INDEX)
      render(<Practice />)
      const section = where()!
      expect(section).toBeTruthy()
      const sections = [...document.querySelectorAll('.practice > section')]
      expect(sections[0]).toBe(section)
      expect(within(section).getByRole('heading', { name: 'Where you are' })).toBeTruthy()
      expect(within(section).getByText('Chapter 4: The layout')).toBeTruthy()
      const panel = within(section).getByRole('region', { name: 'Chapter progress' })
      expect(within(panel).getByText('Open')).toBeTruthy()
      expect(within(panel).getByText('Pass the Chapter 4 test: 90% accuracy within 10 minutes')).toBeTruthy()
      expect(within(panel).getByRole('button', { name: 'Move on anyway' })).toBeTruthy()
    })

    it('moves to chapter 6 once chapters 4 and 5 are cleared', () => {
      fake.value = progress('ready', { marks: [override(4), override(5)] })
      stubIndex(INDEX)
      render(<Practice />)
      const section = where()!
      expect(within(section).getByText('Chapter 6: Two words')).toBeTruthy()
      const panel = within(section).getByRole('region', { name: 'Chapter progress' })
      expect(within(panel).getByText('Do each section drill once at 90% accuracy or better')).toBeTruthy()
      expect(within(panel).queryByText('Pass the Chapter 4 test: 90% accuracy within 10 minutes')).toBeNull()
      expect(within(section).getByRole('link', { name: 'Go to Chapter 6' }).getAttribute('href')).toBe('/page/ch06')
    })

    it('links to the chapter page and navigates on a plain click', () => {
      stubIndex(INDEX)
      render(<Practice />)
      const go = within(where()!).getByRole('link', { name: 'Go to Chapter 4' })
      expect(go.getAttribute('href')).toBe('/page/ch04')
      expect(fireEvent.click(go)).toBe(false)
      expect(location.pathname).toBe('/page/ch04')
    })

    it.each(['loading', 'error'] as const)('is absent while progress is %s', (status) => {
      fake.value = progress(status)
      stubIndex(INDEX)
      render(<Practice />)
      expect(where()).toBeNull()
      expect(screen.queryByText('Where you are')).toBeNull()
      expect(screen.queryByRole('link', { name: /^Go to Chapter/ })).toBeNull()
      expect(document.querySelector('.chapter-panel')).toBeNull()
    })

    it('is absent when there are no chapters', () => {
      fake.value = progress('ready', { chapters: [] })
      stubIndex(INDEX)
      render(<Practice />)
      expect(where()).toBeNull()
      expect(screen.queryByText('Where you are')).toBeNull()
    })

    it('leaves the free-type and Chapter 4 sections in place', () => {
      stubIndex(INDEX)
      render(<Practice />)
      expect(screen.getByRole('region', { name: 'Free type' })).toBeTruthy()
      expect(screen.getByRole('region', { name: 'Chapter 4 drills' })).toBeTruthy()
    })
  })
})
