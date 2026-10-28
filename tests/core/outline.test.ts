import { describe, expect, it } from 'vitest'
import { compareOutlines, outlineKeys, outlineStrokes } from '../../src/core/outline.ts'

describe('outlineStrokes', () => {
  it('counts the slash-separated strokes', () => {
    expect(outlineStrokes('KAT')).toBe(1)
    expect(outlineStrokes('ES/PERB/HREU')).toBe(3)
  })

  it('counts an empty stroke as a stroke', () => {
    expect(outlineStrokes('A//B')).toBe(3)
    expect(outlineStrokes('/')).toBe(2)
  })
})

describe('outlineKeys', () => {
  it('counts the keys pressed in a parseable stroke', () => {
    expect(outlineKeys('KAT')).toBe(3)
    expect(outlineKeys('-T')).toBe(1)
    expect(outlineKeys('TKAD')).toBe(4)
  })

  it('sums the keys over the strokes', () => {
    expect(outlineKeys('ES/PERB/HREU')).toBe(2 + 4 + 4)
  })

  it('counts a lone star, the number key and keys spelled with a hyphen as keys', () => {
    expect(outlineKeys('*')).toBe(1)
    expect(outlineKeys('#S')).toBe(2)
    expect(outlineKeys('#-T')).toBe(2)
    expect(outlineKeys('STKPW')).toBe(5)
    expect(outlineKeys('-RBGS')).toBe(4)
  })

  it('counts an empty stroke as no keys', () => {
    expect(outlineKeys('/')).toBe(0)
    expect(outlineKeys('A//B')).toBe(outlineKeys('A/B'))
  })

  it('counts the characters other than hyphens of a stroke it cannot parse, and does not throw', () => {
    expect(outlineKeys('1')).toBe(1)
    expect(outlineKeys('#1')).toBe(2)
    expect(outlineKeys('1-9')).toBe(2)
    expect(outlineKeys('abc')).toBe(3)
    expect(outlineKeys('-')).toBe(0)
    expect(outlineKeys('KAT/1-9')).toBe(5)
  })
})

describe('compareOutlines', () => {
  it('puts fewer strokes first', () => {
    expect(['ES/PERB/HREU', 'EPS'].sort(compareOutlines)).toEqual(['EPS', 'ES/PERB/HREU'])
    expect(compareOutlines('EPS', 'ES/PERB/HREU')).toBeLessThan(0)
    expect(compareOutlines('ES/PERB/HREU', 'EPS')).toBeGreaterThan(0)
  })

  it('puts fewer keys first among outlines with as many strokes, a stroke count outranking keys', () => {
    expect(compareOutlines('ES/PERB/HREU', 'ES/PERBL/KWREU')).toBeLessThan(0)
    expect(compareOutlines('KAT', 'KATS')).toBeLessThan(0)
    // fewer keys wins even when string order says otherwise
    expect(compareOutlines('TAK', 'KATS')).toBeLessThan(0)
    expect(compareOutlines('STKPWHR', 'A/B')).toBeLessThan(0)
  })

  it('falls back to plain string order for equal strokes and keys', () => {
    expect(compareOutlines('KAT', 'TAK')).toBeLessThan(0)
    expect(compareOutlines('TAK', 'KAT')).toBeGreaterThan(0)
    expect(compareOutlines('KAT', 'KAT')).toBe(0)
    // plain code-unit order, not locale order: uppercase before lowercase
    expect(compareOutlines('Z', 'a')).toBeLessThan(0)
  })

  it('is a total deterministic order', () => {
    const list = ['EPS', 'ES/PERB/HREU', 'ES/PERBL/KWREU', 'KAT', 'TAK', 'KATS', '-T', '*', 'A//B', '1', '#S', 'STKPW']
    const expected = [...list].sort(compareOutlines)
    for (let seed = 1; seed <= 20; seed++) {
      const shuffled = [...list]
      let state = seed
      for (let i = shuffled.length - 1; i > 0; i--) {
        state = (state * 1103515245 + 12345) % 2147483648
        const j = state % (i + 1)
        ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
      }
      expect(shuffled.sort(compareOutlines)).toEqual(expected)
    }
  })
})
