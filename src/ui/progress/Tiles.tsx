import type { JSX } from 'preact'
import type { DayStat } from '../../../server/archive.ts'
import type { DayQuality, StatsMode } from '../../../server/stats.ts'
import { addDays, formatDuration } from '../../core/days.ts'
import { change, enough, weekStart } from '../../core/progressview.ts'
import type { ProgressData } from './useProgressData.ts'

/** The data of a loaded page: what the panels receive. */
export type ReadyData = ProgressData & {
  status: 'ready'
  stats: NonNullable<ProgressData['stats']>
  days: NonNullable<ProgressData['days']>
}

type Window = { from: string; to: string }

const inWindow = (date: string, w: Window): boolean => date >= w.from && date <= w.to

/** `12,345`: fixed so the text does not depend on the locale of the machine. */
export function thousands(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

function sumOf(days: readonly DayStat[], w: Window, field: 'activeMs' | 'strokes'): number {
  let total = 0
  for (const d of days) if (inWindow(d.date, w)) total += d[field]
  return total
}

/**
 * The words-weighted mean of a quality figure over a window, or null when fewer than 3 runs lie behind
 * the window or there are no words to weigh it by.
 */
function qualityMean(days: readonly DayQuality[], w: Window, field: 'wpm' | 'accuracy'): number | null {
  let runs = 0
  let words = 0
  let sum = 0
  for (const d of days) {
    if (!inWindow(d.date, w)) continue
    runs += d.runs
    const value = d[field]
    if (value === null || !(d.words > 0)) continue
    words += d.words
    sum += value * d.words
  }
  return enough(runs) && words > 0 ? sum / words : null
}

const signed = (n: number, text: string): string => `${n < 0 ? '-' : '+'}${text}`

export function timeChange(now: number, before: number): string {
  if (now === before) return 'same as last week'
  return `${signed(now - before, formatDuration(Math.abs(now - before)))} vs last week`
}

export function strokesChange(now: number, before: number): string {
  if (now === before) return 'same as last week'
  return `${signed(now - before, thousands(Math.abs(now - before)))} vs last week`
}

/** `+1.4 wpm` / `+2.1 points`; a difference that rounds to zero is the same. */
function decimalChange(diff: number, unit: string): string {
  const text = Math.abs(diff).toFixed(1)
  if (text === '0.0') return 'same as the 7 days before'
  return `${signed(diff, text)} ${unit} vs the 7 days before`
}

export function modeLabel(mode: StatsMode): string {
  if (mode === 'free') return 'Free-type 7-day average'
  if (mode === 'drills') return 'Drills and tests 7-day average'
  return '7-day average'
}

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
        label={modeLabel(mode)}
        value={wpmNow === null ? '—' : `${wpmNow.toFixed(1)} wpm`}
        note={wpmNow === null ? missing : undefined}
        change={wpmDiff === null ? null : decimalChange(wpmDiff, 'wpm')}
      />
      <Tile
        id="accuracy"
        label="First-try accuracy"
        value={accuracyNow === null ? '—' : `${(accuracyNow * 100).toFixed(1)}%`}
        note={accuracyNow === null ? missing : undefined}
        change={accuracyDiff === null ? null : decimalChange(accuracyDiff * 100, 'points')}
      />
    </ul>
  )
}
