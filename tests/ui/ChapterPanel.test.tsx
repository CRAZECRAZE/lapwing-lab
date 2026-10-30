// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact'
import type { JSX } from 'preact'
import { useState } from 'preact/hooks'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChapterInfo, PracticeIndexEntry } from '../../scripts/build-content.ts'
import type { ProgressMark, SectionResult } from '../../server/archive.ts'
import { chapterStates } from '../../src/core/progress.ts'
import type { ResultsByMode } from '../../src/core/progress.ts'
import type { Progress } from '../../src/state/progress.tsx'
import { ChapterPanel } from '../../src/ui/ChapterPanel.tsx'

// The panel reads progress through `useProgress`; each test hands it a fake value.
const fake = vi.hoisted(() => ({ value: null as Progress | null }))
vi.mock('../../src/state/progress.tsx', async (importActual) => {
  const actual = await importActual<typeof import('../../src/state/progress.tsx')>()
  return { ...actual, useProgress: () => fake.value ?? actual.useProgress() }
})

const CHAPTERS: ChapterInfo[] = [
  { chapter: 1, pageId: 'ch01', title: 'Chapter 1', gate: 'read', listIds: [] },
  { chapter: 2, pageId: 'ch02', title: 'Chapter 2', gate: 'read', listIds: [] },
  { chapter: 3, pageId: 'ch03', title: 'Chapter 3', gate: 'read', listIds: [] },
  { chapter: 4, pageId: 'ch04', title: 'Chapter 4: The layout', gate: 'stage0', passMark: { accuracy: 0.9, maxMinutes: 10 }, listIds: [] },
  {
    chapter: 5,
    pageId: 'ch05',
    title: 'Chapter 5',
    gate: 'test',
    passMark: { accuracy: 0.9, minWpm: 30 },
    testListId: '5-test',
    listIds: ['5-cvc', '5-basic-left-hand'],
  },
  { chapter: 6, pageId: 'ch06', title: 'Chapter 6', gate: 'drills', listIds: ['6-fqm', '6-two-words'] },
  { chapter: 7, pageId: 'ch07', title: 'Chapter 7', gate: 'read', listIds: [] },
]

const INDEX: PracticeIndexEntry[] = [
  { id: '5-cvc', chapter: 5, items: 120 },
  { id: '5-basic-left-hand', chapter: 5, items: 80 },
  { id: '5-test', chapter: 5, items: 300 },
  { id: '6-fqm', chapter: 6, items: 40 },
  { id: '6-two-words', chapter: 6, items: 30 },
]

const result = (section: string, passed: boolean, best: [number, number] | null, last: [number, number] | null): SectionResult => ({
  section,
  runs: 1,
  passed,
  best: best && { accuracy: best[0], wpm: best[1] },
  last: last && { accuracy: last[0], wpm: last[1], endedAt: 1, passed },
  firstPassedAt: passed ? 1 : null,
})

const mark = (chapter: number, kind: 'read' | 'override'): ProgressMark => ({ chapter, kind, at: 1 })
/** Chapter 4 passed, so chapter 5 is open. */
const STAGE0_PASSED = result('pseudo-test', true, [0.96, 20], [0.96, 20])

type Setup = {
  status?: Progress['status']
  results?: Partial<ResultsByMode>
  marks?: ProgressMark[]
}

const calls = {
  setMark: vi.fn<(chapter: number, kind: 'read' | 'override') => void>(),
  setMarks: vi.fn<(chapters: readonly number[], kind: 'read' | 'override') => void>(),
  clearMark: vi.fn<(chapter: number) => void>(),
  reload: vi.fn<() => void>(),
}
/** When set, the next write waits for it; `fail` makes the next write reject. */
let gate: Promise<void> | null = null
/** When set, `setMarks` waits for it after its marks have landed, as the real one does while it reloads. */
let settle: Promise<void> | null = null
let failNext = false

