import type { ChapterInfo } from '../../scripts/build-content.ts'
import { shuffle } from '../stage0/lists.ts'
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
