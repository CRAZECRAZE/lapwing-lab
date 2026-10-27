import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseExampleItems } from '../../scripts/lib/examples.ts'

const book = (name: string) => readFileSync(`content/lapwing-book/src/${name}`, 'utf8')

describe('parseExampleItems', () => {
  it('reads word-then-outline list items', () => {
    expect(parseExampleItems(5, '* dad `TKAD`\n* cat `KAT`\n')).toEqual([
      { chapter: 5, word: 'dad', outlines: ['TKAD'] },
      { chapter: 5, word: 'cat', outlines: ['KAT'] },
    ])
  })

  it('reads nested items and trims stray spaces', () => {
    const md = '* center `SEPB/TER`\n   * centre `SEPB/TER/#TPH`\n*  organize `OR/TKPWA/TPHAOEUZ` \n* aetiology `AET/KWROLG`  \n'
    expect(parseExampleItems(21, md).map((r) => [r.word, r.outlines])).toEqual([
      ['center', ['SEPB/TER']],
      ['centre', ['SEPB/TER/#TPH']],
      ['organize', ['OR/TKPWA/TPHAOEUZ']],
      ['aetiology', ['AET/KWROLG']],
    ])
  })

  it('skips outline-first items and items without a valid outline', () => {
    const md = '* `#ER` 10\n* dad `QQQ`\n* just words\n* dad `KAT/QQQ`\n* ok `TKAD`\n'
    expect(parseExampleItems(5, md)).toEqual([{ chapter: 5, word: 'ok', outlines: ['TKAD'] }])
  })

  it('ignores items inside tables and code fences', () => {
    const md = '| a | b |\n| - | - |\n| * dad `TKAD` | x |\n\n```\n* cat `KAT`\n```\n\n* sat `SAT`\n'
    expect(parseExampleItems(5, md)).toEqual([{ chapter: 5, word: 'sat', outlines: ['SAT'] }])
  })

  it('merges the same word case-insensitively, keeping outlines unique and in order', () => {
    const md = '* organise `OR/TPHAOEUZ/#TPH`\n* Organise `O*RG`\n* organise `OR/TPHAOEUZ/#TPH`\n'
    expect(parseExampleItems(21, md)).toEqual([
      { chapter: 21, word: 'organise', outlines: ['OR/TPHAOEUZ/#TPH', 'O*RG'] },
    ])
  })

  it('keeps a multi-word phrase as the word', () => {
    expect(parseExampleItems(8, '* how ever `HOU/EFR`\n')).toEqual([{ chapter: 8, word: 'how ever', outlines: ['HOU/EFR'] }])
  })

  it('accepts \\r\\n line endings', () => {
    expect(parseExampleItems(5, '* dad `TKAD`\r\n   * dads `TKADZ`\r\n')).toEqual([
      { chapter: 5, word: 'dad', outlines: ['TKAD'] },
      { chapter: 5, word: 'dads', outlines: ['TKADZ'] },
    ])
  })

  it('never throws on unusual markdown', () => {
    expect(parseExampleItems(1, '')).toEqual([])
    expect(parseExampleItems(1, '* `\n* ``\n* a ``\n* b `/`\n> * q `KAT`\n')).toEqual([
      { chapter: 1, word: 'q', outlines: ['KAT'] },
    ])
  })

  it('finds dad in the real Chapter 5', () => {
    expect(parseExampleItems(5, book('Chapter-05.md'))).toContainEqual({ chapter: 5, word: 'dad', outlines: ['TKAD'] })
  })

  it('finds centre and merged organise in the real Chapter 21', () => {
    const rows = parseExampleItems(21, book('Chapter-21.md'))
    expect(rows).toContainEqual({ chapter: 21, word: 'centre', outlines: ['SEPB/TER/#TPH'] })
    expect(rows.find((r) => r.word === 'organise')?.outlines).toEqual(['OR/TKPWA/TPHAOEUZ/#TPH', 'O*RG'])
    expect(rows.length).toBeGreaterThanOrEqual(25)
  })

  it('parses every chapter page without throwing', () => {
    for (let n = 1; n <= 26; n++) {
      const name = `Chapter-${String(n).padStart(2, '0')}.md`
      expect(() => parseExampleItems(n, book(name))).not.toThrow()
    }
  })
})
