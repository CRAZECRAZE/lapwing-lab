import type { JSX } from 'preact'
import { useState } from 'preact/hooks'
import type { StatsMode } from '../../server/stats.ts'
import { localDate } from '../core/days.ts'
import { RANGES } from '../core/progressview.ts'
import type { RangeId } from '../core/progressview.ts'
import { AccuracyConsistency } from './progress/AccuracyConsistency.tsx'
import type { YearDays } from './progress/Heatmap.tsx'
import { HeatmapPanel, useYearDays } from './progress/Heatmap.tsx'
import { Ladder } from './progress/Ladder.tsx'
import { Mixups } from './progress/Mixups.tsx'
import { PlateauNotice } from './progress/PlateauNotice.tsx'
import { RhythmPanel } from './progress/RhythmPanel.tsx'
import { Tiles } from './progress/Tiles.tsx'
import type { ReadyData } from './progress/Tiles.tsx'
import { usePlateau } from './progress/usePlateau.ts'
import { useProgressData } from './progress/useProgressData.ts'
import { useRhythm } from './progress/useRhythm.ts'
import type { RhythmState } from './progress/useRhythm.ts'
import { WeakKeys } from './progress/WeakKeys.tsx'
import { WeeklyBars } from './progress/WeeklyBars.tsx'
import { WpmByDay } from './progress/WpmByDay.tsx'
import './progress.css'

const MODES: readonly { id: StatsMode; label: string }[] = [
  { id: 'free', label: 'Free type' },
  { id: 'drills', label: 'Drills and tests' },
  { id: 'all', label: 'Everything' },
]

function Switch<T extends string>({
  name,
  options,
  value,
  onChange,
}: {
  name: string
  options: readonly { id: T; label: string }[]
  value: T
  onChange: (id: T) => void
}): JSX.Element {
  return (
    <div class="progress__switch" role="group" aria-label={name}>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          class="progress__choice"
          aria-pressed={o.id === value}
          onClick={() => onChange(o.id)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** The Progress tab. `today` (a local `YYYY-MM-DD`) is read once at mount; tests inject it. */
export function Progress({ today: given }: { today?: string }): JSX.Element {
  const [today] = useState(() => given ?? localDate(Date.now()))
  const [range, setRange] = useState<RangeId>('4w')
  const [mode, setMode] = useState<StatsMode>('free')
  const data = useProgressData(range, mode, today)
  // the rhythm panel's runs and pick live here: the panels are rebuilt each time the numbers reload
  const rhythm = useRhythm(mode)
  const year = useYearDays(today) // not part of `data`: the year does not depend on the range or the mode
  const plateau = usePlateau(today) // the last 56 free-type days, whatever the switches say

  return (
    <section class="progress" aria-labelledby="progress-title">
      <div class="progress__bar">
        <h1 id="progress-title" class="progress__title">
          Progress
        </h1>
        <Switch name="Range" options={RANGES} value={range} onChange={setRange} />
        <Switch name="Mode" options={MODES} value={mode} onChange={setMode} />
      </div>

      {plateau.plateau !== null && (
        <PlateauNotice plateau={plateau.plateau} onSnooze={() => void plateau.snooze()} variant="panel" />
      )}
      {data.status === 'loading' && <p class="progress__muted">Loading…</p>}
      {data.status === 'error' && (
        <p class="progress__muted" role="alert">
          Couldn't load your progress.{' '}
          <button type="button" class="progress__retry" onClick={data.retry}>
            Try again
          </button>
        </p>
      )}
      {data.stats !== null && data.days !== null && <Panels data={data as ReadyData} year={year} rhythm={rhythm} />}
    </section>
  )
}

/** Everything under the switches once the data is in, in the order of the panels. */
function Panels({ data, year, rhythm }: { data: ReadyData; year: YearDays; rhythm: RhythmState }): JSX.Element {
  if (data.days.length === 0 && data.stats.allTimeStrokes === 0) {
    return <p class="progress__muted">No practice recorded yet.</p>
  }
  return (
    <>
      <Tiles data={data} />
      <WpmByDay data={data} />
      <AccuracyConsistency data={data} />
      <RhythmPanel data={data} rhythm={rhythm} />
      <WeeklyBars data={data} />
      <WeakKeys data={data} />
      <Mixups data={data} />
      <Ladder />
      <HeatmapPanel today={data.today} year={year} />
    </>
  )
}
