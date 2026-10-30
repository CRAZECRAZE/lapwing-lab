import { useLayoutEffect, useRef, useState } from 'preact/hooks'
import { getSettings, getStats, putSettings } from '../../api.ts'
import { addDays } from '../../core/days.ts'
import { detectPlateau } from '../../core/plateau.ts'
import type { Plateau } from '../../core/plateau.ts'

/** The notice looks at the last 56 days, today included. */
const WINDOW_DAYS = 56
/** "Not now" hides the notice for this many days. */
const SNOOZE_DAYS = 14

type Loaded = { plateau: Plateau | null; snoozedUntil: string | null }

/**
 * The plateau notice's data: one fetch on mount of the free-type days (whatever Progress's Mode and Range say) and the
 * settings. A failure or an empty answer gives no plateau, silently. `plateau` is null while snoozed, i.e. while the
 * stored snooze date is after `today`.
 */
export function usePlateau(today: string): { plateau: Plateau | null; snooze: () => Promise<void> } {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const live = useRef(true)

  useLayoutEffect(() => {
    live.current = true
    Promise.all([getStats(addDays(today, 1 - WINDOW_DAYS), today, 'free'), getSettings()]).then(
      ([stats, settings]) => {
        if (!live.current) return
        const plateau = Array.isArray(stats?.days) ? detectPlateau(stats.days, today) : null
        setLoaded({ plateau, snoozedUntil: settings.plateauSnoozedUntil })
      },
      () => undefined, // no notice and no error: the notice is a nicety
    )
    return () => {
      live.current = false
    }
  }, [today])

  const snooze = async (): Promise<void> => {
    const until = addDays(today, SNOOZE_DAYS)
    try {
      await putSettings({ plateauSnoozedUntil: until })
    } catch {
      return // not stored: the notice stays
    }
    if (live.current) setLoaded((l) => (l === null ? l : { ...l, snoozedUntil: until }))
  }

  const hidden = loaded === null || (loaded.snoozedUntil !== null && loaded.snoozedUntil > today)
  return { plateau: hidden ? null : loaded.plateau, snooze }
}
