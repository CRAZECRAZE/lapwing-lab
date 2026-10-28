import { describe, expect, it } from 'vitest'
import { quarterWpm, RHYTHM_DEFAULTS, runRhythm, type RhythmStroke } from '../../src/core/rhythm.ts'

const T0 = 1_700_000_000_000

/** A run whose i-th gap is gaps[i]: the first is the first stroke's latency, the rest are timestamp differences. */
function run(gaps: number[], correct: (i: number) => boolean = () => true): RhythmStroke[] {
  const strokes: RhythmStroke[] = []
  let ts = T0
  gaps.forEach((gap, i) => {
    if (i > 0) ts += gap
    strokes.push({ tsMs: ts, correct: correct(i), latencyMs: gap })
  })
  return strokes
}

const even = (n: number, ms = 600): number[] => Array.from({ length: n }, () => ms)
const alternating = (n: number): number[] => Array.from({ length: n }, (_, i) => (i % 2 === 0 ? 600 : 1200))
const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0)

function allFinite(value: unknown): boolean {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0
  if (Array.isArray(value)) return value.every(allFinite)
  if (value && typeof value === 'object') return Object.values(value).every(allFinite)
  return true
}

describe('RHYTHM_DEFAULTS', () => {
  it('holds the four documented defaults and cannot be changed', () => {
    expect(RHYTHM_DEFAULTS).toEqual({ breakMs: 10_000, stallFactor: 2.5, stallMinMs: 1_000, minGaps: 10 })
    expect(Object.isFrozen(RHYTHM_DEFAULTS)).toBe(true)
  })

  it('merges options over the defaults and ignores undefined', () => {
    const gaps = [...even(20), 3_000, ...even(5)]
    expect(runRhythm(run(gaps), { stallFactor: undefined, breakMs: undefined }).stalls).toBe(1)
    expect(runRhythm(run(gaps), { breakMs: 2_000 }).breaks).toBe(1)
    expect(runRhythm(run(gaps), { stallMinMs: 5_000 }).stalls).toBe(0)
    expect(runRhythm(run(gaps), { stallFactor: 10 }).stalls).toBe(0)
    expect(runRhythm(run(even(5)), { minGaps: 5 }).steadiness).toBe(100)
    expect(runRhythm(run(even(5))).steadiness).toBeNull()
  })
})

describe('runRhythm: an even run', () => {
  const r = runRhythm(run(even(60)))

  it('has a typical gap of 600, no stalls or breaks and a high steadiness', () => {
    expect(r.gaps).toHaveLength(60)
    expect(r.typicalGapMs).toBe(600)
    expect(r.stalls).toBe(0)
    expect(r.breaks).toBe(0)
    expect(r.steadiness).toBeGreaterThanOrEqual(95)
    expect(r.gaps.every((g) => g.kind === 'normal' && g.ms === 600)).toBe(true)
  })

  it('still scores high with a little natural jitter', () => {
    const jitter = Array.from({ length: 60 }, (_, i) => 600 + ((i * 37) % 11) * 12 - 60)
    expect(runRhythm(run(jitter)).steadiness).toBeGreaterThanOrEqual(85)
  })
})

describe('runRhythm: steadiness', () => {
  const evenScore = runRhythm(run(even(60))).steadiness as number

  it('drops by at least 15 points when every second gap is doubled, without stalls', () => {
    const r = runRhythm(run(alternating(60)))
    expect(r.stalls).toBe(0)
    expect(evenScore - (r.steadiness as number)).toBeGreaterThanOrEqual(15)
  })

  it('is hurt by at most 10 points by one stall among 49 gaps', () => {
    const r = runRhythm(run([...even(25), 4_000, ...even(24)]))
    expect(r.gaps).toHaveLength(50)
    expect(r.stalls).toBe(1)
    expect(r.gaps[25]).toEqual({ ms: 4_000, kind: 'stall' })
    expect(evenScore - (r.steadiness as number)).toBeLessThanOrEqual(10)
  })

  it('is hurt by at most 10 points by one stall in a jittery run too', () => {
    const jitter = Array.from({ length: 50 }, (_, i) => 600 + ((i * 37) % 11) * 12 - 60)
    const base = runRhythm(run(jitter)).steadiness as number
    const withStall = runRhythm(run([...jitter.slice(0, 25), 4_000, ...jitter.slice(26)]))
    expect(withStall.stalls).toBe(1)
    expect(base - (withStall.steadiness as number)).toBeLessThanOrEqual(10)
  })

  it('falls as the spread grows', () => {
    const wide = Array.from({ length: 60 }, (_, i) => (i % 3 === 0 ? 300 : i % 3 === 1 ? 600 : 1500))
    expect(runRhythm(run(wide)).steadiness as number).toBeLessThan(runRhythm(run(alternating(60))).steadiness as number)
  })

  it('is an integer from 0 to 100 even for wild runs', () => {
    const wild = Array.from({ length: 80 }, (_, i) => (i % 2 === 0 ? 1 : 9_900))
    const r = runRhythm(run(wild))
    expect(Number.isInteger(r.steadiness)).toBe(true)
    expect(r.steadiness).toBeGreaterThanOrEqual(0)
    expect(r.steadiness).toBeLessThanOrEqual(100)
    expect(r.steadiness).toBe(0)
  })

  it('stays finite with enormous gaps when breaks are switched off', () => {
    const huge = Array.from({ length: 40 }, (_, i) => (i % 2 === 0 ? 1 : 1e12))
    const r = runRhythm(run(huge), { breakMs: Infinity })
    expect(Number.isFinite(r.steadiness)).toBe(true)
    expect(r.steadiness).toBeGreaterThanOrEqual(0)
    expect(r.steadiness).toBeLessThanOrEqual(100)
    expect(allFinite(r.quarters)).toBe(true)
  })
})

