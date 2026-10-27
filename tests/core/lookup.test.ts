import { describe, expect, it } from 'vitest'
import { looksLikeSteno, searchLookup } from '../../src/core/lookup.ts'
import type { LookupEntry } from '../../scripts/lib/lookup.ts'

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze)
    Object.freeze(value)
  }
  return value
}

function entry(word: string, ...hits: [string, number][]): LookupEntry {
  return { word, hits: hits.map(([outline, chapter]) => ({ outline, chapter, source: 'practice' as const })) }
}

const ENTRIES: readonly LookupEntry[] = deepFreeze([
  entry('scat', ['SKAT', 9]),
  entry('catch', ['KAFP', 7]),
  entry('Cat', ['KAT', 6], ['KA*T', 8]),
  entry('cab', ['KAB', 5]),
  entry('add', ['AD', 5], ['SKWRAD', 9]),
  entry('dog', ['TKOG', 5]),
  entry('how ever', ['HOU/AEFR', 12]),
  entry('however', ['HOUFR', 12]),
])

const words = (results: { word: string }[]): string[] => results.map((r) => r.word)

describe('looksLikeSteno', () => {
  it('accepts upper-case stroke text', () => {
    for (const q of ['SAP', '-RBGSZ', 'KAT/PHREU', '#E', 'A', 'SAT', 'TKAD', 'ADD']) {
      expect(looksLikeSteno(q), q).toBe(true)
    }
  })

  it('rejects words, empty text and anything with other characters', () => {
    for (const q of ['cat', '', '   ', 'Sap', 'S ap', 'hello1', 'CAT', 'I']) {
      expect(looksLikeSteno(q), JSON.stringify(q)).toBe(false)
    }
  })

  it('ignores surrounding whitespace', () => {
    expect(looksLikeSteno('  SAP ')).toBe(true)
  })
})

describe('searchLookup word ranking', () => {
  it('lists prefix matches alphabetically, then substring matches', () => {
    const results = searchLookup(ENTRIES, 'ca')
    expect(words(results)).toEqual(['cab', 'Cat', 'catch', 'scat'])
    expect(results.map((r) => r.match)).toEqual(['prefix', 'prefix', 'prefix', 'contains'])
  })

  it('puts the exact word before prefix and substring matches', () => {
    const results = searchLookup(ENTRIES, 'cat')
    expect(words(results)).toEqual(['Cat', 'catch', 'scat'])
    expect(results.map((r) => r.match)).toEqual(['exact', 'prefix', 'contains'])
  })

  it('is case-insensitive and keeps the display word', () => {
    expect(searchLookup(ENTRIES, 'CaT')[0]).toMatchObject({ word: 'Cat', match: 'exact' })
    expect(searchLookup(ENTRIES, 'cAB')[0].word).toBe('cab')
  })

  it('finds phrases with an inner space as substrings', () => {
    const results = searchLookup(ENTRIES, 'how e')
    expect(words(results)).toEqual(['how ever'])
    expect(results[0].match).toBe('prefix')
    expect(words(searchLookup(ENTRIES, 'w ev'))).toEqual(['how ever'])
  })

  it('trims the query and returns nothing for an empty or blank one', () => {
    expect(words(searchLookup(ENTRIES, '  dog '))).toEqual(['dog'])
    expect(searchLookup(ENTRIES, '')).toEqual([])
    expect(searchLookup(ENTRIES, '   ')).toEqual([])
  })

  it('lists each entry once', () => {
    const results = searchLookup(ENTRIES, 'a')
    expect(new Set(words(results)).size).toBe(results.length)
  })
})

describe('searchLookup maxChapter', () => {
  it('removes later hits and drops entries left with none', () => {
    const results = searchLookup(ENTRIES, 'cat', { maxChapter: 7 })
    expect(results.map((r) => [r.word, r.hits.map((h) => h.outline)])).toEqual([
      ['Cat', ['KAT']],
      ['catch', ['KAFP']],
    ])
    expect(searchLookup(ENTRIES, 'scat', { maxChapter: 8 })).toEqual([])
  })

  it('keeps the exact then prefix then substring order after filtering', () => {
    const results = searchLookup(ENTRIES, 'cat', { maxChapter: 6 })
    expect(results.map((r) => [r.word, r.match])).toEqual([['Cat', 'exact']])
    const prefix = searchLookup(ENTRIES, 'ca', { maxChapter: 8 })
    expect(words(prefix)).toEqual(['cab', 'Cat', 'catch'])
  })

  it('includes chapter equal to the limit and applies no limit when undefined', () => {
    expect(words(searchLookup(ENTRIES, 'dog', { maxChapter: 5 }))).toEqual(['dog'])
    expect(searchLookup(ENTRIES, 'dog', { maxChapter: 4 })).toEqual([])
    expect(searchLookup(ENTRIES, 'add', {})[0].hits).toHaveLength(2)
  })
})

