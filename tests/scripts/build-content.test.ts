import { mkdirSync, mkdtempSync, readFileSync, existsSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildContent } from '../../scripts/build-content.ts'
import type { BuildStats } from '../../scripts/build-content.ts'

const bookDir = join(import.meta.dirname, '..', '..', 'content', 'lapwing-book')
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
  stats = await buildContent({ bookDir, outDir })
})

afterAll(() => {
  rmSync(work, { recursive: true, force: true })
})

describe('buildContent on the vendored book', () => {
  it('reports the expected totals', () => {
    expect(stats.pages).toBe(33)
    expect(stats.practiceLists).toBe(57)
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
})
