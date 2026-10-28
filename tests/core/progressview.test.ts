import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DayStat } from '../../server/archive.ts'
import { addDays } from '../../src/core/days.ts'
import {
  RANGES,
  change,
  daysBetween,
  enough,
  movingAverage,
  rangeBounds,
  weekStart,
  weeksOf,
} from '../../src/core/progressview.ts'

function day(date: string, activeMs: number, strokes: number): DayStat {
  return { date, tests: 1, strokes, activeMs }
}

describe('daysBetween', () => {
  it('counts calendar days, positive, zero and negative', () => {
    expect(daysBetween('2026-10-01', '2026-10-28')).toBe(27)
    expect(daysBetween('2026-10-28', '2026-10-28')).toBe(0)
    expect(daysBetween('2026-10-28', '2026-10-01')).toBe(-27)
  })

  it('crosses month ends, year ends and leap days', () => {
    expect(daysBetween('2026-12-31', '2027-01-01')).toBe(1)
    expect(daysBetween('2028-02-28', '2028-03-01')).toBe(2)
    expect(daysBetween('2027-02-28', '2027-03-01')).toBe(1)
    expect(daysBetween('2026-01-01', '2027-01-01')).toBe(365)
  })

  it('is exact across daylight saving changes in either direction', () => {
    expect(daysBetween('2026-03-28', '2026-03-30')).toBe(2) // Europe, spring forward 29 March
    expect(daysBetween('2026-10-24', '2026-10-26')).toBe(2) // Europe, fall back 25 October
    expect(daysBetween('2026-03-07', '2026-03-09')).toBe(2) // US, spring forward 8 March
    expect(daysBetween('2026-10-31', '2026-11-02')).toBe(2) // US, fall back 1 November
    expect(daysBetween('2026-03-01', '2026-04-01')).toBe(31)
    expect(daysBetween('2026-11-02', '2026-10-31')).toBe(-2)
  })
})

describe('weekStart', () => {
  it('is the date itself for a Monday', () => {
    expect(weekStart('2026-10-26')).toBe('2026-10-26')
  })

  it('maps midweek days back to Monday', () => {
    expect(weekStart('2026-10-28')).toBe('2026-10-26')
    expect(weekStart('2026-10-31')).toBe('2026-10-26')
  })

  it('puts a Sunday in the week that began six days earlier', () => {
    expect(weekStart('2026-11-01')).toBe('2026-10-26')
    expect(weekStart('2026-10-25')).toBe('2026-10-19')
  })

  it('crosses month and year boundaries', () => {
    expect(weekStart('2026-03-01')).toBe('2026-02-23') // a Sunday
    expect(weekStart('2026-12-31')).toBe('2026-12-28')
    expect(weekStart('2027-01-01')).toBe('2026-12-28') // a Friday
    expect(weekStart('2027-01-03')).toBe('2026-12-28') // a Sunday
  })

  it('handles a leap day', () => {
    expect(weekStart('2028-02-29')).toBe('2028-02-28') // a Tuesday
    expect(weekStart('2028-03-05')).toBe('2028-02-28') // a Sunday
    expect(weekStart('2028-03-06')).toBe('2028-03-06')
  })

  it('is stable on daylight saving change days', () => {
    expect(weekStart('2026-03-29')).toBe('2026-03-23') // Sunday, clocks forward in Europe
    expect(weekStart('2026-10-25')).toBe('2026-10-19') // Sunday, clocks back in Europe
    expect(weekStart('2026-03-08')).toBe('2026-03-02') // Sunday, clocks forward in the US
    expect(weekStart('2026-11-01')).toBe('2026-10-26') // Sunday, clocks back in the US
    expect(weekStart('2026-03-30')).toBe('2026-03-30')
  })
})

