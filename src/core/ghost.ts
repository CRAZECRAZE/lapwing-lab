// Ghosts: an earlier run's pace to race against. Pure: no DOM, no Node, no clock reads.
import { replayItems } from './chaptertest.ts'
import { lastSeenText } from './fixup.ts'

/** A run needs at least this many completed words to serve as a ghost. */
export const MIN_GHOST_WORDS = 5

/** How many recent runs are considered when picking the ghosts. */
export const GHOST_CANDIDATES = 30

/** One logged stroke of a run. */
export type GhostRow = {
  tsMs: number
  expected: string[]
  pressedMask: number
  correct: boolean
}

/** An earlier run's pace: `completions[i]` is the ms from its first stroke to the completion of its (i+1)th word. */
export type Ghost = {
  testId: number
  endedAt: number
  wpm: number
  completions: number[]
}

/** A ghost being raced, with the name it goes by on screen. */
export type ActiveGhost = Ghost & { label: 'Best' | 'Last' }

/** For each word the run completed, the ms from the first stroke to that word's finishing stroke. */
export function completionTimes(rows: readonly GhostRow[]): number[] {
  if (rows.length === 0) return []
  const flags = replayItems(rows)
  const out: number[] = []
  flags.forEach((flag, i) => {
    if (flag.completes) out.push(rows[i].tsMs - rows[0].tsMs)
  })
  return out
}

/**
 * The two ghosts to race: the fastest run (a tie goes to the later one) and the latest run (a tie goes to the higher
 * test id). Runs under `MIN_GHOST_WORDS` words are skipped. They may be the same run; with none left, both are null.
 */
export function pickGhosts(runs: readonly Ghost[]): {
  best: Ghost | null
  last: Ghost | null
} {
  let best: Ghost | null = null
  let last: Ghost | null = null
  for (const run of runs) {
    if (run.completions.length < MIN_GHOST_WORDS) continue
    if (best === null || run.wpm > best.wpm || (run.wpm === best.wpm && run.endedAt > best.endedAt)) best = run
    if (last === null || run.endedAt > last.endedAt || (run.endedAt === last.endedAt && run.testId > last.testId)) {
      last = run
    }
  }
  return { best, last }
}

/** How many words the ghost had completed `elapsedMs` into its run (a word finished exactly then counts). */
export function ghostCount(ghost: Ghost, elapsedMs: number): number {
  return ghost.completions.filter((t) => t <= elapsedMs).length
}

/** `m:ss`, the seconds rounded. */
function clock(ms: number): string {
  const total = Math.round(ms / 1000)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

/** e.g. `Best run (3 days ago) had 22 words by 0:41. You: 25 — 3 ahead.` */
export function compareToGhost(
  ghost: ActiveGhost,
  nowMs: number,
  you: { completed: number; elapsedMs: number },
): string {
  const theirs = ghostCount(ghost, you.elapsedMs)
  const diff = you.completed - theirs
  const gap = diff > 0 ? `${diff} ahead` : diff < 0 ? `${-diff} behind` : 'level'
  const words = theirs === 1 ? '1 word' : `${theirs} words`
  return `${ghost.label} run (${lastSeenText(ghost.endedAt, nowMs)}) had ${words} by ${clock(you.elapsedMs)}. You: ${you.completed} — ${gap}.`
}
