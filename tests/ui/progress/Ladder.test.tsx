// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/preact'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ChapterInfo } from '../../../scripts/build-content.ts'
import type { SectionResult } from '../../../server/archive.ts'
import type { ResultsByMode } from '../../../src/core/progress.ts'
import type { Progress } from '../../../src/state/progress.tsx'
import { Ladder } from '../../../src/ui/progress/Ladder.tsx'
import { badNumbers } from './fixtures.ts'

// The panel reads the chapter results through `useProgress`; each test hands it a fake value.
const fake = vi.hoisted(() => ({ value: null as Progress | null }))
vi.mock('../../../src/state/progress.tsx', async (importActual) => {
  const actual = await importActual<typeof import('../../../src/state/progress.tsx')>()
  return { ...actual, useProgress: () => fake.value ?? actual.useProgress() }
})

const CHAPTERS: ChapterInfo[] = [
  { chapter: 1, pageId: 'ch01', title: 'Chapter 1', gate: 'read', listIds: [] },
  { chapter: 4, pageId: 'ch04', title: 'Chapter 4', gate: 'stage0', passMark: { accuracy: 0.9, maxMinutes: 10 }, listIds: [] },
  { chapter: 5, pageId: 'ch05', title: 'Chapter 5', gate: 'test', passMark: { accuracy: 0.9, minWpm: 10, maxWpm: 20 }, testListId: '5-test', listIds: ['5-cvc'] },
  { chapter: 6, pageId: 'ch06', title: 'Chapter 6', gate: 'drills', listIds: ['6-fqm'] },
  { chapter: 7, pageId: 'ch07', title: 'Chapter 7', gate: 'test', passMark: { accuracy: 0.9, minWpm: 20, maxWpm: 30 }, testListId: '7-test', listIds: [] },
  { chapter: 8, pageId: 'ch08', title: 'Chapter 8', gate: 'read', listIds: [] },
]

const result = (section: string, passed: boolean, best: [number, number] | null): SectionResult => ({
  section,
  runs: 1,
  passed,
  best: best && { accuracy: best[0], wpm: best[1] },
  last: best && { accuracy: best[0], wpm: best[1], endedAt: 1, passed },
  firstPassedAt: passed ? 1 : null,
})

function show(
  setup: { status?: Progress['status']; chapters?: ChapterInfo[]; results?: Partial<ResultsByMode>; reload?: () => Promise<void> } = {},
): ReturnType<typeof render> {
  const results: ResultsByMode = { stage0: [], section: [], 'chapter-test': [], ...setup.results }
  fake.value = {
    status: setup.status ?? 'ready',
    chapters: setup.chapters ?? CHAPTERS,
    index: [],
    results,
    marks: [],
    states: new Map(),
    reload: setup.reload ?? (async () => undefined),
    setMark: async () => undefined,
    setMarks: async () => undefined,
    clearMark: async () => undefined,
  }
  return render(<Ladder />)
}

afterEach(() => {
  cleanup()
  fake.value = null
})

const rows = (c: Element): HTMLElement[] => [...c.querySelectorAll<HTMLElement>('.ladder__row')]
const row = (c: Element, chapter: number): HTMLElement => c.querySelector<HTMLElement>(`.ladder__row[data-chapter="${chapter}"]`)!
const text = (el: Element): string => el.textContent!.replace(/\s+/g, ' ').trim()

describe('Ladder: which chapters', () => {
  it('has the title that says it ignores the mode switch, and a row for the test and stage0 gates only', () => {
    const { container } = show()
    expect(screen.getByRole('heading', { level: 2, name: 'Chapter tests (ignores the mode switch)' })).toBeTruthy()
    expect(rows(container).map((r) => r.getAttribute('data-chapter'))).toEqual(['4', '5', '7'])
    expect(rows(container).map((r) => r.querySelector('.ladder__name')!.textContent)).toEqual(['Ch 4', 'Ch 5', 'Ch 7'])
  })

  it('lists the chapters in chapter order whatever order they come in', () => {
    const { container } = show({ chapters: [...CHAPTERS].reverse() })
    expect(rows(container).map((r) => r.getAttribute('data-chapter'))).toEqual(['4', '5', '7'])
  })

  it('is left out when the list has no chapter test, once the chapters are known', () => {
    const { container } = show({ chapters: CHAPTERS.filter((c) => c.gate === 'read' || c.gate === 'drills') })
    expect(container.innerHTML).toBe('')
    cleanup()
    const none = show({ chapters: [] })
    expect(none.container.innerHTML).toBe('')
  })
})

