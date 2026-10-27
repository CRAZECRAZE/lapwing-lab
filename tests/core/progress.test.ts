import { describe, expect, it } from 'vitest'
import {
  blockingChapters,
  chapterList,
  chapterStates,
  currentChapter,
  requirementText,
  taughtChapter,
} from '../../src/core/progress.ts'
import type { ChapterState, ResultsByMode } from '../../src/core/progress.ts'
import type { ChapterInfo } from '../../scripts/build-content.ts'
import type { ProgressMark, SectionResult } from '../../server/archive.ts'

const CHAPTERS: ChapterInfo[] = [
  { chapter: 4, pageId: 'c4', title: 'Four', gate: 'stage0', passMark: { accuracy: 0.9, maxMinutes: 10 }, listIds: [] },
  {
    chapter: 5,
    pageId: 'c5',
    title: 'Five',
    gate: 'test',
    passMark: { accuracy: 0.9, minWpm: 10, maxWpm: 15 },
    testListId: '5-test',
    listIds: ['5-a'],
  },
  {
    chapter: 6,
    pageId: 'c6',
    title: 'Six',
    gate: 'test',
    passMark: { accuracy: 0.9, minWpm: 5 },
    testListId: '6-test',
    listIds: ['6-a'],
  },
  { chapter: 12, pageId: 'c12', title: 'Twelve', gate: 'drills', listIds: ['12-a', '12-b'] },
  { chapter: 18, pageId: 'c18', title: 'Eighteen', gate: 'read', listIds: [] },
]

function res(section: string, passed: boolean): SectionResult {
  return { section, runs: 1, passed, best: { accuracy: 0.95, wpm: 12 }, last: null }
}

function results(r: Partial<ResultsByMode> = {}): ResultsByMode {
  return { stage0: [], section: [], 'chapter-test': [], ...r }
}

function mark(chapter: number, kind: 'read' | 'override'): ProgressMark {
  return { chapter, kind, at: 1 }
}

const STAGE0_PASSED = results({ stage0: [res('pseudo-test', true)] })

describe('chapterStates', () => {
  it('with nothing done, chapter 4 is open and the rest are locked behind it', () => {
    const s = chapterStates(CHAPTERS, results(), [])
    expect(s.get(4)).toEqual({ chapter: 4, cleared: false, locked: false })
    for (const n of [5, 6, 12, 18]) {
      expect(s.get(n)).toEqual({ chapter: n, cleared: false, locked: true, blockedBy: 4 })
    }
  })

  it('a passed Stage 0 clears chapter 4 as passed and opens 5', () => {
    const s = chapterStates(CHAPTERS, STAGE0_PASSED, [])
    expect(s.get(4)).toEqual({ chapter: 4, cleared: true, how: 'passed', locked: false })
    expect(s.get(5)?.locked).toBe(false)
    expect(s.get(6)).toMatchObject({ locked: true, blockedBy: 5 })
    expect(s.get(18)).toMatchObject({ locked: true, blockedBy: 5 })
  })

  it('an override mark on 5 clears it and opens 6', () => {
    const s = chapterStates(CHAPTERS, STAGE0_PASSED, [mark(5, 'override')])
    expect(s.get(5)).toMatchObject({ cleared: true, how: 'override', locked: false })
    expect(s.get(6)).toMatchObject({ cleared: false, locked: false })
    expect(s.get(12)).toMatchObject({ locked: true, blockedBy: 6 })
  })

  it('a chapter test pass clears a test gate as passed', () => {
    const r = results({ stage0: [res('pseudo-test', true)], 'chapter-test': [res('5-test', true)] })
    expect(chapterStates(CHAPTERS, r, []).get(5)).toMatchObject({ cleared: true, how: 'passed' })
  })

  it('a failed-only result never clears, and a result for another section does not either', () => {
    const r = results({
      stage0: [res('pseudo-test', false)],
      'chapter-test': [res('6-test', true), res('5-test', false)],
    })
    const s = chapterStates(CHAPTERS, r, [])
    expect(s.get(4)?.cleared).toBe(false)
    expect(s.get(5)?.cleared).toBe(false)
  })

  it('does not take a stage0 result for another section as the Stage 0 test', () => {
    const r = results({ stage0: [res('rows-left-bottom', true)] })
    expect(chapterStates(CHAPTERS, r, []).get(4)?.cleared).toBe(false)
  })

  it('drills need every list; one missing keeps the chapter uncleared', () => {
    const base = { stage0: [res('pseudo-test', true)] }
    const one = chapterStates(CHAPTERS, results({ ...base, section: [res('12-a', true)] }), [])
    expect(one.get(12)?.cleared).toBe(false)
    const failedOne = chapterStates(CHAPTERS, results({ ...base, section: [res('12-a', true), res('12-b', false)] }), [])
    expect(failedOne.get(12)?.cleared).toBe(false)
    const both = chapterStates(CHAPTERS, results({ ...base, section: [res('12-a', true), res('12-b', true)] }), [])
    expect(both.get(12)).toMatchObject({ cleared: true, how: 'drills' })
  })

  it('a read mark clears a read gate but not a test gate', () => {
    const s = chapterStates(CHAPTERS, STAGE0_PASSED, [mark(18, 'read'), mark(5, 'read')])
    expect(s.get(18)).toMatchObject({ cleared: true, how: 'read' })
    expect(s.get(5)).toMatchObject({ cleared: false })
  })

  it('an override mark clears a read gate with how override', () => {
    expect(chapterStates(CHAPTERS, results(), [mark(18, 'override')]).get(18)).toMatchObject({
      cleared: true,
      how: 'override',
    })
  })

  it('natural clearing wins over a mark', () => {
    const r = results({ stage0: [res('pseudo-test', true)] })
    expect(chapterStates(CHAPTERS, r, [mark(4, 'override')]).get(4)?.how).toBe('passed')
    const d = results({ section: [res('12-a', true), res('12-b', true)] })
    expect(chapterStates(CHAPTERS, d, [mark(12, 'override')]).get(12)?.how).toBe('drills')
  })

  it('chapters 1 to 3 never lock anything and are never locked', () => {
    const early: ChapterInfo[] = [
      { chapter: 1, pageId: 'c1', title: 'One', gate: 'read', listIds: [] },
      { chapter: 2, pageId: 'c2', title: 'Two', gate: 'read', listIds: [] },
      { chapter: 3, pageId: 'c3', title: 'Three', gate: 'read', listIds: [] },
      ...CHAPTERS,
    ]
    const s = chapterStates(early, STAGE0_PASSED, [])
    for (const n of [1, 2, 3, 4]) expect(s.get(n)?.locked).toBe(false)
    expect(s.get(5)).toMatchObject({ locked: false })
    expect(s.get(6)).toMatchObject({ locked: true, blockedBy: 5 })
    const nothing = chapterStates(early, results(), [])
    expect(nothing.get(5)).toMatchObject({ locked: true, blockedBy: 4 })
  })

  it('treats a missing mode key as an empty list', () => {
    const s = chapterStates(CHAPTERS, {} as ResultsByMode, [])
    expect(s.get(4)?.cleared).toBe(false)
  })
})

