import type { JSX } from 'preact'
import { useLayoutEffect, useRef, useState } from 'preact/hooks'
import type { TestSummary } from '../../server/archive.ts'
import { listJournal, listTests } from '../api.ts'
import { addDays, dayLabel, formatDuration, localDate } from '../core/days.ts'
import { isPlainClick, navigate } from '../router.ts'
import { TestList } from './TestList.tsx'
import { journalStore, SAVE_STATUS_TEXT, useAutosave } from './useAutosave.ts'
import './journal.css'

/** True for a real calendar day in `YYYY-MM-DD` form (same rule as the server). */
export function isCalendarDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const [y, m, d] = s.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  date.setUTCFullYear(y)
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
}

const hrefOf = (date: string, today: string): string => (date === today ? '/journal' : `/journal/${date}`)

function onLinkClick(e: MouseEvent): void {
  if (!isPlainClick(e)) return
  e.preventDefault()
  navigate((e.currentTarget as HTMLAnchorElement).getAttribute('href')!)
}

type Results = { status: 'loading' } | { status: 'error' } | { status: 'ready'; tests: TestSummary[] }

/** One plain markdown note per local day, autosaved, with that day's results below it. */
export function Journal({ date: given }: { date?: string }): JSX.Element {
  const [today] = useState(() => localDate(Date.now()))
  const date = given ?? today
  const valid = isCalendarDate(date)
  const note = useAutosave(journalStore, date, valid)
  const [days, setDays] = useState<string[]>([])
  const [results, setResults] = useState<Results>({ status: 'loading' })
  const live = useRef(true)

  const loadResults = (): void => {
    setResults({ status: 'loading' })
    listTests({ limit: 200, date }).then(
      (tests) => live.current && setResults({ status: 'ready', tests }),
      () => live.current && setResults({ status: 'error' }),
    )
  }

  useLayoutEffect(() => {
    live.current = true
    if (valid) {
      listJournal().then(
        (entries) => {
          if (!live.current) return
          const noted = entries.map((e) => e.date).filter((d) => d !== today)
          setDays([...new Set(noted)].sort().reverse())
        },
        () => {}, // the list is a convenience; the editor works without it
      )
      loadResults()
    }
    return () => {
      live.current = false
    }
  }, [])

  if (!valid) {
    return (
      <p class="journal__status">
        No such day.{' '}
        <a href="/journal" onClick={onLinkClick}>Go to today's journal</a>
      </p>
    )
  }

  const label = dayLabel(date)
  const prev = addDays(date, -1)
  const next = addDays(date, 1)

  return (
    <div class="journal">
      <nav class="journal__days" aria-label="Journal days">
        <ul>
          <li>
            <a href="/journal" aria-current={date === today ? 'page' : undefined} onClick={onLinkClick}>Today</a>
          </li>
          {days.map((d) => (
            <li key={d}>
              <a href={`/journal/${d}`} aria-current={d === date ? 'page' : undefined} onClick={onLinkClick}>
                {dayLabel(d)}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <section class="journal__main" aria-labelledby="journal-heading">
        <h1 id="journal-heading" class="journal__heading">{label}</h1>
        <p class="journal__step">
          <a href={hrefOf(prev, today)} aria-label="Previous day" onClick={onLinkClick}>← Previous day</a>
          <a href={hrefOf(next, today)} aria-label="Next day" onClick={onLinkClick}>Next day →</a>
        </p>

        <textarea
          class="journal__text"
          aria-label={`Journal for ${label}`}
          value={note.text}
          readOnly={note.phase !== 'ready'}
          spellcheck
          onInput={(e) => {
            const el = e.currentTarget
            if (note.phase !== 'ready') {
              el.value = note.text
              return
            }
            note.edit(el.value)
          }}
          onBlur={note.flush}
        />
        <div class="journal__state">
          {note.phase === 'loading' && <span class="journal__muted">Loading…</span>}
          {note.phase === 'error' && (
            <span role="alert">
              Couldn't load this day's note.{' '}
              <button type="button" class="journal__button" onClick={note.reload}>Try again</button>
            </span>
          )}
          {note.phase === 'ready' && (
            <span class={note.status === 'failed' ? 'journal__warn' : 'journal__muted'} aria-live="polite">
              {SAVE_STATUS_TEXT[note.status]}
            </span>
          )}
        </div>

        <section class="journal__results" aria-labelledby="journal-results">
          <h2 id="journal-results" class="journal__subheading">Results this day</h2>
          {results.status === 'loading' && <p class="journal__muted">Loading…</p>}
          {results.status === 'error' && (
            <p class="journal__muted" role="alert">
              Couldn't load this day's results.{' '}
              <button type="button" class="journal__button" onClick={loadResults}>Try again</button>
            </p>
          )}
          {results.status === 'ready' && results.tests.length === 0 && (
            <p class="journal__muted">No practice recorded this day.</p>
          )}
          {results.status === 'ready' && results.tests.length > 0 && (
            <>
              <p class="journal__totals">{totals(results.tests)}</p>
              <TestList tests={results.tests} />
            </>
          )}
        </section>
      </section>
    </div>
  )
}

function totals(tests: TestSummary[]): string {
  const ms = tests.reduce((sum, t) => sum + Math.max(0, t.lastStrokeAt - t.firstStrokeAt), 0)
  return `${tests.length} ${tests.length === 1 ? 'test' : 'tests'} · ${formatDuration(ms)}`
}
