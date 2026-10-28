import { useLayoutEffect, useRef, useState } from 'preact/hooks'
import type { DayStat } from '../../../server/archive.ts'
import type { StatsMode, StatsResponse } from '../../../server/stats.ts'
import { getDays, getStats } from '../../api.ts'
import { addDays } from '../../core/days.ts'
import { rangeBounds, weekStart } from '../../core/progressview.ts'
import type { RangeId } from '../../core/progressview.ts'

export type ProgressData = {
  status: 'loading' | 'error' | 'ready'
  /** Null unless `status` is 'ready'; always the answer for the range and mode below, never an earlier one. */
  stats: StatsResponse | null
  /** Every run counted, as on the Days tab; covers the range and the current and previous Monday-week. */
  days: DayStat[] | null
  today: string
  range: RangeId
  mode: StatsMode
  /** Asks for the same data again after a failure. */
  retry: () => void
}

type Loaded = { key: string } & ({ status: 'error' } | { status: 'ready'; stats: StatsResponse; days: DayStat[] })

/**
 * Loads the stats and the days for a range and mode. A switch goes back to 'loading' (the old data is not shown),
 * and a response for an earlier request, or one that arrives after unmount, is dropped.
 */
export function useProgressData(range: RangeId, mode: StatsMode, today: string): ProgressData {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [attempt, setAttempt] = useState(0)
  const latest = useRef(0)
  const key = `${range}|${mode}|${today}|${attempt}`

  useLayoutEffect(() => {
    let live = true
    const mine = ++latest.current
    const current = (): boolean => live && latest.current === mine
    const { from, to } = rangeBounds(range, today)
    // The tiles compare this Monday-week with the previous full one, whatever the range.
    const previousWeek = addDays(weekStart(today), -7)
    const daysFrom = from < previousWeek ? from : previousWeek
    Promise.all([getStats(from, to, mode), getDays(daysFrom, to)]).then(
      ([stats, days]) => current() && setLoaded({ key, status: 'ready', stats, days }),
      () => current() && setLoaded({ key, status: 'error' }),
    )
    return () => {
      live = false
      latest.current++ // a response for another request, or after unmount, is ignored
    }
  }, [range, mode, today, attempt])

  const mine = loaded !== null && loaded.key === key ? loaded : null
  return {
    status: mine === null ? 'loading' : mine.status,
    stats: mine?.status === 'ready' ? mine.stats : null,
    days: mine?.status === 'ready' ? mine.days : null,
    today,
    range,
    mode,
    retry: () => setAttempt((n) => n + 1),
  }
}
