import { describe, expect, it } from 'vitest'
import type { DayQuality } from '../../server/stats.ts'
import { addDays } from '../../src/core/days.ts'
import { detectPlateau } from '../../src/core/plateau.ts'

const TODAY = '2026-10-30'

type Extra = Partial<Omit<DayQuality, 'date'>>

/** A day `offset` days before today. */
function dayAt(offset: number, extra: Extra = {}): DayQuality {
  return { date: addDays(TODAY, -offset), runs: 3, words: 100, wpm: 40, accuracy: 0.95, steadiness: 80, ...extra }
}

/** One day in week k (0 = the week ending today) carrying that week's figures. */
function week(k: number, wpm: number | null, extra: Extra = {}): DayQuality {
  return dayAt(7 * k + 3, { wpm, ...extra })
}

/** Weeks by index; null makes a gap (the week has no days). */
function weeks(values: (number | null)[], extra: (k: number) => Extra = () => ({})): DayQuality[] {
  const out: DayQuality[] = []
  values.forEach((v, k) => {
    if (v !== null) out.push(week(k, v, extra(k)))
  })
  return out
}

describe('detectPlateau', () => {
  it('finds a flat run of three weeks', () => {
    const p = detectPlateau(weeks([41, 42, 40]), TODAY)
    expect(p).not.toBeNull()
    expect(p!.weeks).toBe(3)
    expect(p!.thisWeek).toBe(41)
    expect(p!.others).toEqual([42, 40])
  })

  it('stops at the first week outside tolerance', () => {
    expect(detectPlateau(weeks([41, 44, 41]), TODAY)).toBeNull()
    // 44 is 3 away from 41, tolerance 2: the older flat weeks do not count
    expect(detectPlateau(weeks([41, 41, 44, 41, 41]), TODAY)).toBeNull()
  })

  it('uses 4 percent tolerance when it is larger than 2', () => {
    // 4% of 100 is 4: 104 and 96 are within, 105 is not
    expect(detectPlateau(weeks([100, 104, 96]), TODAY)?.weeks).toBe(3)
    expect(detectPlateau(weeks([100, 105, 96]), TODAY)).toBeNull()
  })

  it('accepts a difference exactly at the tolerance', () => {
    expect(detectPlateau(weeks([41, 43, 39]), TODAY)?.weeks).toBe(3)
  })

  it('skips a gap week without ending the plateau', () => {
    const p = detectPlateau(weeks([41, null, 42, 40]), TODAY)
    expect(p?.weeks).toBe(3)
    expect(p?.others).toEqual([42, 40])
  })

  it('treats a week with fewer than 2 runs as a gap', () => {
    const days = [...weeks([41, null, 42, 40]), week(1, 90, { runs: 1 })]
    expect(detectPlateau(days, TODAY)?.weeks).toBe(3)
  })

  it('sums runs across the days of a week for the 2-run rule', () => {
    const days = [
      dayAt(0, { runs: 1, wpm: 41 }),
      dayAt(1, { runs: 1, wpm: 41 }),
      week(1, 42),
      week(2, 40),
    ]
    expect(detectPlateau(days, TODAY)?.weeks).toBe(3)
  })

  it('treats a week with no words as a gap', () => {
    const days = [...weeks([41, null, 42, 40]), week(1, 90, { words: 0 })]
    expect(detectPlateau(days, TODAY)?.weeks).toBe(3)
  })

  it('weights a week mean wpm by words', () => {
    const days = [
      dayAt(0, { wpm: 30, words: 100 }),
      dayAt(1, { wpm: 50, words: 300 }),
      ...weeks([null, 45, 46]),
    ]
    // (30*100 + 50*300) / 400 = 45
    const p = detectPlateau(days, TODAY)
    expect(p?.thisWeek).toBe(45)
  })

  it('returns null when week 0 has no value', () => {
    expect(detectPlateau(weeks([null, 41, 41, 41]), TODAY)).toBeNull()
    expect(detectPlateau(weeks([41, 41, 41]).slice(1), TODAY)).toBeNull()
  })

  it('returns null with only two flat weeks', () => {
    expect(detectPlateau(weeks([41, 42]), TODAY)).toBeNull()
    expect(detectPlateau(weeks([41, 42, 60]), TODAY)).toBeNull()
  })

  it('keeps at most two others, the most recent, however long the plateau', () => {
    const p = detectPlateau(weeks([41, 42, 40, 41, 43, 39, 41, 42]), TODAY)
    expect(p?.weeks).toBe(8)
    expect(p?.others).toEqual([42, 40])
  })

  it('ignores days outside the 56-day window', () => {
    const days = [...weeks([41, 42, 40]), dayAt(56, { wpm: 41 }), dayAt(60, { wpm: 41 }), dayAt(-1, { wpm: 99 })]
    const p = detectPlateau(days, TODAY)
    expect(p?.weeks).toBe(3)
    expect(detectPlateau([week(0, 41), week(1, 41), dayAt(56, { wpm: 41 })], TODAY)).toBeNull()
  })

  it('counts day 55 as the oldest day of week 7', () => {
    const days = [week(0, 41), week(1, 41), dayAt(55, { wpm: 41 })]
    expect(detectPlateau(days, TODAY)?.weeks).toBe(3)
  })

  it('puts the boundary days into the right weeks', () => {
    // offsets 6 and 7: week 0 and week 1
    const days = [dayAt(0, { wpm: 41 }), dayAt(6, { wpm: 41 }), dayAt(7, { wpm: 41 }), dayAt(13, { wpm: 41 }), dayAt(14, { wpm: 41 })]
    expect(detectPlateau(days, TODAY)?.weeks).toBe(3)
    // only 2 distinct weeks: 0..6 and 7..13
    expect(detectPlateau(days.slice(0, 4), TODAY)).toBeNull()
  })

  it('is stable for empty and unsorted input', () => {
    expect(detectPlateau([], TODAY)).toBeNull()
    const sorted = weeks([41, 42, 40])
    expect(detectPlateau([...sorted].reverse(), TODAY)).toEqual(detectPlateau(sorted, TODAY))
  })

  it('ignores null, NaN and infinite values', () => {
    const bad = [
      week(0, Number.NaN),
      week(1, Number.POSITIVE_INFINITY),
      week(2, null),
      dayAt(2, { wpm: 41, words: Number.NaN }),
      dayAt(2, { wpm: 41, runs: Number.NaN }),
    ]
    expect(detectPlateau(bad, TODAY)).toBeNull()
    const days = [...weeks([41, 42, 40]), week(0, Number.NaN), week(1, Number.POSITIVE_INFINITY)]
    const p = detectPlateau(days, TODAY)
    expect(p?.thisWeek).toBe(41)
    expect(p?.others).toEqual([42, 40])
  })

  it('ignores a malformed date', () => {
    const days = [...weeks([41, 42, 40]), { ...dayAt(1), date: 'nope' }]
    expect(detectPlateau(days, TODAY)?.weeks).toBe(3)
  })

  describe('meanwhile', () => {
    const rising = (acc: [number, number], st: [number, number]) =>
      weeks([41, 42, 40], (k) => ({ accuracy: k === 0 ? acc[1] : k === 2 ? acc[0] : 0.93, steadiness: k === 0 ? st[1] : k === 2 ? st[0] : 70 }))

    it('reports steadiness that rose by at least 3', () => {
      expect(detectPlateau(rising([0.9, 0.9], [70, 73]), TODAY)?.meanwhile.steadiness).toEqual({ from: 70, to: 73 })
      expect(detectPlateau(rising([0.9, 0.9], [70, 72]), TODAY)?.meanwhile.steadiness).toBeUndefined()
    })

    it('reports accuracy in percent points to one decimal when it rose by at least 1.5', () => {
      expect(detectPlateau(rising([0.912, 0.94], [70, 70]), TODAY)?.meanwhile.accuracy).toEqual({ from: 91.2, to: 94 })
      expect(detectPlateau(rising([0.9, 0.915], [70, 70]), TODAY)?.meanwhile.accuracy).toEqual({ from: 90, to: 91.5 })
      expect(detectPlateau(rising([0.9, 0.914], [70, 70]), TODAY)?.meanwhile.accuracy).toBeUndefined()
    })

    it('never reports a decline', () => {
      const p = detectPlateau(rising([0.95, 0.9], [80, 70]), TODAY)
      expect(p?.meanwhile).toEqual({})
    })

    it('compares week 0 with the oldest counted week of the plateau', () => {
      const days = weeks([41, 42, 40, 41, 90], (k) => ({ steadiness: [80, 75, 74, 70, 10][k], accuracy: 0.9 }))
      // the plateau ends at week 3: week 4 (90) is outside tolerance
      const p = detectPlateau(days, TODAY)
      expect(p?.weeks).toBe(4)
      expect(p?.meanwhile.steadiness).toEqual({ from: 70, to: 80 })
    })

    it('omits a metric whose oldest-week value is missing', () => {
      const days = weeks([41, 42, 40], (k) => ({
        accuracy: k === 2 ? null : k === 0 ? 0.95 : 0.9,
        steadiness: k === 2 ? null : k === 0 ? 90 : 70,
      }))
      expect(detectPlateau(days, TODAY)?.meanwhile).toEqual({})
    })

    it('omits a metric whose week 0 value is missing', () => {
      const days = weeks([41, 42, 40], (k) => ({
        accuracy: k === 0 ? null : 0.9,
        steadiness: k === 0 ? null : 70,
      }))
      expect(detectPlateau(days, TODAY)?.meanwhile).toEqual({})
    })

    it('weights a week accuracy by words', () => {
      const days = [
        dayAt(0, { wpm: 41, words: 100, accuracy: 0.9 }),
        dayAt(1, { wpm: 41, words: 300, accuracy: 0.98 }),
        week(1, 42, { accuracy: 0.9 }),
        week(2, 40, { accuracy: 0.9 }),
      ]
      // (0.9*100 + 0.98*300) / 400 = 0.96
      expect(detectPlateau(days, TODAY)?.meanwhile.accuracy).toEqual({ from: 90, to: 96 })
    })

    it('takes the median of non-null steadiness values for a week, rounded', () => {
      const days = [
        dayAt(0, { wpm: 41, steadiness: 80 }),
        dayAt(1, { wpm: 41, steadiness: 90 }),
        dayAt(2, { wpm: 41, steadiness: null }),
        dayAt(3, { wpm: 41, steadiness: 91 }),
        dayAt(4, { wpm: 41, steadiness: 100 }),
        week(1, 42, { steadiness: 70 }),
        week(2, 40, { steadiness: 70 }),
      ]
      // median of 80, 90, 91, 100 = 90.5, rounded to 91
      expect(detectPlateau(days, TODAY)?.meanwhile.steadiness).toEqual({ from: 70, to: 91 })
    })

    it('ignores non-finite accuracy and steadiness', () => {
      const days = weeks([41, 42, 40], (k) => ({
        accuracy: k === 0 ? Number.NaN : 0.9,
        steadiness: k === 0 ? Number.POSITIVE_INFINITY : 70,
      }))
      expect(detectPlateau(days, TODAY)?.meanwhile).toEqual({})
    })
  })

  it('never produces NaN anywhere', () => {
    const days = weeks([41, 42, 40, 41], () => ({ accuracy: 0.95, steadiness: 85 }))
    const p = detectPlateau(days, TODAY)
    const flat = JSON.stringify(p)
    expect(flat).not.toContain('null')
    expect(flat).not.toContain('NaN')
  })
})
