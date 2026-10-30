import { describe, expect, it } from 'vitest'
import type { ChapterInfo } from '../../scripts/build-content.ts'
import type { DayStat, ProgressMark, SectionResult } from '../../server/archive.ts'
import type { DayQuality } from '../../server/stats.ts'
import type { ResultsByMode } from '../../src/core/progress.ts'
import {
  chapterPassDates,
  isMonthComplete,
  monthBounds,
  monthKey,
  monthName,
  monthsBetween,
  monthTitle,
  previousMonth,
  reportTiles,
} from '../../src/core/report.ts'
import type { ReportTilesInput } from '../../src/core/report.ts'

describe('month helpers', () => {
  it('monthKey cuts a date to its month', () => {
    expect(monthKey('2026-10-30')).toBe('2026-10')
  })

  it('monthBounds covers the whole month, leap February included', () => {
    expect(monthBounds('2028-02')).toEqual({ from: '2028-02-01', to: '2028-02-29' })
    expect(monthBounds('2027-02')).toEqual({ from: '2027-02-01', to: '2027-02-28' })
    expect(monthBounds('2026-12')).toEqual({ from: '2026-12-01', to: '2026-12-31' })
    expect(monthBounds('2026-10')).toEqual({ from: '2026-10-01', to: '2026-10-31' })
    expect(monthBounds('2026-04')).toEqual({ from: '2026-04-01', to: '2026-04-30' })
  })

  it('rejects an invalid month with a RangeError', () => {
    for (const bad of ['2026-13', '2026-00', '2026-1', 'nope', '']) {
      expect(() => monthBounds(bad)).toThrow(RangeError)
      expect(() => previousMonth(bad)).toThrow(RangeError)
      expect(() => monthName(bad)).toThrow(RangeError)
    }
  })

  it('previousMonth steps back across a year', () => {
    expect(previousMonth('2026-01')).toBe('2025-12')
    expect(previousMonth('2026-10')).toBe('2026-09')
  })

  it('monthsBetween is ascending and inclusive', () => {
    expect(monthsBetween('2026-10', '2027-01')).toEqual(['2026-10', '2026-11', '2026-12', '2027-01'])
    expect(monthsBetween('2026-10', '2026-10')).toEqual(['2026-10'])
    expect(monthsBetween('2026-11', '2026-10')).toEqual([])
  })

  it('isMonthComplete is true from the last day on', () => {
    expect(isMonthComplete('2026-10', '2026-10-31')).toBe(true)
    expect(isMonthComplete('2026-10', '2026-11-02')).toBe(true)
    expect(isMonthComplete('2026-10', '2026-10-30')).toBe(false)
    expect(isMonthComplete('2026-10', '2026-09-30')).toBe(false)
    expect(isMonthComplete('2028-02', '2028-02-28')).toBe(false)
    expect(isMonthComplete('2028-02', '2028-02-29')).toBe(true)
  })

  it('names months', () => {
    expect(monthName('2026-10')).toBe('October')
    expect(monthName('2026-01')).toBe('January')
    expect(monthTitle('2026-10')).toBe('October 2026')
  })
})

const CHAPTERS: ChapterInfo[] = [
  { chapter: 4, pageId: 'c4', title: 'Four', gate: 'stage0', passMark: { accuracy: 0.9 }, listIds: [] },
  { chapter: 5, pageId: 'c5', title: 'Five', gate: 'test', passMark: { accuracy: 0.9 }, testListId: '5-test', listIds: [] },
  { chapter: 6, pageId: 'c6', title: 'Six', gate: 'test', passMark: { accuracy: 0.9 }, testListId: '6-test', listIds: [] },
  { chapter: 12, pageId: 'c12', title: 'Twelve', gate: 'drills', listIds: ['12-a'] },
  { chapter: 18, pageId: 'c18', title: 'Eighteen', gate: 'read', listIds: [] },
]

function res(section: string, firstPassedAt: number | null): SectionResult {
  return { section, runs: 1, passed: firstPassedAt !== null, best: { accuracy: 1, wpm: 20 }, last: null, firstPassedAt }
}
function results(r: Partial<ResultsByMode> = {}): ResultsByMode {
  return { stage0: [], section: [], 'chapter-test': [], ...r }
}
const at = (y: number, m: number, d: number, h = 12, min = 0): number => new Date(y, m - 1, d, h, min).getTime()

