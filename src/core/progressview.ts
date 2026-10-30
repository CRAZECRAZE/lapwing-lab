// Date and trend helpers for the Progress page. Pure: no DOM, no Node, no clock reads.
// Dates are local `YYYY-MM-DD` strings; weeks start on Monday.
import type { DayStat } from '../../server/archive.ts'
import type { DayQuality } from '../../server/stats.ts'
import { addDays, formatDuration } from './days.ts'

export type RangeId = '4w' | '3m' | 'all'

/** Selectable ranges. `days` is the inclusive length; null means all time (capped at ALL_TIME_DAYS back). */
export const RANGES: readonly { id: RangeId; label: string; days: number | null }[] = [
  { id: '4w', label: '4 weeks', days: 28 },
  { id: '3m', label: '3 months', days: 91 },
  { id: 'all', label: 'All time', days: null },
]

/** `last 4 weeks`, `last 3 months`, `all time`: the period a range stands for, from its own label. */
export function periodText(range: RangeId): string {
  const label = (RANGES.find((r) => r.id === range)?.label ?? '').toLowerCase()
  return range === 'all' ? label : `last ${label}`
}

/** How far back "all time" reaches. The server caps a span (to minus from) at 1,100 days. */
const ALL_TIME_DAYS = 1100

function utcDay(date: string): number {
  const [y, m, d] = date.split('-').map(Number)
  return Date.UTC(y, m - 1, d) / 86400000
}

/** Calendar days from `from` to `to` (negative when `to` is earlier). Immune to daylight saving. */
export function daysBetween(from: string, to: string): number {
  return Math.round(utcDay(to) - utcDay(from))
}

/** The Monday of the week containing a date. A Sunday belongs to the week that began six days before. */
export function weekStart(date: string): string {
  const weekday = new Date(utcDay(date) * 86400000).getUTCDay() // 0 = Sunday
  return addDays(date, -((weekday + 6) % 7))
}

function finite(n: number): number {
  return Number.isFinite(n) ? n : 0
}

/**
 * One entry per Monday-week from the week of `from` to the week of `to`, ascending and zero-filled.
 * Only days inside [from, to] are counted, even when they fall in a boundary week; a day goes to the
 * week of its date, and several rows for one date are summed.
 */
export function weeksOf(
  days: readonly DayStat[],
  from: string,
  to: string,
): { start: string; activeMs: number; strokes: number }[] {
  const weeks: { start: string; activeMs: number; strokes: number }[] = []
  if (from > to) return weeks
  const index = new Map<string, { start: string; activeMs: number; strokes: number }>()
  const last = weekStart(to)
  for (let start = weekStart(from); start <= last; start = addDays(start, 7)) {
    const week = { start, activeMs: 0, strokes: 0 }
    weeks.push(week)
    index.set(start, week)
  }
  for (const day of days) {
    if (day.date < from || day.date > to) continue
    const week = index.get(weekStart(day.date))
    if (!week) continue
    week.activeMs += finite(day.activeMs)
    week.strokes += finite(day.strokes)
  }
  return weeks
}

/**
 * For each date with a value, the mean of the values whose date lies in the trailing `windowDays`
 * calendar days, including the date itself: (date - windowDays, date]. Input may be unsorted; several
 * points on one date are averaged first; non-finite values are ignored. `windowDays` below 1 counts as 1.
 */
export function movingAverage(
  points: readonly { date: string; value: number }[],
  windowDays: number,
): { date: string; value: number }[] {
  const width = Number.isFinite(windowDays) ? Math.max(1, Math.floor(windowDays)) : 1
  const perDate = new Map<string, { sum: number; count: number }>()
  for (const p of points) {
    if (!Number.isFinite(p.value)) continue
    const entry = perDate.get(p.date) ?? { sum: 0, count: 0 }
    entry.sum += p.value
    entry.count++
    perDate.set(p.date, entry)
  }
  const dates = [...perDate.keys()].sort()
  const values = dates.map((d) => {
    const e = perDate.get(d)!
    return e.sum / e.count
  })
  const out: { date: string; value: number }[] = []
  let first = 0
  for (let i = 0; i < dates.length; i++) {
    while (daysBetween(dates[first], dates[i]) >= width) first++
    let sum = 0
    for (let j = first; j <= i; j++) sum += values[j]
    out.push({ date: dates[i], value: sum / (i - first + 1) })
  }
  return out
}

/** A figure needs at least 3 runs behind it. */
export function enough(runs: number): boolean {
  return runs >= 3
}

/** `now - before`, or null when either side is missing or not finite. */
export function change(now: number | null, before: number | null): number | null {
  if (now === null || before === null || !Number.isFinite(now) || !Number.isFinite(before)) return null
  return now - before
}

/** Inclusive date bounds of a range ending today. */
export function rangeBounds(range: RangeId, today: string): { from: string; to: string } {
  const days = RANGES.find((r) => r.id === range)?.days ?? null
  return { from: addDays(today, days === null ? -ALL_TIME_DAYS : -(days - 1)), to: today }
}

/** An inclusive date window. */
export type Window = { from: string; to: string }

export const inWindow = (date: string, w: Window): boolean => date >= w.from && date <= w.to

/** `12,345`: fixed so the text does not depend on the locale of the machine. */
export function thousands(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

/** The sum of a field over the days inside a window; a value that is not a finite number counts as nothing. */
export function sumOf(days: readonly DayStat[], w: Window, field: 'activeMs' | 'strokes'): number {
  let total = 0
  for (const d of days) if (inWindow(d.date, w)) total += finite(d[field])
  return total
}

/**
 * The words-weighted mean of a quality figure over a window, or null when fewer than 3 runs lie behind
 * the window or there are no words to weigh it by. Values that are not finite numbers are left out.
 */
export function qualityMean(days: readonly DayQuality[], w: Window, field: 'wpm' | 'accuracy'): number | null {
  let runs = 0
  let words = 0
  let sum = 0
  for (const d of days) {
    if (!inWindow(d.date, w)) continue
    runs += Number.isFinite(d.runs) ? d.runs : 0
    const value = d[field]
    if (value === null || !Number.isFinite(value) || !Number.isFinite(d.words) || !(d.words > 0)) continue
    words += d.words
    sum += value * d.words
  }
  return enough(runs) && words > 0 ? sum / words : null
}

const signed = (n: number, text: string): string => `${n < 0 ? '-' : '+'}${text}`

/** `+12 min vs last week`; `against` names what the figure is compared with. */
export function timeChange(now: number, before: number, against = 'last week'): string {
  if (now === before) return `same as ${against}`
  return `${signed(now - before, formatDuration(Math.abs(now - before)))} vs ${against}`
}

export function strokesChange(now: number, before: number, against = 'last week'): string {
  if (now === before) return `same as ${against}`
  return `${signed(now - before, thousands(Math.abs(now - before)))} vs ${against}`
}

/** `+1.4 wpm` / `+2.1 points`; a difference that rounds to zero is the same. */
export function decimalChange(diff: number, unit: string, against = 'the 7 days before'): string {
  const text = Math.abs(diff).toFixed(1)
  if (text === '0.0') return `same as ${against}`
  return `${signed(diff, text)} ${unit} vs ${against}`
}

/** Median of a list (the mean of the two middle values when the count is even), rounded to an integer. */
export function medianInt(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return Math.round(sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2)
}
