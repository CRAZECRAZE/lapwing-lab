// The numbers behind the Progress page: per-day quality, key statistics and mix-ups, built from the archive.
// The server owns the heavy reads (every stroke of the range); only small aggregates leave this module.
import { runRhythm } from '../src/core/rhythm.ts'
import { firstShowings } from '../src/core/chaptertest.ts'
import { keyStats } from '../src/core/keystats.ts'
import type { KeyStat, Mixup } from '../src/core/keystats.ts'
import type { Archive, StrokeTiming } from './archive.ts'

export type StatsMode = 'free' | 'drills' | 'all'

export type DayQuality = {
  date: string
  runs: number
  words: number
  wpm: number | null
  accuracy: number | null
  steadiness: number | null
}

export type StatsResponse = {
  from: string
  to: string
  mode: StatsMode
  days: DayQuality[]
  keys: KeyStat[]
  mixups: Mixup[]
  allTimeStrokes: number
}

export const STATS_MODES: readonly StatsMode[] = ['free', 'drills', 'all']

/** The response carries at most this many mix-ups (the most frequent); the page shows fewer. */
export const MAX_MIXUPS = 50

const DRILL_MODES = ['stage0', 'section', 'chapter-test']

function inMode(mode: StatsMode, runMode: string): boolean {
  if (mode === 'all') return true
  return mode === 'free' ? runMode === 'free' : DRILL_MODES.includes(runMode)
}

/** Median of a list (the mean of the two middle values when the count is even), rounded to an integer. */
function medianInt(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return Math.round(sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2)
}

/** First-showing flags for a chapter-test run's timings; null when a row lacks its outlines (then nothing is skipped). */
function freshFlags(run: StrokeTiming[]): boolean[] | null {
  const rows: { expected: string[]; pressedMask: number; correct: boolean }[] = []
  for (const t of run) {
    if (t.expected === undefined || t.pressedMask === undefined) return null
    rows.push({ expected: t.expected, pressedMask: t.pressedMask, correct: t.correct })
  }
  return firstShowings(rows)
}

type DayAcc = { runs: number; words: number; wpmSum: number; accuracySum: number; steadiness: number[] }

export function buildStats(archive: Archive, q: { from: string; to: string; mode: StatsMode }): StatsResponse {
  const { from, to, mode } = q

  // Finished, non-abandoned runs of the chosen mode with a wpm and an accuracy, by local date of the first stroke.
  const counted = new Map<number, string>() // run id -> date
  const modes = new Map<number, string>() // run id -> mode
  const days = new Map<string, DayAcc>()
  for (const r of archive.runsInRange(from, to)) {
    if (r.endedAt === null || r.abandoned || r.wpm === null || r.accuracy === null || !inMode(mode, r.mode)) continue
    counted.set(r.id, r.date)
    modes.set(r.id, r.mode)
    let day = days.get(r.date)
    if (!day) {
      day = { runs: 0, words: 0, wpmSum: 0, accuracySum: 0, steadiness: [] }
      days.set(r.date, day)
    }
    day.runs++
    day.words += r.words
    day.wpmSum += r.wpm * r.words
    day.accuracySum += r.accuracy * r.words
  }

  // The timings arrive ordered by test, then stroke: one pass cuts them into runs. These are large, so they stay local.
  if (counted.size > 0) {
    const timings = archive.timingsInRange(from, to)
    let start = 0
    for (let i = 1; i <= timings.length; i++) {
      if (i < timings.length && timings[i].testId === timings[start].testId) continue
      const date = counted.get(timings[start].testId)
      if (date !== undefined) {
        const run = timings.slice(start, i)
        // A chapter test shows each word several times; its first showings (still being read) are left out of steadiness.
        const fresh = modes.get(timings[start].testId) === 'chapter-test' ? freshFlags(run) : null
        const steadiness = runRhythm(fresh ? run.map((t, k) => ({ ...t, fresh: fresh[k] })) : run).steadiness
        if (steadiness !== null) days.get(date)?.steadiness.push(steadiness)
      }
      start = i
    }
  }

  const out: DayQuality[] = [...days.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, d]) => ({
      date,
      runs: d.runs,
      words: d.words,
      wpm: d.words > 0 ? d.wpmSum / d.words : null,
      accuracy: d.words > 0 ? d.accuracySum / d.words : null,
      steadiness: d.steadiness.length > 0 ? medianInt(d.steadiness) : null,
    }))

  // Keys and mix-ups always cover every mode, and the page's thresholds are not applied here.
  const { keys, mixups } = keyStats(archive.keyRowsInRange(from, to))
  return { from, to, mode, days: out, keys, mixups: mixups.slice(0, MAX_MIXUPS), allTimeStrokes: archive.allTimeStrokes() }
}

export function emptyStats(q: { from: string; to: string; mode: StatsMode }): StatsResponse {
  return { from: q.from, to: q.to, mode: q.mode, days: [], keys: [], mixups: [], allTimeStrokes: 0 }
}