describe('Ladder: met and not yet', () => {
  it('says met in green when the best meets the accuracy and the wpm mark, and not yet when it does not', () => {
    const { container } = show({
      results: { 'chapter-test': [result('5-test', true, [0.94, 12]), result('7-test', false, [0.95, 15])] },
    })
    expect(text(row(container, 5))).toContain('12 wpm · 94%')
    expect(row(container, 5).getAttribute('data-state')).toBe('met')
    expect(row(container, 5).querySelector('.ladder__verdict')!.textContent).toBe('met')
    expect(row(container, 5).querySelector('.ladder__verdict')!.classList.contains('ladder__verdict--met')).toBe(true)
    expect(text(row(container, 7))).toContain('15 wpm · 95%')
    expect(row(container, 7).getAttribute('data-state')).toBe('not-yet')
    expect(row(container, 7).querySelector('.ladder__verdict')!.textContent).toBe('not yet')
    expect(row(container, 7).querySelector('.ladder__verdict')!.classList.contains('ladder__verdict--not-yet')).toBe(true)
  })

  it('judges with the raw numbers and shows 9.9 wpm, not 10, for 9.96 wpm against a mark of 10', () => {
    const { container } = show({ results: { 'chapter-test': [result('5-test', false, [0.95, 9.96])] } })
    expect(text(row(container, 5))).toContain('9.9 wpm')
    expect(text(row(container, 5))).not.toContain('10 wpm ·')
    expect(row(container, 5).querySelector('.ladder__verdict')!.textContent).toBe('not yet')
    expect(row(container, 5).getAttribute('data-state')).toBe('not-yet')
  })

  it('judges the accuracy by its raw value too: 89.6% shows with a decimal and is not yet', () => {
    const { container } = show({ results: { 'chapter-test': [result('5-test', false, [0.896, 15])] } })
    expect(text(row(container, 5))).toContain('15 wpm · 89.6%')
    expect(row(container, 5).querySelector('.ladder__verdict')!.textContent).toBe('not yet')
  })

  it('counts exactly the mark as met (accuracy and wpm at the mark)', () => {
    const { container } = show({ results: { 'chapter-test': [result('5-test', false, [0.9, 10])] } })
    expect(row(container, 5).getAttribute('data-state')).toBe('met')
  })

  it('is not met when only the wpm or only the accuracy is short', () => {
    const { container } = show({
      results: { 'chapter-test': [result('5-test', false, [0.8, 40]), result('7-test', false, [0.99, 19.9])] },
    })
    expect(row(container, 5).getAttribute('data-state')).toBe('not-yet')
    expect(row(container, 7).getAttribute('data-state')).toBe('not-yet')
  })

  it('says met when a run passed even though the best-ranked run does not show it (the app clears the chapter then)', () => {
    const { container } = show({ results: { 'chapter-test': [result('5-test', true, [0.99, 9])] } })
    expect(row(container, 5).getAttribute('data-state')).toBe('met')
    const other = row(container, 5).querySelector('.ladder__other')!
    expect(other.textContent).toBe('passed on another run')
    expect(other.parentElement!.querySelector('.ladder__verdict')!.textContent).toBe('met') // next to the word met
    expect(row(container, 5).querySelector('.ladder__need')!.textContent).toContain('another run passed')
    expect(text(row(container, 5))).toContain('9 wpm')
  })

  it('does not say another run when the best result itself is at the mark', () => {
    const { container } = show({ results: { 'chapter-test': [result('5-test', true, [0.94, 12])] } })
    expect(text(row(container, 5))).not.toContain('another run')
    expect(row(container, 5).querySelector('.ladder__other')).toBeNull()
  })

  describe('says what a not-yet result falls short of, in the requirement line', () => {
    const shorts = (c: Element, n: number): string[] => [...row(c, n).querySelectorAll('.ladder__short')].map((e) => e.textContent!)

    it('accuracy short, speed fine: needs 90% accuracy', () => {
      const { container } = show({ results: { 'chapter-test': [result('5-test', false, [0.82, 30])] } })
      expect(shorts(container, 5)).toEqual(['needs 90% accuracy'])
      expect(row(container, 5).querySelector('.ladder__need')!.textContent).toBe('needs 90% accuracy')
    })

    it('speed short, accuracy fine: needs 10 wpm, with the mark of the chapter', () => {
      const { container } = show({ results: { 'chapter-test': [result('5-test', false, [0.95, 8]), result('7-test', false, [0.95, 15])] } })
      expect(shorts(container, 5)).toEqual(['needs 10 wpm'])
      expect(shorts(container, 7)).toEqual(['needs 20 wpm'])
    })

    it('both short: both are said', () => {
      const { container } = show({ results: { 'chapter-test': [result('5-test', false, [0.82, 8])] } })
      expect(shorts(container, 5)).toEqual(['needs 90% accuracy', 'needs 10 wpm'])
    })

    it('uses the raw numbers: 9.96 wpm is still short of 10, and 89.6% of 90%', () => {
      const { container } = show({ results: { 'chapter-test': [result('5-test', false, [0.95, 9.96]), result('7-test', false, [0.896, 25])] } })
      expect(shorts(container, 5)).toEqual(['needs 10 wpm'])
      expect(shorts(container, 7)).toEqual(['needs 90% accuracy'])
    })

    it('is amber through its class, and absent for met, untried and when nothing is short', () => {
      const { container } = show({ results: { 'chapter-test': [result('5-test', true, [0.94, 12])] } })
      expect(shorts(container, 5)).toEqual([])
      expect(shorts(container, 7)).toEqual([])
      expect(text(row(container, 5).querySelector('.ladder__need')!)).toBe('mark: 90% and 10 wpm')
    })

    it('says the accuracy for Chapter 4 when that is short, and nothing extra when only its time limit failed', () => {
      const low = show({ results: { stage0: [result('pseudo-test', false, [0.8, 12])] } })
      expect(shorts(low.container, 4)).toEqual(['needs 90% accuracy'])
      cleanup()
      const slow = show({ results: { stage0: [result('pseudo-test', false, [0.97, 12])] } })
      expect(shorts(slow.container, 4)).toEqual([])
      expect(text(row(slow.container, 4).querySelector('.ladder__need')!)).toBe('needs 90% within 10 minutes')
    })
  })

  it('judges Chapter 4 by its stored pass (accuracy within the time limit), not by a wpm', () => {
    const passed = show({ results: { stage0: [result('pseudo-test', true, [0.93, 3])] } })
    expect(row(passed.container, 4).getAttribute('data-state')).toBe('met')
    expect(text(row(passed.container, 4))).toContain('3 wpm · 93%')
    expect(text(row(passed.container, 4))).toContain('mark: 90% within 10 minutes')
    expect(text(row(passed.container, 4))).not.toContain('needs')
    cleanup()
    const slow = show({ results: { stage0: [result('pseudo-test', false, [0.97, 30])] } })
    expect(row(slow.container, 4).getAttribute('data-state')).toBe('not-yet')
    expect(row(slow.container, 4).querySelector('.ladder__verdict')!.textContent).toBe('not yet')
  })

  it('shows 89.6% against the 90% mark of Chapter 4 as not yet', () => {
    const { container } = show({ results: { stage0: [result('pseudo-test', false, [0.896, 12])] } })
    expect(text(row(container, 4))).toContain('89.6%')
  })

  it('says not tried yet for a chapter with no attempt, with no verdict word', () => {
    const { container } = show({ results: { 'chapter-test': [result('5-test', true, [0.94, 12])] } })
    expect(text(row(container, 7))).toContain('not tried yet')
    expect(row(container, 7).getAttribute('data-state')).toBe('untried')
    expect(row(container, 7).querySelector('.ladder__verdict')).toBeNull()
    expect(row(container, 7).querySelector('.ladder__fill')).toBeNull()
    expect(text(row(container, 4))).toContain('not tried yet')
    expect(text(row(container, 5))).not.toContain('not tried yet')
  })

  it('says not tried yet for a section whose runs have no best result', () => {
    const { container } = show({ results: { 'chapter-test': [result('5-test', false, null)] } })
    expect(row(container, 5).getAttribute('data-state')).toBe('untried')
  })

  it('shows the mark in words: needs ... until it is met, then mark: ...', () => {
    const { container } = show()
    expect(text(row(container, 5))).toContain('needs 90% and 10 wpm')
    expect(text(row(container, 7))).toContain('needs 90% and 20 wpm')
  })

  it('says mark: 90% and 10 wpm, not needs, for a met row; needs ... for not yet and not tried yet', () => {
    const { container } = show({
      results: { 'chapter-test': [result('5-test', true, [0.94, 12]), result('7-test', false, [0.95, 15])] },
    })
    const need = (n: number): string => row(container, n).querySelector('.ladder__need')!.textContent!
    expect(row(container, 5).getAttribute('data-state')).toBe('met')
    expect(need(5)).toBe('mark: 90% and 10 wpm')
    expect(text(row(container, 5))).not.toContain('needs')
    expect(row(container, 7).getAttribute('data-state')).toBe('not-yet')
    expect(need(7)).toBe('needs 20 wpm')
    expect(row(container, 4).getAttribute('data-state')).toBe('untried')
    expect(need(4)).toBe('needs 90% within 10 minutes')
    // met on another run: the mark still reads as a mark
    cleanup()
    const other = show({ results: { 'chapter-test': [result('5-test', true, [0.85, 8])] } })
    expect(row(other.container, 5).querySelector('.ladder__need')!.textContent).toMatch(/^mark: 90% and 10 wpm/)
  })

  it('does not read a result of another list as the chapter test', () => {
    const { container } = show({ results: { 'chapter-test': [result('7-test', true, [0.95, 25])], section: [result('5-test', true, [0.95, 25])] } })
    expect(row(container, 5).getAttribute('data-state')).toBe('untried')
    expect(row(container, 7).getAttribute('data-state')).toBe('met')
  })
})

