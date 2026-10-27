import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseOutline } from '../../src/core/steno.ts'
import { generatedLists } from '../../scripts/lib/generated.ts'
import type { GeneratedList } from '../../scripts/lib/generated.ts'

const book = (name: string) => readFileSync(`content/lapwing-book/src/${name}`, 'utf8')
const lists = (chapter: number) => generatedLists(chapter, book(`Chapter-${chapter}.md`))
const byId = (all: GeneratedList[], id: string) => all.find((l) => l.id === id)!
const outlinesOf = (list: GeneratedList, prompt: string) => list.items.find((i) => i.prompt === prompt)?.outlines

describe('generatedLists for Chapter 18', () => {
  const all = lists(18)

  it('gives the three lists with their sizes', () => {
    expect(all.map((l) => l.id).sort()).toEqual(['18-lowercase', '18-numbers', '18-uppercase'])
    expect(all.every((l) => l.chapter === 18)).toBe(true)
    expect(byId(all, '18-lowercase').items).toHaveLength(26)
    expect(byId(all, '18-uppercase').items).toHaveLength(26)
    expect(byId(all, '18-numbers').items.length).toBeGreaterThanOrEqual(16)
  })

  it('maps letters to fingerspelling outlines', () => {
    const lower = byId(all, '18-lowercase')
    expect(outlinesOf(lower, 'a')).toEqual(['A*'])
    expect(outlinesOf(lower, 'z')).toEqual(['STKPW*'])
    expect(lower.items.map((i) => i.prompt).join('')).toBe('abcdefghijklmnopqrstuvwxyz')
  })

  it('prompts uppercase letters with capitals, from the uppercase table', () => {
    const upper = byId(all, '18-uppercase')
    expect(outlinesOf(upper, 'A')).toEqual(['A*P'])
    expect(outlinesOf(upper, 'Z')).toEqual(['STKPW*P'])
    expect(upper.items.map((i) => i.prompt).join('')).toBe('ABCDEFGHIJKLMNOPQRSTUVWXYZ')
  })

  it('gives digits and trailing-zero examples', () => {
    const numbers = byId(all, '18-numbers')
    expect(outlinesOf(numbers, '0')).toEqual(['#E'])
    expect(outlinesOf(numbers, '1')).toEqual(['#-R'])
    expect(outlinesOf(numbers, '000')).toEqual(['#EU'])
    expect(outlinesOf(numbers, '10')).toEqual(['#ER'])
    expect(outlinesOf(numbers, '5000')).toEqual(['#EUPB'])
    expect(outlinesOf(numbers, '800')).toEqual(['#UP'])
    expect(outlinesOf(numbers, '20')).toEqual(['#EB'])
    expect(numbers.items).toHaveLength(16)
  })
})

describe('generatedLists for Chapter 20', () => {
  const all = lists(20)

  it('gives punctuation and commands', () => {
    expect(all.map((l) => l.id).sort()).toEqual(['20-commands', '20-punctuation'])
  })

  it('names each punctuation prompt with its character and keeps prompts distinct', () => {
    const punctuation = byId(all, '20-punctuation')
    const prompts = punctuation.items.map((i) => i.prompt)
    expect(new Set(prompts).size).toBe(prompts.length)
    expect(outlinesOf(punctuation, 'Period (.)')).toEqual(['TP-PL'])
    expect(outlinesOf(punctuation, 'Decimal point (.)')).toEqual(['P-P'])
    expect(outlinesOf(punctuation, 'Colon (for time) (:)')).toEqual(['KHR-PB'])
    expect(outlinesOf(punctuation, 'Opening backtick (`)')).toEqual(['KH-FG'])
    expect(punctuation.items).toHaveLength(28)
  })

  it('tells the two Endash and two Hyphen rows apart by their formatting', () => {
    const punctuation = byId(all, '20-punctuation')
    expect(outlinesOf(punctuation, 'Endash (–) — Attaches to the previous word and the next word')).toEqual(['TPH-RB'])
    expect(outlinesOf(punctuation, 'Endash (–) — Space before and after')).toEqual(['TPH*RB'])
    expect(outlinesOf(punctuation, 'Hyphen (-) — Attaches to the previous word and the next word')).toEqual(['H-PB'])
    expect(outlinesOf(punctuation, 'Hyphen (-) — Space before and after')).toEqual(['H*PB'])
  })

  it('ignores the second table of graphics', () => {
    const punctuation = byId(all, '20-punctuation')
    expect(punctuation.items.every((i) => i.outlines.length === 1)).toBe(true)
    expect(punctuation.items.some((i) => i.prompt.startsWith('. '))).toBe(false)
  })

  it('reads commands from their Outline headings', () => {
    const commands = byId(all, '20-commands')
    expect(outlinesOf(commands, 'Enter')).toEqual(['R-R'])
    expect(outlinesOf(commands, 'Enter (capitalize next word)')).toEqual(['R*R'])
    expect(outlinesOf(commands, 'Insert a space')).toEqual(['S-P'])
    expect(commands.items).toHaveLength(11)
  })
})

