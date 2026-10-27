/**
 * Scores shown next to a pass mark.
 *
 * Whole numbers, as everywhere else, except when the rounded value reaches the mark but the real one does not:
 * then one decimal, floored to 0.1, so `Not yet` never sits beside a rounded number that looks like a pass.
 * Judging itself always uses the raw numbers.
 */

/** Absorbs float noise (0.29 * 100 is 28.999999999999996) without moving a value across a tenth. */
const EPSILON = 1e-6

/** `value` floored to one decimal; never reaches `limit` (a value just below the mark must stay below it). */
function floorTenth(value: number, limit: number): number {
  const tenths = Math.floor(value * 10 + EPSILON)
  const floored = tenths / 10
  return floored >= limit ? Math.floor(value * 10) / 10 : floored
}

/** `90%` or, when it is just below `mark` (0..1) but would round up to it, `89.6%`. No mark: plain rounding. */
export function formatAccuracy(accuracy: number, mark?: number): string {
  const percent = accuracy * 100
  const rounded = Math.round(percent)
  if (mark !== undefined && accuracy < mark && rounded >= mark * 100 - EPSILON) {
    return `${floorTenth(percent, mark * 100).toFixed(1)}%`
  }
  return `${rounded}%`
}

/** `10 wpm` or, when it is just below `mark` but would round up to it, `9.6 wpm`. No mark: plain rounding. */
export function formatWpm(wpm: number, mark?: number): string {
  const rounded = Math.round(wpm)
  if (mark !== undefined && wpm < mark && rounded >= mark) {
    return `${floorTenth(wpm, mark).toFixed(1)} wpm`
  }
  return `${rounded} wpm`
}