describe('runRhythm: breaks', () => {
  const gaps = [...even(20), 12_000, ...even(20)]
  const strokes = run(gaps)
  const r = runRhythm(strokes)

  it('marks a gap over 10 seconds as a break, not a stall', () => {
    expect(r.breaks).toBe(1)
    expect(r.stalls).toBe(0)
    expect(r.gaps[20]).toEqual({ ms: 12_000, kind: 'break' })
  })

  it('leaves the break out of the typical gap and the steadiness', () => {
    expect(r.typicalGapMs).toBe(600)
    expect(r.steadiness).toBeGreaterThanOrEqual(95)
  })

  it('leaves the break out of the active time', () => {
    const active = sum(r.gaps.filter((g) => g.kind !== 'break').map((g) => g.ms))
    expect(active).toBe(40 * 600)
    expect(sum((r.quarters ?? []).map((q) => q.activeMs))).toBe(active)
    expect(sum((r.quarters ?? []).map((q) => q.correct))).toBe(gaps.length)
  })

  it('treats exactly the break limit as a normal gap', () => {
    const edge = runRhythm(run([...even(20), 10_000, ...even(5)]))
    expect(edge.breaks).toBe(0)
    expect(edge.gaps[20].ms).toBe(10_000)
    expect(edge.stalls).toBe(1)
  })

  it('has no typical gap, stalls or steadiness when every gap is a break', () => {
    const none = runRhythm(run([11_000, 12_000, 13_000, 14_000]))
    expect(none.breaks).toBe(4)
    expect(none.typicalGapMs).toBeNull()
    expect(none.stalls).toBe(0)
    expect(none.steadiness).toBeNull()
    expect(none.quarters).toBeNull()
  })
})

describe('runRhythm: stalls', () => {
  it('needs more than 2.5 times the typical gap', () => {
    const at = runRhythm(run([...even(20, 1_000), 2_500, ...even(5, 1_000)]))
    expect(at.stalls).toBe(0)
    const over = runRhythm(run([...even(20, 1_000), 2_501, ...even(5, 1_000)]))
    expect(over.stalls).toBe(1)
  })

  it('needs at least one second even when it is many times the typical gap', () => {
    const quick = runRhythm(run([...even(20, 100), 900, ...even(5, 100)]))
    expect(quick.stalls).toBe(0)
    const slow = runRhythm(run([...even(20, 100), 1_000, ...even(5, 100)]))
    expect(slow.stalls).toBe(1)
  })

  it('measures the stall threshold against the median gap, not the smallest gap', () => {
    // 10 x 300, 20 x 600, 10 x 1200 plus 1000 and 1600: the median is 600 (threshold 1500) while the smallest gap
    // is 300 (threshold 750), so only the 1600 gap is a stall; 1000 and the 1200s would be stalls against the minimum.
    const gaps = [...even(10, 300), ...even(10, 600), 1_000, ...even(10, 600), ...even(10, 1_200), 1_600]
    const r = runRhythm(run(gaps))
    expect(r.typicalGapMs).toBe(600)
    expect(r.stalls).toBe(1)
    expect(r.gaps.filter((g) => g.kind === 'stall').map((g) => g.ms)).toEqual([1_600])
  })

  it('counts every stall', () => {
    const r = runRhythm(run([...even(10), 3_000, ...even(10), 5_000, ...even(10), 2_000]))
    expect(r.stalls).toBe(3)
    expect(r.gaps.filter((g) => g.kind === 'stall').map((g) => g.ms)).toEqual([3_000, 5_000, 2_000])
  })
})

