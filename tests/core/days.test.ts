import { describe, expect, it } from 'vitest'
import { addDays, currentStreak, dayLabel, dayLevel, formatDuration, localDate, longestStreak, monthWeeks } from '../../src/core/days.ts'

describe('localDate', () => {
  it('gives the local calendar day at the start and end of the day', () => {
    expect(localDate(new Date(2026, 9, 27, 0, 0, 0, 0).getTime())).toBe('2026-10-27')
    expect(localDate(new Date(2026, 9, 27, 23, 59, 59, 999).getTime())).toBe('2026-10-27')
  })

  it('zero-pads month and day', () => {
    expect(localDate(new Date(2026, 0, 5, 12, 0, 0, 0).getTime())).toBe('2026-01-05')
  })
})

describe('addDays', () => {
  it('crosses month and year boundaries', () => {
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
  })

  it('adds whole days across daylight saving changes', () => {
    expect(addDays('2026-03-29', 1)).toBe('2026-03-30')
    expect(addDays('2026-10-25', 1)).toBe('2026-10-26')
    expect(addDays('2026-03-08', 1)).toBe('2026-03-09')
    expect(addDays('2026-11-01', 1)).toBe('2026-11-02')
    expect(addDays('2026-10-27', 0)).toBe('2026-10-27')
    expect(addDays('2026-01-01', 365)).toBe('2027-01-01')
  })
})

describe('currentStreak', () => {
  it('counts consecutive days ending today', () => {
    expect(currentStreak(new Set(['2026-10-25', '2026-10-26', '2026-10-27']), '2026-10-27')).toBe(3)
  })

  it('ends yesterday when today is empty', () => {
    expect(currentStreak(new Set(['2026-10-25', '2026-10-26']), '2026-10-27')).toBe(2)
  })

  it('is 0 when neither today nor yesterday is active', () => {
    expect(currentStreak(new Set(['2026-10-24']), '2026-10-27')).toBe(0)
  })

  it('stops at a gap', () => {
    expect(currentStreak(new Set(['2026-10-23', '2026-10-25', '2026-10-26', '2026-10-27']), '2026-10-27')).toBe(3)
  })

  it('is 0 for an empty set', () => {
    expect(currentStreak(new Set(), '2026-10-27')).toBe(0)
  })
})

describe('longestStreak', () => {
  it('is 0 for an empty set and 1 for a single day', () => {
    expect(longestStreak(new Set())).toBe(0)
    expect(longestStreak(new Set(['2026-10-27']))).toBe(1)
  })

  it('picks the longest run when gaps split the days', () => {
    const days = ['2026-10-01', '2026-10-02', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-09']
    expect(longestStreak(new Set(days))).toBe(3)
  })

  it('does not bridge a one day gap', () => {
    expect(longestStreak(new Set(['2026-10-01', '2026-10-03']))).toBe(1)
  })

  it('gives the shared length when two runs tie', () => {
    expect(longestStreak(new Set(['2026-10-01', '2026-10-02', '2026-10-10', '2026-10-11']))).toBe(2)
  })

  it('counts a run in the past even when a later run is shorter', () => {
    expect(longestStreak(new Set(['2026-01-01', '2026-01-02', '2026-01-03', '2026-10-27']))).toBe(3)
  })

  it('counts days across a month end and a year end', () => {
    expect(longestStreak(new Set(['2026-10-31', '2026-11-01', '2026-11-02']))).toBe(3)
    expect(longestStreak(new Set(['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02']))).toBe(4)
  })

  it('counts a leap day and not a missing 29 February', () => {
    expect(longestStreak(new Set(['2028-02-28', '2028-02-29', '2028-03-01']))).toBe(3)
    expect(longestStreak(new Set(['2027-02-28', '2027-03-01']))).toBe(2)
    expect(longestStreak(new Set(['2027-02-28', '2027-03-02']))).toBe(1)
  })

  it('does not depend on the order the days were added', () => {
    expect(longestStreak(new Set(['2026-10-03', '2026-10-01', '2026-10-02']))).toBe(3)
  })

  it('handles a long run of days quickly', () => {
    const days = new Set<string>()
    let day = '2024-01-01'
    for (let i = 0; i < 20000; i++) {
      days.add(day)
      day = addDays(day, 1)
    }
    const started = performance.now()
    expect(longestStreak(days)).toBe(20000)
    expect(performance.now() - started).toBeLessThan(2000)
  })
})

describe('monthWeeks', () => {
  it('lays out October 2026 Monday first', () => {
    const weeks = monthWeeks(2026, 10)
    expect(weeks).toHaveLength(5)
    for (const w of weeks) expect(w).toHaveLength(7)
    expect(weeks[0].slice(0, 4)).toEqual([null, null, null, '2026-10-01'])
    expect(weeks[4]).toEqual(['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', null])
  })

  it('has no padding before the first day when the month starts on Monday', () => {
    const weeks = monthWeeks(2026, 6) // 1 June 2026 is a Monday, 30 June a Tuesday
    expect(weeks[0][0]).toBe('2026-06-01')
    expect(weeks[weeks.length - 1].filter((d) => d === null)).toHaveLength(5)
  })

  it('handles February in a leap year', () => {
    const days = monthWeeks(2028, 2).flat().filter((d) => d !== null)
    expect(days).toHaveLength(29)
    expect(days[28]).toBe('2028-02-29')
  })
})

describe('formatDuration', () => {
  it('formats under a minute, minutes and hours', () => {
    expect(formatDuration(0)).toBe('<1 min')
    expect(formatDuration(45 * 1000)).toBe('<1 min')
    expect(formatDuration(12 * 60000)).toBe('12 min')
    expect(formatDuration(65 * 60000)).toBe('1 h 05 min')
  })

  it('handles the 60 minute boundary', () => {
    expect(formatDuration(60 * 60000)).toBe('1 h 00 min')
    expect(formatDuration(59 * 60000 + 59999)).toBe('59 min')
    expect(formatDuration(60000)).toBe('1 min')
  })
})

describe('dayLabel', () => {
  it('formats weekday, day, month and year', () => {
    expect(dayLabel('2026-10-27')).toBe('Tue 27 Oct 2026')
    expect(dayLabel('2026-01-05')).toBe('Mon 5 Jan 2026')
  })
})

describe('dayLevel', () => {
  const MIN = 60000
  it('is 0 for no practice, then steps at 10 and 30 minutes (the Days tab shading)', () => {
    expect(dayLevel(0)).toBe(0)
    expect(dayLevel(1)).toBe(1)
    expect(dayLevel(10 * MIN - 1)).toBe(1)
    expect(dayLevel(10 * MIN)).toBe(2)
    expect(dayLevel(30 * MIN - 1)).toBe(2)
    expect(dayLevel(30 * MIN)).toBe(3)
    expect(dayLevel(10 * 60 * MIN)).toBe(3)
  })

  it('is 0 for a value that is not a time', () => {
    expect(dayLevel(Number.NaN)).toBe(0)
    expect(dayLevel(-5)).toBe(0)
  })
})
