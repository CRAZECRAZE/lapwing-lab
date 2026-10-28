import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DICT_FILES, DICT_FILE_NAMES, buildDictionary, mergeDictionaries } from '../../scripts/lib/dictionary.ts'
import type { DictFile } from '../../scripts/lib/dictionary.ts'
import type { LookupList } from '../../scripts/lib/lookup.ts'

const empty = (): Record<DictFile, Record<string, string>> => ({
  main: {}, uk: {}, names: {}, numbers: {}, commands: {}, movement: {},
})

describe('mergeDictionaries', () => {
  it('lists the six files with their upstream names', () => {
    expect(DICT_FILES).toEqual(['main', 'uk', 'names', 'numbers', 'commands', 'movement'])
    expect(DICT_FILE_NAMES).toEqual({
      main: 'lapwing-base.json',
      uk: 'lapwing-uk-additions.json',
      names: 'lapwing-proper-nouns.json',
      numbers: 'lapwing-numbers.json',
      commands: 'lapwing-commands.json',
      movement: 'lapwing-semi-modal-movement.json',
    })
  })

  it('collapses a pair held by several files into one outline with the files in DICT_FILES order', () => {
    const files = empty()
    // inserted out of order on purpose: the file list must follow DICT_FILES, not insertion
    files.movement = { KAT: 'cat' }
    files.uk = { KAT: 'cat' }
    files.main = { KAT: 'cat' }
    const merged = mergeDictionaries(files)
    expect([...merged.keys()]).toEqual(['cat'])
    expect([...merged.get('cat')!]).toEqual([['KAT', ['main', 'uk', 'movement']]])
  })

  it('keeps one file in the list for a pair held by one file', () => {
    const files = empty()
    files.names = { PAUL: 'Paul' }
    expect(mergeDictionaries(files).get('Paul')!.get('PAUL')).toEqual(['names'])
  })

  it('keeps the same outline under two translations as two entries', () => {
    const files = empty()
    files.main = { TKEFS: 'defense' }
    files.uk = { TKEFS: 'defence' }
    const merged = mergeDictionaries(files)
    expect(merged.get('defense')!.get('TKEFS')).toEqual(['main'])
    expect(merged.get('defence')!.get('TKEFS')).toEqual(['uk'])
  })

  it('collects every outline of a translation', () => {
    const files = empty()
    files.main = { 'ES/PERB/HREU': 'especially', EPS: 'especially' }
    files.uk = { 'ES/PERBL/KWREU': 'especially' }
    const outlines = mergeDictionaries(files).get('especially')!
    expect([...outlines.keys()].sort()).toEqual(['EPS', 'ES/PERB/HREU', 'ES/PERBL/KWREU'])
  })

  it('is case-sensitive: translations are exact strings', () => {
    const files = empty()
    files.main = { KAT: 'cat', KAT2: 'Cat' }
    expect([...mergeDictionaries(files).keys()]).toEqual(['cat', 'Cat'])
  })

  it('iterates in DICT_FILES order, then in each file key order', () => {
    // the object's own key order is reversed: the result must still follow DICT_FILES
    const files = {
      movement: {}, commands: {}, numbers: {},
      names: { E: 'e' },
      uk: { B: 'b', A: 'a' },
      main: { D: 'd', C: 'c' },
    } as Record<DictFile, Record<string, string>>
    const merged = mergeDictionaries(files)
    expect([...merged.keys()]).toEqual(['d', 'c', 'b', 'a', 'e'])
  })

  it('orders the outlines of a translation by first appearance in that order', () => {
    const files = empty()
    files.uk = { Y: 'w' }
    files.main = { Z: 'w', X: 'w' }
    expect([...mergeDictionaries(files).get('w')!.keys()]).toEqual(['Z', 'X', 'Y'])
  })

  it('does not change its input', () => {
    const files = empty()
    files.main = { KAT: 'cat' }
    files.uk = { KAT: 'cat' }
    const before = JSON.stringify(files)
    mergeDictionaries(files)
    expect(JSON.stringify(files)).toBe(before)
  })

  it('merges empty files into an empty map', () => {
    expect(mergeDictionaries(empty()).size).toBe(0)
  })
})