function build(setup: Setup, marks: ProgressMark[], write: (next: ProgressMark[]) => void): Progress {
  const status = setup.status ?? 'ready'
  const results: ResultsByMode = { stage0: [], section: [], 'chapter-test': [], ...setup.results }
  const pending = async (): Promise<void> => {
    if (gate) await gate
    if (failNext) {
      failNext = false
      throw new Error('offline')
    }
  }
  return {
    status,
    chapters: CHAPTERS,
    index: INDEX,
    results,
    marks,
    states: status === 'ready' ? chapterStates(CHAPTERS, results, marks) : new Map(),
    reload: async () => void calls.reload(),
    setMark: async (chapter, kind) => {
      calls.setMark(chapter, kind)
      await pending()
      write([...marks.filter((m) => m.chapter !== chapter), mark(chapter, kind)])
    },
    setMarks: async (chapters, kind) => {
      calls.setMarks([...chapters], kind)
      await pending()
      write([...marks.filter((m) => !chapters.includes(m.chapter)), ...chapters.map((c) => mark(c, kind))])
      if (settle) await settle
    },
    clearMark: async (chapter) => {
      calls.clearMark(chapter)
      await pending()
      write(marks.filter((m) => m.chapter !== chapter))
    },
  }
}

/** Holds the marks in state so a write re-renders the panel with the new progress, as the real provider does. */
function Live({ chapter, setup, today }: { chapter: number; setup: Setup; today?: string }): JSX.Element {
  const [marks, setMarks] = useState(setup.marks ?? [])
  fake.value = build(setup, marks, setMarks)
  return <ChapterPanel chapter={chapter} today={today} />
}

const show = (chapter: number, setup: Setup = {}) => render(<Live chapter={chapter} setup={setup} />)
const panel = (): HTMLElement => document.querySelector('.chapter-panel') as HTMLElement
const status = (): string => document.querySelector('.chapter-panel__status')?.textContent ?? ''
const rows = (): string[] => [...document.querySelectorAll('.chapter-panel__row')].map((r) => r.textContent ?? '')
/** A button of the panel itself (outside the confirmation dialog, whose confirm button can share its name). */
const button = (name: string): HTMLButtonElement =>
  within((document.querySelector('.chapter-panel__actions') as HTMLElement | null) ?? document.body).getByRole('button', {
    name,
  }) as HTMLButtonElement
const dialog = (): HTMLElement => screen.getByRole('alertdialog')
const noDialog = (): void => expect(screen.queryByRole('alertdialog')).toBeNull()
/** A button inside the confirmation dialog. */
const inDialog = (name: string): HTMLButtonElement => within(dialog()).getByRole('button', { name }) as HTMLButtonElement
const noWrites = (): void => {
  expect(calls.setMark).not.toHaveBeenCalled()
  expect(calls.setMarks).not.toHaveBeenCalled()
  expect(calls.clearMark).not.toHaveBeenCalled()
}

beforeEach(() => {
  history.replaceState(null, '', '/page/ch05')
  gate = null
  settle = null
  failNext = false
})

afterEach(() => {
  cleanup()
  fake.value = null
  calls.setMark.mockClear()
  calls.setMarks.mockClear()
  calls.clearMark.mockClear()
  calls.reload.mockClear()
})

