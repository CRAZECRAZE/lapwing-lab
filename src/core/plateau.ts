// Plateau detector: has the typing speed held flat for several weeks? Pure: no DOM, no Node.

import type { DayQuality } from '../../server/stats.ts'
import { daysBetween, medianInt } from './progressview.ts'

export type Plateau = {
  /** Counted weeks in the plateau, this one included. */
  weeks: number
  /** This week's words-per-minute. */
  thisWeek: number
  /** The most recent other counted weeks in the plateau, at most two, most recent first. */
  others: number[]
  /** Quality figures that rose since the oldest counted week of the plateau. */
  meanwhile: { steadiness?: { from: number; to: number }; accuracy?: { from: number; to: number } }
}

const WEEKS = 8
const MIN_WEEKS = 3
const MIN_RUNS = 2
const MAX_OTHERS = 2
const STEADINESS_RISE = 3
const ACCURACY_RISE = 1.5 // percent points
const EPS = 1e-9

type Week = { wpm: number | null; accuracy: number | null; steadiness: number | null }

function finite(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n)
}

/** Words-weighted mean of a field over days, or null when no day has both a value and words. */
function weighted(days: DayQuality[], field: 'wpm' | 'accuracy'): number | null {
  let sum = 0
  let weight = 0
  for (const d of days) {
    const v = d[field]
    if (!finite(v) || !finite(d.words) || d.words <= 0) continue
    sum += v * d.words
    weight += d.words
  }
  return weight > 0 ? sum / weight : null
}

function summarise(days: DayQuality[]): Week {
  let runs = 0
  for (const d of days) if (finite(d.runs) && d.runs > 0) runs += d.runs
  const steady = days.map((d) => d.steadiness).filter(finite)
  return {
    wpm: runs >= MIN_RUNS ? weighted(days, 'wpm') : null,
    accuracy: weighted(days, 'accuracy'),
    steadiness: steady.length > 0 ? medianInt(steady) : null,
  }
}

const round1 = (n: number) => Math.round(n * 10) / 10

/** Eight 7-day weeks end today; week 0 is the latest. Returns the plateau, or null when there is none. */
export function detectPlateau(days: readonly DayQuality[], today: string): Plateau | null {
  const buckets: DayQuality[][] = Array.from({ length: WEEKS }, () => [])
  for (const d of days) {
    const ago = daysBetween(d.date, today)
    if (!Number.isInteger(ago) || ago < 0 || ago >= WEEKS * 7) continue
    buckets[Math.floor(ago / 7)].push(d)
  }
  const weeks = buckets.map(summarise)

  const current = weeks[0]
  if (current.wpm === null) return null
  const tolerance = Math.max(2, 0.04 * current.wpm)

  // Counted weeks within tolerance, from this week back; gaps are skipped, an outlier ends the run.
  const counted: Week[] = [current]
  for (let k = 1; k < WEEKS; k++) {
    const w = weeks[k]
    if (w.wpm === null) continue
    if (Math.abs(w.wpm - current.wpm) > tolerance + EPS) break
    counted.push(w)
  }
  if (counted.length < MIN_WEEKS) return null

  const oldest = counted[counted.length - 1]
  const meanwhile: Plateau['meanwhile'] = {}
  if (current.steadiness !== null && oldest.steadiness !== null && current.steadiness - oldest.steadiness >= STEADINESS_RISE) {
    meanwhile.steadiness = { from: oldest.steadiness, to: current.steadiness }
  }
  if (current.accuracy !== null && oldest.accuracy !== null) {
    const from = round1(oldest.accuracy * 100)
    const to = round1(current.accuracy * 100)
    if (to - from >= ACCURACY_RISE - EPS) meanwhile.accuracy = { from, to }
  }

  return {
    weeks: counted.length,
    thisWeek: current.wpm,
    others: counted.slice(1, 1 + MAX_OTHERS).map((w) => w.wpm as number),
    meanwhile,
  }
}
