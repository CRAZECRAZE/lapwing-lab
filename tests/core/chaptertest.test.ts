import { describe, expect, it } from 'vitest'
import type { ChapterInfo } from '../../scripts/build-content.ts'
import { CHAPTER_TEST, buildChapterTest, drillPassMark } from '../../src/core/chaptertest.ts'
import type { DrillItem } from '../../src/core/drill.ts'

const words = (n: number): DrillItem[] =>
  Array.from({ length: n }, (_, i) => ({ prompt: `word${i}`, outlines: [`W${i}`] }))

/** A small deterministic generator in [0, 1) (mulberry32). */
function seeded(seed: number): () => number {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const prompts = (items: readonly DrillItem[]): string[] => items.map((i) => i.prompt)

describe('buildChapterTest', () => {
  it('is 45 words three times each, per the book', () => {
    expect(CHAPTER_TEST).toEqual({ words: 45, repetitions: 3 })
  })

  it('builds 135 prompts from a 396-item list: 45 distinct, each three in a row', () => {
    const out = buildChapterTest(words(396), seeded(1))
    expect(out).toHaveLength(135)
    expect(new Set(prompts(out)).size).toBe(45)
    for (let i = 0; i < out.length; i += 3) {
      expect(out[i].prompt).toBe(out[i + 1].prompt)
      expect(out[i].prompt).toBe(out[i + 2].prompt)
      if (i > 0) expect(out[i].prompt).not.toBe(out[i - 1].prompt)
    }
  })

  it('is deterministic for a seeded random and differs between seeds', () => {
    const a = prompts(buildChapterTest(words(396), seeded(7)))
    expect(prompts(buildChapterTest(words(396), seeded(7)))).toEqual(a)
    expect(prompts(buildChapterTest(words(396), seeded(8)))).not.toEqual(a)
  })

  it('keeps all of a short list: 30 items give 90 prompts', () => {
    const out = buildChapterTest(words(30), seeded(2))
    expect(out).toHaveLength(90)
    expect(new Set(prompts(out)).size).toBe(30)
  })

  it('returns [] for an empty list', () => {
    expect(buildChapterTest([])).toEqual([])
  })

  it('counts a duplicated prompt once, first one winning', () => {
    const items = [
      { prompt: 'a', outlines: ['A'] },
      { prompt: 'a', outlines: ['A2'] },
      { prompt: 'b', outlines: ['B'] },
    ]
    const out = buildChapterTest(items, seeded(3))
    expect(out).toHaveLength(6)
    expect(new Set(prompts(out))).toEqual(new Set(['a', 'b']))
    expect(out.filter((i) => i.prompt === 'a').every((i) => i.outlines[0] === 'A')).toBe(true)
  })

  it('does not mutate its input', () => {
    const items = words(60)
    const copy = items.map((i) => ({ ...i }))
    buildChapterTest(items, seeded(4))
    expect(items).toEqual(copy)
  })

  it('uses Math.random when no random is given', () => {
    expect(buildChapterTest(words(100))).toHaveLength(135)
  })
})

const info = (over: Partial<ChapterInfo>): ChapterInfo => ({
  chapter: 5,
  pageId: 'chapter-5',
  title: 'Chapter 5',
  gate: 'test',
  listIds: [],
  ...over,
})

describe('drillPassMark', () => {
  it('stage0: accuracy and the time limit', () => {
    expect(drillPassMark(info({ gate: 'stage0', passMark: { accuracy: 0.9, maxMinutes: 5 } }))).toEqual({
      accuracy: 0.9,
      maxMinutes: 5,
    })
  })

  it('stage0: omits maxMinutes when the book has none, and is undefined without a pass mark', () => {
    const mark = drillPassMark(info({ gate: 'stage0', passMark: { accuracy: 0.9 } }))
    expect(mark).toEqual({ accuracy: 0.9 })
    expect(Object.keys(mark!)).toEqual(['accuracy'])
    expect(drillPassMark(info({ gate: 'stage0' }))).toBeUndefined()
  })

  it('test: accuracy and minWpm, dropping maxWpm', () => {
    const mark = drillPassMark(info({ gate: 'test', passMark: { accuracy: 0.95, minWpm: 20, maxWpm: 30 } }))
    expect(mark).toEqual({ accuracy: 0.95, minWpm: 20 })
    expect(mark).not.toHaveProperty('maxWpm')
  })

  it('test: just the accuracy without a minWpm, undefined without a pass mark', () => {
    const mark = drillPassMark(info({ gate: 'test', passMark: { accuracy: 0.95 } }))
    expect(mark).toEqual({ accuracy: 0.95 })
    expect(Object.keys(mark!)).toEqual(['accuracy'])
    expect(drillPassMark(info({ gate: 'test' }))).toBeUndefined()
  })

  it('drills: 90% accuracy whatever the page says', () => {
    expect(drillPassMark(info({ gate: 'drills' }))).toEqual({ accuracy: 0.9 })
    expect(drillPassMark(info({ gate: 'drills', passMark: { accuracy: 0.5, minWpm: 3 } }))).toEqual({ accuracy: 0.9 })
  })

  it('read: no pass mark', () => {
    expect(drillPassMark(info({ gate: 'read', passMark: { accuracy: 0.9 } }))).toBeUndefined()
  })
})