describe('ChapterPanel: Stage 0 (chapter 4)', () => {
  it('is open with the requirement and no drill rows until the test is passed', () => {
    show(4)
    expect(status()).toBe('Open')
    expect(panel().textContent).toContain('Pass the Chapter 4 test: 90% accuracy within 10 minutes')
    expect(rows()).toEqual([])
    expect(button('Move on anyway')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Mark as read' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()
  })

  it('says it was cleared by the pass and shows the best and last results', () => {
    show(4, { results: { stage0: [result('pseudo-test', true, [0.97, 22], [0.93, 18])] } })
    expect(status()).toBe('Cleared · passed the test')
    expect(panel().textContent).toContain('Best: 97% · 22 wpm')
    expect(panel().textContent).toContain('Last: 93% · 18 wpm')
    expect(screen.queryByRole('button', { name: 'Move on anyway' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()
  })

  it('does not repeat the chapter title', () => {
    show(4)
    expect(panel().textContent).not.toContain('The layout')
  })
})

describe('ChapterPanel: test gate', () => {
  it('is open and lists each drill with its count, last result and a Start link, and the chapter test', () => {
    show(5, {
      results: {
        stage0: [STAGE0_PASSED],
        section: [result('5-cvc', true, [0.95, 33], [0.92, 31])],
        'chapter-test': [result('5-test', false, [0.95, 34], [0.81, 25])],
      },
    })
    expect(status()).toBe('Open')
    expect(panel().textContent).toContain('Pass the chapter test: 90% accuracy and at least 30 wpm')
    expect(rows()[0]).toContain('cvc')
    expect(rows()[0]).toContain('120 words')
    expect(rows()[0]).toContain('Last: 92% · 31 wpm')
    expect(rows()[1]).toContain('basic left hand')
    expect(rows()[1]).toContain('80 words')
    expect(rows()[1]).toContain('—')
    expect(rows().join('')).not.toContain('✓') // only drills gates tick their drills
    const starts = screen.getAllByRole('link', { name: /Start/ }).map((a) => a.getAttribute('href'))
    expect(starts).toEqual(['/drill/list/5-cvc', '/drill/list/5-basic-left-hand'])
    const test = document.querySelector('.chapter-panel__test')!.textContent!
    expect(test).toContain('Chapter test')
    expect(test).toContain('45 words, 3 times each')
    expect(test).toContain('Best: 95% · 34 wpm')
    expect(test).toContain('Last: 81% · 25 wpm')
    expect(test).not.toContain('✓')
    expect(screen.getByRole('link', { name: 'Take the chapter test' }).getAttribute('href')).toBe('/drill/test/5')
  })

  it('navigates in-app on a plain click of Start and leaves a modified click to the browser', () => {
    show(5, { results: { stage0: [STAGE0_PASSED] } })
    const start = screen.getAllByRole('link', { name: /Start/ })[0]
    expect(fireEvent.click(start, { ctrlKey: true })).toBe(true)
    expect(location.pathname).toBe('/page/ch05')
    expect(fireEvent.click(start)).toBe(false)
    expect(location.pathname).toBe('/drill/list/5-cvc')
    fireEvent.click(screen.getByRole('link', { name: 'Take the chapter test' }))
    expect(location.pathname).toBe('/drill/test/5')
  })

  it('says it was cleared by the pass and ticks the test', () => {
    show(5, { results: { stage0: [STAGE0_PASSED], 'chapter-test': [result('5-test', true, [0.95, 34], [0.95, 34])] } })
    expect(status()).toBe('Cleared · passed the test')
    expect(document.querySelector('.chapter-panel__test')!.textContent).toContain('✓')
    expect(screen.queryByRole('button', { name: 'Move on anyway' })).toBeNull()
  })
})

describe('ChapterPanel: drills gate', () => {
  const open = [STAGE0_PASSED]

  it('ticks only the drills that passed while some are left', () => {
    show(6, {
      results: { stage0: open, section: [result('6-fqm', true, [0.95, 30], [0.95, 30]), result('6-two-words', false, null, [0.7, 20])] },
      marks: [mark(5, 'override')],
    })
    expect(status()).toBe('Open')
    expect(panel().textContent).toContain('Do each section drill once at 90% accuracy or better')
    expect(rows()[0]).toMatch(/^✓/)
    expect(rows()[0]).toContain('fqm')
    expect(rows()[1]).not.toContain('✓')
    expect(rows()[1]).toContain('two words')
    expect(rows()[1]).toContain('Last: 70% · 20 wpm')
    expect(document.querySelector('.chapter-panel__test')).toBeNull()
  })

  it('says every drill is done once they all passed', () => {
    show(6, {
      results: { stage0: open, section: [result('6-fqm', true, [0.95, 30], [0.95, 30]), result('6-two-words', true, [0.9, 20], [0.9, 20])] },
      marks: [mark(5, 'override')],
    })
    expect(status()).toBe('Cleared · every drill done')
    expect(rows().every((r) => r.startsWith('✓'))).toBe(true)
  })
})

describe('ChapterPanel: read gate and marks', () => {
  const opened: Setup = { results: { stage0: [STAGE0_PASSED] }, marks: [mark(5, 'override'), mark(6, 'override')] }

  it('offers Mark as read, writes a read mark, and then says so with an Undo', async () => {
    show(7, opened)
    expect(status()).toBe('Open')
    expect(panel().textContent).toContain('Read the chapter, then mark it as read')
    expect(rows()).toEqual([])
    fireEvent.click(button('Mark as read'))
    expect(calls.setMark).toHaveBeenCalledWith(7, 'read')
    await waitFor(() => expect(status()).toBe('Cleared · marked read'))
    expect(screen.queryByRole('button', { name: 'Mark as read' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Move on anyway' })).toBeNull()
    fireEvent.click(button('Undo'))
    expect(calls.clearMark).toHaveBeenCalledWith(7)
    await waitFor(() => expect(status()).toBe('Open'))
  })

  it('Move on anyway writes an override for the viewed chapter, disables while saving, and Undo clears it', async () => {
    let release!: () => void
    gate = new Promise((resolve) => (release = resolve))
    show(5, { results: { stage0: [STAGE0_PASSED] } })
    fireEvent.click(button('Move on anyway'))
    fireEvent.click(inDialog('Move on anyway'))
    expect(calls.setMark).toHaveBeenCalledWith(5, 'override')
    await waitFor(() => expect(button('Move on anyway').disabled).toBe(true))
    await act(async () => release())
    await waitFor(() => expect(status()).toBe('Cleared · moved on anyway'))
    gate = null
    fireEvent.click(button('Undo'))
    expect(calls.clearMark).toHaveBeenCalledWith(5)
    await waitFor(() => expect(status()).toBe('Open'))
  })

  it('shows a short error and re-enables the button when a write fails', async () => {
    failNext = true
    show(5, { results: { stage0: [STAGE0_PASSED] } })
    fireEvent.click(button('Move on anyway'))
    fireEvent.click(inDialog('Move on anyway'))
    expect(await screen.findByText("Couldn't save that. Try again.")).toBeTruthy()
    noDialog()
    expect(button('Move on anyway').disabled).toBe(false)
    expect(status()).toBe('Open')
    fireEvent.click(button('Move on anyway'))
    fireEvent.click(inDialog('Move on anyway'))
    await waitFor(() => expect(status()).toBe('Cleared · moved on anyway'))
    expect(screen.queryByText("Couldn't save that. Try again.")).toBeNull()
  })
})

describe('ChapterPanel: Move on anyway', () => {
  it.each([1, 2, 3])('is not offered on chapter %i, which never blocks anything, but Mark as read is', (chapter) => {
    show(chapter)
    expect(status()).toBe('Open')
    expect(screen.queryByRole('button', { name: 'Move on anyway' })).toBeNull()
    expect(button('Mark as read')).toBeTruthy()
  })

  it('is still offered on chapters 4 and 5', () => {
    show(4)
    expect(button('Move on anyway')).toBeTruthy()
    cleanup()
    show(5, { results: { stage0: [STAGE0_PASSED] } })
    expect(button('Move on anyway')).toBeTruthy()
  })
})

describe('ChapterPanel: a score just below a pass mark', () => {
  it('shows the chapter test Best and Last with one decimal when they round up to the mark', () => {
    show(5, {
      results: {
        stage0: [STAGE0_PASSED],
        'chapter-test': [result('5-test', false, [121 / 135, 29.6], [0.896, 29.6])],
      },
    })
    const test = document.querySelector('.chapter-panel__test')!.textContent!
    expect(test).toContain('Best: 89.6% · 29.6 wpm')
    expect(test).toContain('Last: 89.6% · 29.6 wpm')
  })

  it('rounds a chapter test score that is not an edge case as before', () => {
    show(5, { results: { stage0: [STAGE0_PASSED], 'chapter-test': [result('5-test', false, [0.85, 25.4], [0.85, 25.4])] } })
    expect(document.querySelector('.chapter-panel__test')!.textContent).toContain('Last: 85% · 25 wpm')
  })

  it('judges a drills-gate section row by 90%, with no wpm mark', () => {
    show(6, { results: { stage0: [STAGE0_PASSED], section: [result('6-fqm', false, [0.896, 9.6], [0.896, 9.6])] }, marks: [mark(5, 'override')] })
    expect(rows()[0]).toContain('Last: 89.6% · 10 wpm')
  })

  it('leaves a section row in a test-gate chapter as plain practice', () => {
    show(5, { results: { stage0: [STAGE0_PASSED], section: [result('5-cvc', false, [0.896, 31], [0.896, 31])] } })
    expect(rows()[0]).toContain('Last: 90% · 31 wpm')
  })

  it('shows the Stage 0 Best and Last against its pass mark', () => {
    show(4, { results: { stage0: [result('pseudo-test', false, [0.896, 22], [0.896, 22])] } })
    expect(panel().textContent).toContain('Best: 89.6% · 22 wpm')
    expect(panel().textContent).toContain('Last: 89.6% · 22 wpm')
  })
})

describe('ChapterPanel: locks, loading and errors', () => {
  it('shows the lock line and an Open anyway that overrides the blocking chapter', async () => {
    show(6, { results: { stage0: [STAGE0_PASSED] } })
    expect(status()).toBe('Locked until Chapter 5 is cleared')
    expect(screen.queryByRole('button', { name: 'Move on anyway' })).toBeNull()
    fireEvent.click(button('Open anyway'))
    fireEvent.click(inDialog('Open anyway'))
    expect(calls.setMarks).toHaveBeenCalledWith([5], 'override')
    expect(calls.setMark).not.toHaveBeenCalled()
    await waitFor(() => expect(status()).toBe('Open'))
    expect(screen.queryByRole('button', { name: 'Open anyway' })).toBeNull()
  })

  it('renders nothing while progress is loading', () => {
    show(5, { status: 'loading' })
    expect(panel()).toBeNull()
  })

  it('renders nothing for a chapter it does not know', () => {
    show(30)
    expect(panel()).toBeNull()
  })

  it('shows one quiet line on error, with Try again calling reload, and locks nothing', () => {
    show(6, { status: 'error' })
    expect(panel().textContent).toContain("Chapter progress isn't available right now.")
    expect(screen.queryByText(/Locked/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Open anyway' })).toBeNull()
    fireEvent.click(button('Try again'))
    expect(calls.reload).toHaveBeenCalledTimes(1)
  })
})

describe('ChapterPanel: Move on anyway asks first', () => {
  const open5: Setup = { results: { stage0: [STAGE0_PASSED] } }

  it('opens a dialog and writes nothing until Confirm', () => {
    show(5, open5)
    const opener = button('Move on anyway')
    opener.focus()
    fireEvent.click(opener)
    expect(screen.getByRole('alertdialog', { name: 'Move on anyway?' })).toBe(dialog())
    expect(dialog().textContent).toContain('Mark Chapter 5 as done without clearing it? You can undo this later.')
    expect(document.activeElement).toBe(inDialog('Cancel'))
    noWrites()
    expect(status()).toBe('Open')
  })

  it('writes nothing on Cancel, closes, and gives the focus back to the button', () => {
    show(5, open5)
    const opener = button('Move on anyway')
    opener.focus()
    fireEvent.click(opener)
    fireEvent.click(inDialog('Cancel'))
    noDialog()
    noWrites()
    expect(status()).toBe('Open')
    expect(document.activeElement).toBe(button('Move on anyway'))
  })

  it('writes nothing on Esc or a click outside', () => {
    show(5, open5)
    fireEvent.click(button('Move on anyway'))
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    noDialog()
    fireEvent.click(button('Move on anyway'))
    fireEvent.click(document.querySelector('.confirm-dialog')!)
    noDialog()
    noWrites()
  })

  it('writes an override for the viewed chapter only on Confirm, then closes', async () => {
    show(5, open5)
    fireEvent.click(button('Move on anyway'))
    fireEvent.click(inDialog('Move on anyway'))
    expect(calls.setMark).toHaveBeenCalledTimes(1)
    expect(calls.setMark).toHaveBeenCalledWith(5, 'override')
    expect(calls.setMarks).not.toHaveBeenCalled()
    await waitFor(() => expect(status()).toBe('Cleared · moved on anyway'))
    noDialog()
  })

  it('keeps the dialog open and busy while the write is in flight', async () => {
    let release!: () => void
    gate = new Promise((resolve) => (release = resolve))
    show(5, open5)
    fireEvent.click(button('Move on anyway'))
    fireEvent.click(inDialog('Move on anyway'))
    await waitFor(() => expect(inDialog('Move on anyway').disabled).toBe(true))
    expect(inDialog('Cancel').disabled).toBe(true)
    fireEvent.click(inDialog('Move on anyway'))
    expect(calls.setMark).toHaveBeenCalledTimes(1)
    await act(async () => release())
    await waitFor(() => expect(status()).toBe('Cleared · moved on anyway'))
    noDialog()
  })

  it('closes the dialog and shows the error line when the write fails', async () => {
    failNext = true
    show(5, open5)
    fireEvent.click(button('Move on anyway'))
    fireEvent.click(inDialog('Move on anyway'))
    expect(await screen.findByText("Couldn't save that. Try again.")).toBeTruthy()
    noDialog()
    expect(status()).toBe('Open')
  })

  it('Mark as read and Undo still write at once, with no dialog', async () => {
    show(7, { results: { stage0: [STAGE0_PASSED] }, marks: [mark(5, 'override'), mark(6, 'override')] })
    fireEvent.click(button('Mark as read'))
    noDialog()
    expect(calls.setMark).toHaveBeenCalledWith(7, 'read')
    await waitFor(() => expect(status()).toBe('Cleared · marked read'))
    fireEvent.click(button('Undo'))
    noDialog()
    expect(calls.clearMark).toHaveBeenCalledWith(7)
  })
})

describe('ChapterPanel: Open anyway opens the chapter and every one before it', () => {
  // Chapter 4 passed, 5 and 6 not cleared: 7 is locked by 5, and 6 would block it next.
  const locked7: Setup = { results: { stage0: [STAGE0_PASSED] } }

  it('names every blocking chapter in the dialog and writes nothing until Confirm', () => {
    show(7, locked7)
    expect(status()).toBe('Locked until Chapter 5 is cleared')
    fireEvent.click(button('Open anyway'))
    expect(screen.getByRole('alertdialog', { name: 'Open Chapter 7 anyway?' })).toBe(dialog())
    expect(dialog().textContent).toContain(
      'Chapters 5 and 6 will be marked as moved on anyway so Chapter 7 opens. You can undo each one later.',
    )
    expect(document.activeElement).toBe(inDialog('Cancel'))
    noWrites()
  })

  it('writes nothing on Cancel', () => {
    show(7, locked7)
    fireEvent.click(button('Open anyway'))
    fireEvent.click(inDialog('Cancel'))
    noDialog()
    noWrites()
    expect(status()).toBe('Locked until Chapter 5 is cleared')
  })

  it('on Confirm overrides 5 and 6 in one call, and Chapter 7 opens', async () => {
    show(7, locked7)
    fireEvent.click(button('Open anyway'))
    fireEvent.click(inDialog('Open anyway'))
    expect(calls.setMarks).toHaveBeenCalledTimes(1)
    expect(calls.setMarks).toHaveBeenCalledWith([5, 6], 'override')
    expect(calls.setMark).not.toHaveBeenCalled()
    await waitFor(() => expect(status()).toBe('Open'))
    noDialog()
    expect(screen.queryByRole('button', { name: 'Open anyway' })).toBeNull()
  })

  it('skips a chapter in between that is already cleared', () => {
    show(7, { results: { stage0: [STAGE0_PASSED] }, marks: [mark(5, 'override')] })
    expect(status()).toBe('Locked until Chapter 6 is cleared')
    fireEvent.click(button('Open anyway'))
    expect(dialog().textContent).toContain('Chapter 6 will be marked as moved on anyway so Chapter 7 opens.')
    fireEvent.click(inDialog('Open anyway'))
    expect(calls.setMarks).toHaveBeenCalledWith([6], 'override')
  })

  it('keeps the dialog text steady when the marks have landed but the write has not finished', async () => {
    let release!: () => void
    settle = new Promise((resolve) => (release = resolve))
    show(7, locked7)
    fireEvent.click(button('Open anyway'))
    fireEvent.click(inDialog('Open anyway'))
    await waitFor(() => expect(status()).toBe('Open')) // the new state is in, nothing blocks Chapter 7 now
    expect(inDialog('Open anyway').disabled).toBe(true)
    expect(dialog().textContent).toContain('Chapters 5 and 6 will be marked as moved on anyway so Chapter 7 opens.')
    await act(async () => release())
    await waitFor(() => noDialog())
  })

  it('closes the dialog, stays locked and shows the error line when the write fails', async () => {
    failNext = true
    show(7, locked7)
    fireEvent.click(button('Open anyway'))
    fireEvent.click(inDialog('Open anyway'))
    expect(await screen.findByText("Couldn't save that. Try again.")).toBeTruthy()
    noDialog()
    expect(status()).toBe('Locked until Chapter 5 is cleared')
    expect(button('Open anyway').disabled).toBe(false)
  })
})

describe('ChapterPanel: plateau line', () => {
  const FLAT = [
    { date: '2026-10-27', runs: 2, words: 100, wpm: 41.4, accuracy: 0.9, steadiness: 50 },
    { date: '2026-10-20', runs: 2, words: 100, wpm: 42, accuracy: 0.9, steadiness: 50 },
    { date: '2026-10-13', runs: 2, words: 100, wpm: 40, accuracy: 0.9, steadiness: 50 },
  ]
  const stubApi = (days: unknown[] | 'fail', puts: unknown[] = []): ReturnType<typeof vi.fn> => {
    const fn = vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(input, 'http://localhost')
      if (url.pathname === '/api/settings') {
        if (init?.method === 'PUT') puts.push(JSON.parse(String(init.body)))
        return new Response('{}', { status: 200 })
      }
      if (days === 'fail') return new Response('{}', { status: 500 })
      return new Response(JSON.stringify({ from: '', to: '', mode: 'free', days, keys: [], mixups: [], allTimeStrokes: 1 }), { status: 200 })
    })
    vi.stubGlobal('fetch', fn)
    return fn
  }
  const flush = (): Promise<void> => act(async () => new Promise<void>((done) => setTimeout(done, 0)))
  const line = (): HTMLElement | null => document.querySelector('.plateau-line')
  afterEach(() => vi.unstubAllGlobals())

  it('shows one line with a link to Progress in the panel', async () => {
    const fn = stubApi(FLAT)
    render(<Live chapter={5} setup={{}} today="2026-10-28" />)
    expect(line()).toBeNull() // still loading
    await flush()
    expect(line()?.textContent).toBe('Speed flat for 3 weeks, see Progress')
    expect(panel().contains(line())).toBe(true)
    expect(within(line()!).getByRole('link', { name: 'see Progress' }).getAttribute('href')).toBe('/progress')
    expect(fn.mock.calls.filter(([u]) => String(u).startsWith('/api/stats'))).toHaveLength(1)
  })

  it('shows nothing when the request fails or the speed is not flat', async () => {
    stubApi('fail')
    render(<Live chapter={5} setup={{}} today="2026-10-28" />)
    await flush()
    expect(line()).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
    cleanup()
    stubApi([])
    render(<Live chapter={5} setup={{}} today="2026-10-28" />)
    await flush()
    expect(line()).toBeNull()
  })
})
