import { afterEach, describe, expect, it } from 'vitest'
import { parseStroke } from '../../src/core/steno.ts'
import { openArchive } from '../../server/archive.ts'
import type { Archive } from '../../server/archive.ts'
import { buildGhosts } from '../../server/ghost.ts'

const open: Archive[] = []
function memory(): Archive {
  const a = openArchive(':memory:')
  open.push(a)
  return a
}
afterEach(() => {
  while (open.length) open.pop()?.close()
})

const KAT = parseStroke('KAT')

type Seed = { words: number; wpm: number | null; endedAt: number | null; meta?: unknown; mode?: string; section?: string }

// One run of `words` "cat" strokes, a second apart, finished (or left open) as given.
function seedRun(a: Archive, s: Seed): number {
  const testId = a.startTest({
    sessionId: a.createSession(1000),
    startedAt: 1001,
    mode: s.mode ?? 'section',
    chapter: 4,
    section: s.section ?? 'rows-star',
    itemCount: s.words,
  })
  for (let i = 0; i < s.words; i++) {
    a.addStroke({
      testId,
      tsMs: 5000 + 1000 * i,
      prompt: 'cat',
      expected: ['KAT'],
      pressedLevers: [],
      pressedMask: KAT,
      correct: true,
      latencyMs: 400,
      attemptNo: 1,
    })
  }
  if (s.endedAt !== null) {
    a.finishTest(testId, { endedAt: s.endedAt, wpm: s.wpm ?? 0, accuracy: 1, meta: s.meta ?? { passed: true } })
  }
  return testId
}

describe('Archive.ghostRuns', () => {
  it('returns finished, non-abandoned runs of the section newest first, with their strokes in order', () => {
    const a = memory()
    const old = seedRun(a, { words: 2, wpm: 20, endedAt: 2000 })
    const recent = seedRun(a, { words: 3, wpm: 30, endedAt: 3000 })
    const runs = a.ghostRuns('section', 'rows-star', 10)
    expect(runs.map((r) => r.testId)).toEqual([recent, old])
    expect(runs[0]).toMatchObject({ testId: recent, endedAt: 3000, wpm: 30 })
    expect(runs[0].rows).toEqual([0, 1, 2].map((i) => ({ tsMs: 5000 + 1000 * i, expected: ['KAT'], pressedMask: KAT, correct: true })))
    expect(runs[1].rows).toHaveLength(2)
  })

  it('leaves out unfinished, abandoned and other-section or other-mode runs', () => {
    const a = memory()
    const keep = seedRun(a, { words: 1, wpm: 20, endedAt: 2000 })
    seedRun(a, { words: 1, wpm: null, endedAt: null })
    seedRun(a, { words: 1, wpm: 40, endedAt: 4000, meta: { abandoned: true } })
    seedRun(a, { words: 1, wpm: 40, endedAt: 4000, section: 'other' })
    seedRun(a, { words: 1, wpm: 40, endedAt: 4000, mode: 'stage0' })
    expect(a.ghostRuns('section', 'rows-star', 10).map((r) => r.testId)).toEqual([keep])
  })

  it('keeps only the newest limit runs and breaks an ended_at tie by id, newest first', () => {
    const a = memory()
    const ids = [1000, 2000, 2000, 3000].map((endedAt) => seedRun(a, { words: 1, wpm: 10, endedAt }))
    expect(a.ghostRuns('section', 'rows-star', 3).map((r) => r.testId)).toEqual([ids[3], ids[2], ids[1]])
    expect(a.ghostRuns('section', 'rows-star', 1).map((r) => r.testId)).toEqual([ids[3]])
  })

  it('is empty when nothing matches', () => {
    expect(memory().ghostRuns('section', 'rows-star', 30)).toEqual([])
  })
})

describe('buildGhosts', () => {
  it('picks the fastest run as best and the newest as last, skipping runs under 5 words', () => {
    const a = memory()
    const fast = seedRun(a, { words: 6, wpm: 50, endedAt: 2000 })
    seedRun(a, { words: 5, wpm: 30, endedAt: 3000 })
    const newest = seedRun(a, { words: 8, wpm: 20, endedAt: 4000 })
    seedRun(a, { words: 4, wpm: 99, endedAt: 5000 })
    const { best, last } = buildGhosts(a, 'section', 'rows-star')
    expect(best).toEqual({ testId: fast, endedAt: 2000, wpm: 50, completions: [0, 1000, 2000, 3000, 4000, 5000] })
    expect(last).toMatchObject({ testId: newest, endedAt: 4000, wpm: 20 })
    expect(last?.completions).toHaveLength(8)
  })

  it('has no ghosts when no run qualifies', () => {
    const a = memory()
    seedRun(a, { words: 4, wpm: 99, endedAt: 5000 })
    expect(buildGhosts(a, 'section', 'rows-star')).toEqual({ best: null, last: null })
    expect(buildGhosts(a, 'section', 'nothing-here')).toEqual({ best: null, last: null })
  })
})
