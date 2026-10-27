import { describe, expect, it } from 'vitest'
import type { PracticeIndexEntry } from '../../scripts/build-content.ts'
import type { DrillItem } from '../../src/core/drill.ts'
import {
  FREE_MODES,
  PSEUDO_SOURCE,
  buildFreeItems,
  describeFree,
  itemCountFor,
  listIdsFor,
  parseMode,
  parseSource,
  poolFor,
  sourcesFor,
} from '../../src/freetype/free.ts'

const INDEX: PracticeIndexEntry[] = [
  { id: '5-cvc', chapter: 5, items: 3 },
  { id: '5-test', chapter: 5, items: 4 },
  { id: '8-x', chapter: 8, items: 2 },
  { id: '6-fqm', chapter: 6, items: 5 },
]

const item = (prompt: string, outline = prompt.toUpperCase()): DrillItem => ({ prompt, outlines: [outline] })

/** A small seeded generator (mulberry32) so runs are repeatable. */
function seeded(seed: number): () => number {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

describe('free-type modes', () => {
  it('lists the four modes in order', () => {
    expect(FREE_MODES).toEqual([
      { id: 'words-25', label: '25 words', words: 25 },
      { id: 'words-50', label: '50 words', words: 50 },
      { id: 'time-30', label: '30 seconds', seconds: 30 },
      { id: 'time-60', label: '60 seconds', seconds: 60 },
    ])
  })

  it('parses a mode id, and refuses an unknown one', () => {
    expect(parseMode('time-60')).toEqual({ id: 'time-60', label: '60 seconds', seconds: 60 })
    expect(parseMode('words-25')?.words).toBe(25)
    expect(parseMode('words-100')).toBeUndefined()
    expect(parseMode('')).toBeUndefined()
  })

  it('asks for the word count, or 400 items for a timed mode', () => {
    expect(itemCountFor(parseMode('words-25')!)).toBe(25)
    expect(itemCountFor(parseMode('words-50')!)).toBe(50)
    expect(itemCountFor(parseMode('time-30')!)).toBe(400)
    expect(itemCountFor(parseMode('time-60')!)).toBe(400)
  })
})

describe('free-type sources', () => {
  it('starts with the Chapter 4 pseudo-words', () => {
    expect(PSEUDO_SOURCE).toEqual({ id: 'pseudo', label: 'Chapter 4 pseudo-words', chapter: 4, kind: 'stroke' })
  })

  it('adds one cumulative source per chapter that has lists', () => {
    expect(sourcesFor(INDEX)).toEqual([
      PSEUDO_SOURCE,
      { id: 'ch-5', label: 'Chapter 5 word lists', chapter: 5, kind: 'word' },
      { id: 'ch-6', label: 'Chapters 5–6 word lists', chapter: 6, kind: 'word' },
      { id: 'ch-8', label: 'Chapters 5–8 word lists', chapter: 8, kind: 'word' },
    ])
    expect(sourcesFor([])).toEqual([PSEUDO_SOURCE])
  })

  it('ignores lists filed under a chapter before 5', () => {
    expect(sourcesFor([{ id: '4-x', chapter: 4, items: 1 }]).map((s) => s.id)).toEqual(['pseudo'])
  })

  it('parses a source id against the index', () => {
    expect(parseSource('pseudo', [])).toBe(PSEUDO_SOURCE)
    expect(parseSource('ch-8', INDEX)?.label).toBe('Chapters 5–8 word lists')
    expect(parseSource('ch-7', INDEX)).toBeUndefined() // no chapter 7 lists
    expect(parseSource('ch-4', INDEX)).toBeUndefined()
    expect(parseSource('nope', INDEX)).toBeUndefined()
  })

  it('takes every list up to the source chapter, and none for the pseudo-words', () => {
    expect(listIdsFor(parseSource('ch-5', INDEX)!, INDEX)).toEqual(['5-cvc', '5-test'])
    expect(listIdsFor(parseSource('ch-6', INDEX)!, INDEX)).toEqual(['5-cvc', '5-test', '6-fqm'])
    expect(listIdsFor(parseSource('ch-8', INDEX)!, INDEX)).toEqual(['5-cvc', '5-test', '8-x', '6-fqm'])
    expect(listIdsFor(PSEUDO_SOURCE, INDEX)).toEqual([])
  })
})

describe('poolFor', () => {
  it('turns the pseudo-words into stroke items, deduped', () => {
    const words = { test: ['SAP', 'TAP'], extra: [['SAP', 'KAT'], ['TAP']] }
    expect(poolFor(PSEUDO_SOURCE, { words })).toEqual([
      { prompt: 'SAP', outlines: ['SAP'] },
      { prompt: 'TAP', outlines: ['TAP'] },
      { prompt: 'KAT', outlines: ['KAT'] },
    ])
  })

  it('joins the lists for a chapter source, keeping the first of each prompt', () => {
    const lists = [
      { id: '5-cvc', items: [item('cat'), item('sat')] },
      { id: '6-fqm', items: [item('cat', 'KAEUT'), item('fun')] },
    ]
    expect(poolFor(parseSource('ch-6', INDEX)!, { lists })).toEqual([item('cat'), item('sat'), item('fun')])
  })

  it('is empty without data', () => {
    expect(poolFor(PSEUDO_SOURCE, {})).toEqual([])
    expect(poolFor(parseSource('ch-5', INDEX)!, {})).toEqual([])
  })
})

describe('buildFreeItems', () => {
  const pool = ['a', 'b', 'c', 'd', 'e'].map((p) => item(p))

  it('gives exactly the asked number of items', () => {
    expect(buildFreeItems(pool, 3)).toHaveLength(3)
    expect(buildFreeItems(pool, 5)).toHaveLength(5)
    expect(buildFreeItems(pool, 23)).toHaveLength(23)
    expect(buildFreeItems(pool, 0)).toEqual([])
  })

  it('never repeats a prompt within one pass over the pool', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const out = buildFreeItems(pool, 23, seeded(seed))
      for (let start = 0; start < out.length; start += pool.length) {
        const pass = out.slice(start, start + pool.length).map((i) => i.prompt)
        expect(new Set(pass).size).toBe(pass.length)
      }
    }
  })

  it('never puts two equal prompts side by side, even across passes', () => {
    for (const size of [2, 3, 5]) {
      for (let seed = 1; seed <= 200; seed++) {
        const out = buildFreeItems(pool.slice(0, size), 40, seeded(seed))
        for (let i = 1; i < out.length; i++) expect(out[i].prompt).not.toBe(out[i - 1].prompt)
      }
    }
  })

  it('is repeatable with the same random source', () => {
    expect(buildFreeItems(pool, 12, seeded(7))).toEqual(buildFreeItems(pool, 12, seeded(7)))
  })

  it('gives nothing from an empty pool, and repeats a one-item pool', () => {
    expect(buildFreeItems([], 25)).toEqual([])
    expect(buildFreeItems([item('a')], 3)).toEqual([item('a'), item('a'), item('a')])
  })
})

describe('describeFree', () => {
  it('names the source and the mode', () => {
    expect(describeFree('pseudo/words-25')).toBe('Free type · Chapter 4 pseudo-words · 25 words')
    expect(describeFree('ch-8/time-60')).toBe('Free type · Chapters 5–8 word lists · 60 seconds')
    expect(describeFree('ch-5/words-50')).toBe('Free type · Chapter 5 word lists · 50 words')
  })

  it('falls back to the raw section for unknown ids', () => {
    expect(describeFree('ch-4/words-25')).toBe('ch-4/words-25')
    expect(describeFree('pseudo/words-99')).toBe('pseudo/words-99')
    expect(describeFree('odd')).toBe('odd')
  })
})
