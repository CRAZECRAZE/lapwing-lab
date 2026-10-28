import type { JSX } from 'preact'
import type { TestSummary } from '../../../server/archive.ts'
import type { StatsMode } from '../../../server/stats.ts'
import { shortDate } from '../../core/chartmath.ts'
import { localDate } from '../../core/days.ts'
import { describeTest } from '../../core/review.ts'
import { isPlainClick, navigate } from '../../router.ts'
import { clockTime } from '../TestList.tsx'
import { Panel, spansYears } from './Chart.tsx'
import { RhythmView } from './RhythmView.tsx'
import type { ReadyData } from './Tiles.tsx'
import { PICKER_RUNS } from './useRhythm.ts'
import type { RhythmState } from './useRhythm.ts'

const SCOPES: Record<StatsMode, string> = { free: 'free type', drills: 'drills and tests', all: 'all modes' }
const TITLE = 'Rhythm: how steady you type'
const LINE =
  'How evenly you type inside one run: the pauses between strokes, the stalls, and the speed through the run. The day-by-day steadiness is in the chart above.'

/** `Oct 28, 14:05 · Free type · 16.2 wpm` */
function optionLabel(t: TestSummary, withYear: boolean): string {
  const wpm = t.wpm === null || !Number.isFinite(t.wpm) ? '—' : `${t.wpm.toFixed(1)} wpm`
  return `${shortDate(localDate(t.firstStrokeAt), withYear)}, ${clockTime(t.firstStrokeAt)} · ${describeTest(t)} · ${wpm}`
}

/**
 * Panel 4: the rhythm of one finished run of the current mode, picked from the latest 20 (the newest to begin with).
 * What it shows is held by `useRhythm` in the page, so that it survives the panels being rebuilt on a range switch.
 */
export function RhythmPanel({ data, rhythm }: { data: ReadyData; rhythm: RhythmState }): JSX.Element {
  const { list, id, run } = rhythm
  const head = { id: 'progress-rhythm', title: TITLE, scope: SCOPES[data.mode], line: LINE }
  if (list.status === 'error') {
    return (
      <Panel {...head}>
        <p class="progress__muted" role="alert">
          Couldn't load your runs.{' '}
          <button type="button" class="progress__retry" onClick={rhythm.retryList}>
            Try again
          </button>
        </p>
      </Panel>
    )
  }
  if (list.status === 'loading') {
    return (
      <Panel {...head}>
        <p class="progress__muted">Loading…</p>
      </Panel>
    )
  }
  const { runs, capped } = list
  if (runs.length === 0 || id === null) {
    return (
      <Panel {...head}>
        <p class="progress__muted">
          {capped ? 'No finished run of this mode in your latest tests.' : 'No finished run yet.'}
        </p>
      </Panel>
    )
  }

  const withYear = spansYears(runs.map((r) => localDate(r.firstStrokeAt)))
  const href = `/history/${id}`
  return (
    <Panel {...head}>
      <div class="rhythm__pick">
        <label for="progress-rhythm-run">Run</label>
        <select
          id="progress-rhythm-run"
          class="rhythm__select"
          value={String(id)}
          onChange={(e) => rhythm.select(Number((e.currentTarget as HTMLSelectElement).value))}
        >
          {runs.map((r) => (
            <option key={r.id} value={String(r.id)} selected={r.id === id}>
              {optionLabel(r, withYear)}
            </option>
          ))}
        </select>
      </div>
      {capped && runs.length < PICKER_RUNS && <p class="panel__note">Showing the latest {runs.length} runs of this mode.</p>}
      {run === null && <p class="progress__muted">Loading…</p>}
      {run?.status === 'error' && (
        <p class="progress__muted" role="alert">
          Couldn't load this run.{' '}
          <button type="button" class="progress__retry" onClick={rhythm.retryRun}>
            Try again
          </button>
        </p>
      )}
      {run?.status === 'ready' && (
        <>
          <RhythmView test={run.test} strokes={run.strokes} />
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
