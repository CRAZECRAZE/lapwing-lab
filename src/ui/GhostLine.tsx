import type { JSX } from 'preact'
import type { DrillStats } from '../core/drill.ts'
import { lastSeenText } from '../core/fixup.ts'
import { compareToGhost, ghostCount } from '../core/ghost.ts'
import type { ActiveGhost } from '../core/ghost.ts'
import './ghost.css'

const percent = (done: number, of: number): string => `${Math.min(100, (done / of) * 100)}%`

/**
 * One quiet line and two thin tracks under the drill status. Not a live region: it changes every few seconds
 * and reading it aloud would talk over the drill.
 */
export function GhostLine({
  ghost,
  you,
  elapsedMs,
  total,
  nowMs,
}: {
  ghost: ActiveGhost
  you: number
  elapsedMs: number
  /** The run's item count; null for a timed run, which sizes the tracks by the longer of the two runs. */
  total: number | null
  nowMs: number
}): JSX.Element {
  const theirs = ghostCount(ghost, elapsedMs)
  const of = Math.max(1, total ?? Math.max(ghost.completions.length, you))
  return (
    <div class="ghost">
      <p class="ghost__text">
        Ghost ({ghost.label.toLowerCase()}, {lastSeenText(ghost.endedAt, nowMs)}) {theirs} · You {you}
      </p>
      <div class="ghost__track" aria-hidden="true">
        <div class="ghost__fill ghost__fill--ghost" style={{ width: percent(theirs, of) }} />
      </div>
      <div class="ghost__track" aria-hidden="true">
        <div class="ghost__fill ghost__fill--you" style={{ width: percent(you, of) }} />
      </div>
    </div>
  )
}

/** The result card's one line against the ghost this run raced; nothing without one. */
export function GhostNote({ ghost, stats }: { ghost: ActiveGhost | null; stats: DrillStats }): JSX.Element | null {
  if (!ghost) return null
  const text = compareToGhost(ghost, Date.now(), { completed: stats.completed, elapsedMs: stats.elapsedMs })
  return <p class="ghost__note">{text}</p>
}
