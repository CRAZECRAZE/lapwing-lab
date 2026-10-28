import { nearestStroke } from './review.ts'
import { maskToSlots, SLOTS } from './steno.ts'
import type { Slot } from './steno.ts'

/** A key needs this many required presses before the page ranks it. */
export const MIN_KEY_PRESSES = 30
/** A mix-up needs this many occurrences before the page lists it. */
export const MIN_MIXUP_COUNT = 3

export type KeyStat = { slot: Slot; required: number; missed: number }
export type Mixup = { pressed: Slot; needed: Slot; count: number }
/** One group of identical strokes from the archive: `n` strokes with the same expected outlines and pressed keys. */
export type KeyRowInput = { expected: readonly string[]; pressedMask: number; correct: boolean; n: number }

/**
 * Per-key statistics and one-key-for-another mix-ups. The needed stroke of a correct row is the pressed mask;
 * of a wrong row it is the nearest accepted stroke (rows with none are skipped). The archive does not record
 * which stroke of a multi-stroke word was attempted, so for such words the needed stroke is the closest stroke
 * of any accepted outline.
 */
export function keyStats(rows: readonly KeyRowInput[]): { keys: KeyStat[]; mixups: Mixup[] } {
  const required = new Map<Slot, number>()
  const missed = new Map<Slot, number>()
  const mixups = new Map<string, Mixup>()
  const add = (map: Map<Slot, number>, slot: Slot, n: number) => map.set(slot, (map.get(slot) ?? 0) + n)

  for (const { expected, pressedMask, correct, n } of rows) {
    if (!Number.isInteger(n) || n <= 0 || !Number.isInteger(pressedMask)) continue
    const needed = correct ? pressedMask : nearestStroke(expected, pressedMask)
    if (needed === null) continue
    const neededSlots = maskToSlots(needed)
    for (const slot of neededSlots) add(required, slot, n)
    if (correct) continue
    const missing = maskToSlots(needed & ~pressedMask)
    const extra = maskToSlots(pressedMask & ~needed)
    for (const slot of missing) add(missed, slot, n)
    if (missing.length === 1 && extra.length === 1) {
      const key = `${extra[0]}|${missing[0]}`
      const known = mixups.get(key)
      if (known) known.count += n
      else mixups.set(key, { pressed: extra[0], needed: missing[0], count: n })
    }
  }

  const keys = SLOTS.filter((slot) => (required.get(slot) ?? 0) > 0).map((slot) => ({
    slot,
    required: required.get(slot) ?? 0,
    missed: missed.get(slot) ?? 0,
  }))
  const sorted = [...mixups.values()].sort(
    (a, b) => b.count - a.count || (a.pressed < b.pressed ? -1 : a.pressed > b.pressed ? 1 : 0) || (a.needed < b.needed ? -1 : a.needed > b.needed ? 1 : 0),
  )
  return { keys, mixups: sorted }
}
