import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { parsePassMark } from './lib/passmark.ts'
import type { PassMark } from './lib/passmark.ts'
import { parseExampleItems } from './lib/examples.ts'
import type { ExampleRow } from './lib/examples.ts'
import { generatedLists } from './lib/generated.ts'
import { parseKeyChart } from './lib/keychart.ts'
import { buildLookup } from './lib/lookup.ts'
import type { LookupList } from './lib/lookup.ts'
import { parsePracticeFile } from './lib/practice.ts'
import { renderPage } from './lib/render.ts'
import type { Heading, PracticeLink } from './lib/render.ts'
import { parseStage0Words } from './lib/stage0.ts'
import { parseBriefTables, parseSentences } from './lib/tables.ts'
import type { BriefRow, SentenceRow } from './lib/tables.ts'

export type PageKind = 'home' | 'chapter' | 'appendix' | 'glossary' | 'changes'
export type PageEntry = { id: string; title: string; kind: PageKind; number?: number; file: string }
export type BookIndex = { commit: string; pages: PageEntry[] }
export type PageFile = {
  id: string
  title: string
  html: string
  headings: Heading[]
  practiceLinks: PracticeLink[]
  passMark?: PassMark
}
export type PracticeIndexEntry = { id: string; chapter: number; items: number }
export type GateKind = 'stage0' | 'test' | 'drills' | 'read'
export type ChapterInfo = {
  chapter: number
  pageId: string
  title: string
  gate: GateKind
  passMark?: PassMark
  testListId?: string
  listIds: string[]
}
export type BuildStats = {
  pages: number
  practiceLists: number
  practiceLines: number
  generatedLists: number
  outlineTags: number
  briefRows: number
  lookupEntries: number
  lookupBytes: number
}

const SUMMARY_LINE = /^-\s*\[([^\]]+)\]\(([^)]+\.md)\)\s*$/
const BRIEF_CHAPTERS = { first: 5, last: 12 }
const LOOKUP_MAX_BYTES = 5 * 1024 * 1024

function pageEntry(title: string, file: string): PageEntry {
  let match: RegExpExecArray | null
  if (file === 'Home.md') return { id: 'home', title, kind: 'home', file }
  if (file === 'Glossary.md') return { id: 'glossary', title, kind: 'glossary', file }
  if (file === 'Changes.md') return { id: 'changes', title, kind: 'changes', file }
  if ((match = /^Chapter-(\d+)\.md$/.exec(file))) {
    return { id: `ch${match[1]}`, title, kind: 'chapter', number: Number(match[1]), file }
  }
  if ((match = /^Appendix-([A-Z])\.md$/.exec(file))) return { id: `app${match[1]}`, title, kind: 'appendix', file }
  throw new Error(`SUMMARY.md: unrecognised page file ${JSON.stringify(file)}`)
}

function parseSummary(summary: string): PageEntry[] {
  const pages: PageEntry[] = []
  for (const line of summary.split(/\r?\n/)) {
    const match = SUMMARY_LINE.exec(line)
    if (match) pages.push(pageEntry(match[1], match[2]))
  }
  if (pages.length === 0) throw new Error('SUMMARY.md lists no pages')
  return pages
}

export function practiceChapter(id: string): number {
  const match = /^(\d+)-/.exec(id)
  if (!match) throw new Error(`practice list id ${JSON.stringify(id)} has no leading chapter number`)
  return Number(match[1])
}

export function gateFor(
  chapter: number,
  passMark: PassMark | undefined,
  hasTestList: boolean,
  listIds: string[],
): Pick<ChapterInfo, 'gate' | 'passMark' | 'testListId' | 'listIds'> {
  if (chapter === 4) {
    if (!passMark) throw new Error(`chapter 4: the stage 0 gate needs a pass mark on the page`)
    return { gate: 'stage0', passMark, listIds: [] }
  }
  if (hasTestList) {
    if (!passMark || passMark.minWpm === undefined) {
      throw new Error(`chapter ${chapter}: has a ${chapter}-test list but its page has no pass mark with minWpm`)
    }
    return { gate: 'test', passMark, testListId: `${chapter}-test`, listIds }
  }
  return { gate: listIds.length > 0 ? 'drills' : 'read', listIds }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(value))
}

function chapterInfos(
  entries: PageEntry[],
  practiceIndex: PracticeIndexEntry[],
  passMarks: Map<string, PassMark | undefined>,
): ChapterInfo[] {
  const infos: ChapterInfo[] = []
  for (const entry of entries) {
    if (entry.kind !== 'chapter' || entry.number === undefined) continue
    const n = entry.number
    const own = practiceIndex.filter((p) => p.chapter === n).map((p) => p.id)
    const gate = gateFor(
      n,
      passMarks.get(entry.id),
      own.includes(`${n}-test`),
      own.filter((id) => id !== `${n}-test`),
    )
    infos.push({ chapter: n, pageId: entry.id, title: entry.title, ...gate })
  }
  return infos.sort((a, b) => a.chapter - b.chapter)
}

