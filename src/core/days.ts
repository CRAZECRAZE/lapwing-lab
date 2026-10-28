// Calendar helpers on local `YYYY-MM-DD` dates. Weeks start on Monday. Pure: no DOM, no Node.

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function format(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, '0')}-${pad(m)}-${pad(d)}`
}

function parse(date: string): { y: number; m: number; d: number } {
  const [y, m, d] = date.split('-').map(Number)
  return { y, m, d }
}

/** The local calendar date of a timestamp. */
export function localDate(ms: number): string {
  const d = new Date(ms)
  return format(d.getFullYear(), d.getMonth() + 1, d.getDate())
}

/** Adds whole days to a date. Works at local noon so a daylight saving change cannot shift the day. */
export function addDays(date: string, n: number): string {
  const { y, m, d } = parse(date)
  const t = new Date(y, m - 1, d + n, 12)
  return format(t.getFullYear(), t.getMonth() + 1, t.getDate())
}

/** Consecutive active days ending today, or ending yesterday when today is not active yet. */
export function currentStreak(activeDates: ReadonlySet<string>, today: string): number {
  let day = activeDates.has(today) ? today : addDays(today, -1)
  let streak = 0
  while (activeDates.has(day)) {
    streak++
    day = addDays(day, -1)
  }
  return streak
}

/** The longest run of consecutive active days; 0 for an empty set. Linear: each run is walked once, from its first day. */
export function longestStreak(activeDates: ReadonlySet<string>): number {
  let best = 0
  for (const date of activeDates) {
    if (activeDates.has(addDays(date, -1))) continue
    let length = 1
    let day = addDays(date, 1)
    while (activeDates.has(day)) {
      length++
      day = addDays(day, 1)
    }
    if (length > best) best = length
  }
  return best
}

/** Rows of 7 (Monday first) covering a month; days outside the month are null. `month` is 1-12. */
export function monthWeeks(year: number, month: number): (string | null)[][] {
  const lead = (new Date(year, month - 1, 1, 12).getDay() + 6) % 7
  const length = new Date(year, month, 0, 12).getDate()
  const cells: (string | null)[] = Array.from({ length: lead }, () => null)
  for (let d = 1; d <= length; d++) cells.push(format(year, month, d))
  while (cells.length % 7 !== 0) cells.push(null)
  const weeks: (string | null)[][] = []
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))
  return weeks
}

/**
 * How strongly a day is shaded on the Days tab and the year heatmap: 0 no practice, 1 under 10 minutes, 2 under 30,
 * 3 more. A time that is not a positive number is no practice.
 */
export function dayLevel(activeMs: number): 0 | 1 | 2 | 3 {
  if (!(activeMs > 0)) return 0
  if (activeMs < 10 * 60000) return 1
  if (activeMs < 30 * 60000) return 2
  return 3
}

/** '<1 min', '12 min' or '1 h 05 min'. */
export function formatDuration(ms: number): string {
  const minutes = Math.floor(ms / 60000)
  if (minutes < 1) return '<1 min'
  if (minutes < 60) return `${minutes} min`
  return `${Math.floor(minutes / 60)} h ${pad(minutes % 60)} min`
}

/** e.g. 'Tue 27 Oct 2026'. Built from the date parts, so it does not depend on locale or timezone. */
export function dayLabel(date: string): string {
  const { y, m, d } = parse(date)
  const weekday = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]
  return `${weekday} ${d} ${MONTHS[m - 1]} ${y}`
}
