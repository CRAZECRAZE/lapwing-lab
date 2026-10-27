import { describe, expect, it } from 'vitest'
import { DrillSession, diffMasks } from '../../src/core/drill.ts'
import type { DrillItem } from '../../src/core/drill.ts'
import { parseStroke } from '../../src/core/steno.ts'
import type { RawStroke } from '../../src/core/uni.ts'

const press = (text: string): RawStroke => ({ levers: [], mask: parseStroke(text) })
const item = (prompt: string, ...outlines: string[]): DrillItem => ({ prompt, outlines })
const single = (outline: string): DrillItem => item(outline, outline)

describe('diffMasks', () => {
  it('reports missing and extra slots in SLOTS order', () => {
    expect(diffMasks(parseStroke('SAP'), parseStroke('TAP'))).toEqual({ missing: ['S-'], extra: ['T-'] })
  })

  it('is empty for equal masks', () => {
    expect(diffMasks(parseStroke('KAT'), parseStroke('KAT'))).toEqual({ missing: [], extra: [] })
  })

  it('orders several slots by SLOTS order', () => {
    expect(diffMasks(parseStroke('STKPW'), parseStroke('-TSDZ'))).toEqual({
      missing: ['S-', 'T-', 'K-', 'P-', 'W-'],
      extra: ['-T', '-S', '-D', '-Z'],
    })
  })
})

describe('DrillSession basics', () => {
  it('accepts the right stroke as a first-try correct and finishes', () => {
    const it1 = single('SAP')
    const s = new DrillSession([it1])
    expect(s.total).toBe(1)
    expect(s.index).toBe(0)
    expect(s.current).toBe(it1)
    expect(s.finished).toBe(false)
    expect(s.submit(press('SAP'))).toEqual({ kind: 'correct', item: it1, firstTry: true })
    expect(s.finished).toBe(true)
    expect(s.current).toBeUndefined()
    expect(s.index).toBe(1)
  })

  it('misses with a diff, keeps the item current, then correct is not first try', () => {
    const it1 = single('SAP')
    const s = new DrillSession([it1])
    expect(s.submit(press('TAP'))).toEqual({
      kind: 'miss',
      item: it1,
      diff: { missing: ['S-'], extra: ['T-'] },
      expected: 'SAP',
    })
    expect(s.current).toBe(it1)
    expect(s.index).toBe(0)
    expect(s.submit(press('SAP'))).toEqual({ kind: 'correct', item: it1, firstTry: false })
    expect(s.stats().firstTryCorrect).toBe(0)
    expect(s.stats().completed).toBe(1)
  })

  it('advances to the next item after a correct', () => {
    const a = single('SAP')
    const b = single('KAT')
    const s = new DrillSession([a, b])
    s.submit(press('SAP'))
    expect(s.index).toBe(1)
    expect(s.current).toBe(b)
    expect(s.finished).toBe(false)
  })

  it('handles empty items: finished at once, stats all zero, submit ignored', () => {
    const s = new DrillSession([])
    expect(s.total).toBe(0)
    expect(s.finished).toBe(true)
    expect(s.current).toBeUndefined()
    expect(s.submit(press('SAP'))).toEqual({ kind: 'ignored' })
    expect(s.stats()).toEqual({ completed: 0, firstTryCorrect: 0, accuracy: 0, elapsedMs: 0, wpm: 0 })
  })

  it('ignores submits after the last item without changing stats', () => {
    let now = 0
    const s = new DrillSession([single('SAP')], () => now)
    now = 1000
    s.submit(press('SAP'))
    const before = s.stats()
    now = 9000
    expect(s.submit(press('SAP'))).toEqual({ kind: 'ignored' })
    expect(s.submit(press('*'))).toEqual({ kind: 'ignored' })
    expect(s.stats()).toEqual(before)
  })

  it('throws a clear error naming the prompt for an invalid outline', () => {
    expect(() => new DrillSession([item('cat', 'KAT', 'QQ')])).toThrow(/cat/)
  })

  it('throws a clear error naming the prompt when an item has no outlines', () => {
    expect(() => new DrillSession([item('dog')])).toThrow(/dog/)
  })
})

