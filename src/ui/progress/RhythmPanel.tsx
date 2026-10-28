import type { JSX } from 'preact'
import { useEffect, useState } from 'preact/hooks'
import type { StrokeRecord, TestRow, TestSummary } from '../../../server/archive.ts'
import type { StatsMode } from '../../../server/stats.ts'
import { getTest, listTests } from '../../api.ts'
import { shortDate } from '../../core/chartmath.ts'
import { localDate } from '../../core/days.ts'
import { describeTest } from '../../core/review.ts'
import { isPlainClick, navigate } from '../../router.ts'
import { clockTime, wasAbandoned } from '../TestList.tsx'
import { Panel, spansYears } from './Chart.tsx'
import { RhythmView } from './RhythmView.tsx'
import type { ReadyData } from './Tiles.tsx'

const SCOPES: Record<StatsMode, string> = { free: 'free type', drills: 'drills and tests', all: 'all modes' }
const TITLE = 'Rhythm: how steady you type'
const LINE =
  'How evenly you type inside one run: the pauses between strokes, the stalls, and the speed through the run. The day-by-day steadiness is in the chart above.'

/** How many runs the picker offers, and how many of the latest runs are asked for to find them. */
const PICKER_RUNS = 20
const ASKED_RUNS = 100
const DRILL_MODES: readonly string[] = ['stage0', 'section', 'chapter-test']

type RunList = { key: string } & ({ status: 'error' } | { status: 'ready'; runs: TestSummary[] })
type RunLoad = { key: string } & ({ status: 'error' } | { status: 'ready'; test: TestRow; strokes: StrokeRecord[] })

/** The latest finished runs of the mode that were not left early and have strokes, newest first. */
function pickable(tests: readonly TestSummary[], mode: StatsMode): TestSummary[] {
  return tests
    .filter(
      (t) =>
        t.endedAt !== null &&
        !wasAbandoned(t.meta) &&
        t.strokeCount > 0 &&
        (mode === 'all' || (mode === 'free' ? t.mode === 'free' : DRILL_MODES.includes(t.mode))),
    )
    .sort((a, b) => b.id - a.id)
    .slice(0, PICKER_RUNS)
}

/** `Oct 28, 14:05 · Free type · 16.2 wpm` */
function optionLabel(t: TestSummary, withYear: boolean): string {
  const wpm = t.wpm === null || !Number.isFinite(t.wpm) ? '—' : `${t.wpm.toFixed(1)} wpm`
  return `${shortDate(localDate(t.firstStrokeAt), withYear)}, ${clockTime(t.firstStrokeAt)} · ${describeTest(t)} · ${wpm}`
}

/** Panel 4: the rhythm of one finished run of the current mode, picked from the 20 latest (the newest to begin with). */
export function RhythmPanel({ data }: { data: ReadyData }): JSX.Element {
  const { mode } = data
  const [attempt, setAttempt] = useState(0)
  const [list, setList] = useState<RunList | null>(null)
  const [picked, setPicked] = useState<{ key: string; id: number } | null>(null)
  const [strokesAttempt, setStrokesAttempt] = useState(0)
  const [run, setRun] = useState<RunLoad | null>(null)

  // The runs are asked for once, and again after a failure or when the mode changes (not when the range does).
  const listKey = `${mode}|${attempt}`
  useEffect(() => {
    let live = true
    listTests({ limit: ASKED_RUNS }).then(
      (tests) => live && setList({ key: listKey, status: 'ready', runs: pickable(tests, mode) }),
      () => live && setList({ key: listKey, status: 'error' }),
    )
    return () => {
      live = false
    }
  }, [listKey])

  const runs = list !== null && list.key === listKey && list.status === 'ready' ? list.runs : null
  const listFailed = list !== null && list.key === listKey && list.status === 'error'
  // A pick belongs to the list it was made from: a new mode or a new try goes back to the newest run.
  const chosen = picked !== null && picked.key === listKey && runs?.some((r) => r.id === picked.id) ? picked.id : null
  const id = chosen ?? runs?.[0]?.id ?? null

  // One request counter: a late answer for an earlier pick (or after unmount) is dropped.
  const runKey = `${id}|${strokesAttempt}`
  useEffect(() => {
    if (id === null) return
    let live = true
    getTest(id).then(
      (found) =>
        live && setRun(found === null ? { key: runKey, status: 'error' } : { key: runKey, status: 'ready', test: found.test, strokes: found.strokes }),
      () => live && setRun({ key: runKey, status: 'error' }),
    )
    return () => {
      live = false
    }
  }, [runKey])

  const head = { id: 'progress-rhythm', title: TITLE, scope: SCOPES[mode], line: LINE }
  if (listFailed) {
    return (
      <Panel {...head}>
        <p class="progress__muted" role="alert">
          Couldn't load your runs.{' '}
          <button type="button" class="progress__retry" onClick={() => setAttempt((n) => n + 1)}>
            Try again
          </button>
        </p>
      </Panel>
    )
  }
  if (runs === null) {
    return (
      <Panel {...head}>
        <p class="progress__muted">Loading…</p>
      </Panel>
    )
  }
  if (runs.length === 0 || id === null) {
    return (
      <Panel {...head}>
        <p class="progress__muted">No finished run yet.</p>
      </Panel>
    )
  }

  const withYear = spansYears(runs.map((r) => localDate(r.firstStrokeAt)))
  const shown = run !== null && run.key === runKey ? run : null
  const href = `/history/${id}`
  return (
    <Panel {...head}>
      <div class="rhythm__pick">
        <label for="progress-rhythm-run">Run</label>
        <select
          id="progress-rhythm-run"
          class="rhythm__select"
          value={String(id)}
          onChange={(e) => setPicked({ key: listKey, id: Number((e.currentTarget as HTMLSelectElement).value) })}
        >
          {runs.map((r) => (
            <option key={r.id} value={String(r.id)} selected={r.id === id}>
              {optionLabel(r, withYear)}
            </option>
          ))}
        </select>
      </div>
      {shown === null && <p class="progress__muted">Loading…</p>}
      {shown?.status === 'error' && (
        <p class="progress__muted" role="alert">
          Couldn't load this run.{' '}
          <button type="button" class="progress__retry" onClick={() => setStrokesAttempt((n) => n + 1)}>
            Try again
          </button>
        </p>
      )}
      {shown?.status === 'ready' && (
        <>
          <RhythmView test={shown.test} strokes={shown.strokes} />
          <p class="panel__note">
            <a
              class="rhythm__open"
              href={href}
              onClick={(e) => {
                if (!isPlainClick(e)) return
                e.preventDefault()
                navigate(href)
              }}
            >
              Open this run in History
            </a>
          </p>
        </>
      )}
    </Panel>
  )
}
