import type { JSX } from 'preact'
import { useLayoutEffect, useRef, useState } from 'preact/hooks'
import type { DayStat } from '../../server/archive.ts'
import type { DayQuality, StatsResponse } from '../../server/stats.ts'
import { getDays, getSettings, getStats, putSettings } from '../api.ts'
import { isYearMonth } from '../core/dates.ts'
import { localDate } from '../core/days.ts'
import {
  chapterPassDates,
  hasPractice,
  isMonthComplete,
  monthBounds,
  monthKey,
  monthName,
  monthTitle,
  practiceByMonth,
  previousMonth,
  reportsWindowStart,
  reportTiles,
} from '../core/report.ts'
import { useProgress } from '../state/progress.tsx'
import { AppLink } from './AppLink.tsx'
import { ReportTilesView } from './ReportTiles.tsx'
import type { ReadyData } from './progress/Tiles.tsx'
import { WpmByDay } from './progress/WpmByDay.tsx'
import { reportsStore, SAVE_STATUS_TEXT, useAutosave } from './useAutosave.ts'
import './reports.css'

const SCOPES = 'Time and strokes cover every mode; speed, accuracy and steadiness cover free type.'

type Numbers = { stats: StatsResponse; previous: StatsResponse; days: DayStat[] }
type Loaded = { key: string } & ({ status: 'error' } | ({ status: 'ready' } & Numbers))

/**
 * The month's and the previous month's free-type stats, and the days of every mode from the start of the reports window
 * (one call covering both months and the earlier ones that decide whether this is the first month). A response for an
 * earlier request, or one that arrives after unmount, is dropped.
 */
function useReportNumbers(month: string, today: string): { numbers: Numbers | null; failed: boolean; retry: () => void } {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [attempt, setAttempt] = useState(0)
  const latest = useRef(0)
  const key = `${month}|${today}|${attempt}`

  useLayoutEffect(() => {
    let live = true
    const mine = ++latest.current
    const current = (): boolean => live && latest.current === mine
    const { from, to } = monthBounds(month)
    const before = monthBounds(previousMonth(month))
    // the window is counted back from the report month, or from today when the month is still going
    const start = reportsWindowStart(today < to ? today : to)
    Promise.all([
      getStats(from, to, 'free'),
      getStats(before.from, before.to, 'free'),
      getDays(start < before.from ? start : before.from, to),
    ]).then(
      ([stats, previous, days]) => current() && setLoaded({ key, status: 'ready', stats, previous, days }),
      () => current() && setLoaded({ key, status: 'error' }),
    )
    return () => {
      live = false
      latest.current++
    }
  }, [month, today, attempt])

  const mine = loaded !== null && loaded.key === key ? loaded : null
  return {
    numbers: mine?.status === 'ready' ? mine : null,
    failed: mine?.status === 'error',
    retry: () => setAttempt((n) => n + 1),
  }
}

const inMonth = <T extends { date: string }>(days: readonly T[], month: string): T[] => days.filter((d) => monthKey(d.date) === month)
const plural = (n: number, one: string): string => `${n} ${one}${n === 1 ? '' : 's'}`

function Notes({ month }: { month: string }): JSX.Element {
  const note = useAutosave(reportsStore, month, true)
  return (
    <div class="report__notes">
      <label class="report__label" for="report-notes">
        Your notes
      </label>
      <textarea
        id="report-notes"
        class="report__text"
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
      <div class="report__state">
        {note.phase === 'loading' && <span class="report__muted">Loading…</span>}
        {note.phase === 'error' && (
          <span role="alert">
            Couldn't load your notes.{' '}
            <button type="button" class="report__button" onClick={note.reload}>
              Try again
            </button>
          </span>
        )}
        {note.phase === 'ready' && (
          <span class={note.status === 'failed' ? 'report__warn' : 'report__muted'} aria-live="polite">
            {SAVE_STATUS_TEXT[note.status]}
          </span>
        )}
      </div>
    </div>
  )
}

function ReportPage({ month, today }: { month: string; today: string }): JSX.Element {
  const progress = useProgress()
  const { numbers, failed, retry } = useReportNumbers(month, today)
  const failure = failed || progress.status === 'error'
  const ready = numbers !== null && progress.status === 'ready'

  // Opening a month that is over marks it as seen (only forward, once); the banner on Progress stops announcing it.
  const marked = useRef(false)
  useLayoutEffect(() => {
    if (!ready || marked.current) return
    marked.current = true
    if (!isMonthComplete(month, today)) return
    getSettings()
      .then((settings) =>
        settings.reportSeen === null || month > settings.reportSeen ? putSettings({ reportSeen: month }) : undefined,
      )
      .catch(() => undefined) // a nicety: a failure shows nothing
  }, [ready])

  const heading = monthTitle(month)
  const back = (
    <p class="report__back">
      <AppLink href="/progress/reports">Back to Reports</AppLink>
    </p>
  )
  if (!ready) {
    return (
      <section class="report" aria-labelledby="report-title">
        {back}
        <h1 id="report-title" class="report__title">
          {heading}
        </h1>
        {failure ? (
          <p class="report__muted" role="alert">
            Couldn't load this report.{' '}
            <button
              type="button"
              class="report__button"
              onClick={() => {
                retry()
                if (progress.status === 'error') void progress.reload()
              }}
            >
              Try again
            </button>
          </p>
        ) : (
          <p class="report__muted">Loading…</p>
        )}
      </section>
    )
  }

  // The tiles trust their day arrays to be inside their month.
  const everyMode = numbers.days
  const monthDays = inMonth(everyMode, month)
  const before = previousMonth(month)
  const free: DayQuality[] = inMonth(numbers.stats.days, month)
  const firstMonth = practiceByMonth(everyMode.filter((d) => monthKey(d.date) < month)).size === 0
  const chapters = [...chapterPassDates(progress.chapters, progress.results, progress.marks)]
    .map(([chapter, date]) => ({ chapter, date }))
    .filter((c) => monthKey(c.date) === month)
  const tiles = reportTiles({
    month: free,
    previous: inMonth(numbers.previous.days, before),
    time: monthDays,
    previousTime: inMonth(everyMode, before),
    chapters,
    firstMonth,
    previousName: monthName(before),
  })
  const chart: ReadyData = {
    status: 'ready',
    stats: { ...numbers.stats, days: free },
    days: monthDays,
    today,
    range: '4w',
    mode: 'free',
    retry,
  }

  return (
    <section class="report" aria-labelledby="report-title">
      {back}
      <h1 id="report-title" class="report__title">
        {`${heading} · ${plural(monthDays.filter(hasPractice).length, 'practice day')}`}
      </h1>
      <ReportTilesView tiles={tiles} />
      <WpmByDay data={chart} domain={monthBounds(month)} />
      <p class="report__scopes">{SCOPES}</p>
      <Notes month={month} />
    </section>
  )
}

/** One month's report. `today` (a local `YYYY-MM-DD`) is read once at mount; tests inject it. */
export function Report({ month, today: given }: { month: string; today?: string }): JSX.Element {
  const [today] = useState(() => given ?? localDate(Date.now()))
  if (!isYearMonth(month) || month > monthKey(today)) {
    return (
      <section class="report">
        <p class="report__back">
          <AppLink href="/progress/reports">Back to Reports</AppLink>
        </p>
        <p class="report__muted">{isYearMonth(month) ? "That month hasn't happened yet." : 'No such month.'}</p>
      </section>
    )
  }
  return <ReportPage month={month} today={today} />
}
