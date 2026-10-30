import { describe, expect, it } from 'vitest'
import { DrillSession } from '../../src/core/drill.ts'
import type { DrillItem, StrokeResult } from '../../src/core/drill.ts'
import { FIXED_STREAK } from '../../src/core/fixup.ts'
import { FIXUP_MAX_SHOWINGS, FixupSession } from '../../src/core/fixupdrill.ts'
import type { FixupTarget } from '../../src/core/fixupdrill.ts'
import { parseStroke } from '../../src/core/steno.ts'
import type { RawStroke } from '../../src/core/uni.ts'

const press = (text: string): RawStroke => ({ levers: [], mask: parseStroke(text) })
const word = (prompt: string, ...outlines: string[]): DrillItem => ({ prompt, outlines })
const target = (id: string, ...items: DrillItem[]): FixupTarget => ({ id, label: id, items })
const kinds = (results: StrokeResult[]): string[] => results.map((r) => r.kind)

/** Types the same stroke `n` times and returns every result. */
function typeTimes(s: FixupSession, stroke: string, n: number): StrokeResult[] {
  return Array.from({ length: n }, () => s.submit(press(stroke)))
}

describe('FixupSession focus rule', () => {
  it('moves to the next target after ten clean showings and records the fixed one', () => {
    const s = new FixupSession([target('a', word('cat', 'KAT')), target('b', word('sap', 'SAP'))])
    expect(s.total).toBe(2)
    expect(s.index).toBe(0)
    for (let i = 0; i < FIXED_STREAK; i++) {
      expect(s.progress().streak).toBe(i)
      expect(s.progress().target?.id).toBe('a')
      expect(s.submit(press('KAT'))).toMatchObject({ kind: 'correct', firstTry: true })
    }
    expect(s.fixedIds()).toEqual(['a'])
    expect(s.index).toBe(1)
    expect(s.progress()).toMatchObject({ target: { id: 'b' }, streak: 0, fixed: 1, showings: 10, position: 2, total: 2 })
    expect(s.current?.prompt).toBe('sap')
    expect(s.finished).toBe(false)
  })

  it('resets the streak on a miss and does not count the retype', () => {
    const s = new FixupSession([target('a', word('cat', 'KAT'))])
    typeTimes(s, 'KAT', 6)
    expect(s.progress().streak).toBe(6)
    const miss = s.submit(press('SAP'))
    expect(miss).toMatchObject({ kind: 'miss', expected: 'KAT' })
    expect(s.progress().streak).toBe(0)
    expect(s.current?.prompt).toBe('cat')
    expect(s.submit(press('KAT'))).toMatchObject({ kind: 'correct', firstTry: false })
    expect(s.progress().streak).toBe(0)
    expect(s.progress().showings).toBe(7)
    typeTimes(s, 'KAT', FIXED_STREAK - 1)
    expect(s.finished).toBe(false)
    expect(s.progress().streak).toBe(FIXED_STREAK - 1)
    s.submit(press('KAT'))
    expect(s.finished).toBe(true)
    expect(s.fixedIds()).toEqual(['a'])
  })

  it('counts one showing per word of a multi-stroke word', () => {
    const s = new FixupSession([target('a', word('catalog', 'KAT/A-L'))])
    expect(kinds([s.submit(press('KAT'))])).toEqual(['partial'])
    expect(s.progress().showings).toBe(0)
    expect(s.submit(press('A-L'))).toMatchObject({ kind: 'correct', firstTry: true })
    expect(s.progress()).toMatchObject({ showings: 1, streak: 1 })
  })

  it('cycles the items of a target per showing', () => {
    const s = new FixupSession([
      target('a', word('one', 'WUPB'), word('two', 'TWO'), word('tre', 'TRE')),
    ])
    const seen: string[] = []
    for (const stroke of ['WUPB', 'TWO', 'TRE', 'WUPB', 'TWO']) {
      seen.push(s.current?.prompt ?? '')
      s.submit(press(stroke))
    }
    expect(seen).toEqual(['one', 'two', 'tre', 'one', 'two'])
    expect(s.current?.prompt).toBe('tre')
  })

  it('keeps showing the same item after a miss until it is typed', () => {
    const s = new FixupSession([target('a', word('one', 'WUPB'), word('two', 'TWO'))])
    s.submit(press('WUPB'))
    s.submit(press('SAP'))
    expect(s.current?.prompt).toBe('two')
    s.submit(press('TWO'))
    expect(s.current?.prompt).toBe('one')
  })

  it('passes the star undo through without touching the streak', () => {
    const s = new FixupSession([target('a', word('catalog', 'KAT/A-L'))])
    s.submit(press('KAT'))
    s.submit(press('A-L'))
    s.submit(press('KAT'))
    expect(s.submit(press('*'))).toEqual({ kind: 'undo' })
    expect(s.progress()).toMatchObject({ streak: 1, showings: 1 })
    expect(s.submit(press('KAT'))).toMatchObject({ kind: 'partial' })
    expect(s.submit(press('A-L'))).toMatchObject({ kind: 'correct', firstTry: true })
    expect(s.progress().streak).toBe(2)
  })

  it('ignores a star with nothing to undo', () => {
    const s = new FixupSession([target('a', word('cat', 'KAT'))])
    expect(s.submit(press('*'))).toEqual({ kind: 'ignored' })
    expect(s.progress().streak).toBe(0)
  })

  it('finishes after the last target is fixed', () => {
    const s = new FixupSession([target('a', word('cat', 'KAT')), target('b', word('sap', 'SAP'))])
    typeTimes(s, 'KAT', FIXED_STREAK)
    typeTimes(s, 'SAP', FIXED_STREAK)
    expect(s.finished).toBe(true)
    expect(s.current).toBeUndefined()
    expect(s.index).toBe(2)
    expect(s.fixedIds()).toEqual(['a', 'b'])
    expect(s.progress()).toMatchObject({ target: undefined, fixed: 2, capped: false, position: 2 })
    expect(s.submit(press('KAT'))).toEqual({ kind: 'ignored' })
    expect(s.stats().completed).toBe(20)
  })

  it('ends the run at the showing cap with items unfixed', () => {
    const s = new FixupSession([target('a', word('cat', 'KAT'))])
    for (let i = 0; i < FIXUP_MAX_SHOWINGS; i++) {
      expect(s.finished).toBe(false)
      expect(s.progress().capped).toBe(false)
      s.submit(press('SAP')) // miss, then retype: never a clean showing
      s.submit(press('KAT'))
    }
    expect(FIXUP_MAX_SHOWINGS).toBe(500)
    expect(s.finished).toBe(true)
    expect(s.progress()).toMatchObject({ capped: true, showings: 500, fixed: 0 })
    expect(s.current).toBeUndefined()
    expect(s.fixedIds()).toEqual([])
    expect(s.submit(press('KAT'))).toEqual({ kind: 'ignored' })
    expect(s.stats()).toMatchObject({ completed: 500, firstTryCorrect: 0, accuracy: 0 })
  })

  it('is finished at once with no targets', () => {
    const s = new FixupSession([])
    expect(s.total).toBe(0)
    expect(s.finished).toBe(true)
    expect(s.current).toBeUndefined()
    expect(s.submit(press('KAT'))).toEqual({ kind: 'ignored' })
    expect(s.progress()).toMatchObject({ target: undefined, position: 0, total: 0, capped: false })
    expect(s.stats()).toEqual({ completed: 0, firstTryCorrect: 0, accuracy: 0, elapsedMs: 0, wpm: 0 })
  })
})

