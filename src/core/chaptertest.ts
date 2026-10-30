import type { ChapterInfo } from '../../scripts/build-content.ts'
import { shuffle } from '../stage0/lists.ts'
import { DrillSession } from './drill.ts'
import type { DrillItem } from './drill.ts'

/** The book's chapter test: this many random words from the chapter's test list, each shown this many times in a row. */
export const CHAPTER_TEST = { words: 45, repetitions: 3 } as const

/** Spec 4.1: the pass accuracy of a chapter's practice drills. */
const DRILLS_ACCURACY = 0.9

/** `[a, a, a, b, b, b, ...]` from a random pick of the distinct prompts in `items`. */
export function buildChapterTest(items: readonly DrillItem[], random: () => number = Math.random): DrillItem[] {
  const seen = new Set<string>()
  const distinct = items.filter((item) => {
    if (seen.has(item.prompt)) return false
    seen.add(item.prompt)
    return true
  })
  return shuffle(distinct, random)
    .slice(0, CHAPTER_TEST.words)
    .flatMap((item) => Array.from({ length: CHAPTER_TEST.repetitions }, () => item))
}

/** The pass mark a chapter's drill is judged by, or `undefined` when it has none. */
export function drillPassMark(
  info: ChapterInfo,
): { accuracy: number; maxMinutes?: number; minWpm?: number } | undefined {
  const pm = info.passMark
  switch (info.gate) {
    case 'stage0':
      if (!pm) return undefined
      return { accuracy: pm.accuracy, ...(pm.maxMinutes !== undefined ? { maxMinutes: pm.maxMinutes } : {}) }
    case 'test':
      if (!pm) return undefined
      return { accuracy: pm.accuracy, ...(pm.minWpm !== undefined ? { minWpm: pm.minWpm } : {}) }
    case 'drills':
      return { accuracy: DRILLS_ACCURACY }
    case 'read':
      return undefined
  }
}

/**
 * One flag per stroke row: true when the stroke belongs to a first showing of a word in a chapter test (the owner is
 * still reading the word). The rows are replayed through a `DrillSession`, one item at a time: a `correct` result ends
 * the item, `partial` and `miss` continue it. Item k (0-based) is a first showing when `k % repetitions === 0`. A row
 * whose expected outlines differ from the current item's starts a new item (the old one was left unfinished), and so
 * does a row whose outlines cannot be replayed (it counts as an item of one stroke).
 */
export function firstShowings(
  strokes: readonly { expected: string[]; pressedMask: number }[],
  repetitions: number = CHAPTER_TEST.repetitions,
): boolean[] {
  const every = Math.max(1, Math.floor(repetitions) || 1)
  const flags: boolean[] = []
  let session: DrillSession | null = null
  let outlines: readonly string[] = []
  let item = -1
  for (const row of strokes) {
    const same =
      session !== null && row.expected.length === outlines.length && row.expected.every((o, i) => o === outlines[i])
    if (!same) {
      item++
      outlines = row.expected
      try {
        session = new DrillSession([{ prompt: row.expected.join(' '), outlines: [...row.expected] }])
      } catch {
        session = null
      }
    }
    flags.push(item % every === 0)
    if (session === null) continue
    const result = session.submit({ levers: [], mask: row.pressedMask })
    if (result.kind === 'correct') session = null
  }
  return flags
}
