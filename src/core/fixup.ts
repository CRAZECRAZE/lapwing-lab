import { replayItems } from './chaptertest.ts'
import { localDate } from './days.ts'
import { daysBetween } from './progressview.ts'

/** How far back the fix-up lists look, in local days. */
export const FIXUP_WINDOW_DAYS = 30
/** A word needs this many attempts before it can be listed. */
export const MIN_WORD_ATTEMPTS = 5
/** An item is fixed when its latest this-many attempts are all clean. */
export const FIXED_STREAK = 10
/** At most this many items are listed per tab. */
export const LIST_SIZE = 10

/** One archived stroke row of a run, as the fix-up replay reads it. */
export type FixupRow = {
  testId: number
  tsMs: number
  prompt: string
  expected: string[]
  pressedMask: number
  correct: boolean
}

/** One presentation of a word that was completed: clean when no row of it was wrong. */
export type WordAttempt = { prompt: string; expected: string[]; clean: boolean; tsMs: number }

/** A word on the Words tab. */
export type FixupWord = {
  prompt: string
  outlines: string[]
  kind: 'word' | 'stroke'
  attempts: number
  misses: number
  rate: number
  lastTsMs: number
}

/**
 * The word attempts in archived stroke rows, in the order given (rows of one run in time order, runs one after the
 * other). Each run is replayed on its own, so items never span two runs. An item that never completed is dropped; the
 * rest are clean when every row of the item is `correct`. `prompt` and `expected` come from the item's first row and
 * `tsMs` from its last.
 */
export function wordAttempts(rows: readonly FixupRow[]): WordAttempt[] {
  const runs = new Map<number, FixupRow[]>()
  for (const row of rows) {
    const run = runs.get(row.testId)
    if (run) run.push(row)
    else runs.set(row.testId, [row])
  }
  const out: WordAttempt[] = []
  for (const run of runs.values()) {
    const replay = replayItems(run)
    let start = 0
    while (start < run.length) {
      let end = start
      while (end + 1 < run.length && replay[end + 1].item === replay[start].item) end++
      if (replay[end].completes) {
        const items = run.slice(start, end + 1)
        out.push({
          prompt: items[0].prompt,
          expected: items[0].expected,
          clean: items.every((r) => r.correct),
          tsMs: items[items.length - 1].tsMs,
        })
      }
      start = end + 1
    }
  }
  return out
}

/** A prompt that is its only accepted outline (stage 0 strokes, pseudo-words) is shown as a stroke, anything else as a word. */
export function itemKind(prompt: string, outlines: readonly string[]): 'word' | 'stroke' {
  return outlines.length === 1 && outlines[0] === prompt ? 'stroke' : 'word'
}

/**
 * The words to fix, most missed first: at least `MIN_WORD_ATTEMPTS` attempts, at least one miss, and not fixed (the
 * latest `FIXED_STREAK` attempts are not all clean). Sorted by miss rate, then more attempts, then prompt; at most
 * `LIST_SIZE`. The window is the caller's job: pass only attempts inside it.
 */
export function rankWords(attempts: readonly WordAttempt[]): FixupWord[] {
  const byPrompt = new Map<string, WordAttempt[]>()
  for (const a of attempts) {
    const list = byPrompt.get(a.prompt)
    if (list) list.push(a)
    else byPrompt.set(a.prompt, [a])
  }
  const words: FixupWord[] = []
  for (const [prompt, list] of byPrompt) {
    const sorted = list
      .map((a, i) => ({ a, i }))
      .sort((x, y) => x.a.tsMs - y.a.tsMs || x.i - y.i)
      .map((x) => x.a)
    const misses = sorted.filter((a) => !a.clean).length
    if (sorted.length < MIN_WORD_ATTEMPTS || misses === 0) continue
    if (sorted.slice(-FIXED_STREAK).every((a) => a.clean)) continue
    const latest = sorted[sorted.length - 1]
    words.push({
      prompt,
      outlines: latest.expected,
      kind: itemKind(prompt, latest.expected),
      attempts: sorted.length,
      misses,
      rate: misses / sorted.length,
      lastTsMs: latest.tsMs,
    })
  }
  words.sort((a, b) => b.rate - a.rate || b.attempts - a.attempts || (a.prompt < b.prompt ? -1 : a.prompt > b.prompt ? 1 : 0))
  return words.slice(0, LIST_SIZE)
}

/** "today", "yesterday" or "N days ago", by local calendar date. A time in the future counts as today. */
export function lastSeenText(tsMs: number, nowMs: number): string {
  const days = daysBetween(localDate(tsMs), localDate(nowMs))
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  return `${days} days ago`
}
