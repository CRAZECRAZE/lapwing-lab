import type { JSX } from 'preact'
import type { StatsMode } from '../../../server/stats.ts'
import { addDays, formatDuration } from '../../core/days.ts'
import { change, decimalChange, qualityMean, strokesChange, sumOf, thousands, timeChange, weekStart } from '../../core/progressview.ts'
import type { Window } from '../../core/progressview.ts'
import type { ProgressData } from './useProgressData.ts'

/** The data of a loaded page: what the panels receive. */
export type ReadyData = ProgressData & {
  status: 'ready'
  stats: NonNullable<ProgressData['stats']>
  days: NonNullable<ProgressData['days']>
}

export { thousands }

/** The muted scope of a figure that follows the mode switch. */
export const MODE_SCOPES: Record<StatsMode, string> = { free: 'free type', drills: 'drills and tests', all: 'all modes' }

type TileProps = {
  id: string
  label: string
  value: string
  /** Muted small text beside the label, e.g. which modes the figure covers. */
  scope?: string
  /** Quiet text under the value that is not a change, e.g. the all-time count or `not enough data yet`. */
  note?: string
  change?: string | null
}

function Tile({ id, label, value, scope, note, change: changeText }: TileProps): JSX.Element {
  return (
    <li class="progress__tile-item">
      <article class="tile" aria-labelledby={`tile-${id}`}>
        <p class="tile__label">
          <span id={`tile-${id}`} class="tile__name">
            {label}
          </span>
          {scope && <span class="tile__scope">{scope}</span>}
        </p>
        <p class="tile__value">{value}</p>
        {note && <p class="tile__note">{note}</p>}
        {changeText && <p class="tile__change">{changeText}</p>}
      </article>
    </li>
  )
}

/** Panel 1: this week's practice time and strokes and the last 7 days' speed and accuracy, each against the period before. */
export function Tiles({ data }: { data: ReadyData }): JSX.Element {
  const { stats, days, today, mode } = data
  // Monday-weeks: this one runs from Monday to today, the previous one is the full week before.
  const monday = weekStart(today)
  const thisWeek: Window = { from: monday, to: today }
  const lastWeek: Window = { from: addDays(monday, -7), to: addDays(monday, -1) }
  // 7-day windows: the 7 days ending today, and the 7 days before them.
  const last7: Window = { from: addDays(today, -6), to: today }
  const before7: Window = { from: addDays(today, -13), to: addDays(today, -7) }

  const timeNow = sumOf(days, thisWeek, 'activeMs')
  const timeBefore = sumOf(days, lastWeek, 'activeMs')
  const strokesNow = sumOf(days, thisWeek, 'strokes')
  const strokesBefore = sumOf(days, lastWeek, 'strokes')

  const wpmNow = qualityMean(stats.days, last7, 'wpm')
  const wpmDiff = change(wpmNow, qualityMean(stats.days, before7, 'wpm'))
  const accuracyNow = qualityMean(stats.days, last7, 'accuracy')
  const accuracyDiff = change(accuracyNow, qualityMean(stats.days, before7, 'accuracy'))
  const missing = 'not enough data yet'

  return (
    <ul class="progress__tiles" aria-label="Headline figures">
      <Tile
        id="time"
        label="This week"
        scope="all modes"
        value={timeNow > 0 ? formatDuration(timeNow) : '0 min'}
        change={timeNow > 0 && timeBefore > 0 ? timeChange(timeNow, timeBefore) : null}
      />
      <Tile
        id="strokes"
        label="Strokes this week"
        scope="all modes"
        value={thousands(strokesNow)}
        note={`${thousands(stats.allTimeStrokes)} all time`}
        change={strokesNow > 0 && strokesBefore > 0 ? strokesChange(strokesNow, strokesBefore) : null}
      />
      <Tile
        id="wpm"
        label="7-day average"
        scope={MODE_SCOPES[mode]}
        value={wpmNow === null ? '—' : `${wpmNow.toFixed(1)} wpm`}
        note={wpmNow === null ? missing : undefined}
        change={wpmDiff === null ? null : decimalChange(wpmDiff, 'wpm')}
      />
      <Tile
        id="accuracy"
        label="First-try accuracy"
        scope={MODE_SCOPES[mode]}
        value={accuracyNow === null ? '—' : `${(accuracyNow * 100).toFixed(1)}%`}
        note={accuracyNow === null ? missing : undefined}
        change={accuracyDiff === null ? null : decimalChange(accuracyDiff * 100, 'points')}
      />
    </ul>
  )
}