describe('weeksOf', () => {
  it('zero-fills weeks with no practice and keeps them in ascending order', () => {
    const weeks = weeksOf([day('2026-10-05', 1000, 10), day('2026-10-27', 3000, 30)], '2026-10-05', '2026-10-28')
    expect(weeks).toEqual([
      { start: '2026-10-05', activeMs: 1000, strokes: 10 },
      { start: '2026-10-12', activeMs: 0, strokes: 0 },
      { start: '2026-10-19', activeMs: 0, strokes: 0 },
      { start: '2026-10-26', activeMs: 3000, strokes: 30 },
    ])
  })

  it('gives every week zero when there are no days at all', () => {
    const weeks = weeksOf([], '2026-10-05', '2026-10-18')
    expect(weeks).toEqual([
      { start: '2026-10-05', activeMs: 0, strokes: 0 },
      { start: '2026-10-12', activeMs: 0, strokes: 0 },
    ])
  })

  it('sums the days of a week, including the partial current week', () => {
    const days = [day('2026-10-26', 1000, 10), day('2026-10-28', 2000, 20)] // today is Wednesday
    expect(weeksOf(days, '2026-10-26', '2026-10-28')).toEqual([{ start: '2026-10-26', activeMs: 3000, strokes: 30 }])
  })

  it('puts a Sunday in the week that began on the Monday before it', () => {
    const weeks = weeksOf([day('2026-11-01', 500, 5), day('2026-11-02', 700, 7)], '2026-10-26', '2026-11-02')
    expect(weeks).toEqual([
      { start: '2026-10-26', activeMs: 500, strokes: 5 },
      { start: '2026-11-02', activeMs: 700, strokes: 7 },
    ])
  })

  it('does not count days outside [from, to] even in a boundary week', () => {
    const days = [
      day('2026-10-13', 9000, 90), // Tuesday of the first week, before from
      day('2026-10-14', 100, 1), // from
      day('2026-10-28', 200, 2), // to
      day('2026-10-29', 9000, 90), // Thursday of the last week, after to
    ]
    expect(weeksOf(days, '2026-10-14', '2026-10-28')).toEqual([
      { start: '2026-10-12', activeMs: 100, strokes: 1 },
      { start: '2026-10-19', activeMs: 0, strokes: 0 },
      { start: '2026-10-26', activeMs: 200, strokes: 2 },
    ])
  })

  it('sums duplicate rows for one date', () => {
    const weeks = weeksOf([day('2026-10-27', 1000, 10), day('2026-10-27', 500, 5)], '2026-10-26', '2026-10-28')
    expect(weeks).toEqual([{ start: '2026-10-26', activeMs: 1500, strokes: 15 }])
  })

  it('covers a range that starts and ends in the same week, and an unordered input', () => {
    const days = [day('2026-10-28', 2, 2), day('2026-10-26', 1, 1)]
    expect(weeksOf(days, '2026-10-26', '2026-10-26')).toEqual([{ start: '2026-10-26', activeMs: 1, strokes: 1 }])
    expect(weeksOf(days, '2026-10-26', '2026-10-28')).toEqual([{ start: '2026-10-26', activeMs: 3, strokes: 3 }])
  })

  it('crosses a year end and a daylight saving change without dropping or repeating a week', () => {
    const weeks = weeksOf([], '2026-12-21', '2027-01-10')
    expect(weeks.map((w) => w.start)).toEqual(['2026-12-21', '2026-12-28', '2027-01-04'])
    const dst = weeksOf([], '2026-03-02', '2026-04-05').map((w) => w.start)
    expect(dst).toEqual(['2026-03-02', '2026-03-09', '2026-03-16', '2026-03-23', '2026-03-30'])
    const fall = weeksOf([], '2026-10-19', '2026-11-08').map((w) => w.start)
    expect(fall).toEqual(['2026-10-19', '2026-10-26', '2026-11-02'])
  })

  it('is empty when from is after to', () => {
    expect(weeksOf([day('2026-10-27', 1, 1)], '2026-10-28', '2026-10-01')).toEqual([])
  })

  it('has one entry per week over an all-time span', () => {
    const weeks = weeksOf([], '2023-10-14', '2026-10-28')
    expect(weeks[0].start).toBe('2023-10-09')
    expect(weeks[weeks.length - 1].start).toBe('2026-10-26')
    expect(weeks).toHaveLength(daysBetween('2023-10-09', '2026-10-26') / 7 + 1)
  })
})

