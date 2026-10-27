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

  it('strips one wrapping pair of double quotes from the word', () => {
    expect(parseExampleItems(13, '* "race" `RAEUS`\n* \u201crace\u201d `RAEUS`\n* "a "b" c `KAT`\n').map((r) => r.word)).toEqual(['race'])
  })

  it('keeps prefix and suffix forms and phrases of up to three tokens', () => {
    const md = '* pro- `PRO`\n* co^ `KO`\n* how ever `HOU/EFR`\n* ice cream cone `KAT`\n* four word long phrase `KAT`\n'
    expect(parseExampleItems(13, md).map((r) => r.word)).toEqual(['pro-', 'co^', 'how ever', 'ice cream cone'])
  })

  it('rejects prose before the code span', () => {
    const md = [
      '* Left hand, bottom row ( `SKWR`',
      '* Vowels ( `AOEU`',
      '* Long u = `U`',
      '* Press: `KAT`',
      '* red, blue, green ( `RBG`',
      '* two words, then `KAT`',
      '* wrinkl(e)/y `KAT`',
      '* If `EU`',
      '* As `SEPBT`',
      '* Instead of `A/SAOEUPB/-PLT`',
      '* Closest would be `TRUTS`',
      '* Index finger presses `KAT`',
      '* The Z sound is similar `-S`',
      '* key is `-S`',
      '* use `KAT`',
      '',
    ].join('\n')
    expect(parseExampleItems(4, md).map((r) => r.word)).toEqual(['use'])
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

  it('keeps no prose rows from the real Chapters 4 and 7', () => {
    for (const [n, name] of [[4, 'Chapter-04.md'], [7, 'Chapter-07.md']] as const) {
      for (const row of parseExampleItems(n, book(name))) {
        expect(row.word, `chapter ${n}`).not.toMatch(/[(,=:]/)
        expect(row.word.split(' ').length, `chapter ${n} ${row.word}`).toBeLessThanOrEqual(3)
      }
    }
  })

  it('keeps the expected row counts per real chapter', () => {
    // Chapters 5 and 17 each lost one prose row ("Closest would be", "Instead of"); 6, 14 and 21 are unchanged.
    const counts: Record<number, number> = { 4: 0, 5: 21, 6: 19, 14: 14, 17: 61, 21: 32 }
    for (const [n, count] of Object.entries(counts)) {
      const name = `Chapter-${String(n).padStart(2, '0')}.md`
      expect(parseExampleItems(Number(n), book(name)), `chapter ${n}`).toHaveLength(count)
    }
  })

  it('totals between 420 and 440 rows over chapters 1 to 26', () => {
    let total = 0
    for (let n = 1; n <= 26; n++) total += parseExampleItems(n, book(`Chapter-${String(n).padStart(2, '0')}.md`)).length
    expect(total).toBeGreaterThanOrEqual(420)
    expect(total).toBeLessThanOrEqual(440)
  })
})
