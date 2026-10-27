import { describe, expect, it } from 'vitest'
import {
  SLOTS,
  StenoParseError,
  formatStroke,
  maskToSlots,
  parseOutline,
  parseStroke,
  slotMask,
  tryParseStroke,
} from '../../src/core/steno.ts'

describe('slotMask / maskToSlots', () => {
  it('sets bit i for SLOTS[i]', () => {
    expect(slotMask('#')).toBe(1)
    expect(slotMask('-Z')).toBe(1 << (SLOTS.length - 1))
  })

  it('returns slots in SLOTS order', () => {
    expect(maskToSlots(slotMask('-T', 'S-', 'A-'))).toEqual(['S-', 'A-', '-T'])
  })
})

describe('parseStroke', () => {
  const cases: [string, Parameters<typeof slotMask>][] = [
    ['SAP', ['S-', 'A-', '-P']],
    ['KAT', ['K-', 'A-', '-T']],
    ['-T', ['-T']],
    ['-RBGSZ', ['-R', '-B', '-G', '-S', '-Z']],
    ['#TPH', ['#', 'T-', 'P-', 'H-']],
    ['TP-PL', ['T-', 'P-', '-P', '-L']],
    ['#-R', ['#', '-R']],
    ['#EUPB', ['#', '-E', '-U', '-P', '-B']],
    ['HO*P', ['H-', 'O-', '*', '-P']],
    ['A*', ['A-', '*']],
  ]
  for (const [text, slots] of cases) {
    it(`parses ${text}`, () => {
      expect(parseStroke(text)).toBe(slotMask(...slots))
    })
  }

  for (const bad of ['', 'Q', 'OA', 'AA', 'ZZ']) {
    it(`throws StenoParseError for ${JSON.stringify(bad)}`, () => {
      expect(() => parseStroke(bad)).toThrow(StenoParseError)
    })
  }
})

describe('tryParseStroke', () => {
  it('returns null on invalid input', () => {
    expect(tryParseStroke('OA')).toBeNull()
  })

  it('returns the mask on valid input', () => {
    expect(tryParseStroke('SAP')).toBe(slotMask('S-', 'A-', '-P'))
  })
})

describe('parseOutline', () => {
  it('splits on /', () => {
    const outline = parseOutline('KOPL/PHREU/KAEUT')
    expect(outline).toHaveLength(3)
    expect(outline[0]).toBe(slotMask('K-', 'O-', '-P', '-L'))
  })
})

describe('formatStroke', () => {
  for (const text of ['SAP', '-T', '-RBGSZ', '#TPH', 'TP-PL', '#-R', 'HO*P', 'KAT', 'A*P', '#STKPWHRAO*EUFRPBLGTSDZ']) {
    it(`round-trips ${text}`, () => {
      expect(formatStroke(parseStroke(text))).toBe(text)
    })
  }
})
