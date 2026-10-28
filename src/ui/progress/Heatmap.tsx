import type { JSX } from 'preact'
import { useLayoutEffect, useRef, useState } from 'preact/hooks'
import type { DayStat } from '../../../server/archive.ts'
import { getDays } from '../../api.ts'
import { cap, durationText, shortDate } from '../../core/chartmath.ts'
import { addDays, currentStreak, dayLevel, longestStreak } from '../../core/days.ts'
import { daysBetween, weekStart } from '../../core/progressview.ts'
import { DataTable, Panel } from './Chart.tsx'
import { thousands } from './Tiles.tsx'

const TITLE = 'Practice, all modes'
const LINE = 'Each square is a day, from the oldest on the left to today on the right. The greener, the more time you practiced.'
/** The year shown: today and the 364 days before it. */
const YEAR_DAYS = 365
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const WEEKDAYS = ['Mon', '', 'Wed', '', 'Fri', '', '']

type Loaded = { key: string } & ({ status: 'error' } | { status: 'ready'; days: DayStat[] })

export type YearDays = {
  status: 'loading' | 'error' | 'ready'
  /** Null unless `status` is 'ready'; always the answer for `today`, never an earlier one. */
  days: DayStat[] | null
  retry: () => void
}

/**
 * The days of the last year (today and the 364 before), whatever the range and mode of the page. A response for an
 * earlier request, or one that arrives after unmount, is dropped.
 */
export function useYearDays(today: string): YearDays {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [attempt, setAttempt] = useState(0)
  const latest = useRef(0)
  const key = `${today}|${attempt}`

  useLayoutEffect(() => {
    let live = true
    const mine = ++latest.current
    const current = (): boolean => live && latest.current === mine
    getDays(addDays(today, 1 - YEAR_DAYS), today).then(
      (days) => current() && setLoaded({ key, status: 'ready', days }),
      () => current() && setLoaded({ key, status: 'error' }),
    )
    return () => {
      live = false
      latest.current++ // a response for another request, or after unmount, is ignored
    }
  }, [today, attempt])

  const mine = loaded !== null && loaded.key === key ? loaded : null
  return {
    status: mine === null ? 'loading' : mine.status,
    days: mine?.status === 'ready' ? mine.days : null,
    retry: () => setAttempt((n) => n + 1),
  }
}

