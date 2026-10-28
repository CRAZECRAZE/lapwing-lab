import { maskToSlots, tryParseStroke } from './steno.ts'

/**
 * The number of `/`-separated strokes in an outline. An empty stroke ('/', 'A//B') still
 * counts as a stroke: it is what the outline text says, and the dictionary has no such outline.
 */
export function outlineStrokes(outline: string): number {
  return outline.split('/').length
}

/**
 * The total keys pressed for an outline: the keys of each stroke `tryParseStroke` accepts, and for a
 * stroke it rejects (digits written as digits, an empty stroke, a lone '-') the characters other
 * than '-'. Never throws. An empty stroke has no keys.
 */
export function outlineKeys(outline: string): number {
  let keys = 0
  for (const stroke of outline.split('/')) {
    const mask = tryParseStroke(stroke)
    keys += mask === null ? [...stroke].filter((ch) => ch !== '-').length : maskToSlots(mask).length
  }
  return keys
}

/** A total order: fewer strokes first, then fewer keys, then plain string order (not locale order). */
export function compareOutlines(a: string, b: string): number {
  const byStrokes = outlineStrokes(a) - outlineStrokes(b)
  if (byStrokes !== 0) return byStrokes
  const byKeys = outlineKeys(a) - outlineKeys(b)
  if (byKeys !== 0) return byKeys
  return a < b ? -1 : a > b ? 1 : 0
}
