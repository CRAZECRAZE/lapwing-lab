import type { JSX } from 'preact'
import { useLayoutEffect, useRef, useState } from 'preact/hooks'
import type { DayStat } from '../../server/archive.ts'
import { getDays, listReports } from '../api.ts'
import { isYearMonth } from '../core/dates.ts'
import { addDays, formatDuration, localDate } from '../core/days.ts'
import { daysBetween, thousands } from '../core/progressview.ts'
import { monthBounds, monthKey, monthsBetween, monthTitle, practiceByMonth, previousMonth } from '../core/report.ts'
import { isPlainClick, navigate } from '../router.ts'
import './reports.css'

/** The list looks back this many months before the current one (36 months in all). */
const LOOKBACK_MONTHS = 35
/** The server refuses a /api/days span longer than this (MAX_DAYS_SPAN in server/server.ts). */
const MAX_DAYS_SPAN = 1100

/** The first day of the month 35 months back, moved forward by whole months until the request is within the limit. */
function listFrom(today: string): string {
  let month = monthKey(today)
  for (let i = 0; i < LOOKBACK_MONTHS; i++) month = previousMonth(month)
  let from = monthBounds(month).from
  while (daysBetween(from, today) > MAX_DAYS_SPAN) from = addDays(monthBounds(monthKey(from)).to, 1)
  return from
}

type Row = { month: string; activeMs: number; strokes: number; note: boolean }
type Loaded = { key: string } & ({ status: 'error' } | { status: 'ready'; rows: Row[] })

/** Months from the first with practice or a note to the current one, newest first, keeping those with either. */
function buildRows(days: readonly DayStat[], noted: ReadonlySet<string>, today: string): Row[] {
  const byMonth = practiceByMonth(days)
  const current = monthKey(today)
  const known = [...byMonth.keys(), ...noted].filter((m) => m <= current).sort()
  if (known.length === 0) return []
  return monthsBetween(known[0], current)
    .reverse()
    .flatMap((month) =>
      byMonth.has(month) || noted.has(month)
        ? [{ month, activeMs: 0, strokes: 0, ...byMonth.get(month), note: noted.has(month) }]
        : [],
    )
}

function RowLink({ row }: { row: Row }): JSX.Element {
  const href = `/progress/reports/${row.month}`
  return (
    <li class="reports__item">
      <a
        class="reports__row"
        href={href}
        onClick={(e) => {
          if (!isPlainClick(e)) return
          e.preventDefault()
          navigate(href)
        }}
      >
        <span class="reports__month">{monthTitle(row.month)}</span>
        <span class="reports__figure">{formatDuration(row.activeMs)}</span>
        <span class="reports__figure">{`${thousands(row.strokes)} strokes`}</span>
        {row.note && <span class="reports__note">note</span>}
      </a>
    </li>
  )
}

/** The Reports page: every month with practice or a note, newest first. `today` is read once; tests inject it. */
export function Reports({ today: given }: { today?: string }): JSX.Element {
  const [today] = useState(() => given ?? localDate(Date.now()))
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [attempt, setAttempt] = useState(0)
  const latest = useRef(0)
  const key = `${today}|${attempt}`

  useLayoutEffect(() => {
    let live = true
    const mine = ++latest.current
    const current = (): boolean => live && latest.current === mine
    Promise.all([getDays(listFrom(today), today), listReports()]).then(
      ([days, reports]) => {
        if (!current()) return
        const noted = new Set(reports.map((r) => r.month).filter((m) => isYearMonth(m)))
        setLoaded({ key, status: 'ready', rows: buildRows(days, noted, today) })
      },
      () => current() && setLoaded({ key, status: 'error' }),
    )
    return () => {
      live = false
      latest.current++
    }
  }, [today, attempt])

  const state = loaded !== null && loaded.key === key ? loaded : null
  return (
    <section class="reports" aria-labelledby="reports-title">
      <p class="reports__back">
        <a
          href="/progress"
          onClick={(e) => {
            if (!isPlainClick(e)) return
            e.preventDefault()
            navigate('/progress')
          }}
        >
          Back to Progress
        </a>
      </p>
      <h1 id="reports-title" class="reports__title">
        Reports
      </h1>
      {state === null && <p class="reports__muted">Loading…</p>}
      {state?.status === 'error' && (
        <p class="reports__muted" role="alert">
          Couldn't load your reports.{' '}
          <button type="button" class="reports__retry" onClick={() => setAttempt((n) => n + 1)}>
            Try again
          </button>
        </p>
      )}
      {state?.status === 'ready' && state.rows.length === 0 && <p class="reports__muted">No practice recorded yet.</p>}
      {state?.status === 'ready' && state.rows.length > 0 && (
        <ul class="reports__list">
          {state.rows.map((row) => (
            <RowLink key={row.month} row={row} />
          ))}
        </ul>
      )}
    </section>
  )
}