export async function buildContent(opts: { bookDir: string; outDir: string }): Promise<BuildStats> {
  const { bookDir, outDir } = opts
  const src = join(bookDir, 'src')
  const commit = (await readFile(join(bookDir, 'PINNED_COMMIT'), 'utf8')).trim()
  const entries = parseSummary(await readFile(join(src, 'SUMMARY.md'), 'utf8'))
  const pageIds: Record<string, string> = Object.fromEntries(entries.map((e) => [e.file, e.id]))

  await rm(join(outDir, 'pages'), { recursive: true, force: true })
  await rm(join(outDir, 'practice'), { recursive: true, force: true })

  // Practice lists first: an invalid stroke here fails the build before anything else is written.
  const practiceFiles = (await readdir(join(src, 'practice'))).filter((f) => f.endsWith('.txt')).sort()
  const practiceIds = new Set<string>()
  const practiceIndex: PracticeIndexEntry[] = []
  let practiceLines = 0
  const bookLists: LookupList[] = []
  const markdowns = new Map<string, string>()
  for (const entry of entries) markdowns.set(entry.file, await readFile(join(src, entry.file), 'utf8'))
  for (const file of practiceFiles) {
    const id = file.slice(0, -'.txt'.length)
    const text = await readFile(join(src, 'practice', file), 'utf8')
    const chapter = practiceChapter(id)
    const list = parsePracticeFile(id, text)
    practiceIndex.push({ id, chapter, items: list.items.length })
    practiceIds.add(id)
    bookLists.push({ id, chapter, items: list.items })
    practiceLines += text.split(/\r?\n/).filter((line) => line.trim() !== '').length
    await writeJson(join(outDir, 'practice', `${id}.json`), list)
  }

  // Drills generated from the table-only chapters sit next to the book's own lists.
  let generatedCount = 0
  for (const entry of entries) {
    if (entry.kind !== 'chapter' || entry.number === undefined) continue
    for (const list of generatedLists(entry.number, markdowns.get(entry.file)!)) {
      if (practiceIds.has(list.id)) throw new Error(`generated practice list ${list.id} clashes with a book list`)
      practiceIds.add(list.id)
      practiceIndex.push({ id: list.id, chapter: list.chapter, items: list.items.length })
      
      generatedCount++
      await writeJson(join(outDir, 'practice', `${list.id}.json`), { id: list.id, items: list.items })
    }
  }

  const briefs: BriefRow[] = []
  const passMarks = new Map<string, PassMark | undefined>()
  const sentences: SentenceRow[] = []
  const examples: ExampleRow[] = []
  let outlineTags = 0
  for (const entry of entries) {
    const markdown = markdowns.get(entry.file)!
    const rendered = renderPage(markdown, pageIds)
    for (const link of rendered.practiceLinks) {
      if (!practiceIds.has(link.listId)) throw new Error(`${entry.file}: link to unknown practice list ${link.listId}`)
    }
    outlineTags += rendered.outlineTagCount
    const passMark = parsePassMark(markdown)
    passMarks.set(entry.id, passMark)
    const page: PageFile = {
      id: entry.id,
      title: entry.title,
      html: rendered.html,
      headings: rendered.headings,
      practiceLinks: rendered.practiceLinks,
      passMark,
    }
    await writeJson(join(outDir, 'pages', `${entry.id}.json`), page)

    if (entry.kind === 'chapter' && entry.number !== undefined) {
      if (entry.number >= BRIEF_CHAPTERS.first && entry.number <= BRIEF_CHAPTERS.last) {
        briefs.push(...parseBriefTables(entry.number, markdown))
      }
      sentences.push(...parseSentences(entry.number, markdown))
      examples.push(...parseExampleItems(entry.number, markdown))
    }
    if (entry.id === 'ch04') await writeJson(join(outDir, 'stage0.json'), parseStage0Words(markdown))
  }

  const book: BookIndex = { commit, pages: entries }
  await writeJson(join(outDir, 'book.json'), book)
  practiceIndex.sort((a, b) => a.chapter - b.chapter || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  await writeJson(join(outDir, 'practice-index.json'), practiceIndex)
  await writeJson(join(outDir, 'chapters.json'), chapterInfos(entries, practiceIndex, passMarks))
  await writeJson(join(outDir, 'briefs.json'), briefs)
  await writeJson(join(outDir, 'sentences.json'), sentences)
  // The key chart needs Chapters 4, 5 and 18; a book with none of them (a test fixture) simply has no chart.
  const chartFiles = ['Chapter-04.md', 'Chapter-05.md', 'Chapter-18.md']
  const chartMarkdown = chartFiles.map((file) => markdowns.get(file))
  if (chartMarkdown.some((markdown) => markdown !== undefined)) {
    const missing = chartFiles.filter((_, i) => chartMarkdown[i] === undefined)
    if (missing.length > 0) throw new Error(`SUMMARY.md does not list ${missing.join(', ')}, needed for the key chart`)
    const [ch4, ch5, ch18] = chartMarkdown as string[]
    await writeJson(join(outDir, 'keychart.json'), parseKeyChart({ ch4, ch5, ch18 }))
  }
  const lookup = buildLookup({ lists: bookLists, briefs, examples })
  const lookupJson = JSON.stringify(lookup)
  const lookupBytes = Buffer.byteLength(lookupJson)
  if (lookupBytes > LOOKUP_MAX_BYTES) {
    throw new Error(`lookup.json is ${lookupBytes} bytes, over the ${LOOKUP_MAX_BYTES} byte limit`)
  }
  await writeFile(join(outDir, 'lookup.json'), lookupJson)

  return {
    pages: entries.length,
    practiceLists: practiceFiles.length,
    practiceLines,
    generatedLists: generatedCount,
    outlineTags,
    briefRows: briefs.length,
    lookupEntries: lookup.length,
    lookupBytes,
  }
}

if (import.meta.main) {
  const root = join(import.meta.dirname, '..')
  const stats = await buildContent({
    bookDir: join(root, 'content', 'lapwing-book'),
    outDir: join(root, 'content', 'build'),
  })
  console.log(
    `Built ${stats.pages} pages, ${stats.practiceLists} practice lists (${stats.practiceLines} lines) ` +
      `and ${stats.generatedLists} generated lists, ` +
      `${stats.outlineTags} outline tags, ${stats.briefRows} brief rows, ` +
      `lookup ${stats.lookupEntries} entries (${Math.round(stats.lookupBytes / 1024)} KB)`,
  )
}
