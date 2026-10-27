import type { DrillItem } from '../core/drill.ts'
import type { Stage0Words } from '../../scripts/lib/stage0.ts'

export type Stage0Drill = {
  id: string
  title: string
  kind: 'stroke'
  items: DrillItem[]
  passMark?: { accuracy: number; maxMinutes: number }
  /** Row drills only: `items` holds this many shuffled repetitions of the same keys. */
  repeats?: number
}

/** What the Chapter 4 panel needs to list a drill before any word list has loaded. */
export type Stage0Info = Pick<Stage0Drill, 'id' | 'title' | 'passMark'>

const REPEATS = 5

/** Fisher-Yates on a copy; `random` returns a number in [0, 1). */
export function shuffle<T>(items: readonly T[], random: () => number = Math.random): T[] {
  const out = items.slice()
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/** `items` repeated `times` times, each repetition shuffled on its own. */
export function repeat(items: DrillItem[], times: number, random: () => number = Math.random): DrillItem[] {
  const out: DrillItem[] = []
  for (let n = 0; n < times; n++) out.push(...shuffle(items, random))
  return out
}

const keyItems = (keys: string[]): DrillItem[] => keys.map((key) => ({ prompt: key, outlines: [key] }))

function rowDrill(id: string, title: string, keys: string[]): Stage0Drill {
  return { id, title, kind: 'stroke', items: repeat(keyItems(keys), REPEATS), repeats: REPEATS }
}

export const ROW_DRILLS: Stage0Drill[] = [
  rowDrill('rows-left-bottom', 'Left hand, bottom row (S K W R)', ['S', 'K', 'W', 'R']),
  rowDrill('rows-right-bottom', 'Right hand, bottom row (-R -B -G -S -Z)', ['-R', '-B', '-G', '-S', '-Z']),
  rowDrill('rows-left-top', 'Left hand, top row (# T P H)', ['#', 'T', 'P', 'H']),
  rowDrill('rows-right-top', 'Right hand, top row (-F -P -L -T -D)', ['-F', '-P', '-L', '-T', '-D']),
  rowDrill('rows-vowels', 'Vowels (A O E U)', ['A', 'O', 'E', 'U']),
  rowDrill('rows-star', 'The star (*)', ['*']),
]

const TEST_PASS_MARK = { accuracy: 0.9, maxMinutes: 10 }

/** The nine drills of Chapter 4, in the order the panel lists them. */
export const STAGE0_INFO: Stage0Info[] = [
  ...ROW_DRILLS.map(({ id, title }) => ({ id, title })),
  { id: 'pseudo-test', title: 'Chapter 4 test — 100 words', passMark: TEST_PASS_MARK },
  { id: 'pseudo-extra-1', title: 'Extra practice 1 — 99 words' },
  { id: 'pseudo-extra-2', title: 'Extra practice 2 — 82 words' },
]

const wordItems = (words: string[]): DrillItem[] => words.map((word) => ({ prompt: word, outlines: [word] }))

export function buildStage0Drills(words: Stage0Words): Stage0Drill[] {
  const lists = [words.test, ...words.extra]
  return [
    ...ROW_DRILLS,
    ...STAGE0_INFO.slice(ROW_DRILLS.length).map((info, i): Stage0Drill => ({
      ...info,
      kind: 'stroke',
      items: wordItems(lists[i] ?? []),
    })),
  ]
}

/**
 * The items for one attempt, reshuffled each time (the book says "Shuffle words"):
 * the exported lists stay in book order and a row drill's repetitions stay whole.
 */
export function itemsForRun(drill: Stage0Drill, random: () => number = Math.random): DrillItem[] {
  if (drill.repeats === undefined) return shuffle(drill.items, random)
  return repeat(drill.items.slice(0, drill.items.length / drill.repeats), drill.repeats, random)
}
