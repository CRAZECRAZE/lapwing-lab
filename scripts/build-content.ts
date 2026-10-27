import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { parsePassMark } from './lib/passmark.ts'
import type { PassMark } from './lib/passmark.ts'
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
export type BuildStats = {
  pages: number
  practiceLists: number
  practiceLines: number
  outlineTags: number
  briefRows: number
}

const SUMMARY_LINE = /^-\s*\[([^\]]+)\]\(([^)]+\.md)\)\s*$/
const BRIEF_CHAPTERS = { first: 5, last: 12 }

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

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(value))
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
  let practiceLines = 0
  for (const file of practiceFiles) {
    const id = file.slice(0, -'.txt'.length)
    const text = await readFile(join(src, 'practice', file), 'utf8')
    const list = parsePracticeFile(id, text)
    practiceIds.add(id)
    practiceLines += text.split(/\r?\n/).filter((line) => line.trim() !== '').length
    await writeJson(join(outDir, 'practice', `${id}.json`), list)
  }

  const briefs: BriefRow[] = []
  const sentences: SentenceRow[] = []
  let outlineTags = 0
  for (const entry of entries) {
    const markdown = await readFile(join(src, entry.file), 'utf8')
    const rendered = renderPage(markdown, pageIds)
    for (const link of rendered.practiceLinks) {
      if (!practiceIds.has(link.listId)) throw new Error(`${entry.file}: link to unknown practice list ${link.listId}`)
    }
    outlineTags += rendered.outlineTagCount
    const page: PageFile = {
      id: entry.id,
      title: entry.title,
      html: rendered.html,
      headings: rendered.headings,
      practiceLinks: rendered.practiceLinks,
      passMark: parsePassMark(markdown),
    }
    await writeJson(join(outDir, 'pages', `${entry.id}.json`), page)

    if (entry.kind === 'chapter' && entry.number !== undefined) {
      if (entry.number >= BRIEF_CHAPTERS.first && entry.number <= BRIEF_CHAPTERS.last) {
        briefs.push(...parseBriefTables(entry.number, markdown))
      }
      sentences.push(...parseSentences(entry.number, markdown))
    }
    if (entry.id === 'ch04') await writeJson(join(outDir, 'stage0.json'), parseStage0Words(markdown))
  }

  const book: BookIndex = { commit, pages: entries }
  await writeJson(join(outDir, 'book.json'), book)
  await writeJson(join(outDir, 'briefs.json'), briefs)
  await writeJson(join(outDir, 'sentences.json'), sentences)

  return { pages: entries.length, practiceLists: practiceIds.size, practiceLines, outlineTags, briefRows: briefs.length }
}

if (import.meta.main) {
  const root = join(import.meta.dirname, '..')
  const stats = await buildContent({
    bookDir: join(root, 'content', 'lapwing-book'),
    outDir: join(root, 'content', 'build'),
  })
  console.log(
    `Built ${stats.pages} pages, ${stats.practiceLists} practice lists (${stats.practiceLines} lines), ` +
      `${stats.outlineTags} outline tags, ${stats.briefRows} brief rows`,
  )
}
