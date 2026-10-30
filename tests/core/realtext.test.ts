import { describe, expect, it } from 'vitest'
import { MAX_TEXT_CHARS, PART_SIZE, buildLookup, partsOf, planText, textIdFor } from '../../src/core/realtext.ts'
import type { DictCard } from '../../scripts/lib/dictionary.ts'

function card(t: string, ...outlines: string[]): DictCard {
  return { t, r: outlines.map((o) => ({ o })) }
}

function named(t: string, ...outlines: string[]): DictCard {
  return { t, r: outlines.map((o) => ({ o })), n: true }
}

function lookupOf(...cards: DictCard[]): ReadonlyMap<string, string[]> {
  return buildLookup(cards)
}

function prompts(text: string, lookup: ReadonlyMap<string, string[]>): string[] {
  return planText(text, lookup).items.map((it) => it.prompt)
}

describe('constants', () => {
  it('has the part size and the text limit', () => {
    expect(PART_SIZE).toBe(100)
    expect(MAX_TEXT_CHARS).toBe(200000)
  })
})

describe('buildLookup', () => {
  it('maps each card text to its outlines in row order', () => {
    const lookup = lookupOf(card('cat', 'KAT', 'KA*T'), card('the', '-T'))
    expect(lookup.get('cat')).toEqual(['KAT', 'KA*T'])
    expect(lookup.get('the')).toEqual(['-T'])
    expect(lookup.size).toBe(2)
  })

  it('skips named cards', () => {
    const lookup = lookupOf(named('Enter', 'R-R'), card('cat', 'KAT'))
    expect(lookup.has('Enter')).toBe(false)
    expect(lookup.size).toBe(1)
  })

  it('drops outlines that do not parse, and a card left with none', () => {
    const lookup = lookupOf(card('cat', 'KAT', 'not an outline!'), card('bad', 'zzz'))
    expect(lookup.get('cat')).toEqual(['KAT'])
    expect(lookup.has('bad')).toBe(false)
  })

  it('does not change its input', () => {
    const cards = [card('cat', 'KAT', 'zzz'), named('Enter', 'R-R')]
    const before = JSON.stringify(cards)
    buildLookup(cards)
    expect(JSON.stringify(cards)).toBe(before)
  })
})