describe('multi-stroke items', () => {
  const copy = item('copyright', 'KOPL/PHREU/KAEUT')

  it('reports partial progress without advancing, then correct', () => {
    const s = new DrillSession([copy])
    expect(s.submit(press('KOPL'))).toEqual({ kind: 'partial', item: copy })
    expect(s.index).toBe(0)
    expect(s.submit(press('PHREU'))).toEqual({ kind: 'partial', item: copy })
    expect(s.index).toBe(0)
    expect(s.submit(press('KAEUT'))).toEqual({ kind: 'correct', item: copy, firstTry: true })
    expect(s.index).toBe(1)
  })

  it('misses on a wrong second stroke and resets to the first stroke', () => {
    const s = new DrillSession([copy])
    s.submit(press('KOPL'))
    expect(s.submit(press('KAEUT'))).toEqual({
      kind: 'miss',
      item: copy,
      diff: diffMasks(parseStroke('PHREU'), parseStroke('KAEUT')),
      expected: 'PHREU',
    })
    // entry cleared: the second stroke is now a miss against stroke 1
    const again = s.submit(press('PHREU'))
    expect(again).toMatchObject({ kind: 'miss', expected: 'KOPL' })
    // restart from the beginning
    expect(s.submit(press('KOPL'))).toEqual({ kind: 'partial', item: copy })
    expect(s.submit(press('PHREU'))).toEqual({ kind: 'partial', item: copy })
    expect(s.submit(press('KAEUT'))).toEqual({ kind: 'correct', item: copy, firstTry: false })
  })
})

describe('alternate outlines', () => {
  it('accepts either of TAOU or TO', () => {
    const it1 = item('to', 'TAOU', 'TO')
    const a = new DrillSession([it1])
    expect(a.submit(press('TAOU'))).toMatchObject({ kind: 'correct', firstTry: true })
    const b = new DrillSession([it1])
    expect(b.submit(press('TO'))).toMatchObject({ kind: 'correct', firstTry: true })
  })

  it('resolves a first stroke that prefixes only one multi-stroke alternate', () => {
    const it1 = item('x', 'TAOU', 'TO/KAT')
    const s = new DrillSession([it1])
    expect(s.submit(press('TO'))).toEqual({ kind: 'partial', item: it1 })
    expect(s.submit(press('TAOU'))).toMatchObject({ kind: 'miss', expected: 'KAT' })
    expect(s.submit(press('TO'))).toEqual({ kind: 'partial', item: it1 })
    expect(s.submit(press('KAT'))).toMatchObject({ kind: 'correct', firstTry: false })
  })

  it('diffs a miss against the alternate needing the fewest changes, ties to the first listed', () => {
    const it1 = item('x', 'SAP', 'TAP', 'KAT')
    const s = new DrillSession([it1])
    // 'PAP' is one swap from both SAP and TAP, two from KAT: first listed wins
    expect(s.submit(press('PAP'))).toMatchObject({ kind: 'miss', expected: 'SAP' })
    // 'TAT' is one swap from both TAP and KAT (SAP is two swaps away): first listed wins
    expect(s.submit(press('TAT'))).toMatchObject({ kind: 'miss', expected: 'TAP' })
  })

  it('handles duplicate accepted outlines', () => {
    const s = new DrillSession([item('cat', 'KAT', 'KAT')])
    expect(s.submit(press('KAT'))).toMatchObject({ kind: 'correct', firstTry: true })
    expect(s.finished).toBe(true)
  })
})

