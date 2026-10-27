import { describe, expect, it } from 'vitest'
import { buildLookup } from '../../scripts/lib/lookup.ts'
import type { LookupEntry } from '../../scripts/lib/lookup.ts'
import type { ExampleRow } from '../../scripts/lib/examples.ts'
import type { BriefRow } from '../../scripts/lib/tables.ts'

type List = Parameters<typeof buildLookup>[0]['lists'][number]

function list(chapter: number, items: [string, ...string[]][], id = `${chapter}-list`): List {
  return { id, chapter, items: items.map(([prompt, ...outlines]) => ({ prompt, outlines })) }
}

function brief(chapter: number, translation: string, outlines: string[], explanation = ''): BriefRow {
  return { chapter, kind: 'chapter', translation, outlines, explanation }
}

function example(chapter: number, word: string, outlines: string[]): ExampleRow {
  return { chapter, word, outlines }
}

const none = { lists: [], briefs: [], examples: [] }

function find(entries: LookupEntry[], word: string): LookupEntry {
  const entry = entries.find((e) => e.word === word)
  if (!entry) throw new Error(`no entry ${word}`)
  return entry
}

describe('buildLookup', () => {
  it('makes a practice hit per outline of each item, in the chapter of the list', () => {
    const entries = buildLookup({ ...none, lists: [list(5, [['cat', 'KAT', 'KA*T']])] })
    expect(entries).toEqual([
      {
        word: 'cat',
        hits: [
          { outline: 'KA*T', chapter: 5, source: 'practice' },
          { outline: 'KAT', chapter: 5, source: 'practice' },
        ],
      },
    ])
  })

  it('makes brief hits carrying the explanation as note, and omits an empty note', () => {
    const entries = buildLookup({
      ...none,
      briefs: [brief(5, 'are', ['R', '-R'], 'the R key'), brief(6, 'is', ['S'], '')],
    })
    expect(find(entries, 'are').hits).toEqual([
      { outline: '-R', chapter: 5, source: 'brief', note: 'the R key' },
      { outline: 'R', chapter: 5, source: 'brief', note: 'the R key' },
    ])
    const is = find(entries, 'is').hits[0]
    expect(is).toEqual({ outline: 'S', chapter: 6, source: 'brief' })
    expect(is).not.toHaveProperty('note')
  })

  it('makes example hits per outline of each example row', () => {
    const entries = buildLookup({ ...none, examples: [example(21, 'centre', ['SEPB/TER/#TPH'])] })
    expect(entries).toEqual([{ word: 'centre', hits: [{ outline: 'SEPB/TER/#TPH', chapter: 21, source: 'example' }] }])
  })

  it('merges words that differ only in case and keeps the display form of the first hit', () => {
    const entries = buildLookup({
      lists: [list(5, [['Cat', 'KAT']])],
      briefs: [brief(6, 'cat', ['KA*T'])],
      examples: [example(7, 'CAT', ['KAT/S'])],
    })
    expect(entries).toHaveLength(1)
    expect(entries[0].word).toBe('Cat')
    expect(entries[0].hits.map((h) => h.source)).toEqual(['practice', 'brief', 'example'])
  })

  it('takes the display form from the first hit by input order lists, briefs, examples', () => {
    const entries = buildLookup({
      lists: [],
      briefs: [brief(6, 'Cat', ['KA*T'])],
      examples: [example(5, 'cat', ['KAT'])],
    })
    expect(entries[0].word).toBe('Cat')
  })

  it('trims a word for the key and the display form', () => {
    const entries = buildLookup({ ...none, lists: [list(5, [['  cat ', 'KAT']]), list(6, [['CAT', 'KA*T']])] })
    expect(entries).toHaveLength(1)
    expect(entries[0].word).toBe('cat')
    expect(entries[0].hits).toHaveLength(2)
  })

  it('keeps one hit per (outline, chapter, source)', () => {
    const entries = buildLookup({
      lists: [list(5, [['cat', 'KAT', 'KAT']]), list(5, [['cat', 'KAT']], '5-other')],
      briefs: [],
      examples: [example(5, 'cat', ['KAT'])],
    })
    expect(entries[0].hits).toEqual([
      { outline: 'KAT', chapter: 5, source: 'practice' },
      { outline: 'KAT', chapter: 5, source: 'example' },
    ])
  })

  it('treats the same outline in another chapter or source as a different hit', () => {
    const entries = buildLookup({
      lists: [list(5, [['cat', 'KAT']]), list(6, [['cat', 'KAT']])],
      briefs: [brief(5, 'cat', ['KAT'])],
      examples: [],
    })
    expect(entries[0].hits).toHaveLength(3)
  })

  it('keeps the note when the same brief hit appears with and without one', () => {
    const withNote = brief(5, 'are', ['R'], 'the R key')
    const without = brief(5, 'are', ['R'], '')
    for (const briefs of [[withNote, without], [without, withNote]]) {
      const entries = buildLookup({ ...none, briefs })
      expect(entries[0].hits).toEqual([{ outline: 'R', chapter: 5, source: 'brief', note: 'the R key' }])
    }
  })

  it('drops entries with an empty or whitespace-only word', () => {
    const entries = buildLookup({
      lists: [list(5, [['', 'KAT'], ['   ', 'KA*T'], ['dog', 'TKOG']])],
      briefs: [brief(5, ' ', ['R'])],
      examples: [example(5, '\t', ['S'])],
    })
    expect(entries.map((e) => e.word)).toEqual(['dog'])
  })

  it('preserves multi-stroke outlines verbatim', () => {
    const entries = buildLookup({ ...none, examples: [example(21, 'centre', ['SEPB/TER/#TPH', 'S-FPLT/TKOUBG'])] })
    expect(entries[0].hits.map((h) => h.outline)).toEqual(['S-FPLT/TKOUBG', 'SEPB/TER/#TPH'])
  })

  it('sorts hits by chapter, then source (practice, brief, example), then outline', () => {
    const entries = buildLookup({
      lists: [list(7, [['go', 'TKPWO']]), list(5, [['go', 'TKPW', 'GO']])],
      briefs: [brief(5, 'go', ['TKPWO'], 'x'), brief(7, 'go', ['G'], 'y')],
      examples: [example(5, 'go', ['A']), example(7, 'go', ['B'])],
    })
    expect(entries[0].hits.map((h) => `${h.chapter}:${h.source}:${h.outline}`)).toEqual([
      '5:practice:GO',
      '5:practice:TKPW',
      '5:brief:TKPWO',
      '5:example:A',
      '7:practice:TKPWO',
      '7:brief:G',
      '7:example:B',
    ])
  })

  it('orders chapters numerically, not as text', () => {
    const entries = buildLookup({ ...none, lists: [list(10, [['go', 'TKPWO']]), list(9, [['go', 'TKPWO']])] })
    expect(entries[0].hits.map((h) => h.chapter)).toEqual([9, 10])
  })

  it('sorts entries by lower-cased word in code-unit order', () => {
    const entries = buildLookup({
      ...none,
      lists: [list(5, [['b', 'PW'], ['Ab', 'AB'], ['a', 'A'], ['aa', 'AA'], ['B2', 'PW'], ['b-', 'PW']])],
    })
    expect(entries.map((e) => e.word)).toEqual(['a', 'aa', 'Ab', 'b', 'b-', 'B2'])
  })

  it('gives the same result whatever the input order', () => {
    const lists = [list(5, [['cat', 'KAT'], ['dog', 'TKOG']]), list(6, [['cat', 'KA*T']]), list(5, [['ant', 'APBT']], '5-b')]
    const briefs = [brief(5, 'are', ['R', '-R'], 'n'), brief(6, 'cat', ['KAT'], ''), brief(5, 'dog', ['TKOG'], 'd')]
    const examples = [example(5, 'cat', ['KAT']), example(7, 'ant', ['APBT', 'A']), example(5, 'dog', ['TKOG'])]
    const expected = buildLookup({ lists, briefs, examples })
    const orders = [
      { lists: [...lists].reverse(), briefs, examples },
      { lists, briefs: [...briefs].reverse(), examples },
      { lists, briefs, examples: [...examples].reverse() },
      {
        lists: [lists[1], lists[2], lists[0]],
        briefs: [briefs[2], briefs[0], briefs[1]],
        examples: [examples[1], examples[2], examples[0]],
      },
    ]
    for (const input of orders) expect(buildLookup(input)).toEqual(expected)
    expect(expected.map((e) => e.word)).toEqual(['ant', 'are', 'cat', 'dog'])
  })

  it('does not change its input', () => {
    const lists = [list(5, [['cat', 'KAT']])]
    const briefs = [brief(5, 'are', ['R'], 'n')]
    const copy = JSON.stringify({ lists, briefs })
    buildLookup({ lists, briefs, examples: [] })
    expect(JSON.stringify({ lists, briefs })).toBe(copy)
  })
})
