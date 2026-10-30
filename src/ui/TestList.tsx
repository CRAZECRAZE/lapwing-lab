import type { JSX } from 'preact'
import type { TestSummary } from '../../server/archive.ts'
import { dayLabel, localDate } from '../core/days.ts'
import { describeTest } from '../core/review.ts'
import { FIXUP_MODE, TEXT_MODE } from '../core/runmodes.ts'
import { isPlainClick, navigate } from '../router.ts'
import { useTextNames } from './useTextNames.ts'
import './history.css'

const pad = (n: number): string => String(n).padStart(2, '0')

/** Local 24-hour `HH:MM`. */
export function clockTime(ms: number): string {
  const d = new Date(ms)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** True when the test was marked as left before the end. */
export function wasAbandoned(meta: unknown): boolean {
  return typeof meta === 'object' && meta !== null && (meta as { abandoned?: unknown }).abandoned === true
}

export function TestList({ tests }: { tests: TestSummary[] }): JSX.Element {
  const textNames = useTextNames(tests.some((t) => t.mode === TEXT_MODE))
  return (
    <ul class="tests">
      {tests.map((t) => {
        const href = `/history/${t.id}`
        const finished = t.endedAt !== null
        return (
          <li key={t.id}>
            <a
              class="tests__row"
              href={href}
              onClick={(e) => {
                if (!isPlainClick(e)) return
                e.preventDefault()
                navigate(href)
              }}
            >
              <span class="tests__when">
                <span class="tests__time">{clockTime(t.firstStrokeAt)}</span>
                <span class="tests__date">{dayLabel(localDate(t.firstStrokeAt))}</span>
              </span>
              <span class="tests__what">{describeTest(t, textNames)}</span>
              <span class="tests__result">
                {finished ? `${Math.round((t.accuracy ?? 0) * 100)}% · ${t.mode === FIXUP_MODE ? '—' : `${Math.round(t.wpm ?? 0)} wpm`}` : 'Unfinished'}
                {wasAbandoned(t.meta) && <span class="tests__note"> · Left early</span>}
              </span>
              <span class="tests__strokes">{t.strokeCount} strokes</span>
            </a>
          </li>
        )
      })}
    </ul>
  )
}