describe('chapterPassDates', () => {
  it('is empty with no evidence', () => {
    expect(chapterPassDates(CHAPTERS, results(), []).size).toBe(0)
  })

  it('reads the Stage 0 and chapter test passes as local dates', () => {
    const dates = chapterPassDates(
      CHAPTERS,
      results({ stage0: [res('pseudo-test', at(2026, 10, 30))], 'chapter-test': [res('5-test', at(2026, 11, 2))] }),
      [],
    )
    expect(dates.get(4)).toBe('2026-10-30')
    expect(dates.get(5)).toBe('2026-11-02')
    expect(dates.has(6)).toBe(false)
  })

  it('takes the earlier of the test pass and a mark', () => {
    const r = results({ 'chapter-test': [res('5-test', at(2026, 11, 2))], stage0: [res('pseudo-test', at(2026, 10, 1))] })
    const marks: ProgressMark[] = [
      { chapter: 5, kind: 'override', at: at(2026, 10, 20) },
      { chapter: 4, kind: 'read', at: at(2026, 10, 9) },
    ]
    const dates = chapterPassDates(CHAPTERS, r, marks)
    expect(dates.get(5)).toBe('2026-10-20')
    expect(dates.get(4)).toBe('2026-10-01')
  })

  it('counts a drills chapter by its mark only', () => {
    const r = results({ section: [res('12-a', at(2026, 10, 3))] })
    expect(chapterPassDates(CHAPTERS, r, []).has(12)).toBe(false)
    expect(chapterPassDates(CHAPTERS, r, [{ chapter: 12, kind: 'override', at: at(2026, 10, 8) }]).get(12)).toBe('2026-10-08')
  })

  it('counts a read chapter by its mark', () => {
    expect(chapterPassDates(CHAPTERS, results(), [{ chapter: 18, kind: 'read', at: at(2026, 10, 8) }]).get(18)).toBe('2026-10-08')
  })

  it('ignores a result that never passed and a mark for an unknown chapter', () => {
    const dates = chapterPassDates(CHAPTERS, results({ 'chapter-test': [res('5-test', null)] }), [
      { chapter: 99, kind: 'read', at: at(2026, 10, 8) },
    ])
    expect(dates.size).toBe(0)
  })

  it('ignores a mark whose time is not a number', () => {
    expect(chapterPassDates(CHAPTERS, results(), [{ chapter: 18, kind: 'read', at: Number.NaN }]).has(18)).toBe(false)
  })

  it('uses local time: a minute before local midnight is still that day', () => {
    const dates = chapterPassDates(CHAPTERS, results({ 'chapter-test': [res('5-test', at(2026, 10, 31, 23, 59))] }), [])
    expect(dates.get(5)).toBe('2026-10-31')
  })

  it('lists each chapter once', () => {
    const dates = chapterPassDates([...CHAPTERS, CHAPTERS[0]], results({ stage0: [res('pseudo-test', at(2026, 10, 1))] }), [
      { chapter: 4, kind: 'read', at: at(2026, 10, 2) },
    ])
    expect([...dates.keys()].filter((k) => k === 4)).toHaveLength(1)
  })
})

function q(date: string, over: Partial<DayQuality> = {}): DayQuality {
  return { date, runs: 2, words: 100, wpm: 30, accuracy: 0.95, steadiness: 80, ...over }
}
function stat(date: string, activeMs: number, strokes: number): DayStat {
  return { date, tests: 1, strokes, activeMs }
}
function input(over: Partial<ReportTilesInput> = {}): ReportTilesInput {
  return { month: [], previous: [], time: [], previousTime: [], chapters: [], firstMonth: false, previousName: 'September', ...over }
}

const SCOLDING = /\b(worse|slower|dropped|declin|fell|bad|poor|only|behind|slipp|try|should|must|need)/i

function allText(t: ReturnType<typeof reportTiles>): string[] {
  return Object.values(t).flatMap((x) => [x.label, x.value ?? '', x.subline ?? ''])
}

