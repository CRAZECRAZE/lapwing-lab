import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildContent } from '../../scripts/build-content.ts'
import { parseKeyChart } from '../../scripts/lib/keychart.ts'
import type { KeyChartEntry } from '../../scripts/lib/keychart.ts'
import { SLOTS } from '../../src/core/steno.ts'

const bookDir = join(import.meta.dirname, '..', '..', 'content', 'lapwing-book')
const book = (file: string): string => readFileSync(join(bookDir, 'src', file), 'utf8')
const real = { ch4: book('Chapter-04.md'), ch5: book('Chapter-05.md'), ch18: book('Chapter-18.md') }

const ROWS: Record<string, string> = {
  S: '<ins>s</ins>at <ins>s</ins>ill',
  T: '<ins>t</ins>en <ins>t</ins>ap',
  K: '<ins>k</ins>ing <ins>c</ins>ar',
  P: '<ins>p</ins>at <ins>p</ins>ull',
  W: '<ins>w</ins>in <ins>w</ins>att',
  H: '<ins>h</ins>ot <ins>h</ins>um',
  R: '<ins>r</ins>ed <ins>r</ins>an',
  '-F': 'pu<ins>ff</ins> cou<ins>gh</ins>',
  '-P': 'hi<ins>p</ins> sa<ins>p</ins>',
  '-B': 'lo<ins>b</ins> hu<ins>b</ins>',
  '-L': 'fa<ins>ll</ins> lo<ins>l</ins>',
  '-G': 'sa<ins>g</ins> tu<ins>g</ins>',
  '-T': 'righ<ins>t</ins> pi<ins>t</ins>',
  '-S': 'pa<ins>ss</ins> ha<ins>s</ins>',
  '-D': 'ta<ins>d</ins> ri<ins>d</ins>',
  '-Z': 'ja<ins>zz</ins> fi<ins>zz</ins>',
}

const vowelSection = (letter: string, ipa: string, words: string[]): string =>
  `#### *Short ${letter}*\n\nIPA: ${ipa}\n\n${words.map((w) => `* ${w}`).join('\n')}\n\n`

function chapter5(opts: { skip?: string; extra?: string[] } = {}): string {
  const rows = Object.entries(ROWS)
    .filter(([key]) => key !== opts.skip)
    .map(([key, cell]) => `| \`${key}\`${key === '-S' ? '*' : ''} | ${cell} |`)
    .concat(opts.extra ?? [])
  return [
    '# Chapter 5',
    '### Consonant keys',
    '',
    '| Steno key | Examples |',
    '|---|---|',
    ...rows,
    '',
    '### Short vowel sounds',
    '',
    vowelSection('a', '/æ/', ['<ins>c</ins>at', 'h<ins>a</ins>t']),
    vowelSection('e', '/ɛ/', ['p<ins>e</ins>t', 's<ins>e</ins>ll']),
    vowelSection('o', '/ɑ/', ['c<ins>o</ins>t', 'r<ins>o</ins>d']),
    vowelSection('u', '/ʌ/', ['c<ins>u</ins>p']),
    '## Steno order',
    '',
    'Why must "car" be written using the left `K`, and the right hand `-R`?',
    '',
    '**\\#ST<ins>K</ins>PWHR<ins>A</ins>O\\*EUF<ins>R</ins>PBLGTSDZ**',
    '',
  ].join('\n')
}

const ch4 = '# Chapter 4\n\n### The backspace key\n\nPress the asterisk key (`*`) and Plover will delete the last stroke.\n'
const ch18 = '# Chapter 18\n\n## Numbers\n\nThe number key is pressed with the left hand.\n'
const fixture = (ch5: string) => ({ ch4, ch5, ch18 })