type Total = { activeMs: number; strokes: number }

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`
const practiced = (t: Total | undefined): t is Total => t !== undefined && (t.activeMs > 0 || t.strokes > 0)

/** Panel 9 with its own request for the year. */
export function Heatmap({ today }: { today: string }): JSX.Element {
  return <HeatmapPanel today={today} year={useYearDays(today)} />
}

/**
 * Panel 9: a day-by-day grid of the last year, the current and longest streak, and a table of the days. The page
 * asks for the year itself (`useYearDays`) so that a switch of range or mode, which unmounts the other panels
 * while they load, does not fetch the year again.
 */
export function HeatmapPanel({ today, year }: { today: string; year: YearDays }): JSX.Element {
  return (
    <Panel id="progress-heatmap" title={TITLE} line={LINE}>
      {year.status === 'loading' && <p class="progress__muted">Loading…</p>}
      {year.status === 'error' && (
        <p class="progress__muted" role="alert">
          Couldn't load the year.{' '}
          <button type="button" class="progress__retry" onClick={year.retry}>
            Try again
          </button>
        </p>
      )}
      {year.days !== null && <Year key={today} today={today} days={year.days} />}
    </Panel>
  )
}

function Year({ today, days }: { today: string; days: DayStat[] }): JSX.Element {
  const first = addDays(today, 1 - YEAR_DAYS)
  const start = weekStart(first)
  const offset = daysBetween(start, first) // blank cells above the first day
  const columns = daysBetween(start, weekStart(today)) / 7 + 1
  const scroller = useRef<HTMLDivElement>(null)
  const [stopped, setStop] = useState(YEAR_DAYS - 1) // the one tab stop; today until the keyboard moves it
  const [active, setActive] = useState<number | null>(null)

  // Show the latest weeks first when the grid is wider than its container.
  useLayoutEffect(() => {
    const el = scroller.current
    if (el) el.scrollLeft = el.scrollWidth
  }, [])

  const totals = new Map<string, Total>()
  for (const d of days) {
    if (d.date < first || d.date > today) continue
    const t = totals.get(d.date) ?? { activeMs: 0, strokes: 0 }
    t.activeMs = cap(t.activeMs + d.activeMs)
    t.strokes = cap(t.strokes + d.strokes)
    totals.set(d.date, t)
  }
  const activeDates = new Set([...totals].filter(([, t]) => practiced(t)).map(([date]) => date))
  const current = currentStreak(activeDates, today)
  const longest = longestStreak(activeDates)
  let fromFirst = 0 // the run of practiced days that begins on the first day of the year
  while (fromFirst < YEAR_DAYS && activeDates.has(addDays(first, fromFirst))) fromFirst++
  const clipped = fromFirst > 0 && (fromFirst === longest || fromFirst === current)

  const dateAt = (i: number): string => addDays(first, i)
  const label = (date: string): string => {
    const t = totals.get(date)
    if (!practiced(t)) return `${shortDate(date)}: no practice`
    return `${shortDate(date)}: ${durationText(t.activeMs)}, ${thousands(t.strokes)} ${t.strokes === 1 ? 'stroke' : 'strokes'}`
  }

  const stop = Math.min(stopped, YEAR_DAYS - 1)
  const move = (e: KeyboardEvent, index: number): void => {
    const target =
      e.key === 'ArrowRight' ? index + 7
      : e.key === 'ArrowLeft' ? index - 7
      : e.key === 'ArrowDown' ? index + 1
      : e.key === 'ArrowUp' ? index - 1
      : e.key === 'Home' ? 0
      : e.key === 'End' ? YEAR_DAYS - 1
      : null
    if (target === null) return
    e.preventDefault()
    const next = Math.min(Math.max(target, 0), YEAR_DAYS - 1)
    if (next === index) return
    setStop(next)
    ;(e.currentTarget as Element).closest('.heat__grid')?.querySelector<HTMLElement>(`[data-date="${dateAt(next)}"]`)?.focus()
  }

  // A month is named over the column that holds its first day, so each month appears once, four or more columns apart.
  const monthAt = new Map<number, string>()
  for (let i = 0; i < YEAR_DAYS; i++) {
    const date = dateAt(i)
    if (date.endsWith('-01')) monthAt.set(Math.floor((i + offset) / 7), MONTHS[Number(date.slice(5, 7)) - 1])
  }

  const rows = [...totals]
    .filter(([, t]) => practiced(t))
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .map(([date, t]) => ({ key: date, cells: [shortDate(date, true), durationText(t.activeMs), thousands(t.strokes)] }))

  const tip = active === null ? null : { index: active + offset, text: label(dateAt(active)) }
  return (
    <>
      <div class="heat__scroll" ref={scroller}>
        <div class="heat__grid" role="group" aria-label="Practice in the last year">
          <div class="heat__col heat__col--labels" aria-hidden="true">
            <span class="heat__monthslot" />
            <div class="heat__weekdays">
              {WEEKDAYS.map((w, i) => (
                <span key={i} class="heat__weekday">
                  {w}
                </span>
              ))}
            </div>
          </div>
          {Array.from({ length: columns }, (_, c) => (
            <div key={c} class="heat__col">
              <span class="heat__monthslot" aria-hidden="true">
                {monthAt.has(c) && <span class="heat__month">{monthAt.get(c)}</span>}
              </span>
              <div class="heat__week">
                {Array.from({ length: 7 }, (_, r) => {
                  const i = c * 7 + r - offset
                  if (i < 0 || i >= YEAR_DAYS) return <span key={r} class="heat__spacer" aria-hidden="true" />
                  const date = dateAt(i)
                  const t = totals.get(date)
                  const level = practiced(t) ? Math.max(1, dayLevel(t.activeMs)) : 0
                  return (
                    <span
                      key={r}
                      role="img"
                      class="heat__cell"
                      data-date={date}
                      data-level={level}
                      aria-label={label(date)}
                      tabindex={i === stop ? 0 : -1}
                      onFocus={() => {
                        setActive(i)
                        setStop(i)
                      }}
                      onBlur={() => setActive((a) => (a === i ? null : a))}
                      onClick={() => setStop(i)}
                      onMouseEnter={() => setActive(i)}
                      onMouseLeave={() => setActive((a) => (a === i ? null : a))}
                      onKeyDown={(e) => move(e, i)}
                    />
                  )
                })}
              </div>
            </div>
          ))}
          {tip !== null && (
            <span
              class={`heat__tip${Math.floor(tip.index / 7) < 4 ? ' heat__tip--left' : ''}${Math.floor(tip.index / 7) > columns - 5 ? ' heat__tip--right' : ''}${tip.index % 7 < 2 ? ' heat__tip--below' : ''}`}
              style={{ '--col': Math.floor(tip.index / 7), '--row': tip.index % 7 }}
              aria-hidden="true"
            >
              {tip.text}
            </span>
          )}
        </div>
      </div>

      <div class="heat__legend" aria-hidden="true">
        <span>Less</span>
        {[0, 1, 2, 3].map((n) => (
          <span key={n} class="heat__swatch" data-swatch={n} />
        ))}
        <span>More</span>
      </div>

      <p class="heat__streak">{`Current streak: ${plural(current, 'day', 'days')}`}</p>
      <p class="heat__streak">{`Longest streak: ${plural(longest, 'day', 'days')}`}</p>
      <p class="panel__note">A day counts when you practiced in it, in any mode.</p>
      {clipped && <p class="panel__note">Streaks are counted within the last year only, so a longer one may have begun before.</p>}

      <DataTable
        caption="Days with practice in the last year, newest first (days without practice are left out), all modes."
        head={['Day', 'Time', 'Strokes']}
        rows={rows}
      />
    </>
  )
}
