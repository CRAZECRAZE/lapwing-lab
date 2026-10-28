import { describe, expect, it } from 'vitest'
import { keyStats, MIN_KEY_PRESSES, MIN_MIXUP_COUNT } from '../../src/core/keystats.ts'
import type { KeyRowInput } from '../../src/core/keystats.ts'
import { parseStroke, SLOTS } from '../../src/core/steno.ts'

function row(over: Partial<KeyRowInput> & { pressed?: string }): KeyRowInput {
  const { pressed, ...rest } = over
  return { expected: ['SAB'], pressedMask: parseStroke(pressed ?? 'SAB'), correct: true, n: 1, ...rest }
}

const key = (keys: ReturnType<typeof keyStats>['keys'], slot: string) => keys.find((k) => k.slot === slot)

describe('keyStats', () => {
  it('exports the ranking thresholds for the page', () => {
    expect(MIN_KEY_PRESSES).toBe(30)
    expect(MIN_MIXUP_COUNT).toBe(3)
  })

  it('gives empty output for empty input', () => {
    expect(keyStats([])).toEqual({ keys: [], mixups: [] })
  })

  it('counts a correct stroke as required for each of its slots and never missed', () => {
    const { keys, mixups } = keyStats([row({})])
    expect(keys).toEqual([
      { slot: 'S-', required: 1, missed: 0 },
      { slot: 'A-', required: 1, missed: 0 },
      { slot: '-B', required: 1, missed: 0 },
    ])
    expect(mixups).toEqual([])
  })

  it('takes the pressed mask as the needed stroke of a correct row, whatever expected says', () => {
    const { keys } = keyStats([row({ expected: ['TKPW'], pressed: 'SAB' })])
    expect(keys.map((k) => k.slot)).toEqual(['S-', 'A-', '-B'])
  })

  it('counts a one-for-one slip as a miss on the needed key and a mix-up', () => {
    const { keys, mixups } = keyStats([row({ correct: false, pressed: 'SAP' })])
    expect(key(keys, '-B')).toEqual({ slot: '-B', required: 1, missed: 1 })
    expect(key(keys, 'S-')).toEqual({ slot: 'S-', required: 1, missed: 0 })
    expect(key(keys, 'A-')).toEqual({ slot: 'A-', required: 1, missed: 0 })
    expect(key(keys, '-P')).toBeUndefined()
    expect(mixups).toEqual([{ pressed: '-P', needed: '-B', count: 1 }])
  })

  it('counts a miss with two extra keys as missed but not as a mix-up', () => {
    const { keys, mixups } = keyStats([row({ correct: false, pressed: 'STAPG' })])
    expect(key(keys, '-B')).toEqual({ slot: '-B', required: 1, missed: 1 })
    expect(mixups).toEqual([])
  })

  it('counts a miss with a missing key and no extra key as missed but not as a mix-up', () => {
    const { keys, mixups } = keyStats([row({ correct: false, pressed: 'SA' })])
    expect(key(keys, '-B')).toEqual({ slot: '-B', required: 1, missed: 1 })
    expect(mixups).toEqual([])
  })

  it('does not count a mix-up when one key is extra but two are missing', () => {
    const { mixups } = keyStats([row({ correct: false, pressed: 'TA' })])
    expect(mixups).toEqual([])
  })

  it('does not count a miss with only an extra key as a mix-up or as missed', () => {
    const { keys, mixups } = keyStats([row({ correct: false, pressed: 'STAB' })])
    expect(keys.every((k) => k.missed === 0)).toBe(true)
    expect(mixups).toEqual([])
  })

  it('weights every count by n', () => {
    const { keys, mixups } = keyStats([row({ correct: false, pressed: 'SAP', n: 3 }), row({ n: 2 })])
    expect(key(keys, '-B')).toEqual({ slot: '-B', required: 5, missed: 3 })
    expect(key(keys, 'S-')).toEqual({ slot: 'S-', required: 5, missed: 0 })
    expect(mixups).toEqual([{ pressed: '-P', needed: '-B', count: 3 }])
  })

  it('sums the same mix-up over rows', () => {
    const { mixups } = keyStats([row({ correct: false, pressed: 'SAP', n: 2 }), row({ correct: false, pressed: 'SAP', n: 4 })])
    expect(mixups).toEqual([{ pressed: '-P', needed: '-B', count: 6 }])
  })

  it('picks the nearest accepted stroke of a multi-outline expected', () => {
    const { keys, mixups } = keyStats([row({ correct: false, expected: ['TKAP', 'SAB'], pressed: 'SAP' })])
    expect(key(keys, '-B')).toEqual({ slot: '-B', required: 1, missed: 1 })
    expect(key(keys, 'K-')).toBeUndefined()
    expect(mixups).toEqual([{ pressed: '-P', needed: '-B', count: 1 }])
  })

  it('uses the closest stroke of any outline of a multi-stroke word', () => {
    const { keys } = keyStats([row({ correct: false, expected: ['TKPW/SAB'], pressed: 'SA' })])
    expect(keys.map((k) => k.slot)).toEqual(['S-', 'A-', '-B'])
    expect(key(keys, '-B')?.missed).toBe(1)
  })

  it('skips an incorrect row whose outlines do not parse, without throwing', () => {
    expect(keyStats([row({ correct: false, expected: ['???'], pressed: 'SAP' })])).toEqual({ keys: [], mixups: [] })
    expect(keyStats([row({ correct: false, expected: [], pressed: 'SAP' })])).toEqual({ keys: [], mixups: [] })
    const { keys } = keyStats([row({ correct: false, expected: ['???', 'SAB'], pressed: 'SAP' })])
    expect(key(keys, '-B')?.missed).toBe(1)
  })

  it('skips rows with n of zero, negative, fractional or not finite', () => {
    const bad = [0, -2, 1.5, NaN, Infinity, -Infinity]
    for (const n of bad) {
      expect(keyStats([row({ n }), row({ correct: false, pressed: 'SAP', n })])).toEqual({ keys: [], mixups: [] })
    }
  })

  it('skips rows with a non-finite or non-integer pressed mask', () => {
    for (const pressedMask of [NaN, Infinity, 1.5]) {
      expect(keyStats([row({ pressedMask }), row({ correct: false, pressedMask })])).toEqual({ keys: [], mixups: [] })
    }
  })

  it('lists keys in board slot order regardless of row order', () => {
    const { keys } = keyStats([row({ expected: ['-Z'], pressed: '-Z' }), row({ expected: ['S'], pressed: 'S' }), row({ expected: ['*'], pressed: '*' })])
    expect(keys.map((k) => k.slot)).toEqual(['S-', '*', '-Z'])
    expect(keys.map((k) => SLOTS.indexOf(k.slot))).toEqual([...keys.map((k) => SLOTS.indexOf(k.slot))].sort((a, b) => a - b))
  })

  it('sorts mix-ups by count descending, then pressed, then needed', () => {
    const slip = (pressed: string, needed: string, n: number) =>
      row({ expected: [needed], pressed, correct: false, n })
    const { mixups } = keyStats([
      slip('T', 'S', 2),
      slip('-P', '-B', 5),
      slip('K', 'S', 2),
      slip('T', 'K', 2),
      slip('-P', '-L', 5),
    ])
    expect(mixups).toEqual([
      { pressed: '-P', needed: '-B', count: 5 },
      { pressed: '-P', needed: '-L', count: 5 },
      { pressed: 'K-', needed: 'S-', count: 2 },
      { pressed: 'T-', needed: 'K-', count: 2 },
      { pressed: 'T-', needed: 'S-', count: 2 },
    ])
  })

  it('does not depend on the order of the input rows', () => {
    const rows = [row({ correct: false, pressed: 'SAP', n: 2 }), row({ n: 3 }), row({ correct: false, pressed: 'SA' })]
    expect(keyStats([...rows].reverse())).toEqual(keyStats(rows))
  })
})