describe('lone star', () => {
  it('undoes the last entered stroke so it must be re-entered', () => {
    const it1 = item('copyright', 'KOPL/PHREU')
    const s = new DrillSession([it1])
    s.submit(press('KOPL'))
    expect(s.submit(press('*'))).toEqual({ kind: 'undo' })
    expect(s.submit(press('PHREU'))).toMatchObject({ kind: 'miss', expected: 'KOPL' })
    expect(s.submit(press('KOPL'))).toEqual({ kind: 'partial', item: it1 })
  })

  it('undo does not spoil first try', () => {
    const it1 = item('copyright', 'KOPL/PHREU')
    const s = new DrillSession([it1])
    s.submit(press('KOPL'))
    s.submit(press('*'))
    s.submit(press('KOPL'))
    expect(s.submit(press('PHREU'))).toEqual({ kind: 'correct', item: it1, firstTry: true })
  })

  it('is ignored with nothing entered and leaves stats untouched', () => {
    const s = new DrillSession([single('SAP')])
    expect(s.submit(press('*'))).toEqual({ kind: 'ignored' })
    expect(s.stats()).toEqual({ completed: 0, firstTryCorrect: 0, accuracy: 0, elapsedMs: 0, wpm: 0 })
    expect(s.submit(press('SAP'))).toMatchObject({ kind: 'correct', firstTry: true })
  })

  it('is ignored after a miss, and is not itself a miss', () => {
    const it1 = single('SAP')
    const s = new DrillSession([it1])
    s.submit(press('TAP'))
    expect(s.submit(press('*'))).toEqual({ kind: 'ignored' })
    expect(s.submit(press('SAP'))).toEqual({ kind: 'correct', item: it1, firstTry: false })
  })

  it('never makes a first-try item not-first-try when ignored', () => {
    const s = new DrillSession([single('SAP')])
    s.submit(press('*'))
    s.submit(press('*'))
    expect(s.submit(press('SAP'))).toMatchObject({ kind: 'correct', firstTry: true })
  })

  it('is judged normally when the item expects exactly *', () => {
    const star = item('star', '*')
    const s = new DrillSession([star])
    expect(s.submit(press('*'))).toEqual({ kind: 'correct', item: star, firstTry: true })
  })

  it('is judged normally when the expected next stroke of an alternate is *', () => {
    const starNext = item('y', 'TAOU/*', 'TO')
    const t = new DrillSession([starNext])
    expect(t.submit(press('TAOU'))).toEqual({ kind: 'partial', item: starNext })
    expect(t.submit(press('*'))).toEqual({ kind: 'correct', item: starNext, firstTry: true })
  })

  it('misses a star-containing stroke that is not a lone star', () => {
    const s = new DrillSession([single('SAP')])
    expect(s.submit(press('SA*P'))).toMatchObject({ kind: 'miss', expected: 'SAP' })
  })

  it('a * is judged normally while any alive alternate expects * next', () => {
    // alternate 'TO/*' is alive after TO, so * is judged as that alternate's next stroke
    const it1 = item('x', 'TO/*', 'TO/KAT')
    const s = new DrillSession([it1])
    s.submit(press('TO'))
    expect(s.submit(press('*'))).toMatchObject({ kind: 'correct', firstTry: true })
  })
})

describe('stats', () => {
  it('keeps accuracy as a fraction (3 of 4 first try -> 0.75)', () => {
    const items = ['SAP', 'KAT', 'TAP', 'PAT'].map(single)
    const s = new DrillSession(items)
    s.submit(press('SAP'))
    s.submit(press('KAT'))
    s.submit(press('TAP'))
    s.submit(press('KAT')) // miss on PAT
    s.submit(press('PAT'))
    expect(s.stats().completed).toBe(4)
    expect(s.stats().firstTryCorrect).toBe(3)
    expect(s.stats().accuracy).toBe(0.75)
  })

  it('has accuracy 0 and no NaN before anything completes', () => {
    const s = new DrillSession([single('SAP')])
    s.submit(press('TAP'))
    expect(s.stats()).toEqual({ completed: 0, firstTryCorrect: 0, accuracy: 0, elapsedMs: 0, wpm: 0 })
  })

  it('computes wpm with an injected clock (10 items in 60000 ms -> 10)', () => {
    let now = 0
    const items = Array.from({ length: 10 }, () => single('SAP'))
    const s = new DrillSession(items, () => now)
    s.submit(press('SAP')) // first submit at t=0
    for (let i = 1; i < 10; i++) {
      now = (i * 60000) / 9
      s.submit(press('SAP'))
    }
    expect(s.stats().elapsedMs).toBe(60000)
    expect(s.stats().wpm).toBe(10)
  })

  it('elapsed runs from the first submit to the latest completion, not mid-item', () => {
    let now = 100
    const s = new DrillSession([single('SAP'), single('KAT')], () => now)
    expect(s.stats().elapsedMs).toBe(0)
    now = 1000
    s.submit(press('SAP')) // first submit at 1000, completes at 1000
    expect(s.stats().elapsedMs).toBe(0)
    now = 4000
    s.submit(press('TAP')) // miss mid-item
    expect(s.stats().elapsedMs).toBe(0)
    now = 7000
    s.submit(press('KAT'))
    expect(s.stats().elapsedMs).toBe(6000)
    expect(s.stats().wpm).toBeCloseTo(2 / (6000 / 60000))
  })

  it('defaults the clock to Date.now', () => {
    const s = new DrillSession([single('SAP')])
    s.submit(press('SAP'))
    expect(s.stats().elapsedMs).toBeGreaterThanOrEqual(0)
    expect(Number.isFinite(s.stats().wpm)).toBe(true)
  })
})
