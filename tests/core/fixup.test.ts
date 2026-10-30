import { describe, expect, it } from 'vitest'
import {
  FIXED_STREAK,
  FIXUP_WINDOW_DAYS,
  LIST_SIZE,
  MIN_WORD_ATTEMPTS,
  itemKind,
  lastSeenText,
  rankWords,
  wordAttempts,
} from '../../src/core/fixup.ts'
import type { FixupRow, WordAttempt } from '../../src/core/fixup.ts'
import { parseStroke } from '../../src/core/steno.ts'

const row = (
  prompt: string,
  expected: string[],
  stroke: string,
  over: Partial<FixupRow> = {},
): FixupRow => ({ testId: 1, tsMs: 1000, prompt, expected, pressedMask: parseStroke(stroke), correct: true, ...over })

const attempt = (prompt: string, clean: boolean, tsMs: number, expected: string[] = ['KAT']): WordAttempt => ({
  prompt,
  expected,
  clean,
  tsMs,
})

describe('constants', () => {
  it('has the spec values', () => {
    expect(FIXUP_WINDOW_DAYS).toBe(30)
    expect(MIN_WORD_ATTEMPTS).toBe(5)
    expect(FIXED_STREAK).toBe(10)
    expect(LIST_SIZE).toBe(10)
  })
})

describe('wordAttempts', () => {
  it('replays each run on its own and never merges items across runs', () => {
    const out = wordAttempts([
      row('cat', ['KAT'], 'KAT', { testId: 1, tsMs: 10 }),
      row('cat', ['KAT'], 'KAT', { testId: 2, tsMs: 20 }),
      row('dog', ['TKOG'], 'TKOG', { testId: 2, tsMs: 30 }),
    ])
    expect(out.map((a) => [a.prompt, a.tsMs])).toEqual([
      ['cat', 10],
      ['cat', 20],
      ['dog', 30],
    ])
  })

  it('gives 10 clean attempts for a word typed cleanly 10 times back-to-back', () => {
    const rows = Array.from({ length: 10 }, (_, i) => row('cat', ['KAT'], 'KAT', { tsMs: i }))
    const out = wordAttempts(rows)
    expect(out).toHaveLength(10)
    expect(out.every((a) => a.clean)).toBe(true)
  })

  it('makes a miss then a correct retype one unclean attempt', () => {
    const out = wordAttempts([
      row('cat', ['KAT'], 'TKOG', { correct: false, tsMs: 5 }),
      row('cat', ['KAT'], 'KAT', { tsMs: 9 }),
    ])
    expect(out).toEqual([{ prompt: 'cat', expected: ['KAT'], clean: false, tsMs: 9 }])
  })

  it('makes a two-stroke word one attempt, stamped by its last row', () => {
    const out = wordAttempts([
      row('catnip', ['KAT/PHREU'], 'KAT', { tsMs: 1 }),
      row('catnip', ['KAT/PHREU'], 'PHREU', { tsMs: 2 }),
    ])
    expect(out).toEqual([{ prompt: 'catnip', expected: ['KAT/PHREU'], clean: true, tsMs: 2 }])
  })

  it('drops a last item with no completing row', () => {
    const out = wordAttempts([row('cat', ['KAT'], 'KAT'), row('catnip', ['KAT/PHREU'], 'KAT')])
    expect(out.map((a) => a.prompt)).toEqual(['cat'])
  })

  it('skips an unparseable expected row without throwing', () => {
    const rows = [row('bad', ['not a stroke!'], 'KAT'), row('cat', ['KAT'], 'KAT')]
    expect(() => wordAttempts(rows)).not.toThrow()
    expect(wordAttempts(rows).map((a) => a.prompt)).toEqual(['cat'])
  })

  it('returns nothing for no rows', () => {
    expect(wordAttempts([])).toEqual([])
  })
})