describe('the vendored dictionary, merged', () => {
  const dir = join(import.meta.dirname, '..', '..', 'content', 'lapwing-dictionary')
  const files = Object.fromEntries(
    DICT_FILES.map((f) => [f, JSON.parse(readFileSync(join(dir, DICT_FILE_NAMES[f]), 'utf8')) as Record<string, string>]),
  ) as Record<DictFile, Record<string, string>>
  const merged = mergeDictionaries(files)
  const outlinesOf = (t: string): string[] => [...(merged.get(t)?.keys() ?? [])].sort()

  it('holds between 55,000 and 62,000 translations', () => {
    expect(merged.size).toBeGreaterThan(55000)
    expect(merged.size).toBeLessThan(62000)
  })

  it('has the known outlines of common words', () => {
    expect(outlinesOf('the')).toEqual(['-T'])
    expect(outlinesOf('cat')).toEqual(['KAT'])
    expect(outlinesOf('especially')).toEqual(['EPS', 'ES/PERB/HREU', 'ES/PERBL/KWREU'].sort())
    expect(outlinesOf('mistake')).toHaveLength(2)
  })

  it('keeps the US and UK spellings as separate translations', () => {
    expect(merged.has('defense')).toBe(true)
    expect(merged.has('defence')).toBe(true)
  })
})

const input = (over: Partial<Parameters<typeof buildDictionary>[0]> = {}): Parameters<typeof buildDictionary>[0] => ({
  files: empty(), lists: [], briefs: [], examples: [], commit: 'abc', ...over,
})
const list = (id: string, chapter: number, items: [string, string[]][]): LookupList => ({
  id, chapter, items: items.map(([prompt, outlines]) => ({ prompt, outlines })),
})
const cardOf = (file: ReturnType<typeof buildDictionary>, t: string) => file.cards.find((c) => c.t === t)

