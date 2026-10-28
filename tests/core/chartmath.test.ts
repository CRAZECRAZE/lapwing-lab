import { describe, expect, it } from 'vitest'
import {
  bestPoint,
  CHAR_WIDTH,
  cap,
  compactCount,
  dateTickOffsets,
  durationText,
  labelsThatFit,
  labelStep,
  linePath,
  niceMax,
  num,
  scaleLinear,
  shortDate,
  stripCeiling,
  ticks,
  textWidth,
  tickDuration,
  timeAxis,
} from '../../src/core/chartmath.ts'

const MIN = 60000

describe('num', () => {
  it('rounds to two decimals and turns anything not finite into 0', () => {
    expect(num(1.23456)).toBe(1.23)
    expect(num(NaN)).toBe(0)
    expect(num(Infinity)).toBe(0)
    expect(num(-Infinity)).toBe(0)
  })
})

describe('cap', () => {
  it('keeps finite numbers and gives finite stand-ins for NaN and the infinities', () => {
    expect(cap(12.5)).toBe(12.5)
    expect(cap(NaN)).toBe(0)
    expect(cap(Infinity)).toBe(Number.MAX_VALUE)
    expect(cap(-Infinity)).toBe(-Number.MAX_VALUE)
  })
})

describe('scaleLinear', () => {
  it('maps the domain ends to the range ends and keeps the middle in the middle', () => {
    const s = scaleLinear([0, 20], [100, 0])
    expect(s(0)).toBe(100)
    expect(s(20)).toBe(0)
    expect(s(10)).toBe(50)
  })

  it('puts double the value at double the distance from a zero baseline', () => {
    const s = scaleLinear([0, 40], [200, 0])
    expect(200 - s(20)).toBeCloseTo(2 * (200 - s(10)), 5)
  })

  it('returns the middle of the range when the domain has no width (all values equal, one point)', () => {
    const s = scaleLinear([5, 5], [0, 100])
    expect(s(5)).toBe(50)
    expect(Number.isFinite(s(7))).toBe(true)
  })

  it('never returns NaN or Infinity, whatever it is given', () => {
    const inputs = [NaN, Infinity, -Infinity, 1e308, -1e308, 0]
    for (const a of inputs) {
      for (const b of inputs) {
        const s = scaleLinear([a, b], [0, 100])
        for (const v of inputs) expect(Number.isFinite(s(v))).toBe(true)
      }
    }
    expect(Number.isFinite(scaleLinear([0, 1], [NaN, 5])(0.5))).toBe(true)
  })
})

describe('niceMax', () => {
  it('rounds up to 1, 2 or 5 times a power of ten', () => {
    expect(niceMax(0.3)).toBe(0.5)
    expect(niceMax(1)).toBe(1)
    expect(niceMax(1.1)).toBe(2)
    expect(niceMax(2)).toBe(2)
    expect(niceMax(3)).toBe(5)
    expect(niceMax(5)).toBe(5)
    expect(niceMax(5.1)).toBe(10)
    expect(niceMax(17)).toBe(20)
    expect(niceMax(90)).toBe(100)
    expect(niceMax(101)).toBe(200)
    expect(niceMax(4600)).toBe(5000)
  })

  it('is never below the value', () => {
    for (let v = 0.01; v < 5000; v *= 1.37) expect(niceMax(v)).toBeGreaterThanOrEqual(v)
  })

  it('gives 1 for zero, negative and non-finite input, and stays finite for huge values', () => {
    for (const v of [0, -4, NaN, Infinity]) expect(niceMax(v)).toBe(1)
    expect(Number.isFinite(niceMax(1.5e308))).toBe(true)
    expect(Number.isFinite(niceMax(Number.MAX_VALUE))).toBe(true)
    expect(niceMax(1e-320)).toBeGreaterThan(0)
  })
})

describe('ticks', () => {
  it('runs from 0 to the max in a few even steps, ending on the max', () => {
    expect(ticks(20)).toEqual([0, 5, 10, 15, 20])
    expect(ticks(10)).toEqual([0, 2, 4, 6, 8, 10])
    expect(ticks(5)).toEqual([0, 1, 2, 3, 4, 5])
    expect(ticks(1)).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1])
    expect(ticks(100)).toEqual([0, 20, 40, 60, 80, 100])
  })

  it('stays finite and starts at 0 for bad input', () => {
    for (const m of [0, -1, NaN, Infinity, Number.MAX_VALUE]) {
      const t = ticks(m)
      expect(t[0]).toBe(0)
      expect(t.every(Number.isFinite)).toBe(true)
    }
  })
})

describe('timeAxis', () => {
  it('uses whole minutes below an hour and whole hours above, with the max a multiple of the step', () => {
    const a = timeAxis(37 * MIN)
    expect(a.max).toBeGreaterThanOrEqual(37 * MIN)
    for (const t of a.ticks) expect(t % MIN).toBe(0)
    expect(a.ticks[0]).toBe(0)
    expect(a.ticks[a.ticks.length - 1]).toBe(a.max)

    const b = timeAxis(4.6 * 60 * MIN)
    expect(b.max).toBeGreaterThanOrEqual(4.6 * 60 * MIN)
    for (const t of b.ticks) expect(t % (60 * MIN)).toBe(0)
  })

  it('has a usable axis for zero and for bad input', () => {
    for (const v of [0, -5, NaN, Infinity]) {
      const a = timeAxis(v)
      expect(a.max).toBeGreaterThan(0)
      expect(a.ticks[0]).toBe(0)
      expect(a.ticks.every(Number.isFinite)).toBe(true)
    }
  })

  it('stays finite for a huge value', () => {
    const a = timeAxis(Number.MAX_VALUE)
    expect(Number.isFinite(a.max)).toBe(true)
    expect(a.ticks.every(Number.isFinite)).toBe(true)
  })
})