describe('runRhythm: the first gap and the clock', () => {
  it('uses latencyMs for the first stroke and timestamp differences after it', () => {
    const r = runRhythm([
      { tsMs: T0, correct: true, latencyMs: 900 },
      { tsMs: T0 + 400, correct: true, latencyMs: 5 },
      { tsMs: T0 + 1_000, correct: true, latencyMs: 7 },
    ])
    expect(r.gaps.map((g) => g.ms)).toEqual([900, 400, 600])
  })

  it('counts a long first latency as a break', () => {
    const r = runRhythm([
      { tsMs: T0, correct: true, latencyMs: 30_000 },
      { tsMs: T0 + 500, correct: true, latencyMs: 500 },
    ])
    expect(r.gaps[0]).toEqual({ ms: 30_000, kind: 'break' })
    expect(r.gaps[1]).toEqual({ ms: 500, kind: 'normal' })
  })

  it('gives a gap of 0 when the clock goes backwards, and every output stays finite and non-negative', () => {
    const strokes: RhythmStroke[] = [
      { tsMs: T0 + 5_000, correct: true, latencyMs: 400 },
      { tsMs: T0 + 4_000, correct: true, latencyMs: 100 },
      { tsMs: T0 + 4_500, correct: false, latencyMs: 500 },
      { tsMs: T0 + 5_200, correct: true, latencyMs: 700 },
    ]
    const r = runRhythm(strokes)
    expect(r.gaps.map((g) => g.ms)).toEqual([400, 0, 500, 700])
    expect(allFinite(r)).toBe(true)
  })

  it('treats non-finite numbers as 0 rather than spreading NaN', () => {
    const r = runRhythm([
      { tsMs: T0, correct: true, latencyMs: Number.NaN },
      { tsMs: Number.NaN, correct: true, latencyMs: 1 },
      { tsMs: T0 + 100, correct: true, latencyMs: 1 },
    ])
    expect(allFinite(r)).toBe(true)
  })
})

describe('runRhythm: infinite numbers', () => {
  it('turns Infinity and -Infinity in tsMs or latencyMs into a gap of 0', () => {
    for (const bad of [Infinity, -Infinity]) {
      const r = runRhythm([
        { tsMs: T0, correct: true, latencyMs: bad },
        { tsMs: T0 + 500, correct: true, latencyMs: 500 },
        { tsMs: bad, correct: true, latencyMs: 1 },
        { tsMs: T0 + 1_000, correct: true, latencyMs: 1 },
        { tsMs: T0 + 1_500, correct: true, latencyMs: 1 },
      ])
      expect(r.gaps.map((g) => g.ms)).toEqual([0, 500, 0, 0, 500])
      expect(allFinite(r)).toBe(true)
    }
  })
})

