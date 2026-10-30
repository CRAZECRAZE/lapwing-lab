import { describe, expect, it } from 'vitest'
import type { ChapterInfo } from '../../scripts/build-content.ts'
import { CHAPTER_TEST, buildChapterTest, drillPassMark, firstShowings } from '../../src/core/chaptertest.ts'
import type { DrillItem } from '../../src/core/drill.ts'
import { parseStroke } from '../../src/core/steno.ts'

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

describe('firstShowings', () => {
  const one = ['KAT']
  const two = ['KAT/PHREU']
  const row = (expected: string[], stroke: string, correct = true) => ({
    expected,
    pressedMask: parseStroke(stroke),
    correct,
  })
  /** The rows of one correct showing of a word. */
  const showing = (outlines: string[]) => outlines[0].split('/').map((s) => row(outlines, s))

  it('flags the strokes of showings 1, 4 and 7 (items 0, 3, 6) and no others', () => {
    const rows = [
      ...[0, 1, 2].flatMap(() => showing(one)),
      ...[0, 1, 2].flatMap(() => showing(['TKOG'])),
      ...[0, 1, 2].flatMap(() => showing(two)),
    ]
    const flags = firstShowings(rows)
    expect(flags).toHaveLength(rows.length)
    // one-stroke word x3, one-stroke word x3, two-stroke word x3 (item 6 starts with 2 strokes)
    expect(flags).toEqual([true, false, false, true, false, false, true, true, false, false, false, false])
  })

  it('keeps a miss and the retry inside the same showing', () => {
    const rows = [
      row(two, 'KAT'),
      row(two, 'TKOG', false), // a miss in the middle of the showing
      row(two, 'KAT'),
      row(two, 'PHREU'),
      ...showing(two),
      ...showing(two),
      ...showing(two),
    ]
    const flags = firstShowings(rows)
    expect(flags.slice(0, 4)).toEqual([true, true, true, true])
    expect(flags.slice(4, 8)).toEqual([false, false, false, false])
    expect(flags.slice(8)).toEqual([true, true])
  })

  it('treats a different expected outline as a new item even when the last one was not finished', () => {
    const flags = firstShowings([row(two, 'KAT'), row(one, 'KAT'), row(one, 'KAT')])
    expect(flags).toEqual([true, false, false])
  })

  it('uses the given number of repetitions', () => {
    const rows = [...showing(one), ...showing(one), ...showing(one), ...showing(one)]
    expect(firstShowings(rows, 2)).toEqual([true, false, true, false])
    expect(firstShowings(rows, 1)).toEqual([true, true, true, true])
  })

  it('flags a trailing incomplete item without throwing', () => {
    const rows = [...showing(one), ...showing(one), ...showing(one), row(two, 'KAT')]
    expect(() => firstShowings(rows)).not.toThrow()
    expect(firstShowings(rows)).toEqual([true, false, false, true])
  })

  it('does not throw on rows that cannot be replayed', () => {
    // both rows are unreplayable: each counts as an item of one stroke (items 0 and 1 of 3)
    expect(
      firstShowings([
        { expected: [], pressedMask: 1, correct: true },
        { expected: ['not a stroke!'], pressedMask: 0, correct: true },
      ]),
    ).toEqual([true, false])
  })

  it('keeps a miss on a one-stroke word and its correct retry in the same showing', () => {
    const flags = firstShowings([
      row(one, 'TKOG', false),
      row(one, 'KAT'),
      ...showing(one),
      ...showing(one),
      ...showing(one),
    ])
    expect(flags).toEqual([true, true, false, false, true])
  })

  describe('after an undo that was never logged', () => {
    // Live: KAT (partial), * (undo, not logged), KAT (partial), PHREU (correct). The log holds KAT, KAT, PHREU.
    const catnip = (...undoAt: number[]) => {
      const rows = []
      for (let k = 0; k < 3; k++) {
        rows.push(row(two, 'KAT'))
        if (undoAt.includes(k)) rows.push(row(two, 'KAT'))
        rows.push(row(two, 'PHREU'))
      }
      return rows
    }
    const clean = firstShowings(catnip())

    it('has the clean run flag showings 1 only', () => {
      expect(clean).toEqual([true, true, false, false, false, false])
    })

    it('flags a repeated partial stroke on the first showing like the run without the undo', () => {
      const rows = catnip(0)
      expect(firstShowings(rows)).toEqual([true, true, true, false, false, false, false])
    })

    it('stays in step through later words after an undo on the first showing', () => {
      const words = [two, ['TKOG'], ['KAT']]
      const rows = [
        row(two, 'KAT'),
        row(two, 'KAT'),
        row(two, 'PHREU'),
        ...showing(two),
        ...showing(two),
        ...[0, 1, 2].flatMap(() => showing(words[1])),
        ...[0, 1, 2].flatMap(() => showing(words[2])),
      ]
      const flags = firstShowings(rows)
      expect(flags).toEqual([
        true, true, true, false, false, false, false,
        true, false, false,
        true, false, false,
      ])
    })

    it('stays in step after an undo on a later showing', () => {
      const rows = [...showing(two), row(two, 'KAT'), row(two, 'KAT'), row(two, 'PHREU'), ...showing(two), ...showing(['TKOG'])]
      expect(firstShowings(rows)).toEqual([true, true, false, false, false, false, false, true])
    })

    it('gives the flags the live drill had for three words x three showings with one undo (6 of 13 were wrong)', () => {
      const words = [two, ['TKOG'], ['KAT']]
      const rows: ReturnType<typeof row>[] = []
      const truth: boolean[] = []
      words.forEach((w) =>
        [0, 1, 2].forEach((k) => {
          const strokes = w[0].split('/')
          strokes.forEach((s, i) => {
            rows.push(row(w, s))
            truth.push(k === 0)
            // the unlogged undo: the owner pressed the first stroke again after popping it
            if (w === two && k === 0 && i === 0) {
              rows.push(row(w, s))
              truth.push(true)
            }
          })
        }),
      )
      expect(rows).toHaveLength(13)
      expect(firstShowings(rows)).toEqual(truth)
    })

    it('finds the stroke an undo went back to in a three-stroke word', () => {
      const three = ['KAT/PHREU/TKOG']
      // A, B, * (pops B), B, C is logged as A, B, B, C
      const rows = [row(three, 'KAT'), row(three, 'PHREU'), row(three, 'PHREU'), row(three, 'TKOG'), ...showing(three)]
      expect(firstShowings(rows)).toEqual([true, true, true, true, false, false, false])
    })
  })

  it('gives [] for no strokes', () => {
    expect(firstShowings([])).toEqual([])
  })
})