describe('Ladder: the bars', () => {
  const widthOf = (el: Element | null): string => (el as HTMLElement).style.width
  const leftOf = (el: Element | null): string => (el as HTMLElement).style.left

  it('draws the best wpm against the mark on a scale that is max(best, mark) rounded up, with a tick at the mark', () => {
    const { container } = show({ results: { 'chapter-test': [result('5-test', true, [0.94, 12]), result('7-test', false, [0.95, 15])] } })
    // ch 5: scale 15 (12 rounded up to a multiple of 5); fill 80%, mark 10/15
    expect(widthOf(row(container, 5).querySelector('.ladder__fill'))).toBe('80%')
    expect(leftOf(row(container, 5).querySelector('.ladder__mark'))).toBe('66.67%')
    // ch 7: scale 20 (the mark 20 is the larger); fill 75%, mark at 100%
    expect(widthOf(row(container, 7).querySelector('.ladder__fill'))).toBe('75%')
    expect(leftOf(row(container, 7).querySelector('.ladder__mark'))).toBe('100%')
  })

  it('keeps the fill within the bar when the best is far above the mark', () => {
    const { container } = show({ results: { 'chapter-test': [result('5-test', true, [0.94, 61])] } })
    expect(widthOf(row(container, 5).querySelector('.ladder__fill'))).toBe('93.85%') // 61 / 65
    expect(leftOf(row(container, 5).querySelector('.ladder__mark'))).toBe('15.38%')
  })

  it('names what the bar shows for a screen reader', () => {
    const { container } = show({ results: { 'chapter-test': [result('5-test', true, [0.94, 12])] } })
    const bar = row(container, 5).querySelector('.ladder__bar')!
    expect(bar.getAttribute('role')).toBe('img')
    expect(bar.getAttribute('aria-label')).toBe('Chapter 5: best 12 wpm, the mark is 10 wpm')
  })

  it('colours by the verdict through classes (tokens in the stylesheet)', () => {
    const { container } = show({ results: { 'chapter-test': [result('5-test', true, [0.94, 12]), result('7-test', false, [0.95, 15])] } })
    expect(row(container, 5).querySelector('.ladder__bar')!.classList.contains('ladder__bar--met')).toBe(true)
    expect(row(container, 7).querySelector('.ladder__bar')!.classList.contains('ladder__bar--not-yet')).toBe(true)
  })

  it('has no bar for Chapter 4, which has no wpm mark', () => {
    const { container } = show({ results: { stage0: [result('pseudo-test', true, [0.93, 20])] } })
    expect(row(container, 4).querySelector('.ladder__bar')).toBeNull()
  })
})

