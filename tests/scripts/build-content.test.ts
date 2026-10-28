import { mkdirSync, mkdtempSync, readFileSync, readdirSync, existsSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildContent, gateFor, practiceChapter } from '../../scripts/build-content.ts'
import { parseOutline, SLOTS } from '../../src/core/steno.ts'
import type { LookupEntry } from '../../scripts/lib/lookup.ts'
import { DICT_FILE_NAMES, DICT_FILES } from '../../scripts/lib/dictionary.ts'
import type { DictCard, DictionaryFile } from '../../scripts/lib/dictionary.ts'
import type { BuildStats, ChapterInfo, PracticeIndexEntry } from '../../scripts/build-content.ts'

const bookDir = join(import.meta.dirname, '..', '..', 'content', 'lapwing-book')
const dictionaryDir = join(import.meta.dirname, '..', '..', 'content', 'lapwing-dictionary')
const PINNED = '46b53e1ebec3b19fb402da046d6dc0a13b530787'

let work: string
let outDir: string
let stats: BuildStats

function readJson(...parts: string[]): any {
  return JSON.parse(readFileSync(join(outDir, ...parts), 'utf8'))
}

beforeAll(async () => {
  work = mkdtempSync(join(tmpdir(), 'build-content-'))
  outDir = join(work, 'out')
  stats = await buildContent({ bookDir, outDir, dictionaryDir })
})

afterAll(() => {
  rmSync(work, { recursive: true, force: true })
})

describe('buildContent on the vendored book', () => {
  it('reports the expected totals', () => {
    expect(stats.pages).toBe(33)
    expect(stats.practiceLists).toBe(57)
    expect(stats.generatedLists).toBe(6)
    expect(stats.practiceLines).toBe(7299)
    expect(stats.outlineTags).toBe(154)
    expect(stats.briefRows).toBe(readJson('briefs.json').length)
  })

  it('writes book.json with the pinned commit and pages in SUMMARY order', () => {
    const book = readJson('book.json')
    expect(book.commit).toBe(PINNED)
    expect(book.pages).toHaveLength(33)
    expect(book.pages[0]).toEqual({ id: 'home', title: 'Home', kind: 'home', file: 'Home.md' })
    expect(book.pages[5]).toEqual({
      id: 'ch05',
      title: 'Chapter 5: Lapwing setup and basics',
      kind: 'chapter',
      number: 5,
      file: 'Chapter-05.md',
    })
    expect(book.pages.map((p: { id: string }) => p.id).slice(-6)).toEqual(['appA', 'appB', 'appC', 'appD', 'glossary', 'changes'])
    expect(book.pages.find((p: { id: string }) => p.id === 'appB').kind).toBe('appendix')
  })

  it('writes a page file per page with pass marks where the chapter has one', () => {
    expect(readJson('pages', 'ch05.json').passMark).toEqual({ accuracy: 0.9, minWpm: 10, maxWpm: 20 })
    expect(readJson('pages', 'ch07.json').passMark.minWpm).toBe(5)
    expect(readJson('pages', 'ch04.json').passMark.maxMinutes).toBe(10)
    for (const id of ['ch12', 'ch14', 'ch17']) expect(readJson('pages', `${id}.json`)).not.toHaveProperty('passMark')
    const ch05 = readJson('pages', 'ch05.json')
    expect(ch05.id).toBe('ch05')
    expect(ch05.title).toBe('Chapter 5: Lapwing setup and basics')
    expect(ch05.practiceLinks.length).toBeGreaterThan(0)
  })

  it('rewrites image links to /media/ and wraps strokes', () => {
    const ch18 = readJson('pages', 'ch18.json')
    expect(ch18.html).toContain('href="/media/18-numbers.png"')
    expect(ch18.html).not.toContain('href="img/')
    expect(ch18.html).toContain('data-stroke=')
  })

  it('writes practice lists, briefs, sentences and stage 0 words', () => {
    expect(existsSync(join(outDir, 'practice', '5-cvc.json'))).toBe(true)
    const list = readJson('practice', '5-cvc.json')
    expect(list.id).toBe('5-cvc')
    expect(list.items[0]).toHaveProperty('outlines')
    const briefs = readJson('briefs.json')
    expect(briefs.length).toBeGreaterThan(0)
    expect(new Set(briefs.map((b: { chapter: number }) => b.chapter))).toEqual(new Set([5, 6, 7, 8, 9, 10, 11, 12]))
    expect(readJson('sentences.json').length).toBeGreaterThan(0)
    expect(readJson('stage0.json').test).toHaveLength(100)
  })
})