describe('buildDictionary', () => {
  it('passes the commit through', () => {
    expect(buildDictionary(input({ commit: 'deadbeef' })).commit).toBe('deadbeef')
  })

  it('labels the row a practice item names and no other row', () => {
    const files = empty()
    files.main = { KAT: 'cat', KA: 'cat', KAET: 'cat' }
    const out = buildDictionary(input({ files, lists: [list('l', 5, [['cat', ['KAT']]])] }))
    expect(cardOf(out, 'cat')!.r).toEqual([
      { o: 'KA' },
      { o: 'KAT', b: [{ chapter: 5, source: 'practice' }] },
      { o: 'KAET' },
    ])
  })

  it('gives two labels, practice then example, for the same outline and chapter', () => {
    const files = empty()
    files.main = { KAT: 'cat' }
    const out = buildDictionary(input({
      files,
      examples: [{ chapter: 5, word: 'cat', outlines: ['KAT'] }],
      lists: [list('l', 5, [['cat', ['KAT']]])],
    }))
    expect(cardOf(out, 'cat')!.r[0].b).toEqual([
      { chapter: 5, source: 'practice' },
      { chapter: 5, source: 'example' },
    ])
  })

  it('orders labels by chapter, then practice, brief, example, whatever order they arrive in', () => {
    const files = empty()
    files.main = { KAT: 'cat' }
    const out = buildDictionary(input({
      files,
      examples: [{ chapter: 2, word: 'cat', outlines: ['KAT'] }],
      briefs: [{ chapter: 2, kind: 'chapter', translation: 'cat', outlines: ['KAT'], explanation: '' }],
      lists: [list('late', 9, [['cat', ['KAT']]]), list('early', 2, [['cat', ['KAT']]])],
    }))
    expect(cardOf(out, 'cat')!.r[0].b).toEqual([
      { chapter: 2, source: 'practice' },
      { chapter: 2, source: 'brief' },
      { chapter: 2, source: 'example' },
      { chapter: 9, source: 'practice' },
    ])
  })

  it('repeats a (chapter, source) once', () => {
    const files = empty()
    files.main = { KAT: 'cat' }
    const out = buildDictionary(input({
      files,
      lists: [list('a', 5, [['cat', ['KAT']]]), list('b', 5, [['cat', ['KAT']]])],
    }))
    expect(cardOf(out, 'cat')!.r[0].b).toEqual([{ chapter: 5, source: 'practice' }])
  })

  it('matches the book text to the card ignoring case and surrounding spaces', () => {
    const files = empty()
    files.main = { KAT: 'cat' }
    const out = buildDictionary(input({ files, lists: [list('l', 5, [['  Cat ', ['KAT']]])] }))
    expect(out.cards.map((c) => c.t)).toEqual(['cat'])
    expect(cardOf(out, 'cat')!.r).toEqual([{ o: 'KAT', b: [{ chapter: 5, source: 'practice' }] }])
  })

  it('labels each case-variant card that has the outline', () => {
    const files = empty()
    files.main = { TKEFS: 'defense' }
    files.uk = { TKEFS: 'Defense' }
    const out = buildDictionary(input({ files, lists: [list('l', 3, [['defense', ['TKEFS']]])] }))
    const label = [{ chapter: 3, source: 'practice' }]
    expect(cardOf(out, 'defense')!.r[0].b).toEqual(label)
    expect(cardOf(out, 'Defense')!.r[0].b).toEqual(label)
  })

  it('adds no book-only row when a case-variant card already has the outline', () => {
    const files = empty()
    files.main = { KAT: 'Cat', KA: 'cat' }
    const out = buildDictionary(input({ files, lists: [list('l', 5, [['cat', ['KAT']]])] }))
    expect(out.cards).toEqual([
      { t: 'Cat', r: [{ o: 'KAT', b: [{ chapter: 5, source: 'practice' }] }] },
      { t: 'cat', r: [{ o: 'KA' }] },
    ])
  })

  it('never labels by outline alone', () => {
    const files = empty()
    files.main = { KAT: 'cat', KITN: 'kitten' }
    const out = buildDictionary(input({ files, lists: [list('l', 5, [['kitten', ['KAT']]])] }))
    expect(cardOf(out, 'cat')!.r).toEqual([{ o: 'KAT' }])
    expect(cardOf(out, 'kitten')!.r).toEqual([
      { o: 'KAT', x: true, b: [{ chapter: 5, source: 'practice' }] },
      { o: 'KITN' },
    ])
  })

  it('adds a book-only row in outline order, marked x, with its label', () => {
    const files = empty()
    files.main = { KAT: 'cat', 'KAT/KAT': 'cat', KA: 'cat' }
    const out = buildDictionary(input({
      files,
      examples: [{ chapter: 6, word: 'cat', outlines: ['KAET'] }],
    }))
    expect(cardOf(out, 'cat')!.r).toEqual([
      { o: 'KA' },
      { o: 'KAT' },
      { o: 'KAET', x: true, b: [{ chapter: 6, source: 'example' }] },
      { o: 'KAT/KAT' },
    ])
  })

  it('puts a book-only row on the card whose text is the exact entry text', () => {
    const files = empty()
    files.main = { TKEFS: 'defense' }
    files.uk = { TKEFS: 'Defense', TKEF: 'Defense' }
    const lower = buildDictionary(input({ files, lists: [list('l', 3, [['defense', ['TKAOEFS']]])] }))
    expect(cardOf(lower, 'defense')!.r.map((r) => r.o)).toEqual(['TKEFS', 'TKAOEFS'])
    expect(cardOf(lower, 'Defense')!.r.map((r) => r.o)).toEqual(['TKEF', 'TKEFS'])
    const upper = buildDictionary(input({ files, lists: [list('l', 3, [['Defense', ['TKAOEFS']]])] }))
    expect(cardOf(upper, 'defense')!.r.map((r) => r.o)).toEqual(['TKEFS'])
    expect(cardOf(upper, 'Defense')!.r.map((r) => r.o)).toEqual(['TKEF', 'TKEFS', 'TKAOEFS'])
  })

  it('puts a book-only row on the first matching card when no card has the exact text', () => {
    const files = empty()
    files.main = { TKEFS: 'defense' }
    files.uk = { TKEFS: 'Defense' }
    // cards sort 'Defense' before 'defense' (plain code-unit order), so the first matching card is 'Defense'
    const out = buildDictionary(input({ files, lists: [list('l', 3, [['DEFENSE', ['TKAOEFS']]])] }))
    expect(cardOf(out, 'Defense')!.r.map((r) => r.o)).toEqual(['TKEFS', 'TKAOEFS'])
    expect(cardOf(out, 'defense')!.r.map((r) => r.o)).toEqual(['TKEFS'])
  })

  it('merges entries with the same missing outline on the same card into one row', () => {
    const files = empty()
    files.main = { KAT: 'cat' }
    const out = buildDictionary(input({
      files,
      lists: [list('l', 5, [['cat', ['KAET']]])],
      examples: [{ chapter: 5, word: 'cat', outlines: ['KAET'] }],
    }))
    expect(cardOf(out, 'cat')!.r).toEqual([
      { o: 'KAT' },
      { o: 'KAET', x: true, b: [{ chapter: 5, source: 'practice' }, { chapter: 5, source: 'example' }] },
    ])
  })

  it('makes a named card for a text no card matches, with the dictionary translations of its outline', () => {
    const files = empty()
    files.main = { 'R-R': '{#Return}', KAT: 'cat' }
    files.commands = { 'R-R': '{#Enter}' }
    const out = buildDictionary(input({
      files,
      lists: [list('20-commands', 20, [['Enter or Return', ['R-R']]])],
    }))
    expect(cardOf(out, 'Enter or Return')).toEqual({
      t: 'Enter or Return',
      n: true,
      r: [{ o: 'R-R', b: [{ chapter: 20, source: 'practice' }], w: ['{#Enter}', '{#Return}'] }],
    })
  })

  it('lists no translations as an empty w on a named card', () => {
    const out = buildDictionary(input({ lists: [list('l', 20, [['Comma (,)', ['KW-BG']]])] }))
    expect(cardOf(out, 'Comma (,)')).toEqual({
      t: 'Comma (,)', n: true, r: [{ o: 'KW-BG', b: [{ chapter: 20, source: 'practice' }], w: [] }],
    })
  })

  it('merges named texts by trimmed lower case, keeps the first display form and orders its rows', () => {
    const out = buildDictionary(input({
      lists: [list('l', 20, [['Enter or Return', ['R-R/R-R']], [' enter or return ', ['R-R']]])],
      briefs: [{ chapter: 21, kind: 'extra', translation: 'ENTER OR RETURN', outlines: ['R-R'], explanation: '' }],
    }))
    expect(out.cards).toHaveLength(1)
    expect(out.cards[0].t).toBe('Enter or Return')
    expect(out.cards[0].r).toEqual([
      { o: 'R-R', b: [{ chapter: 20, source: 'practice' }, { chapter: 21, source: 'brief' }], w: [] },
      { o: 'R-R/R-R', b: [{ chapter: 20, source: 'practice' }], w: [] },
    ])
  })

  it('skips book entries with empty text or an empty outline', () => {
    const files = empty()
    files.main = { KAT: 'cat' }
    const out = buildDictionary(input({
      files,
      lists: [list('l', 5, [['', ['KAT']], ['   ', ['KAT']], ['cat', ['']]])],
    }))
    expect(out.cards).toEqual([{ t: 'cat', r: [{ o: 'KAT' }] }])
  })

  it('lists the other files that hold a pair, and nothing when only main does', () => {
    const files = empty()
    files.main = { KAT: 'cat', KA: 'cat', KAET: 'cat' }
    files.uk = { KAT: 'cat', 'KAT/KAT': 'cat' }
    files.names = { KAET: 'cat' }
    files.movement = { KAET: 'cat' }
    const out = buildDictionary(input({ files }))
    expect(cardOf(out, 'cat')!.r).toEqual([
      { o: 'KA' },
      { o: 'KAT', f: ['uk'] },
      { o: 'KAET', f: ['names', 'movement'] },
      { o: 'KAT/KAT', f: ['uk'] },
    ])
  })

  it('carries a brief note on its label, the first non-empty one for a repeated label', () => {
    const files = empty()
    files.main = { KAT: 'cat' }
    const brief = (explanation: string) => ({ chapter: 4, kind: 'chapter' as const, translation: 'cat', outlines: ['KAT'], explanation })
    const out = buildDictionary(input({
      files,
      briefs: [brief(''), brief('first note'), brief('second note')],
    }))
    expect(cardOf(out, 'cat')!.r[0].b).toEqual([{ chapter: 4, source: 'brief', note: 'first note' }])
  })

  it('carries the note of a brief row straight onto its label', () => {
    const files = empty()
    files.main = { KAT: 'cat' }
    const out = buildDictionary(input({
      files,
      briefs: [{ chapter: 4, kind: 'chapter', translation: 'cat', outlines: ['KAT'], explanation: 'a pet' }],
    }))
    expect(cardOf(out, 'cat')!.r[0].b).toEqual([{ chapter: 4, source: 'brief', note: 'a pet' }])
  })

  it('leaves out the note on a label with no note', () => {
    const files = empty()
    files.main = { KAT: 'cat' }
    const out = buildDictionary(input({
      files,
      briefs: [{ chapter: 4, kind: 'chapter', translation: 'cat', outlines: ['KAT'], explanation: '' }],
    }))
    expect(cardOf(out, 'cat')!.r[0].b![0]).toEqual({ chapter: 4, source: 'brief' })
    expect('note' in cardOf(out, 'cat')!.r[0].b![0]).toBe(false)
  })

  it('sorts cards by lower-cased text, then exact text, and builds the same file twice', () => {
    const files = empty()
    files.main = { A1: 'b', A2: 'B', A3: 'a', A4: 'C', A5: 'a b' }
    const args = input({ files, lists: [list('l', 1, [['zed', ['Z']], ['b', ['A1']]])] })
    const one = buildDictionary(args)
    const two = buildDictionary(args)
    expect(JSON.stringify(one)).toBe(JSON.stringify(two))
    expect(one.cards.map((c) => c.t)).toEqual(['a', 'a b', 'B', 'b', 'C', 'zed'])
  })

  it('does not change its input', () => {
    const files = empty()
    files.main = { KAT: 'cat' }
    const args = input({ files, lists: [list('l', 1, [['cat', ['KAET']]])] })
    const before = JSON.stringify(args)
    buildDictionary(args)
    expect(JSON.stringify(args)).toBe(before)
  })

  it('maps each letter to its outline from the 18-lowercase list', () => {
    const out = buildDictionary(input({
      lists: [
        list('18-uppercase', 18, [['A', ['KPA/A*']]]),
        list('18-lowercase', 18, [['a', ['A*']], ['b', ['PW*', 'PW']]]),
      ],
    }))
    expect(out.letters).toEqual({ a: 'A*', b: 'PW*' })
  })

  it('has no letters without the 18-lowercase list', () => {
    expect(buildDictionary(input({ lists: [list('18-uppercase', 18, [['A', ['KPA/A*']]])] })).letters).toEqual({})
  })
})

