import { useLayoutEffect, useRef, useState } from 'preact/hooks'
import { getDays } from '../api.ts'
import { addDays, currentStreak, localDate } from '../core/days.ts'

/**
 * Consecutive practice days ending today (or yesterday while today is still empty).
 * null while the first load runs and after a failed load. Reloads when `refreshKey` changes and
 * keeps the previous number while it does.
 */
export function useStreak(refreshKey: string): number | null {
  const [streak, setStreak] = useState<number | null>(null)
  const latest = useRef(0)

  useLayoutEffect(() => {
    const mine = ++latest.current
    const today = localDate(Date.now())
    getDays(addDays(today, -400), today).then(
      (days) => {
        if (latest.current !== mine) return
        try {
          setStreak(currentStreak(new Set(days.map((d) => d.date)), today))
        } catch {
          setStreak(null) // an unexpected response shape counts as a failed load
        }
      },
      () => {
        if (latest.current === mine) setStreak(null)
      },
    )
    return () => {
      latest.current++ // a response for an earlier key, or after unmount, is ignored
    }
  }, [refreshKey])

  return streak
}