describe('generatedLists for Chapter 21', () => {
  const all = lists(21)

  it('gives the UK spellings list', () => {
    expect(all.map((l) => l.id)).toEqual(['21-uk-spellings'])
    const uk = all[0]
    expect(uk.items.length).toBeGreaterThanOrEqual(25)
    expect(outlinesOf(uk, 'centre')).toEqual(['SEPB/TER/#TPH'])
  })
})

describe('generatedLists in general', () => {
  it('parses every outline of every list', () => {
    for (const chapter of [18, 20, 21]) {
      for (const list of lists(chapter)) {
        for (const item of list.items) {
          expect(item.prompt).not.toBe('')
          expect(item.outlines.length).toBeGreaterThan(0)
          for (const outline of item.outlines) expect(() => parseOutline(outline), `${list.id} ${item.prompt}`).not.toThrow()
        }
      }
    }
  })

  it('gives [] for other chapters', () => {
    for (const chapter of [1, 5, 17, 19, 22, 26]) {
      expect(generatedLists(chapter, 'anything\n* dad `TKAD`\n')).toEqual([])
    }
  })

  it('throws naming the list and the outline when an outline is bad', () => {
    const broken = book('Chapter-18.md').replace('stroke="STKPW*"', 'stroke="QQQ"')
    expect(() => generatedLists(18, broken)).toThrow(/18-lowercase.*"QQQ"/)
    const commands =
      '## Punctuation\n\n| Character | Name | Formatting | Steno outline | Mnemonic |\n| - | - | - | - | - |\n' +
      '| <code>.</code> | Period | Attaches. | `TP-PL` | x |\n\n## Commands\n\n### Enter\n#### Outline: `QQQ`\n'
    expect(() => generatedLists(20, commands)).toThrow(/20-commands.*"QQQ"/)
  })

  it('throws naming the chapter and table when an expected table is missing', () => {
    expect(() => generatedLists(18, '# Chapter 18\n')).toThrow(/Chapter 18.*Lowercase/)
    expect(() => generatedLists(20, '# Chapter 20\n')).toThrow(/Chapter 20.*Punctuation/)
    expect(() => generatedLists(21, '# Chapter 21\n')).toThrow(/Chapter 21/)
  })

  it('skips command headings without an outline line and uses the first of two', () => {
    const md =
      '## Punctuation\n\n| Character | Name | Formatting | Steno outline | Mnemonic |\n| - | - | - | - | - |\n' +
      '| <code>.</code> | Period | Attaches. | `TP-PL` | x |\n\n## Commands\n\n' +
      '### None\nText only\n\n### Two\n#### Outline: `R-R`\n#### Outline: `R*R`\n\n### Example first\n#### Example: `KAT`\n#### Outline: `S-P`\n\n### Last\n#### Outline: `KPA`\n'
    const commands = byId(generatedLists(20, md), '20-commands')
    expect(commands.items).toEqual([
      { prompt: 'Two', outlines: ['R-R'] },
      { prompt: 'Last', outlines: ['KPA'] },
    ])
  })

  it('throws when prompts would collide', () => {
    const md =
      '## Punctuation\n\n| Character | Name | Formatting | Steno outline | Mnemonic |\n| - | - | - | - | - |\n' +
      '| <code>.</code> | Dot | Same. | `TP-PL` | x |\n| <code>.</code> | Dot | Same. | `P-P` | x |\n\n## Commands\n\n### Enter\n#### Outline: `R-R`\n'
    expect(() => generatedLists(20, md)).toThrow(/20-punctuation.*Dot/)
  })
})