describe('currentChapter', () => {
  it('moves forward as chapters clear and stops at the last', () => {
    expect(currentChapter(CHAPTERS, chapterStates(CHAPTERS, results(), []))).toBe(4)
    expect(currentChapter(CHAPTERS, chapterStates(CHAPTERS, STAGE0_PASSED, []))).toBe(5)
    expect(currentChapter(CHAPTERS, chapterStates(CHAPTERS, STAGE0_PASSED, [mark(5, 'override')]))).toBe(6)
    const all = [mark(5, 'override'), mark(6, 'override'), mark(12, 'override'), mark(18, 'read')]
    expect(currentChapter(CHAPTERS, chapterStates(CHAPTERS, STAGE0_PASSED, all))).toBe(18)
  })

  it('skips chapters below 4 and works without chapter 4 in the list', () => {
    const list: ChapterInfo[] = [
      { chapter: 2, pageId: 'c2', title: 'Two', gate: 'read', listIds: [] },
      ...CHAPTERS.slice(1),
    ]
    expect(currentChapter(list, chapterStates(list, results(), []))).toBe(5)
  })
})

describe('taughtChapter', () => {
  it('is 4 when nothing is cleared and moves on as chapters clear', () => {
    expect(taughtChapter(CHAPTERS, chapterStates(CHAPTERS, results(), []))).toBe(4)
    expect(taughtChapter(CHAPTERS, chapterStates(CHAPTERS, STAGE0_PASSED, []))).toBe(5)
    expect(taughtChapter(CHAPTERS, chapterStates(CHAPTERS, STAGE0_PASSED, [mark(5, 'override')]))).toBe(6)
  })

  it('stops at the last chapter when everything is cleared', () => {
    const all = [mark(5, 'override'), mark(6, 'override'), mark(12, 'override'), mark(18, 'read')]
    expect(taughtChapter(CHAPTERS, chapterStates(CHAPTERS, STAGE0_PASSED, all))).toBe(18)
  })

  it('hides nothing (26) while progress is not ready', () => {
    expect(taughtChapter(CHAPTERS, new Map())).toBe(26)
  })

  it('hides nothing (26) when there are no chapters', () => {
    expect(taughtChapter([], chapterStates(CHAPTERS, results(), []))).toBe(26)
    expect(taughtChapter([], new Map())).toBe(26)
  })

  it('is never below 4, even when the list only has earlier chapters', () => {
    const early: ChapterInfo[] = [{ chapter: 2, pageId: 'c2', title: 'Two', gate: 'read', listIds: [] }]
    const states = chapterStates(early, results(), [])
    expect(currentChapter(early, states)).toBe(2)
    expect(taughtChapter(early, states)).toBe(4)
  })
})

