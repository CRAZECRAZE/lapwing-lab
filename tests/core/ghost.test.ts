import { describe, expect, it } from 'vitest'
import {
  GHOST_CANDIDATES,
  MIN_GHOST_WORDS,
  compareToGhost,
  completionTimes,
  ghostCount,
  pickGhosts,
} from '../../src/core/ghost.ts'
import type { ActiveGhost, Ghost, GhostRow } from '../../src/core/ghost.ts'
import { parseStroke } from '../../src/core/steno.ts'

const row = (tsMs: number, expected: string[], stroke: string, correct = true): GhostRow => ({
  tsMs,
  expected,
  pressedMask: parseStroke(stroke),
  correct,
})

describe('constants', () => {
  it('needs 5 words for a ghost and looks at the last 30 runs', () => {
    expect(MIN_GHOST_WORDS).toBe(5)
    expect(GHOST_CANDIDATES).toBe(30)
  })
})

describe('completionTimes', () => {
  const cat = ['KAT']
  const two = ['KAT/PHREU']

  it('is the ms from the first stroke to each completed word', () => {
    expect(completionTimes([row(1000, cat, 'KAT'), row(2500, cat, 'KAT'), row(4000, cat, 'KAT')])).toEqual([
      0, 1500, 3000,
    ])
  })

  it('completes a word with a miss at the correct row', () => {
    const rows = [row(1000, cat, 'TKOG', false), row(1800, cat, 'KAT'), row(3000, cat, 'KAT')]
    expect(completionTimes(rows)).toEqual([800, 2000])
  })

  it('completes a two-stroke word at its last stroke', () => {
    const rows = [row(0, two, 'KAT'), row(700, two, 'PHREU'), row(1500, cat, 'KAT')]
    expect(completionTimes(rows)).toEqual([700, 1500])
  })

  it('does not add a completion for a star-undo inside a word', () => {
    // Live: KAT, * (undo, never logged), KAT, PHREU. The log holds KAT, KAT, PHREU.
    const rows = [row(0, two, 'KAT'), row(500, two, 'KAT'), row(900, two, 'PHREU')]
    expect(completionTimes(rows)).toEqual([900])
  })

  it('is empty for no rows and for rows that never complete', () => {
    expect(completionTimes([])).toEqual([])
    expect(completionTimes([row(0, two, 'KAT'), row(400, cat, 'TKOG', false)])).toEqual([])
  })
})

const run = (testId: number, endedAt: number, wpm: number, words = MIN_GHOST_WORDS): Ghost => ({
  testId,
  endedAt,
  wpm,
  completions: Array.from({ length: words }, (_, i) => i * 1000),
})

describe('pickGhosts', () => {
  it('ignores runs with fewer than MIN_GHOST_WORDS completions', () => {
    const short = run(1, 9000, 99, MIN_GHOST_WORDS - 1)
    const ok = run(2, 1000, 20)
    expect(pickGhosts([short, ok])).toEqual({ best: ok, last: ok })
    expect(pickGhosts([short])).toEqual({ best: null, last: null })
  })

  it('best is the highest wpm; a tie goes to the later run', () => {
    const a = run(1, 1000, 30)
    const b = run(2, 2000, 40)
    const c = run(3, 3000, 40)
    expect(pickGhosts([a, b, c]).best).toBe(c)
    expect(pickGhosts([c, b, a]).best).toBe(c)
  })

  it('last is the latest endedAt; a tie goes to the higher testId', () => {
    const a = run(1, 3000, 10)
    const b = run(2, 2000, 50)
    const c = run(3, 3000, 20)
    expect(pickGhosts([a, b, c]).last).toBe(c)
    expect(pickGhosts([c, b, a]).last).toBe(c)
  })

  it('best and last can be the same run', () => {
    const a = run(1, 1000, 10)
    const b = run(2, 2000, 50)
    const picked = pickGhosts([a, b])
    expect(picked.best).toBe(b)
    expect(picked.last).toBe(b)
  })

  it('is null for both with no runs', () => {
    expect(pickGhosts([])).toEqual({ best: null, last: null })
  })
})

describe('ghostCount', () => {
  const ghost: Ghost = {
    testId: 1,
    endedAt: 0,
    wpm: 10,
    completions: [500, 1500, 3000],
  }

  it('counts the completions at or before the elapsed time', () => {
    expect(ghostCount(ghost, 0)).toBe(0)
    expect(ghostCount(ghost, 499)).toBe(0)
    expect(ghostCount(ghost, 500)).toBe(1)
    expect(ghostCount(ghost, 2999)).toBe(2)
    expect(ghostCount(ghost, 3000)).toBe(3)
    expect(ghostCount(ghost, 999999)).toBe(3)
  })
})

describe('compareToGhost', () => {
  const now = new Date(2026, 9, 30, 12, 0, 0).getTime()
  const DAY = 24 * 60 * 60 * 1000
  const ghost = (label: 'Best' | 'Last', daysAgo: number, words: number): ActiveGhost => ({
    label,
    testId: 1,
    endedAt: now - daysAgo * DAY,
    wpm: 30,
    completions: Array.from({ length: words }, (_, i) => i * 1000),
  })

  it('says how many words the run had by now, and how far ahead you are', () => {
    expect(
      compareToGhost(ghost('Best', 3, 22), now, {
        completed: 25,
        elapsedMs: 41000,
      }),
    ).toBe('Best run (3 days ago) had 22 words by 0:41. You: 25 — 3 ahead.')
  })

  it('says behind', () => {
    expect(
      compareToGhost(ghost('Best', 3, 22), now, {
        completed: 20,
        elapsedMs: 41000,
      }),
    ).toBe('Best run (3 days ago) had 22 words by 0:41. You: 20 — 2 behind.')
  })

  it('says level', () => {
    expect(
      compareToGhost(ghost('Best', 3, 22), now, {
        completed: 22,
        elapsedMs: 41000,
      }),
    ).toBe('Best run (3 days ago) had 22 words by 0:41. You: 22 — level.')
  })

  it('uses the singular for one word and the Last label', () => {
    expect(
      compareToGhost(ghost('Last', 1, 1), now, {
        completed: 0,
        elapsedMs: 65000,
      }),
    ).toBe('Last run (yesterday) had 1 word by 1:05. You: 0 — 1 behind.')
  })

  it('counts only the ghost words reached by the elapsed time', () => {
    expect(
      compareToGhost(ghost('Last', 0, 50), now, {
        completed: 5,
        elapsedMs: 9000,
      }),
    ).toBe('Last run (today) had 10 words by 0:09. You: 5 — 5 behind.')
  })
})