describe('searchLookup limit', () => {
  const many: LookupEntry[] = Array.from({ length: 40 }, (_, i) => entry(`word${String(i).padStart(2, '0')}`, ['WORD', 5]))

  it('caps at 30 by default', () => {
    const results = searchLookup(many, 'word')
    expect(results).toHaveLength(30)
    expect(results[0].word).toBe('word00')
    expect(results[29].word).toBe('word29')
  })

  it('takes a custom limit', () => {
    expect(searchLookup(many, 'word', { limit: 5 })).toHaveLength(5)
    expect(searchLookup(many, 'word', { limit: 100 })).toHaveLength(40)
  })

  it('returns nothing for a limit of 0 or less', () => {
    expect(searchLookup(many, 'word', { limit: 0 })).toEqual([])
    expect(searchLookup(many, 'word', { limit: -3 })).toEqual([])
  })

  it('caps the combined outline and word list', () => {
    const mixed = [entry('zzz', ['KAT', 5]), entry('kat', ['XX', 5])]
    expect(words(searchLookup(mixed, 'KAT', { limit: 1 }))).toEqual(['zzz'])
  })
})

describe('searchLookup outlines', () => {
  it('finds the entry for an exact outline first, with the matching hit first', () => {
    const results = searchLookup([entry('cat', ['KA*T', 6], ['KAT', 6]), entry('kat', ['XX', 5])], 'KAT')
    expect(results[0]).toMatchObject({ word: 'cat', match: 'outline' })
    expect(results[0].hits.map((h) => h.outline)).toEqual(['KAT', 'KA*T'])
    expect(results[1]).toMatchObject({ word: 'kat', match: 'exact' })
  })

  it('finds an entry by an outline prefix too, exact outlines before prefix ones', () => {
    const entries = [entry('cab', ['KAB', 5]), entry('cat', ['KAT', 5]), entry('ka', ['KA', 5])]
    const results = searchLookup(entries, 'KA')
    expect(results.map((r) => [r.word, r.match])).toEqual([
      ['ka', 'outline'],
      ['cab', 'outline'],
      ['cat', 'outline'],
    ])
    expect(words(searchLookup(ENTRIES, 'KA'))).toEqual(['cab', 'Cat', 'catch'])
  })

  it('orders each outline group alphabetically by lower-case word', () => {
    const entries = [entry('zed', ['SKAT', 5], ['KAT', 5]), entry('Apple', ['KAT', 5])]
    expect(words(searchLookup(entries, 'KAT'))).toEqual(['Apple', 'zed'])
  })

  it('ignores outline hits later than maxChapter', () => {
    expect(searchLookup(ENTRIES, 'KAT', { maxChapter: 5 })).toEqual([])
    const results = searchLookup(ENTRIES, 'KA*T', { maxChapter: 6 })
    expect(results).toEqual([])
    expect(words(searchLookup(ENTRIES, 'KA*T', { maxChapter: 8 }))).toEqual(['Cat'])
  })

  it('lists a steno-looking word once, as an outline result when an outline matches', () => {
    const results = searchLookup([entry('add', ['AD', 5], ['ADD', 5]), entry('dog', ['TKOG', 5])], 'ADD')
    expect(results.filter((r) => r.word === 'add')).toHaveLength(1)
    expect(results[0]).toMatchObject({ word: 'add', match: 'outline' })
    expect(results[0].hits.map((h) => h.outline)).toEqual(['ADD', 'AD'])
  })

  it('lists a steno-looking word once, as a word result when no outline matches', () => {
    const results = searchLookup([entry('add', ['TKAD', 5])], 'ADD')
    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({ word: 'add', match: 'exact' })
  })

  it('does not search outlines for lower-case queries', () => {
    expect(searchLookup([entry('xyz', ['KAT', 5])], 'kat')).toEqual([])
  })
})

describe('searchLookup purity', () => {
  it('does not mutate the entries and returns new objects', () => {
    const results = searchLookup(ENTRIES, 'KAT')
    results[0].hits.reverse()
    results[0].hits.push({ outline: 'X', chapter: 1, source: 'brief' })
    const plain = searchLookup(ENTRIES, 'cat')
    expect(plain[0]).not.toBe(ENTRIES[2])
    expect(plain[0].hits).not.toBe(ENTRIES[2].hits)
    expect(ENTRIES[2].hits).toHaveLength(2)
  })

  it('is deterministic', () => {
    expect(searchLookup(ENTRIES, 'ca')).toEqual(searchLookup(ENTRIES, 'ca'))
    expect(searchLookup(ENTRIES, 'KAT')).toEqual(searchLookup([...ENTRIES].reverse(), 'KAT'))
  })
})