describe('keychart.json', () => {
  it('is written with one entry per slot', () => {
    const chart = readJson('keychart.json')
    expect(chart).toHaveLength(23)
    expect(chart.map((e: { slot: string }) => e.slot)).toEqual([...SLOTS])
  })
})

describe('lookup.json', () => {
  const lookup = (): LookupEntry[] => readJson('lookup.json')
  const entry = (word: string): LookupEntry => {
    const found = lookup().find((e) => e.word === word)
    expect(found, `entry ${word}`).toBeDefined()
    return found!
  }

  it('exists and matches the stats', () => {
    expect(existsSync(join(outDir, 'lookup.json'))).toBe(true)
    expect(lookup().length).toBeGreaterThan(1000)
    expect(stats.lookupEntries).toBe(lookup().length)
  })

  it('stays under 5 MB', () => {
    expect(statSync(join(outDir, 'lookup.json')).size).toBeLessThan(5 * 1024 * 1024)
  })

  it('has a practice hit for cat in chapter 5', () => {
    expect(entry('cat').hits).toContainEqual({ outline: 'KAT', chapter: 5, source: 'practice' })
  })

  it('has brief hits for are with the explanation as note', () => {
    const briefs = readJson('briefs.json')
    const explanation = briefs.find((b: { translation: string }) => b.translation === 'are').explanation
    expect(explanation).not.toBe('')
    const hits = entry('are').hits.filter((h) => h.source === 'brief' && h.chapter === 5)
    expect(hits.map((h) => h.outline).sort()).toEqual(['-R', 'R'])
    for (const hit of hits) expect(hit.note).toBe(explanation)
  })

  it('has example hits for dad and centre', () => {
    expect(entry('dad').hits).toContainEqual({ outline: 'TKAD', chapter: expect.any(Number), source: 'example' })
    expect(entry('centre').hits).toContainEqual({ outline: 'SEPB/TER/#TPH', chapter: 21, source: 'example' })
  })

  it('has chapter 13 example hits for the prefix words, such as around, mistake and subway', () => {
    expect(entry('around').hits).toContainEqual({ outline: 'A/ROUPBD', chapter: 13, source: 'example' })
    expect(entry('mistake').hits).toContainEqual({ outline: 'PHEUS/TAEUBG', chapter: 13, source: 'example' })
    expect(entry('subway').hits).toContainEqual({ outline: 'SUB/WAEU', chapter: 13, source: 'example' })
  })

  it('has hits from both practice lists and brief tables for a word in both, such as do', () => {
    const sources = new Set(entry('do').hits.map((h) => h.source))
    expect(sources.has('practice')).toBe(true)
    expect(sources.has('brief')).toBe(true)
  })

  it('has parseable outlines, no empty words, and sorted entries with hits', () => {
    const entries = lookup()
    for (const e of entries) {
      expect(e.word.trim()).not.toBe('')
      expect(e.word).not.toMatch(/[\r\n]/)
      expect(e.hits.length).toBeGreaterThan(0)
      for (const hit of e.hits) {
        expect(() => parseOutline(hit.outline), `${e.word} ${hit.outline}`).not.toThrow()
        expect(hit.chapter).toBeGreaterThanOrEqual(1)
        expect(hit.chapter).toBeLessThanOrEqual(26)
      }
    }
    const keys = entries.map((e) => e.word.toLowerCase())
    expect(new Set(keys).size).toBe(keys.length)
    expect(keys).toEqual([...keys].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)))
  })

  it('leaves the generated drills out of the practice hits', () => {
    // The book's own lists cover chapters 5 to 17; the drills generated for chapters 18, 20 and 21 are not practice hits.
    const practice = lookup().flatMap((e) => e.hits.filter((h) => h.source === 'practice'))
    expect(practice.every((h) => h.chapter <= 17)).toBe(true)
  })
})