describe('planText', () => {
  const base = lookupOf(card('the', '-T'), card('cat', 'KAT', 'KA*T'), card('sat', 'SAT'))

  it('plans one word item per word with the card outlines', () => {
    const plan = planText('The cat sat.', base)
    expect(plan.items).toEqual([
      { prompt: 'the', outlines: ['-T'], kind: 'word' },
      { prompt: 'cat', outlines: ['KAT', 'KA*T'], kind: 'word' },
      { prompt: 'sat', outlines: ['SAT'], kind: 'word' },
    ])
    expect(plan).toMatchObject({
      words: 3,
      covered: 3,
      skipped: 0,
      missing: [],
    })
  })

  it('gives each item its own outlines array', () => {
    const plan = planText('cat', base)
    plan.items[0].outlines.push('X')
    expect(base.get('cat')).toEqual(['KAT', 'KA*T'])
  })

  it('matches exactly as written first', () => {
    const lookup = lookupOf(card('I', 'EU'), card('i', 'AOE'))
    expect(prompts('I i', lookup)).toEqual(['I', 'i'])
    expect(planText('I', lookup).items[0].outlines).toEqual(['EU'])
  })

  it('falls back to lower case', () => {
    expect(prompts('The', base)).toEqual(['the'])
  })

  it('matches a capitalised card exactly but not from lower-case text', () => {
    const lookup = lookupOf(card('Paris', 'PAERS'))
    expect(prompts('Paris', lookup)).toEqual(['Paris'])
    const plan = planText('paris', lookup)
    expect(plan.items).toEqual([])
    expect(plan.missing).toEqual([{ word: 'paris', count: 1 }])
  })

  it('does not match named cards', () => {
    const plan = planText('Enter', lookupOf(named('Enter', 'R-R')))
    expect(plan.covered).toBe(0)
    expect(plan.missing).toEqual([{ word: 'Enter', count: 1 }])
  })

  it('trims surrounding punctuation', () => {
    expect(prompts('cat, (cat) “cat” cat!? ‘cat’', base)).toEqual(['cat', 'cat', 'cat', 'cat', 'cat'])
  })

  it('keeps inner apostrophes and treats a curly one as straight', () => {
    const lookup = lookupOf(card("don't", 'TKOPB/T'))
    expect(prompts("don't don’t", lookup)).toEqual(["don't", "don't"])
  })

  it('matches a hyphenated word whole when it has an entry', () => {
    const lookup = lookupOf(card('well-known', 'WEL/TPH'), card('well', 'WEL'), card('known', 'TPHOPB'))
    expect(planText('well-known', lookup).items).toEqual([
      { prompt: 'well-known', outlines: ['WEL/TPH'], kind: 'word' },
    ])
  })

  it('tries the parts of a hyphenated word with no entry', () => {
    const lookup = lookupOf(card('well', 'WEL'), card('known', 'TPHOPB'))
    const plan = planText('well-known', lookup)
    expect(plan.items.map((it) => it.prompt)).toEqual(['well', 'known'])
    expect(plan.words).toBe(1)
    expect(plan.covered).toBe(1)
    expect(plan.items).toHaveLength(2)
    expect(plan.missing).toEqual([])
  })

  it('trims punctuation around the parts of a hyphenated word', () => {
    const lookup = lookupOf(card('rock', 'ROBG'), card('n', 'TPH'), card('roll', 'ROL'))
    expect(prompts("rock-'n'-roll", lookup)).toEqual(['rock', 'n', 'roll'])
  })

  it('matches a word written decomposed against a composed card', () => {
    const lookup = lookupOf(card('caf\u00e9', 'KAF'))
    expect(prompts('cafe\u0301', lookup)).toEqual(['caf\u00e9'])
  })

  it('counts a missing hyphenated word once, not as covered', () => {
    const lookup = lookupOf(card('well', 'WEL'), card('cat', 'KAT'))
    const plan = planText('cat well-known well-known cat', lookup)
    expect(plan.words).toBe(4)
    expect(plan.covered).toBe(2)
    expect(plan.items).toHaveLength(2)
    expect(plan.missing).toEqual([{ word: 'well-known', count: 2 }])
  })

  it('never covers more words than there are', () => {
    const lookup = lookupOf(card('well', 'WEL'), card('known', 'TPHOPB'))
    const plan = planText('well-known well-known', lookup)
    expect(plan.covered).toBe(plan.words)
    expect(plan.items.length).toBeGreaterThan(plan.covered)
  })

  it('sends the whole hyphenated word to missing, once, when a part is unknown', () => {
    const lookup = lookupOf(card('well', 'WEL'))
    const plan = planText('Well-Known well-known', lookup)
    expect(plan.items).toEqual([])
    expect(plan.missing).toEqual([
      { word: 'Well-Known', count: 1 },
      { word: 'well-known', count: 1 },
    ])
  })

  it('skips and counts tokens with no letter', () => {
    const plan = planText('cat 42 — 3.5 cat', base)
    expect(plan).toMatchObject({
      words: 2,
      covered: 2,
      skipped: 3,
      missing: [],
    })
  })

  it('lists unknown words with counts, most first then alphabetical', () => {
    const plan = planText('zed yak zed cat quux yak zed', base)
    expect(plan.words).toBe(7)
    expect(plan.covered).toBe(1)
    expect(plan.missing).toEqual([
      { word: 'zed', count: 3 },
      { word: 'yak', count: 2 },
      { word: 'quux', count: 1 },
    ])
  })

  it('repeats repeated words in text order', () => {
    expect(prompts('cat the cat', base)).toEqual(['cat', 'the', 'cat'])
  })

  it('splits on any whitespace', () => {
    expect(prompts('cat\n\tthe sat　cat', base)).toEqual(['cat', 'the', 'sat', 'cat'])
  })

  it('plans nothing for empty or blank text', () => {
    for (const text of ['', '  \n\t ']) {
      expect(planText(text, base)).toEqual({
        items: [],
        words: 0,
        covered: 0,
        skipped: 0,
        missing: [],
      })
    }
  })

  it('plans a 5,000-word text against a large lookup quickly', () => {
    const cards: DictCard[] = []
    for (let i = 0; i < 100000; i++) cards.push(card(`w${i.toString(36).replace(/\d/g, 'q')}x${i}`, 'KAT'))
    cards.push(card('the', '-T'), card('cat', 'KAT'))
    const lookup = buildLookup(cards)
    const text = Array.from({ length: 5000 }, (_, i) => (i % 3 === 0 ? 'The' : i % 3 === 1 ? 'cat,' : 'zork')).join(' ')
    const start = performance.now()
    const plan = planText(text, lookup)
    const elapsed = performance.now() - start
    expect(plan.words).toBe(5000)
    expect(plan.covered).toBe(3334)
    expect(elapsed).toBeLessThan(500)
  })
})

