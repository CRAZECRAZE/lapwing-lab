import type { JSX } from 'preact'
import { useLayoutEffect, useRef, useState } from 'preact/hooks'
import type { DayStat, TestSummary } from '../../server/archive.ts'
import { getDays, getJournal, listJournal, listTests } from '../api.ts'
import { dayLabel, formatDuration, localDate, monthWeeks } from '../core/days.ts'
import { isPlainClick, navigate } from '../router.ts'
import { useStreak } from '../state/streak.ts'
import { isCalendarDate } from './Journal.tsx'
import { TestList } from './TestList.tsx'
import './days.css'

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
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const MINUTE = 60000

const pad = (n: number): string => String(n).padStart(2, '0')

function onLinkClick(e: MouseEvent): void {
  if (!isPlainClick(e)) return
  e.preventDefault()
  navigate((e.currentTarget as HTMLAnchorElement).getAttribute('href')!)
}

/** 0 no practice, 1 under 10 minutes, 2 under 30, 3 more. A day with strokes is at least 1. */
function levelOf(stat: DayStat | undefined): 0 | 1 | 2 | 3 {
  if (!stat) return 0
  if (stat.activeMs < 10 * MINUTE) return 1
  if (stat.activeMs < 30 * MINUTE) return 2
  return 3
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`

/** The calendar and, for a date, that day's practice and note. */
export function Days({ date }: { date?: string }): JSX.Element {
  if (date === undefined) return <MonthView />
  if (!isCalendarDate(date)) {
    return (
      <p class="days__status">
        No such day.{' '}
        <a href="/days" onClick={onLinkClick}>Back to the calendar</a>
      </p>
    )
  }
  return <DayView date={date} />
}

type Month = { year: number; month: number }
type MonthData =
  | { key: string; status: 'error' }
  | { key: string; status: 'ready'; days: DayStat[] }

function MonthView(): JSX.Element {
  const [today] = useState(() => localDate(Date.now()))
  const [shown, setShown] = useState<Month>(() => ({
    year: Number(today.slice(0, 4)),
    month: Number(today.slice(5, 7)),
  }))
  const [data, setData] = useState<MonthData | null>(null)
  const [noted, setNoted] = useState<ReadonlySet<string>>(new Set())
  const [attempt, setAttempt] = useState(0)
  const latest = useRef(0)
  const live = useRef(true)
  const streak = useStreak('days')

  const { year, month } = shown
  const key = `${year}-${pad(month)}`
  const last = new Date(year, month, 0, 12).getDate()

  useLayoutEffect(() => {
    live.current = true
    listJournal().then(
      (entries) => live.current && setNoted(new Set(entries.map((e) => e.date))),
      () => {}, // the dots are a convenience
    )
    return () => {
      live.current = false
    }
  }, [])

  useLayoutEffect(() => {
    const mine = ++latest.current
    getDays(`${key}-01`, `${key}-${pad(last)}`).then(
      (days) => latest.current === mine && setData({ key, status: 'ready', days }),
      () => latest.current === mine && setData({ key, status: 'error' }),
    )
    return () => {
      latest.current++ // a response for another month, or after unmount, is ignored
    }
  }, [key, attempt])

  const step = (by: number): void => {
    setShown((m) => {
      const index = m.year * 12 + (m.month - 1) + by
      return { year: Math.floor(index / 12), month: (index % 12) + 1 }
    })
  }

  const ready = data !== null && data.key === key && data.status === 'ready' ? data.days : null
  const failed = data !== null && data.key === key && data.status === 'error'
  const stats = new Map((ready ?? []).map((d) => [d.date, d]))

  return (
    <section class="days" aria-labelledby="days-title">
      <div class="days__bar">
        <button type="button" class="days__step" aria-label="Previous month" onClick={() => step(-1)}>
          ←
        </button>
        <h1 id="days-title" class="days__title">{MONTH_NAMES[month - 1]} {year}</h1>
        <button type="button" class="days__step" aria-label="Next month" onClick={() => step(1)}>
          →
        </button>
      </div>

      <div class="days__grid">
        {WEEKDAYS.map((w) => (
          <span key={w} class="days__weekday" aria-hidden="true">{w}</span>
        ))}
        {monthWeeks(year, month).flatMap((week, row) =>
          week.map((d, col) => {
            if (d === null) return <span key={`pad-${row}-${col}`} class="days__cell days__cell--pad" />
            const stat = stats.get(d)
            const note = noted.has(d)
            const label = [dayLabel(d), stat ? formatDuration(stat.activeMs) : '', note ? 'has a note' : '']
              .filter(Boolean)
              .join(', ')
            return (
              <a
                key={d}
                class="days__cell"
                href={`/days/${d}`}
                data-level={levelOf(stat)}
                aria-label={label}
                aria-current={d === today ? 'date' : undefined}
                onClick={onLinkClick}
              >
                {Number(d.slice(8))}
                {note && <span class="days__dot" aria-hidden="true" />}
              </a>
            )
          }),
        )}
      </div>

      {data === null || (data.key !== key && !failed) ? <p class="days__muted">Loading…</p> : null}
      {failed && (
        <p class="days__muted" role="alert">
          Couldn't load this month.{' '}
          <button type="button" class="days__button" onClick={() => setAttempt(attempt + 1)}>Try again</button>
        </p>
      )}
      {ready && (
        <p class="days__totals">
          {plural(ready.length, 'day', 'days')} practiced · {formatDuration(ready.reduce((s, d) => s + d.activeMs, 0))} ·{' '}
          {plural(ready.reduce((s, d) => s + d.tests, 0), 'test', 'tests')}
        </p>
      )}
      {streak !== null && streak >= 1 && <p class="days__totals">Streak: {plural(streak, 'day', 'days')}</p>}
    </section>
  )
}

type Block<T> = { status: 'loading' } | { status: 'error' } | { status: 'ready'; value: T }

function DayView({ date }: { date: string }): JSX.Element {
  const [tests, setTests] = useState<Block<TestSummary[]>>({ status: 'loading' })
  const [note, setNote] = useState<Block<string>>({ status: 'loading' })
  const testsSeq = useRef(0)
  const noteSeq = useRef(0)

  const loadTests = (): void => {
    const mine = ++testsSeq.current
    setTests({ status: 'loading' })
    listTests({ limit: 200, date }).then(
      (value) => testsSeq.current === mine && setTests({ status: 'ready', value }),
      () => testsSeq.current === mine && setTests({ status: 'error' }),
    )
  }
  const loadNote = (): void => {
    const mine = ++noteSeq.current
    setNote({ status: 'loading' })
    getJournal(date).then(
      (value) => noteSeq.current === mine && setNote({ status: 'ready', value }),
      () => noteSeq.current === mine && setNote({ status: 'error' }),
    )
  }

  useLayoutEffect(() => {
    loadTests()
    loadNote()
    return () => {
      testsSeq.current++
      noteSeq.current++
    }
  }, [date])

  return (
    <section class="days days--day" aria-labelledby="days-title">
      <a class="days__back" href="/days" onClick={onLinkClick}>Back to month</a>
      <h1 id="days-title" class="days__title days__title--day">{dayLabel(date)}</h1>

      <section class="days__block" aria-labelledby="days-practice">
        <h2 id="days-practice" class="days__subheading">Practice</h2>
        {tests.status === 'loading' && <p class="days__muted">Loading…</p>}
        {tests.status === 'error' && (
          <p class="days__muted" role="alert">
            Couldn't load this day's practice.{' '}
            <button type="button" class="days__button" onClick={loadTests}>Try again</button>
          </p>
        )}
        {tests.status === 'ready' && tests.value.length === 0 && (
          <p class="days__muted">No practice recorded this day.</p>
        )}
        {tests.status === 'ready' && tests.value.length > 0 && <TestList tests={tests.value} />}
      </section>

      <section class="days__block" aria-labelledby="days-note">
        <h2 id="days-note" class="days__subheading">Note</h2>
        {note.status === 'loading' && <p class="days__muted">Loading…</p>}
        {note.status === 'error' && (
          <p class="days__muted" role="alert">
            Couldn't load this day's note.{' '}
            <button type="button" class="days__button" onClick={loadNote}>Try again</button>
          </p>
        )}
        {note.status === 'ready' && note.value.trim() === '' && <p class="days__muted">No note for this day.</p>}
        {note.status === 'ready' && note.value.trim() !== '' && <p class="days__note">{note.value}</p>}
        <p class="days__more">
          <a href={`/journal/${date}`} onClick={onLinkClick}>Open in Journal</a>
        </p>
      </section>
    </section>
  )
}