describe('FixupSession validation', () => {
  const messageOf = (run: () => unknown): string => {
    try {
      run()
    } catch (e) {
      return e instanceof Error ? e.message : String(e)
    }
    return ''
  }

  it('throws at construction for an item with no outlines, like DrillSession', () => {
    const bad = word('nothing')
    const expected = messageOf(() => new DrillSession([bad]))
    expect(expected).toContain('has no outlines')
    expect(messageOf(() => new FixupSession([target('a', word('cat', 'KAT')), target('b', bad)]))).toBe(expected)
  })

  it('throws at construction for an invalid outline, like DrillSession', () => {
    const bad = word('oops', 'QQQ')
    const expected = messageOf(() => new DrillSession([bad]))
    expect(expected).toContain('has an invalid outline')
    expect(messageOf(() => new FixupSession([target('a', word('cat', 'KAT'), bad)]))).toBe(expected)
  })

  it('throws for a target with no items', () => {
    expect(() => new FixupSession([target('a')])).toThrow(/no items/)
  })
})

describe('FixupSession stats', () => {
  it('counts showings, clean showings and the clean share, with wpm always 0', () => {
    let now = 0
    const s = new FixupSession([target('a', word('cat', 'KAT'))], () => now)
    expect(s.stats()).toEqual({ completed: 0, firstTryCorrect: 0, accuracy: 0, elapsedMs: 0, wpm: 0 })
    now = 1000
    s.submit(press('KAT'))
    now = 3000
    s.submit(press('SAP'))
    now = 4000
    s.submit(press('KAT'))
    now = 9000
    s.submit(press('KAT'))
    const stats = s.stats()
    expect(stats).toMatchObject({ completed: 3, firstTryCorrect: 2, elapsedMs: 8000, wpm: 0 })
    expect(stats.accuracy).toBeCloseTo(2 / 3)
  })

  it('never reports a wpm other than 0 or NaN', () => {
    const s = new FixupSession([target('a', word('cat', 'KAT'))], () => 5)
    expect(Number.isNaN(s.stats().wpm)).toBe(false)
    s.submit(press('KAT'))
    const stats = s.stats()
    expect(stats.wpm).toBe(0)
    for (const v of Object.values(stats)) expect(Number.isNaN(v)).toBe(false)
  })

  it('uses the injected clock and not the wall clock for elapsed time', () => {
    let now = 100
    const s = new FixupSession([target('a', word('cat', 'KAT'))], () => now)
    s.submit(press('KAT'))
    now = 700
    s.submit(press('KAT'))
    expect(s.stats().elapsedMs).toBe(600)
  })
})

describe('FixupSession replay', () => {
  it('gives identical results when the same strokes replay with the same clock', () => {
    const strokes = ['KAT', 'SAP', 'KAT', 'KAT', '*', 'KAT', 'A-L', 'KAT', 'KAT', 'KAT']
    const run = () => {
      let now = 0
      const s = new FixupSession(
        [target('a', word('cat', 'KAT'), word('catalog', 'KAT/A-L')), target('b', word('sap', 'SAP'))],
        () => (now += 250),
      )
      const results = strokes.map((x) => s.submit(press(x)))
      return { results, progress: s.progress(), stats: s.stats(), fixed: s.fixedIds() }
    }
    expect(run()).toEqual(run())
  })
})
