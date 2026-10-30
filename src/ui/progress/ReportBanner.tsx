import type { JSX } from 'preact'
import { useLayoutEffect, useState } from 'preact/hooks'
import type { DayStat } from '../../../server/archive.ts'
import { getDays, getSettings } from '../../api.ts'
import { isMonthComplete, monthBounds, monthKey, monthName, practiceByMonth, previousMonth } from '../../core/report.ts'
import { isPlainClick, navigate } from '../../router.ts'
import '../reports.css'

/** The month to announce: the latest complete month with practice, if the owner has not opened its report. */
function pendingMonth(days: readonly DayStat[], seen: string | null, today: string): string | null {
  const latest = [...practiceByMonth(days).keys()].filter((m) => isMonthComplete(m, today)).sort().pop()
  return latest !== undefined && (seen === null || latest > seen) ? latest : null
}

/**
 * A quiet line on the Progress page when a month has just ended and its report has not been opened.
 * One fetch on mount (the last two months of days, and the settings); a failure or a slow answer shows nothing.
 */
export function ReportBanner({ today }: { today: string }): JSX.Element | null {
  const [month, setMonth] = useState<string | null>(null)

  useLayoutEffect(() => {
    let live = true
    const from = monthBounds(previousMonth(monthKey(today))).from
    Promise.all([getDays(from, today), getSettings()]).then(
      ([days, settings]) => live && setMonth(pendingMonth(days, settings.reportSeen ?? null, today)),
      () => undefined, // no banner and no error: it is a nicety
    )
    return () => {
      live = false
    }
  }, [today])

  if (month === null) return null
  const href = `/progress/reports/${month}`
  return (
    <p class="report-banner">
      <a
        href={href}
        onClick={(e) => {
          if (!isPlainClick(e)) return
          e.preventDefault()
          navigate(href)
        }}
      >
        {`${monthName(month)} is done. Your report is ready.`}
      </a>
    </p>
  )
}
