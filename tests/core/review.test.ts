import { describe, expect, it } from 'vitest'
import type { StrokeRecord } from '../../server/archive.ts'
import { describeTest, misses, slowest } from '../../src/core/review.ts'
import { parseStroke } from '../../src/core/steno.ts'

function stroke(over: Partial<StrokeRecord> & { pressed?: string }): StrokeRecord {
  const { pressed, ...rest } = over
  return {
    testId: 1,
    tsMs: 0,
    prompt: 'sap',
    expected: ['SAP'],
    pressedLevers: [],
    pressedMask: parseStroke(pressed ?? 'SAP'),
    correct: true,
    latencyMs: 500,
    attemptNo: 1,
    ...rest,
  }
}

describe('misses', () => {
  it('reports an extra key', () => {
    expect(misses([stroke({ correct: false, pressed: 'STAP' })])).toEqual([
      { prompt: 'sap', expected: 'SAP', pressed: 'STAP', missing: [], extra: ['T-'] },
    ])
  })

  it('reports a missing key', () => {
    expect(misses([stroke({ correct: false, pressed: 'S-P' })])).toEqual([
      { prompt: 'sap', expected: 'SAP', pressed: 'S-P', missing: ['A-'], extra: [] },
    ])
  })

  it('picks the nearer of two accepted outlines', () => {
    const [miss] = misses([stroke({ correct: false, expected: ['TAP', 'SAP'], pressed: 'SA' })])
    expect(miss.expected).toBe('SAP')
    expect(miss.missing).toEqual(['-P'])
  })

  it('uses the closest stroke of a multi-stroke outline', () => {
    const [miss] = misses([stroke({ correct: false, expected: ['TKPW/SAP'], pressed: 'S-P' })])
    expect(miss.expected).toBe('SAP')
  })

  it('skips an outline that does not parse, and falls back when none do', () => {
    const [a] = misses([stroke({ correct: false, expected: ['???', 'SAP'], pressed: 'S-P' })])
    expect(a.expected).toBe('SAP')
    const [b] = misses([stroke({ correct: false, expected: ['???'], pressed: 'S-P' })])
    expect(b).toEqual({ prompt: 'sap', expected: '???', pressed: 'S-P', missing: [], extra: [] })
    const [c] = misses([stroke({ correct: false, expected: [], pressed: 'S-P' })])
    expect(c.expected).toBe('')
  })

  it('ignores correct strokes and an empty list', () => {
    expect(misses([stroke({})])).toEqual([])
    expect(misses([])).toEqual([])
  })
})

describe('slowest', () => {
  const list = [
    stroke({ prompt: 'a', latencyMs: 300 }),
    stroke({ prompt: 'b', latencyMs: 900 }),
    stroke({ prompt: 'c', latencyMs: 900 }),
    stroke({ prompt: 'x', latencyMs: 5000, correct: false }),
    stroke({ prompt: 'd', latencyMs: 100 }),
  ]

  it('orders by latency, ties in log order, correct strokes only', () => {
    expect(slowest(list, 10)).toEqual([
      { prompt: 'b', latencyMs: 900 },
      { prompt: 'c', latencyMs: 900 },
      { prompt: 'a', latencyMs: 300 },
      { prompt: 'd', latencyMs: 100 },
    ])
  })

  it('limits to n and does not reorder its input', () => {
    expect(slowest(list, 2).map((s) => s.prompt)).toEqual(['b', 'c'])
    expect(list.map((s) => s.prompt)).toEqual(['a', 'b', 'c', 'x', 'd'])
  })
})

describe('describeTest', () => {
  it('names a stage0 section by its drill title', () => {
    expect(describeTest({ mode: 'stage0', section: 'rows-vowels', chapter: 4 })).toMatch(/^Chapter 4 · .*Vowels/)
  })

  it('falls back to the section id, and to mode and section for other modes', () => {
    expect(describeTest({ mode: 'stage0', section: 'mystery', chapter: 4 })).toBe('Chapter 4 · mystery')
    expect(describeTest({ mode: 'weird', section: 'x-1', chapter: null })).toBe('weird · x-1')
  })

  it('names a free-type run by its source and mode', () => {
    expect(describeTest({ mode: 'free', section: 'pseudo/words-25', chapter: 4 })).toBe(
      'Free type · Chapter 4 pseudo-words · 25 words',
    )
    expect(describeTest({ mode: 'free', section: 'ch-8/time-60', chapter: 8 })).toBe(
      'Free type · Chapters 5–8 word lists · 60 seconds',
    )
    expect(describeTest({ mode: 'free', section: 'ch-x/what', chapter: null })).toBe('Free type · ch-x/what')
    expect(describeTest({ mode: 'free', section: null, chapter: null })).toBe('Free type')
  })
})