describe('Ladder: loading, errors and the numbers', () => {
  it('shows Loading… while the provider loads', () => {
    const { container } = show({ status: 'loading', chapters: [] })
    expect(screen.getByRole('heading', { name: 'Chapter tests (ignores the mode switch)' })).toBeTruthy()
    expect(screen.getByText('Loading…')).toBeTruthy()
    expect(rows(container)).toHaveLength(0)
  })

  it("says Couldn't load the chapter results. on an error, and Try again reloads", () => {
    const reload = vi.fn(async () => undefined)
    const { container } = show({ status: 'error', reload })
    expect(screen.getByText(/Couldn't load the chapter results\./)).toBeTruthy()
    expect(rows(container)).toHaveLength(0) // no verdict without results
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('has a table with every chapter test, tried or not', () => {
    const { container } = show({ results: { 'chapter-test': [result('5-test', true, [0.94, 12.4])] } })
    const details = container.querySelector('details.chart__numbers') as HTMLElement
    expect(within(details).getByText('Show the numbers')).toBeTruthy()
    const rowsOf = [...details.querySelectorAll('tbody tr')].map((tr) => [...tr.children].map((c) => c.textContent))
    expect(rowsOf).toEqual([
      ['Ch 4', '—', '—', '90% within 10 minutes', 'not tried yet'],
      ['Ch 5', '12 wpm', '94%', '90% and 10 wpm', 'met'],
      ['Ch 7', '—', '—', '90% and 20 wpm', 'not tried yet'],
    ])
    expect([...details.querySelectorAll('thead th')].map((c) => c.textContent)).toEqual(['Chapter', 'Best wpm', 'Best accuracy', 'Mark', 'Result'])
  })

  it('writes the table values with the same mark-aware rounding', () => {
    const { container } = show({ results: { 'chapter-test': [result('5-test', false, [0.896, 9.96])] } })
    const cells = [...container.querySelectorAll('details tbody tr')][1].children
    expect(cells[1].textContent).toBe('9.9 wpm')
    expect(cells[2].textContent).toBe('89.6%')
    expect(cells[4].textContent).toBe('not yet')
  })

  const odd: [string, [number, number]][] = [
    ['NaN', [Number.NaN, Number.NaN]],
    ['Infinity', [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY]],
    ['negative', [-1, -5]],
    ['zero', [0, 0]],
    ['huge', [1e300, Number.MAX_VALUE]],
  ]
  for (const [name, best] of odd) {
    it(`has no NaN or Infinity in attributes or text: ${name}`, () => {
      const { container } = show({ results: { 'chapter-test': [result('5-test', false, best), result('7-test', false, best)], stage0: [result('pseudo-test', false, best)] } })
      expect(badNumbers(container)).toEqual([])
    })
  }

  it('has none for a mark without a wpm or with a zero mark', () => {
    const chapters: ChapterInfo[] = [
      { chapter: 5, pageId: 'ch05', title: 'Chapter 5', gate: 'test', passMark: { accuracy: 0.9 }, testListId: '5-test', listIds: [] },
      { chapter: 7, pageId: 'ch07', title: 'Chapter 7', gate: 'test', passMark: { accuracy: 0, minWpm: 0 }, testListId: '7-test', listIds: [] },
      { chapter: 9, pageId: 'ch09', title: 'Chapter 9', gate: 'test', listIds: [] },
    ]
    const { container } = show({ chapters, results: { 'chapter-test': [result('5-test', true, [0.9, 12]), result('7-test', true, [0.5, 0])] } })
    expect(badNumbers(container)).toEqual([])
    expect(rows(container)).toHaveLength(3)
  })
})