describe('partsOf', () => {
  const nums = (n: number): number[] => Array.from({ length: n }, (_, i) => i)

  it('cuts 230 items into 100, 100 and 30', () => {
    expect(partsOf(nums(230)).map((p) => p.length)).toEqual([100, 100, 30])
  })

  it('keeps the order across parts', () => {
    expect(partsOf(nums(230)).flat()).toEqual(nums(230))
  })

  it('gives no parts for no items', () => {
    expect(partsOf([])).toEqual([])
  })

  it('gives one part for exactly the part size', () => {
    expect(partsOf(nums(100)).map((p) => p.length)).toEqual([100])
  })

  it('takes a custom size', () => {
    expect(partsOf(nums(7), 3)).toEqual([[0, 1, 2], [3, 4, 5], [6]])
  })
})

describe('textIdFor', () => {
  const VALID = /^[a-z0-9]+(-[a-z0-9]+)*$/

  it('makes a lower-case slug', () => {
    expect(textIdFor('My Notes!', [])).toBe('my-notes')
  })

  it('collapses runs of other characters to one dash and trims', () => {
    expect(textIdFor('  --Hello,   World__ ', [])).toBe('hello-world')
    expect(textIdFor('a é ñ b', [])).toBe('a-b')
  })

  it('cuts to 40 characters without a trailing dash', () => {
    const id = textIdFor('abcdefghi '.repeat(10), [])
    expect(id.length).toBeLessThanOrEqual(40)
    expect(id.endsWith('-')).toBe(false)
    expect(textIdFor('a'.repeat(60), [])).toBe('a'.repeat(40))
    expect(textIdFor(`${'a'.repeat(39)} bbb`, [])).toBe('a'.repeat(39))
  })

  it('falls back to text when nothing is left', () => {
    expect(textIdFor('', [])).toBe('text')
    expect(textIdFor('!!! ???', [])).toBe('text')
  })

  it('numbers an id that is taken', () => {
    expect(textIdFor('Notes', ['notes'])).toBe('notes-2')
    expect(textIdFor('Notes', ['notes', 'notes-2'])).toBe('notes-3')
    expect(textIdFor('', ['text'])).toBe('text-2')
  })

  it('always gives a valid id', () => {
    const long = 'a'.repeat(100)
    const cases: [string, string[]][] = [
      ['My Notes!', []],
      ['日本語', []],
      ['--', ['text', 'text-2']],
      [long, []],
      [long, ['a'.repeat(40), `${'a'.repeat(38)}-2`]],
      ['1 2 3', ['1-2-3']],
      ['x-y_z', []],
      [`${'ab '.repeat(14)}c d`, [`${'ab-'.repeat(13)}ab`]],
    ]
    for (const [name, taken] of cases) {
      const id = textIdFor(name, taken)
      expect(id).toMatch(VALID)
      expect(id.length).toBeLessThanOrEqual(40)
      expect(taken).not.toContain(id)
    }
  })

  it('keeps a numbered id within 40 characters', () => {
    const base = 'a'.repeat(40)
    expect(textIdFor(base, [base])).toBe(`${'a'.repeat(38)}-2`)
    expect(textIdFor(base, [base, `${'a'.repeat(38)}-2`])).toBe(`${'a'.repeat(38)}-3`)
    const dashed = `${'ab-'.repeat(13)}abc`
    const id = textIdFor(dashed, [dashed])
    expect(id.length).toBeLessThanOrEqual(40)
    expect(id).toMatch(VALID)
  })
})
