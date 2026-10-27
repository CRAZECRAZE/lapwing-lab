import { describe, expect, it } from 'vitest'
import { addDays, currentStreak, dayLabel, formatDuration, localDate, monthWeeks } from '../../src/core/days.ts'

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