describe('requirementText', () => {
  it('describes each gate', () => {
    expect(requirementText(CHAPTERS[0])).toBe('Pass the Chapter 4 test: 90% accuracy within 10 minutes')
    expect(requirementText(CHAPTERS[1])).toBe('Pass the chapter test: 90% accuracy and at least 10 wpm')
    expect(requirementText(CHAPTERS[2])).toBe('Pass the chapter test: 90% accuracy and at least 5 wpm')
    expect(requirementText(CHAPTERS[3])).toBe('Do each section drill once at 90% accuracy or better')
    expect(requirementText(CHAPTERS[4])).toBe('Read the chapter, then mark it as read')
  })

  it('handles the optional clauses', () => {
    const base = { chapter: 4, pageId: 'c4', title: 'Four', listIds: [] }
    expect(requirementText({ ...base, gate: 'stage0', passMark: { accuracy: 0.9, maxMinutes: 1 } })).toBe(
      'Pass the Chapter 4 test: 90% accuracy within 1 minute',
    )
    expect(requirementText({ ...base, gate: 'stage0', passMark: { accuracy: 0.85 } })).toBe(
      'Pass the Chapter 4 test: 85% accuracy',
    )
    expect(requirementText({ ...base, gate: 'test', passMark: { accuracy: 0.9 } })).toBe('Pass the chapter test: 90% accuracy')
    expect(requirementText({ ...base, gate: 'test' })).toBe('Pass the chapter test')
  })
})

/** A state map from `[chapter, cleared]` pairs; the lock fields do not matter to `blockingChapters`. */
function states(pairs: [number, boolean][]): Map<number, ChapterState> {
  return new Map(pairs.map(([chapter, cleared]) => [chapter, { chapter, cleared, locked: false }]))
}

describe('blockingChapters', () => {
  it('is empty when every chapter from 4 up to the one before is cleared', () => {
    expect(blockingChapters(states([[4, true], [5, true], [6, true], [7, false]]), 7)).toEqual([])
  })

  it('lists the one chapter that blocks', () => {
    expect(blockingChapters(states([[4, true], [5, false], [6, false]]), 6)).toEqual([5])
  })

  it('lists every uncleared chapter from 4 up to the one before, ascending', () => {
    const map = new Map([...states([[7, false], [6, false], [4, false], [5, false], [8, false]])])
    expect(blockingChapters(map, 8)).toEqual([4, 5, 6, 7])
  })

  it('skips the cleared chapters in between', () => {
    expect(blockingChapters(states([[4, true], [5, false], [6, true], [7, false], [8, false]]), 8)).toEqual([5, 7])
  })

  it('ignores chapters before 4, the chapter itself and the ones after it', () => {
    expect(blockingChapters(states([[1, false], [2, false], [3, false], [4, true], [5, false], [6, false], [7, false]]), 6)).toEqual([5])
  })

  it('skips a chapter number that has no state', () => {
    expect(blockingChapters(states([[4, true], [5, false], [7, false], [9, false]]), 9)).toEqual([5, 7])
  })

  it('is empty for an empty map (progress not ready: nothing is locked)', () => {
    expect(blockingChapters(new Map(), 7)).toEqual([])
  })

  it('is empty for chapter 4 and below', () => {
    const map = states([[1, false], [2, false], [3, false], [4, false]])
    expect(blockingChapters(map, 4)).toEqual([])
    expect(blockingChapters(map, 3)).toEqual([])
  })

  it('agrees with chapterStates on a real chain', () => {
    const chain = chapterStates(CHAPTERS, results(), [mark(6, 'override')])
    expect(blockingChapters(chain, 12)).toEqual([4, 5])
    expect(blockingChapters(chain, 18)).toEqual([4, 5, 12])
  })
})

describe('chapterList', () => {
  it('names one chapter', () => {
    expect(chapterList([5])).toBe('Chapter 5')
  })

  it('joins two with and', () => {
    expect(chapterList([5, 6])).toBe('Chapters 5 and 6')
  })

  it('joins three or more with commas and a final and', () => {
    expect(chapterList([5, 6, 7])).toBe('Chapters 5, 6 and 7')
    expect(chapterList([4, 5, 6, 12])).toBe('Chapters 4, 5, 6 and 12')
  })
})
