import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { tryParseStroke } from '../../src/core/steno.ts'
import { parseStage0Words } from '../../scripts/lib/stage0.ts'

describe('parseStage0Words', () => {
  const words = parseStage0Words(readFileSync('content/lapwing-book/src/Chapter-04.md', 'utf8'))

  it('finds the 100-word test and the two extra lists', () => {
    expect(words.test).toHaveLength(100)
    expect(words.test[0]).toBe('SAP')
    expect(words.test[1]).toBe('HUD')
    expect(words.extra.map((a) => a.length)).toEqual([99, 82])
  })

  it('only contains valid strokes', () => {
    for (const word of [...words.test, ...words.extra.flat()]) expect(tryParseStroke(word), word).not.toBeNull()
  })

  it('throws when there is no word block', () => {
    expect(() => parseStage0Words('# Chapter 4\n\n```\nSAP HUD\n```\n')).toThrow(/Chapter 4/)
  })
})
