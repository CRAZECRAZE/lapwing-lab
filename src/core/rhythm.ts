// The rhythm of one run: how steadily the owner types, from the stroke rows the app already records.
// Pure: no DOM, no fetch, no Node.

export type RhythmStroke = { tsMs: number; correct: boolean; latencyMs: number }

export type RhythmOptions = {
  /** A gap longer than this is a break: the owner stepped away. Left out of everything below. */
  breakMs?: number
  /** A stall is a gap more than this many times the typical gap... */
  stallFactor?: number
  /** ...and at least this long. */
  stallMinMs?: number
  /** Fewer non-break gaps than this give no steadiness score. */
  minGaps?: number
}

export type RhythmGap = { ms: number; kind: 'normal' | 'stall' | 'break' }

export type Rhythm = {
  /** One gap per stroke, in order. */
  gaps: RhythmGap[]
  /** Median of the non-break gaps; null when there are none. It is 0 when most gaps are 0 (equal timestamps). */
  typicalGapMs: number | null
  stalls: number
  breaks: number
  /** Integer 0..100, null under `minGaps` non-break gaps or when the typical gap is 0 (no rhythm to score). */
  steadiness: number | null
  /** The run cut into four slices of equal active time; null with no active time or fewer than 4 strokes. */
  quarters: { activeMs: number; correct: number }[] | null
}

export const RHYTHM_DEFAULTS: Readonly<Required<RhythmOptions>> = Object.freeze({
  breakMs: 10_000,
  stallFactor: 2.5,
  stallMinMs: 1_000,
  minGaps: 10,
})

/** A usable number of milliseconds: finite and not negative (a clock that went backwards counts as 0). */
function clean(ms: number): number {
  return Number.isFinite(ms) && ms > 0 ? ms : 0
}

/** The q-th quantile (0..1) of an ascending list, interpolating between neighbours. */
function quantile(sorted: readonly number[], q: number): number {
  const pos = (sorted.length - 1) * q
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)
}

/**
 * Steadiness: the spread of the gaps relative to their typical size, as a robust coefficient of variation.
 * spread = interquartile range / 1.349 (the standard deviation a normal distribution with that IQR would have),
 * cv = spread / median, score = round(100 * (1 - min(1, cv))).
 * The IQR and the median ignore the extremes, so one stall among fifty gaps barely moves the score, while a run that
 * keeps swinging between quick and slow gaps does: gaps alternating 600 and 1200 give cv of about 0.49, a score near 51.
 * A perfectly even run scores 100. The result is always an integer from 0 to 100 (never NaN or Infinity): the
 * median is positive here and finite, so cv is finite, and it is clamped before scoring.
 */
function steadinessOf(sorted: readonly number[], median: number): number | null {
  if (!(median > 0)) return null
  const spread = (quantile(sorted, 0.75) - quantile(sorted, 0.25)) / 1.349
  const cv = spread / median
  if (!Number.isFinite(cv)) return 0
  return Math.max(0, Math.min(100, Math.round(100 * (1 - Math.min(1, cv)))))
}

export function runRhythm(strokes: readonly RhythmStroke[], opts: RhythmOptions = {}): Rhythm {
  const breakMs = opts.breakMs ?? RHYTHM_DEFAULTS.breakMs
  const stallFactor = opts.stallFactor ?? RHYTHM_DEFAULTS.stallFactor
  const stallMinMs = opts.stallMinMs ?? RHYTHM_DEFAULTS.stallMinMs
  const minGaps = opts.minGaps ?? RHYTHM_DEFAULTS.minGaps

  // The first stroke's gap is its own latency (time since its prompt appeared); later gaps are timestamp differences.
  const raw = strokes.map((s, i) => clean(i === 0 ? s.latencyMs : s.tsMs - strokes[i - 1].tsMs))
  const isBreak = raw.map((ms) => ms > breakMs)
  const kept = raw.filter((_, i) => !isBreak[i]).sort((a, b) => a - b)

  const typicalGapMs = kept.length > 0 ? quantile(kept, 0.5) : null
  const gaps: RhythmGap[] = raw.map((ms, i) => {
    if (isBreak[i]) return { ms, kind: 'break' }
    const stall = typicalGapMs !== null && ms > stallFactor * typicalGapMs && ms >= stallMinMs
    return { ms, kind: stall ? 'stall' : 'normal' }
  })
  const stalls = gaps.filter((g) => g.kind === 'stall').length
  const breaks = gaps.length - kept.length

  const steadiness = typicalGapMs !== null && kept.length >= minGaps ? steadinessOf(kept, typicalGapMs) : null

  // Quarters: slice k holds the cumulative active time in (k/4, (k+1)/4] of the total (the first slice also holds 0).
  // A stroke goes to the slice holding the end of its gap; a break stroke adds no time and sits where the run is.
  const active = kept.reduce((a, b) => a + b, 0)
  let quarters: Rhythm['quarters'] = null
  if (active > 0 && strokes.length >= 4) {
    quarters = Array.from({ length: 4 }, () => ({ activeMs: 0, correct: 0 }))
    let cumulative = 0
    strokes.forEach((s, i) => {
      if (!isBreak[i]) cumulative += raw[i]
      const slice = Math.max(0, Math.min(3, Math.ceil((cumulative * 4) / active) - 1))
      if (!isBreak[i]) quarters![slice].activeMs += raw[i]
      if (s.correct) quarters![slice].correct += 1
    })
  }

  return { gaps, typicalGapMs, stalls, breaks, steadiness, quarters }
}

/**
 * Estimated words per minute in each quarter: the run's completed words shared across the slices in proportion to
 * their correct strokes, divided by the slice's active minutes. Null for a slice with no correct strokes or no active time.
 */
export function quarterWpm(r: Rhythm, completedWords: number): (number | null)[] {
  const none = [null, null, null, null]
  if (!r.quarters || !Number.isFinite(completedWords)) return none
  const totalCorrect = r.quarters.reduce((a, q) => a + q.correct, 0)
  if (totalCorrect === 0) return none
  const words = Math.max(0, completedWords)
  return r.quarters.map((q) => {
    if (q.correct === 0 || !(q.activeMs > 0)) return null
    return (words * (q.correct / totalCorrect)) / (q.activeMs / 60_000)
  })
}
