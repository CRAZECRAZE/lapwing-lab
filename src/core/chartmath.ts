// The arithmetic behind the Progress charts. Pure: no DOM, no Node, no clock reads.
// Everything returned here ends up in an SVG attribute, so none of it may be NaN or Infinity: a value that
// is not finite is replaced by a finite one (0, the middle of a range) rather than passed on.
import { formatDuration } from './days.ts'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MINUTE = 60000

/** A finite number rounded to two decimals; anything else is 0. The one gate every coordinate passes through. */
export function num(n: number): number {
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0
}

/** A finite stand-in for a value that overflowed: NaN is 0, and the infinities are the largest numbers a double holds. */
export function cap(n: number): number {
  if (Number.isNaN(n)) return 0
  if (n === Infinity) return Number.MAX_VALUE
  if (n === -Infinity) return -Number.MAX_VALUE
  return n
}

/**
 * A function from the domain to the range, linear and unclamped. A domain without width (all values equal,
 * a single point) or a bad end puts everything in the middle of the range; the result is always finite.
 */
export function scaleLinear(
  domain: readonly [number, number],
  range: readonly [number, number],
): (value: number) => number {
  const [d0, d1] = domain
  const [r0, r1] = range
  const mid = Number.isFinite(r0) && Number.isFinite(r1) ? r0 + (r1 - r0) / 2 : 0
  const width = d1 - d0
  if (!Number.isFinite(width) || width === 0 || !Number.isFinite(r0) || !Number.isFinite(r1)) return () => mid
  return (value) => {
    const out = r0 + ((value - d0) / width) * (r1 - r0)
    return Number.isFinite(out) ? out : mid
  }
}

/** Rounds a value up to 1, 2 or 5 times a power of ten (17 gives 20, 90 gives 100). Zero or a bad value gives 1. */
export function niceMax(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1
  const power = 10 ** Math.floor(Math.log10(value))
  if (!(power > 0)) return value // below the smallest power of ten a double holds
  const fraction = Math.round((value / power) * 1e9) / 1e9
  const step = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10
  const out = step * power
  return Number.isFinite(out) ? out : Number.MAX_VALUE
}

const isNice = (n: number): boolean => Math.abs(niceMax(n) - n) <= n * 1e-9

/** Axis tick values from 0 to `max` (a niceMax value) in 2 to 5 even steps, the last one on the max. */
export function ticks(max: number): number[] {
  if (!Number.isFinite(max) || max <= 0) return [0]
  for (const count of [4, 5, 2]) {
    if (!isNice(max / count)) continue
    const out: number[] = []
    for (let i = 0; i <= count; i++) out.push(Math.round(((max * i) / count) * 1e9) / 1e9)
    if (out.every(Number.isFinite)) return out
  }
  return [0, max]
}

/** An axis for a duration: whole-minute or whole-hour steps, at most 5 of them, from 0 to a max that is a step multiple. */
export function timeAxis(maxMs: number): { max: number; ticks: number[] } {
  const wanted = Number.isFinite(maxMs) && maxMs > 0 ? maxMs : MINUTE
  const steps = [1, 2, 5, 10, 15, 30].map((m) => m * MINUTE)
  let step = steps.find((s) => wanted / s <= 5)
  for (let hours = 1; step === undefined; hours = nextHours(hours)) {
    const s = hours * 60 * MINUTE
    if (wanted / s <= 5) step = s
  }
  const count = Math.max(1, Math.ceil(wanted / step))
  const out: number[] = []
  for (let i = 0; i <= count; i++) {
    const t = i * step
    if (!Number.isFinite(t)) break
    out.push(t)
  }
  return { max: out[out.length - 1], ticks: out }
}

/** 1, 2, 5, 10, 20, 50 ...: the next whole-hour step. */
function nextHours(hours: number): number {
  const next = niceMax(hours * 1.0000001)
  return next > hours ? next : hours * 2
}

/** `0 min`, `<1 min`, `12 min`, `1 h 05 min`: `formatDuration`, but an exact zero reads `0 min`. */
export function durationText(ms: number): string {
  return ms > 0 ? formatDuration(ms) : '0 min'
}

/** `30 min`, `1 h 30 min`, `2 h`: a duration for an axis, without the padded minutes. */
export function tickDuration(ms: number): string {
  const minutes = Math.floor(ms / MINUTE)
  return minutes >= 60 && minutes % 60 === 0 ? `${minutes / 60} h` : durationText(ms)
}

/** An SVG path through the points (`M x yL x y`); points that are not finite are left out. */
export function linePath(points: readonly { x: number; y: number }[]): string {
  return points
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${num(p.x)} ${num(p.y)}`)
    .join('')
}

/** Day offsets 0 .. `span` for the labels of a date axis: every day of a short span, else at most `max` evenly spread. */
export function dateTickOffsets(span: number, max: number): number[] {
  const last = Number.isFinite(span) ? Math.max(0, Math.floor(span)) : 0
  const slots = Math.max(1, Math.floor(max))
  if (last + 1 <= slots) return Array.from({ length: last + 1 }, (_, i) => i)
  const step = Math.ceil(last / (slots - 1))
  const out: number[] = []
  for (let offset = 0; offset <= last; offset += step) out.push(offset)
  return out
}

/** `Oct 3`, or `Oct 3 2026` with the year. Built from the date parts: no locale, no timezone. */
export function shortDate(date: string, withYear = false): string {
  const [y, m, d] = date.split('-').map(Number)
  const text = `${MONTHS[m - 1]} ${d}`
  return withYear ? `${text} ${y}` : text
}

/** The point with the highest value (the earliest of equals), or null for none. */
export function bestPoint<T extends { value: number }>(points: readonly T[]): T | null {
  let best: T | null = null
  for (const p of points) if (best === null || p.value > best.value) best = p
  return best
}

/** `842`, `1k`, `11.3k`: a count short enough to sit under a narrow bar. */
export function compactCount(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0'
  if (n < 1000) return String(Math.round(n))
  return `${(Math.round(n / 100) / 10).toString()}k`
}
