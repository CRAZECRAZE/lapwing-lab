import { describe, expect, it } from 'vitest'
import { MIN_PATTERN_WORDS, PATTERN_WORDS, patternWords } from '../../src/core/fixupwords.ts'
import type { ListWords } from '../../src/core/fixupwords.ts'
import type { DrillItem } from '../../src/core/drill.ts'

const items = (prefix: string, outline: string, n: number): DrillItem[] =>
  Array.from({ length: n }, (_, i) => ({ prompt: `${prefix}${i}`, outlines: [outline] }))

/** A small deterministic generator (mulberry32). */
function seeded(seed: number): () => number {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

describe('constants', () => {
  it('has the spec values', () => {
    expect(PATTERN_WORDS).toBe(12)
    expect(MIN_PATTERN_WORDS).toBe(4)
  })
})

describe('patternWords', () => {
  it('returns only words with an outline stroke containing the needed key', () => {
    const lists: ListWords[] = [
      {
        chapter: 1,
        items: [
          { prompt: 'cat', outlines: ['KAT'] },
          { prompt: 'sack', outlines: ['SAF'] },
          { prompt: 'two', outlines: ['TWO', 'KAT/SAF'] },
        ],
      },
    ]
    const got = patternWords('-T', lists, 5).map((i) => i.prompt).sort()
    expect(got).toEqual(['cat', 'two'])
  })

  it('ignores lists of chapters above the reached chapter', () => {
    const lists: ListWords[] = [
      { chapter: 2, items: items('a', 'KAT', 3) },
      { chapter: 3, items: items('b', 'KAT', 3) },
    ]
    const got = patternWords('-T', lists, 2).map((i) => i.prompt).sort()
    expect(got).toEqual(['a0', 'a1', 'a2'])
  })

  it('takes at most 12, round-robin across lists, with no duplicate prompts', () => {
    const lists: ListWords[] = [
      { chapter: 1, items: items('a', 'KAT', 30) },
      { chapter: 2, items: items('b', 'KAT', 30) },
    ]
    const got = patternWords('-T', lists, 2)
    expect(got).toHaveLength(12)
    expect(got.filter((i) => i.prompt.startsWith('a'))).toHaveLength(6)
    expect(got.filter((i) => i.prompt.startsWith('b'))).toHaveLength(6)
    expect(new Set(got.map((i) => i.prompt)).size).toBe(12)
  })

  it('skips a prompt that two lists share', () => {
    const lists: ListWords[] = [
      { chapter: 1, items: [{ prompt: 'cat', outlines: ['KAT'] }] },
      { chapter: 2, items: [{ prompt: 'cat', outlines: ['KAT'] }] },
    ]
    expect(patternWords('-T', lists, 2)).toHaveLength(1)
  })

  it('is deterministic for a seeded random and varies with the seed', () => {
    const lists: ListWords[] = [{ chapter: 1, items: items('a', 'KAT', 40) }]
    const one = patternWords('-T', lists, 1, seeded(1)).map((i) => i.prompt)
    expect(patternWords('-T', lists, 1, seeded(1)).map((i) => i.prompt)).toEqual(one)
    expect(patternWords('-T', lists, 1, seeded(2)).map((i) => i.prompt)).not.toEqual(one)
  })

  it('does not change the lists it is given', () => {
    const list = items('a', 'KAT', 20)
    const copy = list.map((i) => ({ ...i }))
    patternWords('-T', [{ chapter: 1, items: list }], 1, seeded(3))
    expect(list).toEqual(copy)
  })

  it('skips an item with an unparseable outline instead of throwing', () => {
    const lists: ListWords[] = [
      {
        chapter: 1,
        items: [
          { prompt: 'bad', outlines: ['!!!'] },
          { prompt: 'cat', outlines: ['KAT'] },
        ],
      },
    ]
    expect(patternWords('-T', lists, 1).map((i) => i.prompt)).toEqual(['cat'])
  })

  it('still returns fewer than MIN_PATTERN_WORDS as they are', () => {
    const lists: ListWords[] = [{ chapter: 1, items: items('a', 'KAT', 2) }]
    expect(patternWords('-T', lists, 1)).toHaveLength(2)
  })

  it('returns an empty list when nothing matches', () => {
    expect(patternWords('-T', [], 1)).toEqual([])
  })
})
