// The month-end report's arithmetic: month helpers, the date each chapter was first passed, and the six tiles.
// Pure: no DOM, no fetch, no Node. Months are `YYYY-MM`, dates local `YYYY-MM-DD`.
import type { ChapterInfo } from '../../scripts/build-content.ts'
import type { DayStat, ProgressMark } from '../../server/archive.ts'
import type { DayQuality } from '../../server/stats.ts'
import { isYearMonth } from './dates.ts'
import { addDays, formatDuration, localDate } from './days.ts'
import { resultOf } from './progress.ts'
import type { ResultsByMode } from './progress.ts'
import {
  change,
  decimalChange,
  enough,
  medianInt,
  qualityMean,
  strokesChange,
  sumOf,
  thousands,
  timeChange,
} from './progressview.ts'
import type { Window } from './progressview.ts'

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

function parseMonth(month: string): { y: number; m: number } {
  if (!isYearMonth(month)) throw new RangeError(`not a month: ${String(month)}`)
  const [y, m] = month.split('-').map(Number)
  return { y, m }
}

function formatMonth(y: number, m: number): string {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}`
}

/** The month a date falls in: `2026-10-30` -> `2026-10`. */
export function monthKey(date: string): string {
  return date.slice(0, 7)
}

/** The first and last local date of a month. Throws a RangeError for anything but a valid `YYYY-MM`. */
export function monthBounds(month: string): { from: string; to: string } {
  const { y, m } = parseMonth(month)
  const next = m === 12 ? formatMonth(y + 1, 1) : formatMonth(y, m + 1)
  return { from: `${month}-01`, to: addDays(`${next}-01`, -1) }
}

/** The calendar month before: `2026-01` -> `2025-12`. */
export function previousMonth(month: string): string {
  const { y, m } = parseMonth(month)
  return m === 1 ? formatMonth(y - 1, 12) : formatMonth(y, m - 1)
}

/** Every month from `first` to `last`, ascending and inclusive; empty when `last` is before `first`. */
export function monthsBetween(first: string, last: string): string[] {
  const a = parseMonth(first)
  parseMonth(last)
  const months: string[] = []
  for (let y = a.y, m = a.m, key = first; key <= last; ) {
    months.push(key)
    if (m === 12) {
      y++
      m = 1
    } else m++
    key = formatMonth(y, m)
  }
  return months
}

/** True when `today` is the month's last day or later. */
export function isMonthComplete(month: string, today: string): boolean {
  return today >= monthBounds(month).to
}

/** `2026-10` -> `October`. */
export function monthName(month: string): string {
  return MONTH_NAMES[parseMonth(month).m - 1]
}

/** `2026-10` -> `October 2026`. */
export function monthTitle(month: string): string {
  return `${monthName(month)} ${parseMonth(month).y}`
}

/**
 * The local date each chapter was first passed: the earliest of its test's `firstPassedAt` (Stage 0 for the `stage0`
 * gate, the chapter test for `test`; a `drills` or `read` gate has no test evidence) and any progress mark for it.
 * A chapter with no evidence is absent.
 */
export function chapterPassDates(
  chapters: readonly ChapterInfo[],
  results: ResultsByMode,
  marks: readonly ProgressMark[],
): Map<number, string> {
  const dates = new Map<number, string>()
  for (const info of chapters) {
    const times: number[] = []
    if (info.gate === 'stage0' || info.gate === 'test') {
      const first = resultOf(info, results)?.firstPassedAt
      if (typeof first === 'number' && Number.isFinite(first)) times.push(first)
    }
    for (const mark of marks) if (mark.chapter === info.chapter && Number.isFinite(mark.at)) times.push(mark.at)
    if (times.length > 0) dates.set(info.chapter, localDate(Math.min(...times)))
  }
  return dates
}

export type ReportTilesInput = {
  /** The month's free-type days (`/api/stats`, mode free). */
  month: DayQuality[]
  /** The previous calendar month's free-type days. */
  previous: DayQuality[]
  /** The month's days across every mode (`/api/days`). */
  time: DayStat[]
  /** The previous month's days across every mode. */
  previousTime: DayStat[]
  /** The chapters first passed in the month, with the local date. */
  chapters: { chapter: number; date: string }[]
  /** No earlier month has any practice. */
  firstMonth: boolean
  /** The previous month's name, e.g. `September`, for the change lines. */
  previousName: string
}

/** A value of null means too few runs: the line under it then says `not enough runs yet`. */
export type ReportTile = { label: string; value: string | null; subline: string | null }

export type ReportTiles = {
  time: ReportTile
  strokes: ReportTile
  wpm: ReportTile
  accuracy: ReportTile
  steadiness: ReportTile
  chapters: ReportTile
}

const MISSING = 'not enough runs yet'
const EVERYTHING: Window = { from: '', to: '￿' }

const finiteOr0 = (n: number): number => (Number.isFinite(n) ? n : 0)

/** `1st`, `2nd`, `3rd`, `4th`, `11th`, `22nd`. */
function ordinal(n: number): string {
  const tens = n % 100
  if (tens >= 11 && tens <= 13) return `${n}th`
  return `${n}${({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'}`
}

const wpmText = (n: number): string => `${n.toFixed(1)} wpm`
const percentText = (accuracy: number): string => `${(accuracy * 100).toFixed(1)}%`

/** The first and last free-type day that has a wpm, or null when fewer than two days do. Accuracy follows the same days. */
function endpoints(days: readonly DayQuality[], field: 'wpm' | 'accuracy'): { first: number; last: number } | null {
  const dated = days
    .filter((d) => typeof d.wpm === 'number' && Number.isFinite(d.wpm) && typeof d[field] === 'number' && Number.isFinite(d[field]))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  if (dated.length < 2) return null
  return { first: dated[0][field] as number, last: dated[dated.length - 1][field] as number }
}

/** The month report's six tiles. Every figure is finite; one on fewer than 3 free-type runs is null. */
export function reportTiles(input: ReportTilesInput): ReportTiles {
  const { month, previous, time, previousTime, firstMonth, previousName } = input

  const runs = month.reduce((sum, d) => sum + finiteOr0(d.runs), 0)
  const steady = month.map((d) => d.steadiness).filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
  const wpm = qualityMean(month, EVERYTHING, 'wpm')
  const accuracy = qualityMean(month, EVERYTHING, 'accuracy')
  const steadiness = enough(runs) && steady.length > 0 ? medianInt(steady) : null
  const wpmBefore = firstMonth ? null : qualityMean(previous, EVERYTHING, 'wpm')
  const accuracyBefore = firstMonth ? null : qualityMean(previous, EVERYTHING, 'accuracy')
  const steadinessBefore = firstMonth ? null : previousSteadiness(previous)

  const wpmDiff = change(wpm, wpmBefore)
  const accuracyDiff = change(accuracy, accuracyBefore)
  const steadinessDiff = change(steadiness, steadinessBefore)

  const timeNow = sumOf(time, EVERYTHING, 'activeMs')
  const timeBefore = sumOf(previousTime, EVERYTHING, 'activeMs')
  const strokesNow = sumOf(time, EVERYTHING, 'strokes')
  const strokesBefore = sumOf(previousTime, EVERYTHING, 'strokes')

  const wpmRange = firstMonth ? endpoints(month, 'wpm') : null
  const accuracyRange = firstMonth ? endpoints(month, 'accuracy') : null

  const tile = (label: string, value: string | null, subline: string | null): ReportTile =>
    value === null ? { label, value: null, subline: MISSING } : { label, value, subline }

  const chapters = [...input.chapters].sort((a, b) => a.chapter - b.chapter)

  return {
    time: {
      label: 'Practice time',
      value: timeNow > 0 ? formatDuration(timeNow) : '0 min',
      subline: !firstMonth && timeNow > 0 && timeBefore > 0 ? timeChange(timeNow, timeBefore, previousName) : null,
    },
    strokes: {
      label: 'Strokes',
      value: thousands(strokesNow),
      subline: !firstMonth && strokesNow > 0 && strokesBefore > 0 ? strokesChange(strokesNow, strokesBefore, previousName) : null,
    },
    wpm: tile(
      'Free-type wpm',
      wpm === null ? null : wpmText(wpm),
      wpmRange
        ? `first day ${Math.round(wpmRange.first)}, last day ${Math.round(wpmRange.last)}`
        : wpmDiff === null
          ? null
          : decimalChange(wpmDiff, 'wpm', previousName),
    ),
    accuracy: tile(
      'Accuracy',
      accuracy === null ? null : percentText(accuracy),
      accuracyRange
        ? `first day ${percentText(accuracyRange.first)}, last day ${percentText(accuracyRange.last)}`
        : accuracyDiff === null
          ? null
          : decimalChange(accuracyDiff * 100, 'points', previousName),
    ),
    steadiness: tile(
      'Steadiness',
      steadiness === null ? null : String(steadiness),
      steadinessDiff === null ? null : steadinessChange(steadinessDiff, previousName),
    ),
    chapters: {
      label: 'Chapters passed',
      value: String(chapters.length),
      subline:
        chapters.length === 0
          ? null
          : chapters.map((c) => `ch ${c.chapter} on the ${ordinal(Number(c.date.slice(8, 10)))}`).join(', '),
    },
  }
}

/** The previous month's steadiness, on the same terms as this month's: 3 runs and a day with a value. */
function previousSteadiness(days: readonly DayQuality[]): number | null {
  const runs = days.reduce((sum, d) => sum + finiteOr0(d.runs), 0)
  const steady = days.map((d) => d.steadiness).filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
  return enough(runs) && steady.length > 0 ? medianInt(steady) : null
}

function steadinessChange(diff: number, against: string): string {
  if (diff === 0) return `same as ${against}`
  return `${diff < 0 ? '-' : '+'}${Math.abs(Math.round(diff))} vs ${against}`
}