describe('runRhythm: steadiness pins', () => {
  it('scores gaps alternating 600 and 1200 ms about 51', () => {
    // 30 gaps of 600 and 30 of 1200: median 900, quartiles 600 and 1200, IQR 600, spread 600 / 1.349 = 444.8,
    // cv = 444.8 / 900 = 0.494, score = round(100 * (1 - 0.494)) = 51 (current implementation gives exactly 51).
    expect(Math.abs((runRhythm(run(alternating(60))).steadiness as number) - 51)).toBeLessThanOrEqual(3)
  })

  it('scores a seeded lognormal-like run (sigma 0.25 around 600 ms, 150 gaps) between 72 and 84', () => {
    // mulberry32 + Box-Muller, fixed seed. For a lognormal, IQR / 1.349 / median is about sigma = 0.25, so about 75;
    // the current implementation gives 73 for this seed. A wider spread constant (P10-P90 or no 1.349) falls below 72.
    let seed = 12345
    const uniform = (): number => {
      seed = (seed + 0x6d2b79f5) | 0
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
    const normal = (): number => Math.sqrt(-2 * Math.log(1 - uniform())) * Math.cos(2 * Math.PI * uniform())
    const gaps = Array.from({ length: 150 }, () => Math.round(600 * Math.exp(0.25 * normal())))
    const score = runRhythm(run(gaps)).steadiness as number
    expect(score).toBeGreaterThanOrEqual(72)
    expect(score).toBeLessThanOrEqual(84)
  })
})

describe('runRhythm: too little data', () => {
  it('gives no steadiness under 10 non-break gaps and a score from 10', () => {
    expect(runRhythm(run(even(9))).steadiness).toBeNull()
    expect(runRhythm(run(even(10))).steadiness).toBe(100)
  })

  it('counts only non-break gaps toward the minimum', () => {
    expect(runRhythm(run([...even(9), 12_000, 12_000])).steadiness).toBeNull()
  })

  it('handles no strokes', () => {
    const r = runRhythm([])
    expect(r.gaps).toEqual([])
    expect(r.typicalGapMs).toBeNull()
    expect(r.stalls).toBe(0)
    expect(r.breaks).toBe(0)
    expect(r.steadiness).toBeNull()
    expect(r.quarters).toBeNull()
    expect(quarterWpm(r, 10)).toEqual([null, null, null, null])
  })

  it('handles one stroke without throwing', () => {
    const r = runRhythm(run([700]))
    expect(r.gaps).toEqual([{ ms: 700, kind: 'normal' }])
    expect(r.typicalGapMs).toBe(700)
    expect(r.steadiness).toBeNull()
    expect(r.quarters).toBeNull()
  })

  it('takes the average of the two middle gaps as the typical gap of an even count', () => {
    expect(runRhythm(run([100, 200, 300, 900])).typicalGapMs).toBe(250)
    expect(runRhythm(run([100, 900, 300])).typicalGapMs).toBe(300)
  })

  it('gives no quarters under 4 strokes', () => {
    expect(runRhythm(run([500, 500, 500])).quarters).toBeNull()
    expect(runRhythm(run([500, 500, 500, 500])).quarters).not.toBeNull()
  })
})

describe('runRhythm: equal timestamps', () => {
  const strokes: RhythmStroke[] = Array.from({ length: 30 }, () => ({ tsMs: T0, correct: true, latencyMs: 0 }))
  const r = runRhythm(strokes)

  it('has a typical gap of 0 (the median of the gaps), and steadiness null because there is no rhythm to score', () => {
    expect(r.gaps).toHaveLength(30)
    expect(r.typicalGapMs).toBe(0)
    expect(r.steadiness).toBeNull()
    expect(r.stalls).toBe(0)
  })

  it('has no quarters and no NaN anywhere', () => {
    expect(r.quarters).toBeNull()
    expect(allFinite(r)).toBe(true)
    expect(quarterWpm(r, 20)).toEqual([null, null, null, null])
  })
})

describe('runRhythm: quarters', () => {
  const r = runRhythm(run(even(60)))

  it('cuts an even run into four slices of equal active time', () => {
    expect(r.quarters).toHaveLength(4)
    const active = (r.quarters ?? []).map((q) => q.activeMs)
    expect(Math.max(...active) - Math.min(...active)).toBeLessThanOrEqual(600)
    expect(sum(active)).toBe(60 * 600)
  })

  it('counts each correct stroke once', () => {
    const mixed = runRhythm(run(even(60), (i) => i % 3 !== 0))
    expect(sum((mixed.quarters ?? []).map((q) => q.correct))).toBe(40)
  })

  it('assigns a stroke to the slice holding the end of its gap', () => {
    // active time 4 x 1000 = 4000 ms, so a slice is 1000 ms and a gap ending on a boundary stays in the earlier slice.
    const q = runRhythm(run([1000, 1000, 1000, 1000])).quarters
    expect(q).toEqual([
      { activeMs: 1000, correct: 1 },
      { activeMs: 1000, correct: 1 },
      { activeMs: 1000, correct: 1 },
      { activeMs: 1000, correct: 1 },
    ])
    // active time 4500, a slice is 1125 ms: the strokes end at 500, 1000, 1500 and 4500; the long last gap sits wholly in the last slice
    const lopsided = runRhythm(run([500, 500, 500, 3000])).quarters
    expect(lopsided).toEqual([
      { activeMs: 1000, correct: 2 },
      { activeMs: 500, correct: 1 },
      { activeMs: 0, correct: 0 },
      { activeMs: 3000, correct: 1 },
    ])
  })

  it('puts the gap of a break stroke in no slice, and the stroke in the slice current at that moment', () => {
    const q = runRhythm(run([1000, 1000, 20_000, 1000, 1000])).quarters
    // active 4000: slice boundaries at 1000, 2000, 3000, 4000; the break stroke sits at 2000 -> slice 1
    expect(q).toEqual([
      { activeMs: 1000, correct: 1 },
      { activeMs: 1000, correct: 2 },
      { activeMs: 1000, correct: 1 },
      { activeMs: 1000, correct: 1 },
    ])
  })

  it('puts a break stroke at the very start in the first slice and at the very end in the last', () => {
    const q = runRhythm(run([30_000, 1000, 1000, 1000, 1000, 30_000])).quarters
    expect(q?.map((x) => x.correct)).toEqual([2, 1, 1, 2])
    expect(sum((q ?? []).map((x) => x.activeMs))).toBe(4000)
  })

  it('counts only correct strokes', () => {
    const q = runRhythm(run([1000, 1000, 1000, 1000], (i) => i !== 1)).quarters
    expect(q?.map((x) => x.correct)).toEqual([1, 0, 1, 1])
  })
})

describe('quarterWpm', () => {
  it('gives four numbers averaging words per active minute for an even run', () => {
    const r = runRhythm(run(even(60)))
    const wpm = quarterWpm(r, 40)
    const activeMinutes = (60 * 600) / 60_000
    expect(wpm).toHaveLength(4)
    wpm.forEach((v) => expect(v).toBeCloseTo(40 / activeMinutes, 6))
    expect(sum(wpm as number[]) / 4).toBeCloseTo(40 / activeMinutes, 6)
  })

  it('shares the words in proportion to correct strokes', () => {
    // 4 equal slices of 15000 ms (0.25 min); correct strokes per slice are 1, 3, 4, 0 out of 8 and 12 words
    const r = {
      gaps: [],
      typicalGapMs: 1000,
      stalls: 0,
      breaks: 0,
      steadiness: 90,
      quarters: [
        { activeMs: 15_000, correct: 1 },
        { activeMs: 15_000, correct: 3 },
        { activeMs: 15_000, correct: 4 },
        { activeMs: 15_000, correct: 0 },
      ],
    }
    const wpm = quarterWpm(r, 12)
    expect(wpm[0]).toBeCloseTo((12 * (1 / 8)) / 0.25, 9)
    expect(wpm[1]).toBeCloseTo((12 * (3 / 8)) / 0.25, 9)
    expect(wpm[2]).toBeCloseTo((12 * (4 / 8)) / 0.25, 9)
    expect(wpm[3]).toBeNull()
  })

  it('divides by each slice of its own length', () => {
    const r = {
      gaps: [],
      typicalGapMs: 1000,
      stalls: 0,
      breaks: 0,
      steadiness: null,
      quarters: [
        { activeMs: 30_000, correct: 2 },
        { activeMs: 60_000, correct: 2 },
        { activeMs: 0, correct: 2 },
        { activeMs: 30_000, correct: 2 },
      ],
    }
    const wpm = quarterWpm(r, 16)
    expect(wpm[0]).toBeCloseTo(4 / 0.5, 9)
    expect(wpm[1]).toBeCloseTo(4 / 1, 9)
    expect(wpm[2]).toBeNull()
    expect(wpm[3]).toBeCloseTo(4 / 0.5, 9)
  })

  it('gives null for a quarter with no correct strokes in a real run', () => {
    const r = runRhythm(run([1000, 1000, 1000, 1000], (i) => i !== 1))
    const wpm = quarterWpm(r, 4)
    expect(wpm[1]).toBeNull()
    expect(wpm[0]).not.toBeNull()
  })

  it('gives four nulls when there are no quarters or no correct strokes', () => {
    expect(quarterWpm(runRhythm(run([500, 500])), 10)).toEqual([null, null, null, null])
    expect(quarterWpm(runRhythm(run(even(8), () => false)), 10)).toEqual([null, null, null, null])
  })

  it('never returns NaN or Infinity, whatever the words', () => {
    const r = runRhythm(run(even(20)))
    expect(quarterWpm(r, Number.NaN)).toEqual([null, null, null, null])
    expect(quarterWpm(r, -5).every((v) => v === null || (Number.isFinite(v) && v >= 0))).toBe(true)
    expect(quarterWpm(r, 0).every((v) => v === 0)).toBe(true)
  })
})

describe('runRhythm: purity', () => {
  it('gives the same answer twice', () => {
    const strokes = run([...even(30), 4_000, ...even(30)], (i) => i % 7 !== 0)
    expect(runRhythm(strokes)).toEqual(runRhythm(strokes))
  })

  it('does not change its input', () => {
    const strokes = run([...even(30), 4_000, ...even(30)])
    const frozen = strokes.map((s) => Object.freeze({ ...s }))
    const before = JSON.stringify(frozen)
    Object.freeze(frozen)
    runRhythm(frozen)
    expect(JSON.stringify(frozen)).toBe(before)
  })
})
