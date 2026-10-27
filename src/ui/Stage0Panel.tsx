import type { JSX } from 'preact'
import { useEffect, useState } from 'preact/hooks'
import type { TestRow } from '../../server/archive.ts'
import { getLastTest } from '../api.ts'
import { formatAccuracy, formatWpm } from '../core/format.ts'
import { isPlainClick, navigate } from '../router.ts'
import { STAGE0_INFO } from '../stage0/lists.ts'
import type { Stage0Info } from '../stage0/lists.ts'

const minutes = (ms: number): number => Math.max(1, Math.ceil(ms / 60000))

/** The quiet "last time" text for one drill. */
export function describeLast(info: Stage0Info, row: TestRow | null): string {
  if (row === null || row.accuracy === null) return '—'
  const meta = (row.meta ?? {}) as { elapsedMs?: unknown; passed?: unknown }
  if (info.passMark) {
    const time = typeof meta.elapsedMs === 'number' ? ` · ${minutes(meta.elapsedMs)} min` : ''
    const verdict = meta.passed === true ? 'Passed ' : meta.passed === false ? 'Not yet · ' : ''
    return `${verdict}${formatAccuracy(row.accuracy, info.passMark.accuracy)}${time}`
  }
  return `${formatAccuracy(row.accuracy)} · ${formatWpm(row.wpm ?? 0)}`
}

export function Stage0Panel(): JSX.Element {
  // A drill with no entry yet (still loading, never run, or the lookup failed) shows a dash.
  const [last, setLast] = useState<Record<string, TestRow | null>>({})

  useEffect(() => {
    let live = true
    for (const { id } of STAGE0_INFO) {
      void getLastTest('stage0', id).then((row) => live && setLast((prev) => ({ ...prev, [id]: row })))
    }
    return () => {
      live = false
    }
  }, [])

  return (
    <section class="stage0" aria-labelledby="stage0-heading">
      <h2 id="stage0-heading" class="stage0__heading">Practice — Stage 0</h2>
      <ul class="stage0__list">
        {STAGE0_INFO.map((info) => {
          const href = `/drill/stage0/${info.id}`
          return (
            <li key={info.id}>
              <a
                class="stage0__drill"
                href={href}
                onClick={(e) => {
                  if (!isPlainClick(e)) return
                  e.preventDefault()
                  navigate(href)
                }}
              >
                <span class="stage0__title">{info.title}</span>
                <span class="stage0__last">{describeLast(info, last[info.id] ?? null)}</span>
              </a>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