describe('movingAverage', () => {
  it('returns one point for one point', () => {
    expect(movingAverage([{ date: '2026-10-27', value: 40 }], 7)).toEqual([{ date: '2026-10-27', value: 40 }])
  })

  it('is empty for no points', () => {
    expect(movingAverage([], 7)).toEqual([])
  })

  it('averages the values in the trailing window including the day itself', () => {
    const points = [
      { date: '2026-10-20', value: 10 },
      { date: '2026-10-22', value: 20 },
      { date: '2026-10-24', value: 30 },
    ]
    expect(movingAverage(points, 7)).toEqual([
      { date: '2026-10-20', value: 10 },
      { date: '2026-10-22', value: 15 },
      { date: '2026-10-24', value: 20 },
    ])
  })

  it('includes a day exactly windowDays - 1 back and excludes one windowDays back', () => {
    const points = [
      { date: '2026-10-01', value: 100 },
      { date: '2026-10-07', value: 10 }, // 6 days after: the first is out of a 6 day window, in a 7 day one
    ]
    expect(movingAverage(points, 7)[1].value).toBe(55)
    expect(movingAverage(points, 6)[1].value).toBe(10)
    expect(movingAverage([{ date: '2026-10-01', value: 100 }, { date: '2026-10-06', value: 10 }], 6)[1].value).toBe(55)
  })

  it('does not count earlier points across a gap longer than the window', () => {
    const points = [
      { date: '2026-09-01', value: 100 },
      { date: '2026-09-02', value: 100 },
      { date: '2026-10-27', value: 20 },
    ]
    expect(movingAverage(points, 7)[2]).toEqual({ date: '2026-10-27', value: 20 })
  })

  it('does not look at later points', () => {
    const out = movingAverage([{ date: '2026-10-01', value: 10 }, { date: '2026-10-02', value: 90 }], 7)
    expect(out[0].value).toBe(10)
    expect(out[1].value).toBe(50)
  })

  it('sorts unsorted input', () => {
    const out = movingAverage(
      [
        { date: '2026-10-24', value: 30 },
        { date: '2026-10-20', value: 10 },
        { date: '2026-10-22', value: 20 },
      ],
      7,
    )
    expect(out.map((p) => p.date)).toEqual(['2026-10-20', '2026-10-22', '2026-10-24'])
    expect(out.map((p) => p.value)).toEqual([10, 15, 20])
  })

  it('averages duplicate dates first, so a date counts once', () => {
    const out = movingAverage(
      [
        { date: '2026-10-20', value: 10 },
        { date: '2026-10-20', value: 20 },
        { date: '2026-10-21', value: 45 },
      ],
      7,
    )
    expect(out).toEqual([
      { date: '2026-10-20', value: 15 },
      { date: '2026-10-21', value: 30 },
    ])
  })

  it('ignores non-finite values and never produces NaN', () => {
    const out = movingAverage(
      [
        { date: '2026-10-20', value: Number.NaN },
        { date: '2026-10-21', value: 10 },
        { date: '2026-10-22', value: Number.POSITIVE_INFINITY },
        { date: '2026-10-23', value: Number.NEGATIVE_INFINITY },
        { date: '2026-10-24', value: 30 },
      ],
      7,
    )
    expect(out).toEqual([
      { date: '2026-10-21', value: 10 },
      { date: '2026-10-24', value: 20 },
    ])
    for (const p of out) expect(Number.isFinite(p.value)).toBe(true)
  })

  it('treats a window below 1 (or not a number) as 1', () => {
    const points = [{ date: '2026-10-26', value: 10 }, { date: '2026-10-27', value: 30 }]
    for (const w of [0, -5, 0.4, Number.NaN]) {
      expect(movingAverage(points, w).map((p) => p.value)).toEqual([10, 30])
    }
    expect(movingAverage(points, 2).map((p) => p.value)).toEqual([10, 20])
  })

  it('keeps the window in calendar days across a daylight saving change', () => {
    const points = [{ date: '2026-03-27', value: 10 }, { date: '2026-03-30', value: 30 }]
    expect(movingAverage(points, 4)[1].value).toBe(20) // 3 days back is inside a 4 day window
    expect(movingAverage(points, 3)[1].value).toBe(30)
  })

  it('does not mutate its input', () => {
    const points = [{ date: '2026-10-24', value: 30 }, { date: '2026-10-20', value: 10 }]
    movingAverage(points, 7)
    expect(points.map((p) => p.date)).toEqual(['2026-10-24', '2026-10-20'])
  })
})

describe('enough', () => {
  it('needs at least 3 runs', () => {
    expect(enough(0)).toBe(false)
    expect(enough(2)).toBe(false)
    expect(enough(3)).toBe(true)
    expect(enough(40)).toBe(true)
  })
})

describe('change', () => {
  it('is now minus before', () => {
    expect(change(52, 40)).toBe(12)
    expect(change(40, 52)).toBe(-12)
    expect(change(0, 0)).toBe(0)
  })

  it('is null when either side is null or not finite', () => {
    expect(change(null, 40)).toBeNull()
    expect(change(40, null)).toBeNull()
    expect(change(null, null)).toBeNull()
    expect(change(Number.NaN, 40)).toBeNull()
    expect(change(40, Number.POSITIVE_INFINITY)).toBeNull()
  })
})

