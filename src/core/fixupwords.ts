import type { DrillItem } from './drill.ts'
import { parseOutline, slotMask } from './steno.ts'
import type { Slot } from './steno.ts'

/** At most this many words are drilled per pattern. */
export const PATTERN_WORDS = 12
/** A pattern with fewer drillable words than this cannot be ticked; the caller decides. */
export const MIN_PATTERN_WORDS = 4

/** The items of one practice list and the chapter it belongs to. */
export type ListWords = { chapter: number; items: readonly DrillItem[] }

/** True when any stroke of any accepted outline presses `key`. An unparseable outline never matches. */
function usesKey(item: DrillItem, key: number): boolean {
  return item.outlines.some((outline) => {
    try {
      return parseOutline(outline).some((stroke) => (stroke & key) !== 0)
    } catch {
      return false
    }
  })
}

function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/**
 * Up to `PATTERN_WORDS` words to drill a pattern's needed key: items with an accepted outline stroke containing the key,
 * from lists of chapters up to `reachedChapter`. Each list is shuffled, then words are taken one list at a time in turn
 * so no list dominates. A prompt appears once.
 */
export function patternWords(
  needed: Slot,
  lists: readonly ListWords[],
  reachedChapter: number,
  random: () => number = Math.random,
): DrillItem[] {
  const key = slotMask(needed)
  const queues = lists
    .filter((list) => list.chapter <= reachedChapter)
    .map((list) => shuffled(list.items.filter((item) => usesKey(item, key)), random))
  const out: DrillItem[] = []
  const seen = new Set<string>()
  for (let round = 0; out.length < PATTERN_WORDS && queues.some((q) => round < q.length); round++) {
    for (const queue of queues) {
      if (out.length >= PATTERN_WORDS) break
      const item = queue[round]
      if (!item || seen.has(item.prompt)) continue
      seen.add(item.prompt)
      out.push(item)
    }
  }
  return out
}