describe('linePath', () => {
  it('joins points with M and L', () => {
    expect(linePath([{ x: 1, y: 2 }, { x: 3.456, y: 4 }])).toBe('M1 2L3.46 4')
  })

  it('is empty for no points and a single move for one', () => {
    expect(linePath([])).toBe('')
    expect(linePath([{ x: 1, y: 2 }])).toBe('M1 2')
  })

  it('drops points that are not finite instead of writing them', () => {
    const d = linePath([{ x: 1, y: 2 }, { x: NaN, y: 3 }, { x: 4, y: Infinity }, { x: 5, y: 6 }])
    expect(d).toBe('M1 2L5 6')
    expect(d).not.toMatch(/NaN|Infinity/)
  })
})

describe('dateTickOffsets', () => {
  it('lists at most `max` offsets from 0, even and inside the span', () => {
    for (const span of [0, 1, 5, 13, 27, 90, 1100]) {
      const o = dateTickOffsets(span, 6)
      expect(o.length).toBeGreaterThanOrEqual(1)
      expect(o.length).toBeLessThanOrEqual(6)
      expect(o[0]).toBe(0)
      expect(o.every((n) => Number.isInteger(n) && n >= 0 && n <= span)).toBe(true)
    }
  })

  it('shows every day of a short span', () => {
    expect(dateTickOffsets(2, 6)).toEqual([0, 1, 2])
  })
})

describe('shortDate', () => {
  it('writes the month and the day, with the year only when asked', () => {
    expect(shortDate('2026-10-03')).toBe('Oct 3')
    expect(shortDate('2026-12-31')).toBe('Dec 31')
    expect(shortDate('2025-01-09', true)).toBe('Jan 9 2025')
  })
})

describe('bestPoint', () => {
  it('is the highest value, the earliest on a tie, and null for nothing', () => {
    expect(bestPoint([])).toBeNull()
    const pts = [
      { date: '2026-10-01', value: 12 },
      { date: '2026-10-02', value: 17 },
      { date: '2026-10-03', value: 17 },
      { date: '2026-10-04', value: 9 },
    ]
    expect(bestPoint(pts)).toEqual({ date: '2026-10-02', value: 17 })
  })
})

describe('compactCount', () => {
  it('keeps small counts and shortens thousands to one decimal', () => {
    expect(compactCount(0)).toBe('0')
    expect(compactCount(842)).toBe('842')
    expect(compactCount(1000)).toBe('1k')
    expect(compactCount(11284)).toBe('11.3k')
    expect(compactCount(Infinity)).toBe('0')
  })
})

describe('tickDuration', () => {
  it('drops the padded minutes of a whole hour', () => {
    expect(tickDuration(30 * MIN)).toBe('30 min')
    expect(tickDuration(120 * MIN)).toBe('2 h')
    expect(tickDuration(90 * MIN)).toBe('1 h 30 min')
    expect(tickDuration(0)).toBe('0 min')
  })
})

describe('durationText', () => {
  it('is formatDuration, except that an exact zero is 0 min', () => {
    expect(durationText(0)).toBe('0 min')
    expect(durationText(-5)).toBe('0 min')
    expect(durationText(20000)).toBe('<1 min')
    expect(durationText(276 * MIN)).toBe('4 h 36 min')
  })
})

describe('label fitting', () => {
  it('estimates a label as its characters times the character width', () => {
    expect(textWidth('11.3k')).toBe(5 * CHAR_WIDTH)
    expect(textWidth('')).toBe(0)
  })

  it('gives 1 when a slot holds a label and its gap, else the number of slots a label needs', () => {
    expect(labelStep(40, 48)).toBe(1)
    expect(labelStep(40, 47)).toBe(2)
    expect(labelStep(40, 18)).toBe(3)
    expect(labelStep(0, 18)).toBe(1)
  })

  it('stays a usable whole number for a zero, negative or non-finite slot', () => {
    for (const slot of [0, -3, NaN, Infinity]) {
      const n = labelStep(40, slot)
      expect(Number.isInteger(n) && n >= 1).toBe(true)
    }
    expect(labelStep(NaN, 10)).toBeGreaterThanOrEqual(1)
  })

  it('fits between 2 and the most labels along a room', () => {
    expect(labelsThatFit(480, 48, 6)).toBe(6)
    expect(labelsThatFit(480, 88, 6)).toBe(4)
    expect(labelsThatFit(100, 88, 6)).toBe(2)
    expect(labelsThatFit(NaN, 88, 6)).toBe(2)
  })
})

describe('stripCeiling', () => {
  it('is the longest gap when no gap is out of proportion', () => {
    expect(stripCeiling([600, 700, 800, 900, 1000])).toBe(1000)
    expect(stripCeiling([0, 0, 0])).toBe(0)
    expect(stripCeiling([])).toBe(0)
  })

  it('is 3 times the 95th percentile when one gap is far above the rest', () => {
    const gaps = [...Array.from({ length: 59 }, () => 600), 9000]
    expect(stripCeiling(gaps)).toBe(1800)
  })

  it('does not cap when the slowest few are a real share of the run', () => {
    const gaps = [...Array.from({ length: 55 }, () => 600), ...Array.from({ length: 5 }, () => 5000)]
    expect(stripCeiling(gaps)).toBe(5000)
  })

  it('ignores gaps that are not finite or are negative', () => {
    expect(stripCeiling([600, Number.NaN, -5, Number.POSITIVE_INFINITY, 800])).toBe(800)
  })
})