describe('dictionary.json on the vendored book', () => {
  const dictionary = (): DictionaryFile => readJson('dictionary.json')
  const card = (text: string): DictCard => {
    const found = dictionary().cards.find((c) => c.t === text)
    expect(found, `card ${text}`).toBeDefined()
    return found!
  }
  const row = (text: string, outline: string) => {
    const found = card(text).r.find((r) => r.o === outline)
    expect(found, `row ${text} ${outline}`).toBeDefined()
    return found!
  }

  it('is written with the pinned dictionary commit and matches the stats', () => {
    const file = dictionary()
    expect(file.commit).toBe(readFileSync(join(dictionaryDir, 'PINNED_COMMIT'), 'utf8').trim())
    expect(stats.dictionaryCards).toBe(file.cards.length)
    expect(stats.dictionaryBytes).toBe(statSync(join(outDir, 'dictionary.json')).size)
    expect(file.letters.a).toBe('A*')
  })

  it('stays under 8 MB and holds between 55,000 and 62,000 cards', () => {
    expect(statSync(join(outDir, 'dictionary.json')).size).toBeLessThan(8 * 1024 * 1024)
    expect(dictionary().cards.length).toBeGreaterThan(55000)
    expect(dictionary().cards.length).toBeLessThan(62000)
  })

  it('labels the chapter 13 example outlines of around, mistake and subway', () => {
    expect(card('around').r.map((r) => r.o)).toEqual(expect.arrayContaining(['A/ROUPBD', 'ARPBD']))
    expect(row('around', 'A/ROUPBD').b).toContainEqual({ chapter: 13, source: 'example' })
    expect(card('mistake').r.map((r) => r.o)).toEqual(expect.arrayContaining(['SPHAEUBG', 'PHEUS/TAEUBG']))
    expect(row('mistake', 'PHEUS/TAEUBG').b).toContainEqual({ chapter: 13, source: 'example' })
    expect(row('mistake', 'SPHAEUBG').b ?? []).not.toContainEqual({ chapter: 13, source: 'example' })
    expect(row('subway', 'SUB/WAEU').b).toContainEqual({ chapter: 13, source: 'example' })
    expect(row('subway', 'SUB/WA*EU').b).toBeUndefined()
  })

  it('labels the lowercase a of Chapter 18 as a practice item', () => {
    expect(row('a', 'A*').b).toContainEqual({ chapter: 18, source: 'practice' })
  })

  it('keeps the Chapter 20 Enter command as a book-only row on the enter card', () => {
    // The book calls the command "Enter", which is a word the dictionary has, so R-R (the dictionary writes it as
    // "{^~|\n^}") lands as an x row on the `enter` card instead of a card of its own.
    const enter = card('enter')
    expect(enter.n).toBeUndefined()
    expect(row('enter', 'R-R')).toEqual({ o: 'R-R', b: [{ chapter: 20, source: 'practice' }], x: true })
    expect(dictionary().cards.some((c) => c.t === 'Enter')).toBe(false)
  })

  it('holds a command the dictionary has no word for as a named card whose rows carry the dictionary words', () => {
    // "Enter (capitalize next word)" is the book's own heading text; R*R is written "{^\n}{^}{-|}" in lapwing-commands.json.
    expect(card('Enter (capitalize next word)')).toEqual({
      t: 'Enter (capitalize next word)',
      n: true,
      r: [{ o: 'R*R', b: [{ chapter: 20, source: 'practice' }], w: ['{^\n}{^}{-|}'] }],
    })
  })
})

