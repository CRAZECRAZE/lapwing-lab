import { replayItems } from './chaptertest.ts'
import { localDate } from './days.ts'
import { MIN_KEY_PRESSES, MIN_MIXUP_COUNT, keyStats } from './keystats.ts'
import { daysBetween } from './progressview.ts'
import { nearestStroke } from './review.ts'
import { SLOTS, maskToSlots } from './steno.ts'
import type { Slot } from './steno.ts'

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

/** A pattern is a key pressed in place of another, or a needed key left out with nothing standing in for it. */
export type PatternKey = { kind: 'mixup'; pressed: Slot; needed: Slot } | { kind: 'missing'; needed: Slot }

/** A pattern on the Patterns tab: `count` occurrences out of `required` presses of the needed key. */
export type FixupPattern = PatternKey & { id: string; count: number; required: number; rate: number; lastTsMs: number }

/** Both tabs' lists, with the date range they cover. */
export type FixupLists = { from: string; to: string; words: FixupWord[]; patterns: FixupPattern[] }

/** `mixup:<pressed>><needed>` or `missing:<needed>`. */
export function patternId(key: PatternKey): string {
  return key.kind === 'mixup' ? `mixup:${key.pressed}>${key.needed}` : `missing:${key.needed}`
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/** Higher rate first, then higher count, then the needed key in `SLOTS` order, then the id. */
function comparePatterns(a: FixupPattern, b: FixupPattern): number {
  return (
    b.rate - a.rate ||
    b.count - a.count ||
    SLOTS.indexOf(a.needed) - SLOTS.indexOf(b.needed) ||
    compareText(a.id, b.id)
  )
}

/**
 * The patterns to fix, most mistaken first. Rows are in chronological order (run by run, stroke by stroke) and are
 * limited to the window by the caller. The needed stroke of a row is as in `keyStats`; rows with none are skipped.
 *
 * A mix-up counts as in `keyStats`. A missing key counts net of the mix-ups for that key. A pattern qualifies when its
 * needed key was required `MIN_KEY_PRESSES` times and it occurred `MIN_MIXUP_COUNT` times. Its rate is its count over
 * the needed key's required presses. A pattern is fixed, and left out, when the latest `FIXED_STREAK` strokes that
 * required its needed key all pressed it; a mix-up and a missing key for the same needed key share that status.
 */
export function rankPatterns(rows: readonly FixupRow[]): FixupPattern[] {
  const clean = new Map<Slot, boolean[]>()
  const lastSeen = new Map<string, number>()
  for (const row of rows) {
    if (!Number.isInteger(row.pressedMask)) continue
    const needed = row.correct ? row.pressedMask : nearestStroke(row.expected, row.pressedMask)
    if (needed === null) continue
    for (const slot of maskToSlots(needed)) {
      const list = clean.get(slot)
      const wasPressed = (row.pressedMask & needed & (1 << SLOTS.indexOf(slot))) !== 0
      if (list) list.push(wasPressed)
      else clean.set(slot, [wasPressed])
    }
    if (row.correct) continue
    const missing = maskToSlots(needed & ~row.pressedMask)
    const extra = maskToSlots(row.pressedMask & ~needed)
    const oneForOne = missing.length === 1 && extra.length === 1
    for (const slot of missing) {
      const id = oneForOne ? patternId({ kind: 'mixup', pressed: extra[0], needed: slot }) : patternId({ kind: 'missing', needed: slot })
      lastSeen.set(id, row.tsMs)
    }
  }

  const { keys, mixups } = keyStats(rows.map((r) => ({ expected: r.expected, pressedMask: r.pressedMask, correct: r.correct, n: 1 })))
  const required = new Map(keys.map((k) => [k.slot, k.required]))
  const counted: [PatternKey, number][] = mixups.map((m) => [{ kind: 'mixup', pressed: m.pressed, needed: m.needed }, m.count])
  for (const key of keys) {
    const net = key.missed - mixups.filter((m) => m.needed === key.slot).reduce((sum, m) => sum + m.count, 0)
    counted.push([{ kind: 'missing', needed: key.slot }, net])
  }

  const patterns: FixupPattern[] = []
  for (const [key, count] of counted) {
    const presses = required.get(key.needed) ?? 0
    if (presses < MIN_KEY_PRESSES || count < MIN_MIXUP_COUNT) continue
    if ((clean.get(key.needed) ?? []).slice(-FIXED_STREAK).every(Boolean)) continue
    const id = patternId(key)
    patterns.push({ ...key, id, count, required: presses, rate: count / presses, lastTsMs: lastSeen.get(id) ?? 0 })
  }
  return patterns.sort(comparePatterns).slice(0, LIST_SIZE)
}

/** Both fix-up lists from the archived rows of the window. */
export function buildLists(rows: readonly FixupRow[]): { words: FixupWord[]; patterns: FixupPattern[] } {
  return { words: rankWords(wordAttempts(rows)), patterns: rankPatterns(rows) }
}