describe('reportTiles: first month', () => {
  const first = input({
    firstMonth: true,
    month: [q('2026-10-05', { wpm: 22, accuracy: 0.9, steadiness: 70 }), q('2026-10-12', { wpm: 30 }), q('2026-10-28', { wpm: 41, accuracy: 0.96 })],
    time: [stat('2026-10-05', 600000, 1000), stat('2026-10-12', 1200000, 2500)],
  })

  it('has a first day / last day subline on wpm and accuracy only', () => {
    const t = reportTiles(first)
    expect(t.wpm.subline).toBe('first day 22, last day 41')
    expect(t.accuracy.subline).toBe('first day 90.0%, last day 96.0%')
    expect(t.steadiness.subline).toBeNull()
    expect(t.time.subline).toBeNull()
    expect(t.strokes.subline).toBeNull()
    expect(t.chapters.subline).toBeNull()
  })

  it('has no first/last subline with a single free-type day', () => {
    const t = reportTiles(input({ firstMonth: true, month: [q('2026-10-05', { runs: 3 })] }))
    expect(t.wpm.subline).toBeNull()
    expect(t.accuracy.subline).toBeNull()
  })

  it('formats the values', () => {
    const t = reportTiles(first)
    expect(t.time.value).toBe('30 min')
    expect(t.strokes.value).toBe('3,500')
    expect(t.wpm.value).toBe('31.0 wpm')
    expect(t.accuracy.value).toBe('93.7%')
    expect(t.steadiness.value).toBe('80')
    expect(t.chapters.value).toBe('0')
  })
})

describe('reportTiles: later month', () => {
  const base = input({
    month: [q('2026-10-05', { runs: 2, wpm: 40, accuracy: 0.97, steadiness: 85 }), q('2026-10-06', { runs: 2, wpm: 40, accuracy: 0.97, steadiness: 85 })],
    previous: [q('2026-09-05', { runs: 3, wpm: 21, accuracy: 0.92, steadiness: 80 })],
    time: [stat('2026-10-05', 3600000, 6000)],
    previousTime: [stat('2026-09-05', 1800000, 4000)],
  })

  it('shows changes against the previous month by name', () => {
    const t = reportTiles(base)
    expect(t.wpm.subline).toBe('+19.0 wpm vs September')
    expect(t.accuracy.subline).toBe('+5.0 points vs September')
    expect(t.steadiness.subline).toBe('+5 vs September')
    expect(t.time.subline).toBe('+30 min vs September')
    expect(t.strokes.subline).toBe('+2,000 vs September')
  })

  it('words a worse change plainly', () => {
    const t = reportTiles(
      input({
        month: [q('2026-10-05', { runs: 3, wpm: 20, accuracy: 0.9, steadiness: 70 })],
        previous: [q('2026-09-05', { runs: 3, wpm: 25, accuracy: 0.95, steadiness: 80 })],
        time: [stat('2026-10-05', 600000, 1000)],
        previousTime: [stat('2026-09-05', 1800000, 4000)],
      }),
    )
    expect(t.wpm.subline).toBe('-5.0 wpm vs September')
    expect(t.accuracy.subline).toBe('-5.0 points vs September')
    expect(t.steadiness.subline).toBe('-10 vs September')
    expect(t.time.subline).toBe('-20 min vs September')
    expect(t.strokes.subline).toBe('-3,000 vs September')
    for (const text of allText(t)) expect(text).not.toMatch(SCOLDING)
  })

  it('says same when a change rounds to nothing', () => {
    const t = reportTiles(
      input({
        month: [q('2026-10-05', { runs: 3, wpm: 30, steadiness: 80 })],
        previous: [q('2026-09-05', { runs: 3, wpm: 30.02, steadiness: 80 })],
        time: [stat('2026-10-05', 600000, 1000)],
        previousTime: [stat('2026-09-05', 600000, 1000)],
      }),
    )
    expect(t.wpm.subline).toBe('same as September')
    expect(t.steadiness.subline).toBe('same as September')
    expect(t.time.subline).toBe('same as September')
    expect(t.strokes.subline).toBe('same as September')
  })

  it('has no change when the previous month has no figure or no practice', () => {
    const t = reportTiles(input({ ...base, previous: [q('2026-09-05', { runs: 2 })], previousTime: [] }))
    expect(t.wpm.subline).toBeNull()
    expect(t.accuracy.subline).toBeNull()
    expect(t.steadiness.subline).toBeNull()
    expect(t.time.subline).toBeNull()
    expect(t.strokes.subline).toBeNull()
  })

  it('does not compare time when this month has none', () => {
    const t = reportTiles(input({ previousTime: [stat('2026-09-05', 1800000, 4000)] }))
    expect(t.time.subline).toBeNull()
    expect(t.strokes.subline).toBeNull()
  })

  it('first month never compares even if previous data is passed', () => {
    const t = reportTiles({ ...base, firstMonth: true })
    expect(t.time.subline).toBeNull()
    expect(t.strokes.subline).toBeNull()
    expect(t.steadiness.subline).toBeNull()
  })
})

