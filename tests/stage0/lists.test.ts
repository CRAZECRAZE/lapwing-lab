import { describe, expect, it } from 'vitest'
import { maskToSlots, parseOutline } from '../../src/core/steno.ts'
import { ROW_DRILLS, STAGE0_INFO, buildStage0Drills, itemsForRun, repeat } from '../../src/stage0/lists.ts'
import { readFileSync } from 'node:fs'

/** Deterministic random in [0, 1) (mulberry32). */
function seeded(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const words = (n: number, tag: string): string[] => Array.from({ length: n }, (_, i) => `${tag}${i}`)

describe('ROW_DRILLS', () => {
  it('has the six drills in order', () => {
    expect(ROW_DRILLS.map((d) => d.id)).toEqual([
      'rows-left-bottom',
      'rows-right-bottom',
      'rows-left-top',
      'rows-right-top',
      'rows-vowels',
      'rows-star',
    ])
  })

  it('uses single-stroke, single-slot outlines that equal their prompts', () => {
    for (const drill of ROW_DRILLS) {
      expect(drill.kind).toBe('stroke')
      for (const item of drill.items) {
        expect(item.outlines).toEqual([item.prompt])
        const strokes = parseOutline(item.outlines[0])
        expect(strokes).toHaveLength(1)
        expect(maskToSlots(strokes[0])).toHaveLength(1)
      }
    }
  })

  it('covers the five right-hand bottom slots', () => {
    const drill = ROW_DRILLS.find((d) => d.id === 'rows-right-bottom')!
    expect(new Set(drill.items.map((i) => i.prompt))).toEqual(new Set(['-R', '-B', '-G', '-S', '-Z']))
  })

  it('covers the keys named in each title, five times each', () => {
    const keys: Record<string, string[]> = {
      'rows-left-bottom': ['S', 'K', 'W', 'R'],
      'rows-left-top': ['#', 'T', 'P', 'H'],
      'rows-right-top': ['-F', '-P', '-L', '-T', '-D'],
      'rows-vowels': ['A', 'O', 'E', 'U'],
      'rows-star': ['*'],
    }
    for (const [id, expected] of Object.entries(keys)) {
      const drill = ROW_DRILLS.find((d) => d.id === id)!
      expect(drill.items).toHaveLength(expected.length * 5)
      for (const key of expected) expect(drill.items.filter((i) => i.prompt === key)).toHaveLength(5)
    }
  })
})

describe('repeat', () => {
  const base = ['a', 'b', 'c', 'd'].map((p) => ({ prompt: p, outlines: [p] }))

  it('keeps the multiset of every repetition and does not mutate the source', () => {
    const copy = structuredClone(base)
    const out = repeat(base, 5, seeded(1))
    expect(base).toEqual(copy)
    expect(out).toHaveLength(20)
    for (let n = 0; n < 5; n++) {
      expect(out.slice(n * 4, n * 4 + 4).map((i) => i.prompt).sort()).toEqual(['a', 'b', 'c', 'd'])
    }
  })

  it('shuffles each repetition independently and deterministically for a given random', () => {
    const out = repeat(base, 5, seeded(7))
    expect(out).toEqual(repeat(base, 5, seeded(7)))
    const orders = new Set(Array.from({ length: 5 }, (_, n) => out.slice(n * 4, n * 4 + 4).map((i) => i.prompt).join('')))
    expect(orders.size).toBeGreaterThan(1)
    expect(out.map((i) => i.prompt).join('')).not.toBe('abcd'.repeat(5))
  })
})

describe('buildStage0Drills', () => {
  const stage0 = { test: words(100, 't'), extra: [words(99, 'x'), words(82, 'y')] }

  it('adds the pseudo-word test and the two extra lists after the row drills', () => {
    const drills = buildStage0Drills(stage0)
    expect(drills.map((d) => d.id)).toEqual([
      ...ROW_DRILLS.map((d) => d.id),
      'pseudo-test',
      'pseudo-extra-1',
      'pseudo-extra-2',
    ])
    const test = drills.find((d) => d.id === 'pseudo-test')!
    expect(test.items).toHaveLength(100)
    expect(test.items.every((i) => i.outlines.length === 1 && i.outlines[0] === i.prompt)).toBe(true)
    expect(test.items.map((i) => i.prompt)).toEqual(stage0.test)
    expect(test.passMark).toEqual({ accuracy: 0.9, maxMinutes: 10 })
    expect(test.title).toBe('Chapter 4 test — 100 words')
    expect(drills.find((d) => d.id === 'pseudo-extra-1')!.passMark).toBeUndefined()
    expect(drills.find((d) => d.id === 'pseudo-extra-1')!.items).toHaveLength(99)
    expect(drills.find((d) => d.id === 'pseudo-extra-2')!.items).toHaveLength(82)
  })

  it('matches the info list the panel shows, and the real built word lists all parse', () => {
    const real = JSON.parse(readFileSync('content/build/stage0.json', 'utf8'))
    const drills = buildStage0Drills(real)
    expect(drills.map(({ id, title, passMark }) => ({ id, title, passMark }))).toEqual(
      STAGE0_INFO.map(({ id, title, passMark }) => ({ id, title, passMark })),
    )
    for (const drill of drills) for (const item of drill.items) expect(() => parseOutline(item.outlines[0])).not.toThrow()
  })
})

describe('itemsForRun', () => {
  it('shuffles pseudo-word lists without touching the book order', () => {
    const drill = buildStage0Drills({ test: words(100, 't'), extra: [words(99, 'x'), words(82, 'y')] })[6]
    const before = drill.items.map((i) => i.prompt)
    const run = itemsForRun(drill, seeded(3))
    expect(drill.items.map((i) => i.prompt)).toEqual(before)
    expect(run.map((i) => i.prompt)).not.toEqual(before)
    expect(run.map((i) => i.prompt).sort()).toEqual([...before].sort())
  })

  it('deals a row drill five whole repetitions again', () => {
    const drill = ROW_DRILLS[1]
    const run = itemsForRun(drill, seeded(4))
    expect(run).toHaveLength(25)
    for (let n = 0; n < 5; n++) {
      expect(run.slice(n * 5, n * 5 + 5).map((i) => i.prompt).sort()).toEqual(['-B', '-G', '-R', '-S', '-Z'])
    }
  })
})