describe('practice-index.json', () => {
  it('lists every practice list with chapter 5 to 21, sorted by chapter then id', () => {
    const index: PracticeIndexEntry[] = readJson('practice-index.json')
    expect(index).toHaveLength(63)
    for (const entry of index) {
      expect(Object.keys(entry).sort()).toEqual(['chapter', 'id', 'items'])
      expect(entry.chapter).toBeGreaterThanOrEqual(5)
      expect(entry.chapter).toBeLessThanOrEqual(21)
    }
    const sorted = [...index].sort((a, b) => a.chapter - b.chapter || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    expect(index).toEqual(sorted)
    const chapters = index.map((e) => e.chapter)
    expect(chapters.indexOf(10)).toBeGreaterThan(chapters.lastIndexOf(9))
  })

  it('adds the generated lists after the book lists of their chapter', () => {
    const index: PracticeIndexEntry[] = readJson('practice-index.json')
    expect(index.filter((e) => e.chapter >= 18).map((e) => e.id)).toEqual([
      '18-lowercase',
      '18-numbers',
      '18-uppercase',
      '20-commands',
      '20-punctuation',
      '21-uk-spellings',
    ])
    for (const e of index.filter((x) => x.chapter >= 18)) {
      expect(readJson('practice', `${e.id}.json`)).toMatchObject({ id: e.id })
      expect(readJson('practice', `${e.id}.json`).items).toHaveLength(e.items)
      expect(Object.keys(readJson('practice', `${e.id}.json`)).sort()).toEqual(['id', 'items'])
    }
    expect(readJson('practice', '18-lowercase.json').items[0]).toEqual({ prompt: 'a', outlines: ['A*'] })
    expect(readdirSync(join(outDir, 'practice'))).toHaveLength(63)
  })

  it('counts the items of each list', () => {
    const index: PracticeIndexEntry[] = readJson('practice-index.json')
    const entry = index.find((e) => e.id === '5-basic-left-hand')
    expect(entry).toBeDefined()
    expect(entry!.chapter).toBe(5)
    expect(entry!.items).toBe(readJson('practice', '5-basic-left-hand.json').items.length)
    expect(entry!.items).toBeGreaterThan(0)
  })
})

describe('chapters.json', () => {
  const chapters = (): ChapterInfo[] => readJson('chapters.json')
  const chapter = (n: number): ChapterInfo => chapters().find((c) => c.chapter === n)!

  it('has one entry per chapter page, ascending 1 to 26', () => {
    expect(chapters().map((c) => c.chapter)).toEqual(Array.from({ length: 26 }, (_, i) => i + 1))
    expect(chapter(5).pageId).toBe('ch05')
    expect(chapter(5).title).toBe('Chapter 5: Lapwing setup and basics')
  })

  it('gates chapter 4 as stage 0 with its time-limited pass mark and no lists', () => {
    const ch4 = chapter(4)
    expect(ch4.gate).toBe('stage0')
    expect(ch4.passMark).toEqual({ accuracy: 0.9, maxMinutes: 10 })
    expect(ch4.listIds).toEqual([])
    expect(ch4).not.toHaveProperty('testListId')
  })

  it('gates test chapters on their test list and a pass mark with minWpm', () => {
    const ch5 = chapter(5)
    expect(ch5.gate).toBe('test')
    expect(ch5.testListId).toBe('5-test')
    expect(ch5.passMark).toMatchObject({ accuracy: 0.9, minWpm: 10 })
    expect(ch5.listIds).toEqual(['5-EU', '5-basic-left-hand', '5-cvc', '5-dbl'])
    for (const n of [7, 8, 9, 10]) expect(chapter(n).passMark?.minWpm).toBe(5)
    expect(chapter(13).passMark?.maxWpm).toBe(40)
    const tests = chapters().filter((c) => c.gate === 'test')
    expect(tests.map((c) => c.chapter)).toEqual([5, 6, 7, 8, 9, 10, 11, 13, 15, 16])
    for (const c of tests) {
      expect(c.passMark?.minWpm).toBeGreaterThan(0)
      expect(c.testListId).toBe(`${c.chapter}-test`)
    }
  })

  it('lists each chapter\'s non-test lists in practice-index order', () => {
    const index: PracticeIndexEntry[] = readJson('practice-index.json')
    for (const c of chapters()) {
      const expected = index.filter((e) => e.chapter === c.chapter && e.id !== `${c.chapter}-test`).map((e) => e.id)
      expect(c.listIds).toEqual(c.chapter === 4 ? [] : expected)
    }
  })

  it('gates chapters with lists but no test as drills without a pass mark', () => {
    expect(chapter(12)).toMatchObject({ gate: 'drills', listIds: ['12-left-orthographic-chords', '12-words-with-f-as-s'] })
    expect(chapter(14)).toMatchObject({ gate: 'drills', listIds: ['14-compound-words', '14-suffix-keys'] })
    expect(chapter(17).gate).toBe('drills')
    expect(chapter(17).listIds).toHaveLength(7)
    for (const n of [12, 14, 17]) {
      expect(chapter(n)).not.toHaveProperty('passMark')
      expect(chapter(n)).not.toHaveProperty('testListId')
    }
  })

  it('gates the generated-drill chapters as drills without a pass mark', () => {
    expect(chapter(18)).toMatchObject({ gate: 'drills', listIds: ['18-lowercase', '18-numbers', '18-uppercase'] })
    expect(chapter(20)).toMatchObject({ gate: 'drills', listIds: ['20-commands', '20-punctuation'] })
    expect(chapter(21)).toMatchObject({ gate: 'drills', listIds: ['21-uk-spellings'] })
    for (const n of [18, 20, 21]) {
      expect(chapter(n)).not.toHaveProperty('passMark')
      expect(chapter(n)).not.toHaveProperty('testListId')
    }
  })

  it('gates chapters without lists as read', () => {
    for (const n of [1, 2, 3, 19, 22, 23, 24, 25, 26]) {
      expect(chapter(n)).toMatchObject({ gate: 'read', listIds: [] })
      expect(chapter(n)).not.toHaveProperty('passMark')
      expect(chapter(n)).not.toHaveProperty('testListId')
    }
  })
})

describe('gateFor', () => {
  const mark = { accuracy: 0.9, minWpm: 10, maxWpm: 20 }

  it('applies the gate rules in order', () => {
    expect(gateFor(4, { accuracy: 0.9, maxMinutes: 10 }, false, [])).toEqual({
      gate: 'stage0',
      passMark: { accuracy: 0.9, maxMinutes: 10 },
      listIds: [],
    })
    expect(gateFor(5, mark, true, ['5-a'])).toEqual({ gate: 'test', passMark: mark, testListId: '5-test', listIds: ['5-a'] })
    expect(gateFor(12, undefined, false, ['12-a'])).toEqual({ gate: 'drills', listIds: ['12-a'] })
    expect(gateFor(1, undefined, false, [])).toEqual({ gate: 'read', listIds: [] })
  })

  it('throws naming the chapter when a test chapter lacks a pass mark or minWpm', () => {
    expect(() => gateFor(9, undefined, true, [])).toThrow(/chapter 9/i)
    expect(() => gateFor(9, { accuracy: 0.9, maxMinutes: 10 }, true, [])).toThrow(/chapter 9.*minWpm/i)
  })

  it('throws naming chapter 4 when it has no pass mark', () => {
    expect(() => gateFor(4, undefined, false, [])).toThrow(/chapter 4/i)
  })
})

describe('practiceChapter', () => {
  it('reads the integer before the first dash', () => {
    expect(practiceChapter('5-basic-left-hand')).toBe(5)
    expect(practiceChapter('10-right-ch-sh-rch')).toBe(10)
    expect(practiceChapter('13-test')).toBe(13)
  })

  it('throws naming the id when there is no leading chapter number', () => {
    expect(() => practiceChapter('briefs')).toThrow(/"briefs"/)
    expect(() => practiceChapter('x5-foo')).toThrow(/"x5-foo"/)
    expect(() => practiceChapter('-foo')).toThrow(/"-foo"/)
  })
})

describe('buildContent on a fixture book', () => {
  function fixture(page: string, practice: string): string {
    const dir = mkdtempSync(join(work, 'book-'))
    mkdirSync(join(dir, 'src', 'practice'), { recursive: true })
    writeFileSync(join(dir, 'PINNED_COMMIT'), `${PINNED}\n`)
    writeFileSync(join(dir, 'src', 'SUMMARY.md'), '# Summary\n-[Home](Home.md)\n')
    writeFileSync(join(dir, 'src', 'Home.md'), page)
    writeFileSync(join(dir, 'src', 'practice', '1-bad.txt'), practice)
    return dir
  }

  it('keeps an invalid stroke in a prose code span as plain code', async () => {
    const dir = fixture('Press `QQQ` and `SAP`\n', 'a\tA\n')
    const out = join(work, 'fixture-ok')
    await buildContent({ bookDir: dir, outDir: out })
    const home = JSON.parse(readFileSync(join(out, 'pages', 'home.json'), 'utf8'))
    expect(home.html).toContain('<code>QQQ</code>')
    expect(home.html).toContain('data-stroke="SAP"')
  })

  it('rejects when a practice list has an invalid stroke', async () => {
    const dir = fixture('Hello\n', 'cat\tKAT\nbad\tQQQ\n')
    await expect(buildContent({ bookDir: dir, outDir: join(work, 'fixture-bad') })).rejects.toThrow(/1-bad.*bad outline/)
  })

  it('rejects when a practice list id has no leading chapter number', async () => {
    const dir = fixture('Hello\n', 'a\tA\n')
    renameSync(join(dir, 'src', 'practice', '1-bad.txt'), join(dir, 'src', 'practice', 'nochapter.txt'))
    await expect(buildContent({ bookDir: dir, outDir: join(work, 'fixture-nochapter') })).rejects.toThrow(/nochapter/)
  })

  it('rejects when a test chapter page has no pass mark', async () => {
    const dir = fixture('Hello\n', 'a\tA\n')
    writeFileSync(join(dir, 'src', 'SUMMARY.md'), '# Summary\n-[Chapter 5](Chapter-05.md)\n')
    writeFileSync(join(dir, 'src', 'Chapter-05.md'), 'No pass mark here\n')
    writeFileSync(join(dir, 'src', 'practice', '5-test.txt'), 'a\tA\n')
    await expect(buildContent({ bookDir: dir, outDir: join(work, 'fixture-nomark') })).rejects.toThrow(/chapter 5/i)
  })
})

describe('dictionary.json on a fixture book and dictionary', () => {
  const FILES: Record<string, Record<string, string>> = {
    main: { KAT: 'cat', SAP: 'sap' },
    uk: { KAT: 'cat', SEPB: 'centre' },
    names: {},
    numbers: { '#S': '1' },
    commands: {},
    movement: {},
  }

  function dictDir(files: Record<string, unknown> = {}): string {
    const dir = mkdtempSync(join(work, 'dict-'))
    for (const file of DICT_FILES) {
      writeFileSync(join(dir, DICT_FILE_NAMES[file]), JSON.stringify(file in files ? files[file] : FILES[file]))
    }
    writeFileSync(join(dir, 'PINNED_COMMIT'), 'abc123\n')
    return dir
  }

  function book(): string {
    const dir = mkdtempSync(join(work, 'book-'))
    mkdirSync(join(dir, 'src', 'practice'), { recursive: true })
    writeFileSync(join(dir, 'PINNED_COMMIT'), `${PINNED}\n`)
    writeFileSync(join(dir, 'src', 'SUMMARY.md'), '# Summary\n- [Home](Home.md)\n- [Chapter 21](Chapter-21.md)\n')
    writeFileSync(join(dir, 'src', 'Home.md'), 'Hello\n')
    writeFileSync(join(dir, 'src', 'Chapter-21.md'), '# Chapter 21\n\n* centre `SEPB/TER/#TPH`\n')
    writeFileSync(join(dir, 'src', 'practice', '1-words.txt'), 'cat\tKAT\nzap\tSAP\n')
    return dir
  }

  const dictionaryOf = (out: string): DictionaryFile => JSON.parse(readFileSync(join(out, 'dictionary.json'), 'utf8'))

  it('writes ordered cards with the commit, book labels, named cards and book-only rows', async () => {
    const out = join(work, 'dict-ok')
    const result = await buildContent({ bookDir: book(), outDir: out, dictionaryDir: dictDir() })
    const file = dictionaryOf(out)
    expect(file.commit).toBe('abc123')
    expect(file.cards.map((c) => c.t)).toEqual(['1', 'cat', 'centre', 'sap', 'zap'])
    expect(file.cards.find((c) => c.t === 'cat')).toEqual({
      t: 'cat',
      r: [{ o: 'KAT', f: ['uk'], b: [{ chapter: 1, source: 'practice' }] }],
    })
    expect(file.cards.find((c) => c.t === 'zap')).toEqual({
      t: 'zap',
      n: true,
      r: [{ o: 'SAP', b: [{ chapter: 1, source: 'practice' }], w: ['sap'] }],
    })
    expect(result.dictionaryCards).toBe(5)
    expect(result.dictionaryBytes).toBe(statSync(join(out, 'dictionary.json')).size)
  })

  it('adds the generated drill items to the dictionary as labelled rows', async () => {
    const out = join(work, 'dict-generated')
    await buildContent({ bookDir: book(), outDir: out, dictionaryDir: dictDir() })
    const centre = dictionaryOf(out).cards.find((c) => c.t === 'centre')!
    expect(centre.r).toEqual([
      { o: 'SEPB', f: ['uk'] },
      {
        o: 'SEPB/TER/#TPH',
        b: [
          { chapter: 21, source: 'practice' },
          { chapter: 21, source: 'example' },
        ],
        x: true,
      },
    ])
  })

  it('writes nothing and reports zero when no dictionary directory is given', async () => {
    const out = join(work, 'dict-none')
    const result = await buildContent({ bookDir: book(), outDir: out })
    expect(existsSync(join(out, 'dictionary.json'))).toBe(false)
    expect(result.dictionaryCards).toBe(0)
    expect(result.dictionaryBytes).toBe(0)
  })

  it('builds byte-identical files twice', async () => {
    const dir = dictDir()
    const a = join(work, 'dict-twice-a')
    const b = join(work, 'dict-twice-b')
    await buildContent({ bookDir: book(), outDir: a, dictionaryDir: dir })
    await buildContent({ bookDir: book(), outDir: b, dictionaryDir: dir })
    expect(readFileSync(join(a, 'dictionary.json'))).toEqual(readFileSync(join(b, 'dictionary.json')))
  })

  it('rejects a dictionary file with a non-string value, naming the file and the key', async () => {
    const dir = dictDir({ main: { KAT: 'cat', SAP: 3 } })
    await expect(buildContent({ bookDir: book(), outDir: join(work, 'dict-num'), dictionaryDir: dir })).rejects.toThrow(
      /lapwing-base\.json: expected an object of strings, got a number at "SAP"/,
    )
  })

  it('rejects a dictionary file that holds an array or null instead of an object', async () => {
    const asArray = dictDir({ uk: ['KAT'] })
    await expect(buildContent({ bookDir: book(), outDir: join(work, 'dict-arr'), dictionaryDir: asArray })).rejects.toThrow(
      /lapwing-uk-additions\.json: expected an object/,
    )
    const asNull = dictDir({ names: null })
    await expect(buildContent({ bookDir: book(), outDir: join(work, 'dict-null'), dictionaryDir: asNull })).rejects.toThrow(
      /lapwing-proper-nouns\.json: expected an object/,
    )
  })

  it('rejects a dictionary file that is not JSON, naming the file', async () => {
    const dir = dictDir()
    writeFileSync(join(dir, DICT_FILE_NAMES.numbers), '{nope')
    await expect(buildContent({ bookDir: book(), outDir: join(work, 'dict-json'), dictionaryDir: dir })).rejects.toThrow(
      /lapwing-numbers\.json/,
    )
  })

  it('rejects a missing dictionary file, naming it and keeping the cause', async () => {
    const dir = dictDir()
    rmSync(join(dir, DICT_FILE_NAMES.commands))
    const error = await buildContent({ bookDir: book(), outDir: join(work, 'dict-missing'), dictionaryDir: dir }).catch((e) => e)
    expect(error).toBeInstanceOf(Error)
    expect(error.message).toMatch(/lapwing-commands\.json/)
    expect(error.cause?.code).toBe('ENOENT')
  })

  it('throws over the size limit and leaves no dictionary.json behind', async () => {
    const out = join(work, 'dict-big')
    await expect(
      buildContent({ bookDir: book(), outDir: out, dictionaryDir: dictDir(), dictionaryMaxBytes: 100 }),
    ).rejects.toThrow(/dictionary\.json is \d+ bytes, over the 100 byte limit/)
    expect(existsSync(join(out, 'dictionary.json'))).toBe(false)
  })

  it('accepts a file exactly at the size limit', async () => {
    const dir = dictDir()
    const probe = join(work, 'dict-probe')
    const { dictionaryBytes } = await buildContent({ bookDir: book(), outDir: probe, dictionaryDir: dir })
    const out = join(work, 'dict-exact')
    await buildContent({ bookDir: book(), outDir: out, dictionaryDir: dir, dictionaryMaxBytes: dictionaryBytes })
    expect(existsSync(join(out, 'dictionary.json'))).toBe(true)
    await expect(
      buildContent({ bookDir: book(), outDir: join(work, 'dict-under'), dictionaryDir: dir, dictionaryMaxBytes: dictionaryBytes - 1 }),
    ).rejects.toThrow(/over the/)
  })
})
