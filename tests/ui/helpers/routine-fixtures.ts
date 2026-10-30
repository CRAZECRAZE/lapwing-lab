// Shared fixtures for the routine suites: chapter progress where Chapter 5 is the one being taught, and test rows.
import type { ChapterInfo, PracticeIndexEntry } from '../../../scripts/build-content.ts'
import type { ProgressMark, TestSummary } from '../../../server/archive.ts'
import type { RoutineDoc, RoutineStep } from '../../../src/core/routine.ts'
import { chapterStates } from '../../../src/core/progress.ts'
import type { ResultsByMode } from '../../../src/core/progress.ts'
import type { Progress } from '../../../src/state/progress.tsx'

export const CHAPTERS: ChapterInfo[] = [
  {
    chapter: 4,
    pageId: 'ch04',
    title: 'Chapter 4',
    gate: 'stage0',
    passMark: { accuracy: 0.9, maxMinutes: 10 },
    listIds: [],
  },
  { chapter: 5, pageId: 'ch05', title: 'Chapter 5', gate: 'read', listIds: ['5-cvc', '5-ops'] },
  { chapter: 20, pageId: 'ch20', title: 'Chapter 20', gate: 'read', listIds: ['20-far'] },
]
export const INDEX: PracticeIndexEntry[] = [
  { id: '5-cvc', chapter: 5, items: 6 },
  { id: '5-ops', chapter: 5, items: 6 },
  { id: '20-far', chapter: 20, items: 6 },
]

/** Chapter 4 is cleared, so Chapter 5 is the one being taught: its lists are reached, Chapter 20's is not. */
export function progress(opts: { status?: Progress['status']; index?: PracticeIndexEntry[] } = {}): Progress {
  const status = opts.status ?? 'ready'
  const results: ResultsByMode = { stage0: [], section: [], 'chapter-test': [] }
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

export const STEPS: RoutineStep[] = [
  { kind: 'list', listId: '5-cvc' },
  { kind: 'free', source: 'ch-5', mode: 'words-25' },
  { kind: 'fixup', tab: 'words' },
  { kind: 'text', id: 'moby', part: 2 },
]

export const DOC: RoutineDoc = {
  routines: [
    { id: 'morning', name: 'Morning', steps: STEPS },
    { id: 'evening', name: 'Evening', steps: [{ kind: 'fixup', tab: 'patterns' }] },
  ],
  active: 'morning',
}

export const TEXTS = [{ id: 'moby', name: 'Moby Dick', chars: 100 }]

/** A test row for `listTests`; finished unless `endedAt` says otherwise. */
export function testRow(mode: string, section: string | null, over: Partial<TestSummary> = {}): TestSummary {
  return {
    id: 1,
    sessionId: 1,
    startedAt: 1,
    endedAt: 2,
    mode,
    chapter: null,
    section,
    itemCount: 25,
    wpm: 40,
    accuracy: 0.9,
    meta: {},
    strokeCount: 10,
    firstStrokeAt: 1,
    lastStrokeAt: 2,
    ...over,
  }
}