describe('RANGES and rangeBounds', () => {
  it('lists the three ranges', () => {
    expect(RANGES).toEqual([
      { id: '4w', label: '4 weeks', days: 28 },
      { id: '3m', label: '3 months', days: 91 },
      { id: 'all', label: 'All time', days: null },
    ])
  })

  it('makes 4 weeks the last 28 days, today included', () => {
    expect(rangeBounds('4w', '2026-10-28')).toEqual({ from: '2026-10-01', to: '2026-10-28' })
    expect(daysBetween('2026-10-01', '2026-10-28') + 1).toBe(28)
  })

  it('makes 3 months the last 91 days, today included', () => {
    const b = rangeBounds('3m', '2026-10-28')
    expect(b).toEqual({ from: '2026-07-30', to: '2026-10-28' })
    expect(daysBetween(b.from, b.to) + 1).toBe(91)
  })

  it('reaches 1,100 days back for all time, which is the most the server accepts', () => {
    const b = rangeBounds('all', '2026-10-28')
    expect(b).toEqual({ from: addDays('2026-10-28', -1100), to: '2026-10-28' })
    expect(daysBetween(b.from, b.to)).toBe(1100)
  })

  it('keeps the exact length across daylight saving dates and year and leap day ends', () => {
    for (const today of ['2026-03-30', '2026-11-02', '2026-03-09', '2026-10-26', '2027-01-03', '2028-03-01']) {
      expect(daysBetween(rangeBounds('4w', today).from, today)).toBe(27)
      expect(daysBetween(rangeBounds('3m', today).from, today)).toBe(90)
      expect(daysBetween(rangeBounds('all', today).from, today)).toBe(1100)
    }
    expect(rangeBounds('4w', '2026-11-02')).toEqual({ from: '2026-10-06', to: '2026-11-02' })
    expect(rangeBounds('4w', '2026-03-30')).toEqual({ from: '2026-03-03', to: '2026-03-30' })
    expect(rangeBounds('4w', '2028-03-01')).toEqual({ from: '2028-02-03', to: '2028-03-01' })
  })
})

describe('purity', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('gives the same answers whatever the clock says', () => {
    const run = () => [
      weekStart('2026-11-01'),
      weeksOf([day('2026-10-27', 1, 1)], '2026-10-20', '2026-10-28'),
      movingAverage([{ date: '2026-10-27', value: 3 }], 7),
      rangeBounds('4w', '2026-10-28'),
      daysBetween('2026-10-01', '2026-10-28'),
    ]
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2001, 0, 1, 12))
    const a = run()
    vi.setSystemTime(new Date(2040, 5, 15, 3))
    expect(run()).toEqual(a)
  })

  it('never calls Date.now or the argument-less Date constructor', () => {
    const now = vi.spyOn(Date, 'now')
    const RealDate = Date
    const seen: number[] = []
    vi.stubGlobal(
      'Date',
      new Proxy(RealDate, {
        construct(target, args, newTarget) {
          seen.push(args.length)
          return Reflect.construct(target, args, newTarget)
        },
      }),
    )
    weekStart('2026-11-01')
    weeksOf([], '2026-10-20', '2026-10-28')
    movingAverage([{ date: '2026-10-27', value: 3 }], 7)
    rangeBounds('all', '2026-10-28')
    daysBetween('2026-10-01', '2026-10-28')
    vi.unstubAllGlobals()
    expect(now).not.toHaveBeenCalled()
    expect(seen.length).toBeGreaterThan(0)
    expect(seen).not.toContain(0)
  })

  it('is client safe: only type imports from server, no Node modules, no DOM or network', () => {
    const raw = readFileSync(new URL('../../src/core/progressview.ts', import.meta.url), 'utf8')
    const source = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    const imports = [...source.matchAll(/^import .*$/gm)].map((m) => m[0])
    for (const line of imports) {
      if (line.includes('server/')) expect(line.startsWith('import type ')).toBe(true)
      expect(line).not.toMatch(/node:/)
    }
    expect(source).not.toMatch(/\b(document|window|fetch|localStorage|Date\.now|performance\.now)\b/)
    expect(source).not.toMatch(/new Date\(\)/)
  })
})
