// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChapterInfo } from '../../scripts/build-content.ts'
import type { ProgressMark, TestRow } from '../../server/archive.ts'
import type { FixupLists } from '../../src/core/fixup.ts'
import { chapterStates } from '../../src/core/progress.ts'
import type { ResultsByMode } from '../../src/core/progress.ts'
import type { Progress } from '../../src/state/progress.tsx'
import { Practice } from '../../src/ui/Practice.tsx'

// The chapter panel's plateau line asks for the stats and the settings; here that fails, so there is no line.
vi.mock('../../src/api.ts', () => ({
  getLastTest: vi.fn(),
  getStats: vi.fn(async () => Promise.reject(new Error('offline'))),
  getSettings: vi.fn(async () => ({ plateauSnoozedUntil: null })),
  putSettings: vi.fn(),
  getFixup: vi.fn(),
}))
const api = await import('../../src/api.ts')
const getLastTest = vi.mocked(api.getLastTest)
const getFixup = vi.mocked(api.getFixup)

const lists = (words: number, patterns: number): FixupLists => ({
  from: '2026-10-02',
  to: '2026-10-30',
  words: Array.from({ length: words }, (_, i) => ({ word: `w${i}` }) as unknown as FixupLists['words'][number]),
  patterns: Array.from({ length: patterns }, (_, i) => ({ id: `missing:p${i}` }) as unknown as FixupLists['patterns'][number]),
})

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
  getFixup.mockReset().mockResolvedValue(lists(0, 0))
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
    expect(modes.map((r) => r.value)).toEqual(['words-25', 'words-50', 'time-30', 'time-60', 'custom'])
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

  describe('Custom amount', () => {
    const box = (): HTMLInputElement => screen.getByRole('spinbutton', { name: 'Amount' }) as HTMLInputElement
    const start = (): HTMLElement => screen.getByRole('link', { name: 'Start' })
    const startButton = (): HTMLButtonElement => screen.getByRole('button', { name: 'Start' }) as HTMLButtonElement
    const type = (value: string): void => void fireEvent.input(box(), { target: { value } })
    const unit = (name: 'words' | 'seconds'): void => void fireEvent.click(screen.getByRole('radio', { name }))
    const choose = (): void => void fireEvent.click(screen.getByRole('radio', { name: 'Custom' }))
    const hint = (): HTMLElement => document.getElementById(box().getAttribute('aria-describedby')!)!
    const expectDisabled = (): void => {
      expect(screen.queryByRole('link', { name: 'Start' })).toBeNull()
      expect(startButton().disabled).toBe(true)
    }

    beforeEach(() => {
      stubIndex(INDEX)
    })

    it('shows the box only once Custom is chosen, with words as the default unit', () => {
      render(<Practice />)
      expect(screen.queryByRole('spinbutton', { name: 'Amount' })).toBeNull()
      expect(screen.queryByRole('radiogroup', { name: 'Unit' })).toBeNull()
      expect(screen.getByRole('radio', { name: 'Custom' })).toHaveProperty('checked', false)
      choose()
      expect(screen.getByRole('radio', { name: 'Custom' })).toHaveProperty('checked', true)
      expect(box().getAttribute('inputmode')).toBe('numeric')
      expect(box().getAttribute('min')).toBe('1')
      expect(box().getAttribute('max')).toBe('500')
      const units = within(screen.getByRole('radiogroup', { name: 'Unit' })).getAllByRole('radio') as HTMLInputElement[]
      expect(units.map((r) => [r.value, r.checked])).toEqual([['words', true], ['seconds', false]])
      unit('seconds')
      expect(box().getAttribute('min')).toBe('5')
      expect(box().getAttribute('max')).toBe('600')
    })

    it('starts a custom number of words', () => {
      render(<Practice />)
      choose()
      type('40')
      expect(start().getAttribute('href')).toBe('/practice/free/pseudo/words-40')
      fireEvent.click(start())
      expect(location.pathname).toBe('/practice/free/pseudo/words-40')
    })

    it('starts a custom number of seconds, from the chosen source', async () => {
      render(<Practice />)
      const select = screen.getByRole('combobox', { name: 'Words from' }) as HTMLSelectElement
      await waitFor(() => expect(select.options).toHaveLength(3))
      fireEvent.change(select, { target: { value: 'ch-8' } })
      choose()
      unit('seconds')
      type('90')
      fireEvent.click(start())
      expect(location.pathname).toBe('/practice/free/ch-8/time-90')
    })

    it.each([
      ['empty', '', 'words'],
      ['zero words', '0', 'words'],
      ['501 words', '501', 'words'],
      ['4 seconds', '4', 'seconds'],
      ['601 seconds', '601', 'seconds'],
      ['a decimal', '1.5', 'words'],
      ['letters', 'abc', 'words'],
      ['an exponent', '1e2', 'words'],
      ['a minus sign', '-5', 'seconds'],
    ] as const)('disables Start for %s and says what is allowed', (_name, text, which) => {
      render(<Practice />)
      choose()
      if (which === 'seconds') unit('seconds')
      type(text)
      expectDisabled()
      fireEvent.click(startButton())
      expect(location.pathname).toBe('/practice')
      expect(hint().textContent).toBe(which === 'words' ? '1–500 words' : '5–600 seconds')
      expect(hint().textContent).not.toContain(which === 'words' ? 'seconds' : 'words')
    })

    it('marks a typed value that is out of range as invalid, and clears it once valid', () => {
      render(<Practice />)
      choose()
      expect(box().getAttribute('aria-invalid')).toBeNull()
      type('501')
      expect(box().getAttribute('aria-invalid')).toBe('true')
      type('500')
      expect(box().getAttribute('aria-invalid')).toBeNull()
      expect(start().getAttribute('href')).toBe('/practice/free/pseudo/words-500')
    })

    it('has Start disabled before anything is typed', () => {
      render(<Practice />)
      choose()
      expectDisabled()
    })

    it('re-checks the same typed text when the unit changes', () => {
      render(<Practice />)
      choose()
      type('601')
      expectDisabled()
      unit('seconds')
      expectDisabled()
      type('60')
      expect(start().getAttribute('href')).toBe('/practice/free/pseudo/time-60')
      type('4')
      expectDisabled()
      unit('words')
      expect(start().getAttribute('href')).toBe('/practice/free/pseudo/words-4')
      type('300')
      unit('seconds')
      expect(start().getAttribute('href')).toBe('/practice/free/pseudo/time-300')
      type('601')
      unit('words')
      expectDisabled()
    })

    it('starts on Enter in the box when the value is valid', () => {
      render(<Practice />)
      choose()
      type('40')
      fireEvent.keyDown(box(), { key: 'Enter' })
      expect(location.pathname).toBe('/practice/free/pseudo/words-40')
    })

    it('does nothing on Enter when the value is not valid', () => {
      render(<Practice />)
      choose()
      fireEvent.keyDown(box(), { key: 'Enter' })
      type('501')
      fireEvent.keyDown(box(), { key: 'Enter' })
      expect(location.pathname).toBe('/practice')
    })

    it('does not start on other keys', () => {
      render(<Practice />)
      choose()
      type('40')
      fireEvent.keyDown(box(), { key: 'a' })
      expect(location.pathname).toBe('/practice')
    })

    it('ignores the custom box while a preset is chosen, and finds it again on return', () => {
      render(<Practice />)
      choose()
      unit('seconds')
      type('90')
      fireEvent.click(screen.getByRole('radio', { name: '50 words' }))
      expect(screen.queryByRole('spinbutton', { name: 'Amount' })).toBeNull()
      expect(start().getAttribute('href')).toBe('/practice/free/pseudo/words-50')
      choose()
      expect(box().value).toBe('90')
      expect(screen.getByRole('radio', { name: 'seconds' })).toHaveProperty('checked', true)
      expect(start().getAttribute('href')).toBe('/practice/free/pseudo/time-90')
    })

    it('a preset stays startable even when the custom box holds an invalid value', () => {
      render(<Practice />)
      choose()
      type('999')
      fireEvent.click(screen.getByRole('radio', { name: '30 seconds' }))
      expect(start().getAttribute('href')).toBe('/practice/free/pseudo/time-30')
    })

    it('asks for the last result of the custom combination, and shows a dash while it is not valid', async () => {
      getLastTest.mockImplementation(async (mode, section) =>
        mode === 'free' && section === 'pseudo/words-40' ? row({ accuracy: 0.77, wpm: 22.4 }) : null,
      )
      render(<Practice />)
      choose()
      type('40')
      expect(await screen.findByText('Last: 77% · 22 wpm')).toBeTruthy()
      expect(getLastTest).toHaveBeenCalledWith('free', 'pseudo/words-40')
      type('0')
      expect(screen.getByText('Last: —')).toBeTruthy()
      expect(getLastTest).not.toHaveBeenCalledWith('free', 'pseudo/words-0')
      type('40')
      expect(await screen.findByText('Last: 77% · 22 wpm')).toBeTruthy()
      unit('seconds')
      expect(await screen.findByText('Last: —')).toBeTruthy()
      expect(getLastTest).toHaveBeenCalledWith('free', 'pseudo/time-40')
    })
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

  describe('Real text card', () => {
    it('sits after Free type, with a link to the real-text page', () => {
      stubIndex(INDEX)
      render(<Practice />)
      const card = screen.getByRole('region', { name: 'Real text' })
      const names = [...document.querySelectorAll('.practice > section')].map((s) => s.getAttribute('aria-label') ?? s.querySelector('h2')?.textContent)
      expect(names.indexOf('Real text')).toBe(names.indexOf('Free type') + 1)
      expect(card.classList.contains('practice__box')).toBe(true)
      const go = within(card).getByRole('link', { name: 'Open real text' })
      expect(go.getAttribute('href')).toBe('/practice/text')
      expect(fireEvent.click(go)).toBe(false)
      expect(location.pathname).toBe('/practice/text')
    })
  })

  describe('Fix-up card', () => {
    const card = (): HTMLElement => screen.getByRole('region', { name: 'Fix-up' })

    it('sits between Where you are and Free type', () => {
      stubIndex(INDEX)
      render(<Practice />)
      const names = [...document.querySelectorAll('.practice > section')].map((s) => s.getAttribute('aria-label') ?? s.querySelector('h2')?.textContent)
      expect(names.slice(0, 3)).toEqual(['Where you are', 'Fix-up', 'Free type'])
      expect(within(card()).getByRole('heading', { name: 'Fix-up' })).toBeTruthy()
      expect(card().classList.contains('practice__box')).toBe(true)
    })

    it('shows the counts from the fix-up lists, with a link to the page', async () => {
      getFixup.mockResolvedValue(lists(3, 2))
      stubIndex(INDEX)
      render(<Practice />)
      expect(await within(card()).findByText('3 words, 2 patterns to fix')).toBeTruthy()
      const go = within(card()).getByRole('link')
      expect(go.getAttribute('href')).toBe('/practice/fixup')
      expect(fireEvent.click(go)).toBe(false)
      expect(location.pathname).toBe('/practice/fixup')
    })

    it('uses singular nouns for one', async () => {
      getFixup.mockResolvedValue(lists(1, 0))
      stubIndex(INDEX)
      render(<Practice />)
      expect(await within(card()).findByText('1 word, 0 patterns to fix')).toBeTruthy()
      cleanup()
      getFixup.mockResolvedValue(lists(0, 1))
      render(<Practice />)
      expect(await within(card()).findByText('0 words, 1 pattern to fix')).toBeTruthy()
    })

    it('says nothing to fix with empty lists, and still links to the page', async () => {
      stubIndex(INDEX)
      render(<Practice />)
      expect(await within(card()).findByText('Nothing to fix right now.')).toBeTruthy()
      expect(within(card()).queryByText(/to fix$/)).toBeNull()
      expect(within(card()).getByRole('link').getAttribute('href')).toBe('/practice/fixup')
    })

    it('shows neither numbers nor an error while loading', () => {
      getFixup.mockReturnValue(new Promise(() => {}))
      stubIndex(INDEX)
      render(<Practice />)
      expect(card().textContent).not.toMatch(/\d/)
      expect(within(card()).queryByText('Nothing to fix right now.')).toBeNull()
      expect(within(card()).queryByRole('alert')).toBeNull()
      expect(within(card()).getByRole('link').getAttribute('href')).toBe('/practice/fixup')
    })

    it('shows only the link when the fetch fails', async () => {
      getFixup.mockRejectedValue(new Error('offline'))
      stubIndex(INDEX)
      render(<Practice />)
      await waitFor(() => expect(getFixup).toHaveBeenCalled())
      await new Promise((r) => setTimeout(r, 10))
      expect(card().textContent).not.toMatch(/\d/)
      expect(within(card()).queryByText('Nothing to fix right now.')).toBeNull()
      expect(within(card()).queryByRole('alert')).toBeNull()
      expect(within(card()).getByRole('link').getAttribute('href')).toBe('/practice/fixup')
    })

    it('is shown even when progress has not loaded', () => {
      fake.value = progress('loading')
      stubIndex(INDEX)
      render(<Practice />)
      expect(card()).toBeTruthy()
    })
  })
})