describe('buildDictionary on the vendored files', () => {
  const dir = join(import.meta.dirname, '..', '..', 'content', 'lapwing-dictionary')
  const files = Object.fromEntries(
    DICT_FILES.map((f) => [f, JSON.parse(readFileSync(join(dir, DICT_FILE_NAMES[f]), 'utf8')) as Record<string, string>]),
  ) as Record<DictFile, Record<string, string>>
  const out = buildDictionary({ files, lists: [], briefs: [], examples: [], commit: 'x' })

  it('writes especially as EPS, ES/PERB/HREU, ES/PERBL/KWREU with no labels', () => {
    const rows = cardOf(out, 'especially')!.r
    expect(rows.map((r) => r.o)).toEqual(['EPS', 'ES/PERB/HREU', 'ES/PERBL/KWREU'])
    expect(rows.every((r) => !('b' in r))).toBe(true)
  })

  it('has 55,000 to 62,000 cards, sorted, none without outlines', () => {
    expect(out.cards.length).toBeGreaterThan(55000)
    expect(out.cards.length).toBeLessThan(62000)
    const lower = out.cards.map((c) => c.t.toLowerCase())
    for (let i = 1; i < out.cards.length; i++) {
      const a = out.cards[i - 1]
      const b = out.cards[i]
      const [la, lb] = [lower[i - 1], lower[i]]
      expect(la < lb || (la === lb && a.t < b.t)).toBe(true)
    }
    expect(out.cards.every((c) => c.r.length > 0)).toBe(true)
  })
})
