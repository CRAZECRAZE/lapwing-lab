import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DICT_FILES, DICT_FILE_NAMES, mergeDictionaries } from '../../scripts/lib/dictionary.ts'
import type { DictFile } from '../../scripts/lib/dictionary.ts'

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