describe('parseKeyChart on the real book', () => {
  const chart = parseKeyChart(real)
  const by = (slot: string): KeyChartEntry => chart.find((e) => e.slot === slot)!

  it('has one entry per slot, in SLOTS order', () => {
    expect(chart.map((e) => e.slot)).toEqual([...SLOTS])
    expect(chart).toHaveLength(23)
  })

  it('puts each slot in its group', () => {
    const groups = Object.fromEntries(chart.map((e) => [e.slot, e.group]))
    for (const slot of ['S-', 'T-', 'K-', 'P-', 'W-', 'H-', 'R-']) expect(groups[slot], slot).toBe('left')
    for (const slot of ['A-', 'O-', '-E', '-U']) expect(groups[slot], slot).toBe('vowel')
    for (const slot of ['-F', '-R', '-P', '-B', '-L', '-G', '-T', '-S', '-D', '-Z']) expect(groups[slot], slot).toBe('right')
    expect(groups['#']).toBe('special')
    expect(groups['*']).toBe('special')
  })

  it("gives the table's consonants their example words", () => {
    expect(by('K-').examples).toEqual(['king', 'car'])
    expect(by('-F').examples).toEqual(['puff', 'cough'])
    expect(by('-S').examples).toEqual(['pass', 'has'])
    expect(by('W-').examples).toEqual(['win', 'watt'])
    expect(by('-S').source).toBe('Consonant keys')
  })

  it('derives the sounds from the underlined letters, once each', () => {
    expect(by('K-').sounds).toEqual(['k', 'c'])
    expect(by('-F').sounds).toEqual(['ff', 'gh'])
    expect(by('-S').sounds).toEqual(['ss', 's'])
    expect(by('-Z').sounds).toEqual(['zz'])
    expect(by('S-').sounds).toEqual(['s'])
  })

  it('takes the short vowels from their sections', () => {
    expect(by('A-')).toMatchObject({ sounds: ['/æ/'], examples: ['cat', 'hat'], source: 'Short a' })
    expect(by('-E')).toMatchObject({ sounds: ['/ɛ/'], examples: ['pet', 'sell'], source: 'Short e' })
    expect(by('O-')).toMatchObject({ sounds: ['/ɑ/'], examples: ['cot', 'rod'], source: 'Short o' })
    expect(by('-U')).toMatchObject({ sounds: ['/ʌ/', '/ʊ/'], examples: ['cup', 'hut', 'could', 'pull'], source: 'Short u' })
  })

  it('takes the right-hand R from the steno order text', () => {
    expect(by('-R')).toMatchObject({ sounds: ['r'], examples: ['car'], source: 'Steno order' })
  })

  it('describes # and * from the book, with no examples', () => {
    expect(by('*').sounds[0]).toContain('asterisk')
    expect(by('*').examples).toEqual([])
    expect(by('*').source).toBe('The backspace key')
    expect(by('#').sounds[0]).toContain('number key')
    expect(by('#').examples).toEqual([])
    expect(by('#').source).toBe('Numbers')
  })

  it('has something from the book on every entry', () => {
    for (const entry of chart) expect(entry.sounds.length + entry.examples.length, entry.slot).toBeGreaterThan(0)
  })
})

describe('every source is a heading in the built page JSON', () => {
  let work: string
  let outDir: string
  beforeAll(async () => {
    work = mkdtempSync(join(tmpdir(), 'keychart-'))
    outDir = join(work, 'out')
    await buildContent({ bookDir, outDir })
  })
  afterAll(() => rmSync(work, { recursive: true, force: true }))

  const titles = (page: string): string[] =>
    JSON.parse(readFileSync(join(outDir, 'pages', `${page}.json`), 'utf8')).headings.map((h: { title: string }) => h.title)

  it('checks each entry against the chapter it was read from', () => {
    const chart = parseKeyChart(real)
    const chapterOf = (slot: string): string => (slot === '*' ? 'ch04' : slot === '#' ? 'ch18' : 'ch05')
    for (const entry of chart) expect(titles(chapterOf(entry.slot)), entry.slot).toContain(entry.source)
  })
})

describe('parseKeyChart on fixtures', () => {
  it('accepts the complete fixture', () => {
    expect(parseKeyChart(fixture(chapter5()))).toHaveLength(23)
  })

  it('throws naming the slot when the table lacks a consonant row', () => {
    expect(() => parseKeyChart(fixture(chapter5({ skip: '-G' })))).toThrow(/-G/)
    expect(() => parseKeyChart(fixture(chapter5({ skip: 'W' })))).toThrow(/W-/)
  })

  it('throws naming the slot when a slot appears twice', () => {
    expect(() => parseKeyChart(fixture(chapter5({ extra: ['| `K` | <ins>k</ins>ey |'] })))).toThrow(/duplicate.*K-/)
  })

  it('throws when a key in the table is not a slot', () => {
    expect(() => parseKeyChart(fixture(chapter5({ extra: ['| `X` | <ins>x</ins>ray |'] })))).toThrow(/X/)
  })

  it('keeps only the first six examples of a vowel', () => {
    const many = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight']
    const ch5 = chapter5().replace('* <ins>c</ins>at\n* h<ins>a</ins>t', many.map((w) => `* ${w}`).join('\n'))
    const a = parseKeyChart(fixture(ch5)).find((e) => e.slot === 'A-')!
    expect(a.examples).toEqual(many.slice(0, 6))
  })

  it('throws naming the slot when a vowel section is missing', () => {
    const ch5 = chapter5().replace('#### *Short o*', '#### *Short other*')
    expect(() => parseKeyChart(fixture(ch5))).toThrow(/O-/)
  })
})