describe('reportTiles: too few runs', () => {
  it('gives a null value and the not-enough line under 3 runs', () => {
    const t = reportTiles(input({ month: [q('2026-10-05', { runs: 1 }), q('2026-10-06', { runs: 1 })] }))
    for (const tile of [t.wpm, t.accuracy, t.steadiness]) {
      expect(tile.value).toBeNull()
      expect(tile.subline).toBe('not enough runs yet')
    }
  })

  it('counts runs across days: 3 is enough', () => {
    const t = reportTiles(input({ month: [q('2026-10-05', { runs: 1 }), q('2026-10-06', { runs: 2 })] }))
    expect(t.wpm.value).not.toBeNull()
  })

  it('steadiness needs a day with a value', () => {
    const t = reportTiles(input({ month: [q('2026-10-05', { runs: 5, steadiness: null })] }))
    expect(t.wpm.value).not.toBeNull()
    expect(t.steadiness.value).toBeNull()
    expect(t.steadiness.subline).toBe('not enough runs yet')
  })

  it('a null value when words are zero', () => {
    const t = reportTiles(input({ month: [q('2026-10-05', { runs: 5, words: 0, wpm: null, accuracy: null })] }))
    expect(t.wpm.value).toBeNull()
    expect(t.accuracy.value).toBeNull()
  })

  it('compares against a previous month with too few runs as no comparison', () => {
    const t = reportTiles(input({ month: [q('2026-10-05', { runs: 4 })], previous: [q('2026-09-05', { runs: 2 })] }))
    expect(t.wpm.subline).toBeNull()
  })
})

describe('reportTiles: chapters and time', () => {
  it('lists chapters with ordinal days', () => {
    const t = reportTiles(input({ chapters: [{ chapter: 4, date: '2026-10-30' }] }))
    expect(t.chapters.value).toBe('1')
    expect(t.chapters.subline).toBe('ch 4 on the 30th')
  })

  it('joins several, ascending by chapter, with all ordinal forms', () => {
    const t = reportTiles(
      input({
        chapters: [
          { chapter: 6, date: '2026-10-23' },
          { chapter: 5, date: '2026-10-01' },
          { chapter: 7, date: '2026-10-02' },
          { chapter: 8, date: '2026-10-11' },
          { chapter: 9, date: '2026-10-12' },
          { chapter: 10, date: '2026-10-13' },
        ],
      }),
    )
    expect(t.chapters.value).toBe('6')
    expect(t.chapters.subline).toBe(
      'ch 5 on the 1st, ch 6 on the 23rd, ch 7 on the 2nd, ch 8 on the 11th, ch 9 on the 12th, ch 10 on the 13th',
    )
  })

  it('shows zero time as a dash-free 0 min', () => {
    const t = reportTiles(input())
    expect(t.time.value).toBe('0 min')
    expect(t.strokes.value).toBe('0')
  })

  it('has labels', () => {
    const t = reportTiles(input())
    expect(Object.keys(t).sort()).toEqual(['accuracy', 'chapters', 'steadiness', 'strokes', 'time', 'wpm'])
    for (const tile of Object.values(t)) expect(tile.label.length).toBeGreaterThan(0)
  })
})

describe('reportTiles: finite output', () => {
  it('never prints NaN or Infinity for empty and odd input', () => {
    const odd = input({
      firstMonth: true,
      month: [
        q('2026-10-01', { runs: 5, words: Number.NaN, wpm: Number.NaN, accuracy: Number.POSITIVE_INFINITY, steadiness: Number.NaN }),
        q('2026-10-02', { runs: 5, words: -3, wpm: 10, accuracy: 0.5, steadiness: Number.POSITIVE_INFINITY }),
        q('2026-10-03', { runs: Number.NaN }),
      ],
      previous: [q('2026-09-01', { runs: 5, wpm: Number.NaN })],
      time: [stat('2026-10-01', Number.NaN, Number.POSITIVE_INFINITY), stat('2026-10-02', -5, -5)],
      previousTime: [stat('2026-09-01', Number.POSITIVE_INFINITY, 4)],
    })
    for (const i of [input(), odd, { ...odd, firstMonth: false }]) {
      for (const text of allText(reportTiles(i))) expect(text).not.toMatch(/NaN|Infinity/)
    }
  })
})
