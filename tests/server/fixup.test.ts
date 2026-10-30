import { afterEach, describe, expect, it } from 'vitest'
import { parseStroke } from '../../src/core/steno.ts'
import { openArchive } from '../../server/archive.ts'
import type { Archive } from '../../server/archive.ts'
import { buildFixup, emptyFixup } from '../../server/fixup.ts'

const open: Archive[] = []
function memory(): Archive {
  const a = openArchive(':memory:')
  open.push(a)
  return a
}
afterEach(() => {
  while (open.length) open.pop()?.close()
})

const RANGE = { from: '2026-10-01', to: '2026-10-31' }
const KAT = parseStroke('KAT')
const KAP = parseStroke('KAP')

// One run of `items` presentations of "cat"; the items in `missed` take a wrong stroke (P for T) before the right one.
function seedCat(a: Archive, items: number, missed: number[]) {
  const testId = a.startTest({
    sessionId: a.createSession(1000),
    startedAt: 1001,
    mode: 'free',
    chapter: null,
    section: null,
    itemCount: items,
  })
  let tsMs = new Date(2026, 9, 27, 10).getTime()
  const add = (pressedMask: number, correct: boolean) => {
    tsMs += 1000
    a.addStroke({
      testId,
      tsMs,
      prompt: 'cat',
      expected: ['KAT'],
      pressedLevers: [],
      pressedMask,
      correct,
      latencyMs: 400,
      attemptNo: 1,
    })
  }
  for (let i = 0; i < items; i++) {
    if (missed.includes(i)) add(KAP, false)
    add(KAT, true)
  }
}

describe('emptyFixup', () => {
  it('echoes the range with empty lists', () => {
    expect(emptyFixup(RANGE)).toEqual({ ...RANGE, words: [], patterns: [] })
  })
})

describe('buildFixup', () => {
  it('is empty for an empty database and echoes the range', () => {
    expect(buildFixup(memory(), RANGE)).toEqual({ ...RANGE, words: [], patterns: [] })
  })

  it('lists a word missed often and the repeated mix-up behind it', () => {
    const a = memory()
    seedCat(a, 36, [30, 31, 32, 33])
    const lists = buildFixup(a, RANGE)
    expect(lists.from).toBe('2026-10-01')
    expect(lists.to).toBe('2026-10-31')
    expect(lists.words).toEqual([
      expect.objectContaining({ prompt: 'cat', outlines: ['KAT'], attempts: 36, misses: 4 }),
    ])
    expect(lists.patterns).toEqual([
      expect.objectContaining({ id: 'mixup:-P>-T', kind: 'mixup', pressed: '-P', needed: '-T', count: 4 }),
    ])
  })

  it('ignores strokes outside the range', () => {
    const a = memory()
    seedCat(a, 36, [30, 31, 32, 33])
    expect(buildFixup(a, { from: '2026-11-01', to: '2026-11-30' })).toEqual({
      from: '2026-11-01',
      to: '2026-11-30',
      words: [],
      patterns: [],
    })
  })
})