describe('rankWords', () => {
  const many = (prompt: string, flags: boolean[], startMs = 0, expected = ['KAT']) =>
    flags.map((clean, i) => attempt(prompt, clean, startMs + i, expected))

  it('excludes a word with fewer than 5 attempts', () => {
    expect(rankWords(many('cat', [false, false, false, false]))).toEqual([])
    expect(rankWords(many('cat', [false, false, false, false, false]))).toHaveLength(1)
  })

  it('excludes a word with 5 or more attempts and no miss', () => {
    expect(rankWords(many('cat', [true, true, true, true, true, true]))).toEqual([])
  })

  it('excludes a word whose latest 10 attempts are clean, lists it when a miss is inside the latest 10', () => {
    const fixed = many('cat', [false, ...Array(10).fill(true)])
    expect(rankWords(fixed)).toEqual([])
    const inside = many('cat', [true, false, ...Array(9).fill(true)])
    expect(rankWords(inside)).toHaveLength(1)
  })

  it('judges the latest attempts by time, not by input order', () => {
    const shuffled = many('cat', [false, ...Array(10).fill(true)]).reverse()
    expect(rankWords(shuffled)).toEqual([])
  })

  it('sorts by rate desc, then attempts desc, then prompt asc', () => {
    const out = rankWords([
      ...many('b', [false, true, true, true, true]), // 0.2
      ...many('a', [false, true, true, true, true]), // 0.2
      ...many('c', [false, true, true, true, true, true]), // 1/6, 6 attempts
      ...many('d', [false, false, true, true, true]), // 0.4
      ...many('e', [...Array(10).fill(true), false, false]), // 1/6, 12 attempts
      ...many('f', [false, true, true, true, true, true, true]), // 1/7
    ])
    expect(out.map((w) => w.prompt)).toEqual(['d', 'a', 'b', 'e', 'c', 'f'])
  })

  it('returns at most LIST_SIZE words', () => {
    const attempts = Array.from({ length: 15 }, (_, i) => many(`w${String(i).padStart(2, '0')}`, [false, true, true, true, true])).flat()
    expect(rankWords(attempts)).toHaveLength(LIST_SIZE)
  })

  it('reports rate, outlines of the latest attempt and its time', () => {
    const attempts = [
      attempt('cat', false, 1, ['OLD']),
      attempt('cat', true, 2, ['OLD']),
      attempt('cat', false, 3, ['OLD']),
      attempt('cat', true, 4, ['OLD']),
      attempt('cat', true, 9, ['KAT', 'KA']),
    ]
    expect(rankWords(attempts)).toEqual([
      { prompt: 'cat', outlines: ['KAT', 'KA'], kind: 'word', attempts: 5, misses: 2, rate: 2 / 5, lastTsMs: 9 },
    ])
  })

  it('classifies kind from the prompt and the latest outlines', () => {
    const out = rankWords(many('a', [false, true, true, true, true], 0, ['a']))
    expect(out[0].kind).toBe('stroke')
  })
})

describe('itemKind', () => {
  it('is a stroke when the prompt equals its only outline', () => {
    expect(itemKind('a', ['a'])).toBe('stroke')
  })

  it('is a word otherwise', () => {
    expect(itemKind('the', ['-T'])).toBe('word')
    expect(itemKind('a', ['a', 'b'])).toBe('word')
  })
})

describe('lastSeenText', () => {
  const at = (d: number, h = 12) => new Date(2026, 9, d, h).getTime()

  it('says today, yesterday and N days ago by local calendar date', () => {
    expect(lastSeenText(at(30, 0), at(30, 23))).toBe('today')
    expect(lastSeenText(at(29, 23), at(30, 0))).toBe('yesterday')
    expect(lastSeenText(at(27, 8), at(30, 8))).toBe('3 days ago')
  })

  it('says today for a future time', () => {
    expect(lastSeenText(at(31), at(30))).toBe('today')
  })
})
