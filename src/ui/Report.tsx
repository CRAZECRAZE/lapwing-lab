import type { JSX } from 'preact'
import { monthTitle } from '../core/report.ts'

/** One month's report. A stub for now: the heading only. */
export function Report({ month }: { month: string }): JSX.Element {
  return (
    <section class="report">
      <h1>{monthTitle(month)}</h1>
    </section>
  )
}
