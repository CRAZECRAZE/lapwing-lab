import { Lexer } from 'marked'
import type { Token, Tokens } from 'marked'
import { parseOutline, StenoParseError } from '../../src/core/steno.ts'
import { parseExampleItems } from './examples.ts'
import { blockAfterHeading, codeSpans, plainText } from './tables.ts'

export type GeneratedList = { id: string; chapter: number; items: { prompt: string; outlines: string[] }[] }
type Item = GeneratedList['items'][number]

const LETTERS = 'abcdefghijklmnopqrstuvwxyz'

function tableAfter(chapter: number, tokens: Token[], title: string): Tokens.Table {
  const table = blockAfterHeading<Tokens.Table>(tokens, title, 'table')
  if (!table) throw new Error(`Chapter ${chapter}: no table under the "${title}" heading`)
  return table
}

// Cells look like `a <br> <steno-outline stroke="A*" ...>`; empty cells are padding.
function graphicCells(table: Tokens.Table): { label: string; stroke: string }[] {
  const cells: { label: string; stroke: string }[] = []
  for (const row of table.rows) {
    for (const cell of row) {
      if (cell.text.trim() === '') continue
      const stroke = /<steno-outline\b[^>]*\bstroke="([^"]*)"/.exec(cell.text)
      const br = cell.text.search(/<br\s*\/?>/)
      if (!stroke || br < 0) throw new Error(`a table cell is not "label <br> <steno-outline>": ${JSON.stringify(cell.text)}`)
      cells.push({ label: cell.text.slice(0, br).trim(), stroke: stroke[1] })
    }
  }
  return cells
}

function letterItems(chapter: number, tokens: Token[], title: string, prompt: (letter: string) => string): Item[] {
  const cells = graphicCells(tableAfter(chapter, tokens, title))
  if (cells.map((c) => c.label).join('') !== LETTERS) {
    throw new Error(`Chapter 18: the "${title}" table should hold the letters a to z in order, got ${JSON.stringify(cells.map((c) => c.label).join(''))}`)
  }
  return cells.map((c) => ({ prompt: prompt(c.label), outlines: [c.stroke] }))
}

function numberItems(tokens: Token[]): Item[] {
  const items: Item[] = graphicCells(tableAfter(18, tokens, 'Numbers')).map((c) => ({ prompt: c.label, outlines: [c.stroke] }))
  const list = blockAfterHeading<Tokens.List>(tokens, 'Numbers', 'list')
  for (const entry of list?.items ?? []) {
    const match = /^`([^`]+)`\s+(\d+)\s*$/.exec(entry.text.trim())
    if (match) items.push({ prompt: match[2], outlines: [match[1]] })
  }
  return items
}

function formattingSuffix(formatting: string): string {
  return ` — ${formatting.replace(/\.\s*$/, '')}`
}

// Character cells are inline HTML such as <code class="code-mono">.</code>, so strip tags from the raw text.
function characterOf(cell: Tokens.TableCell): string {
  return cell.text.replace(/<[^>]*>/g, '').replace(/\\(.)/g, '$1').trim()
}

function punctuationItems(tokens: Token[]): Item[] {
  const rows = tableAfter(20, tokens, 'Punctuation').rows.map((row) => ({
    base: `${plainText(row[1].tokens)} (${characterOf(row[0])})`,
    formatting: plainText(row[2].tokens),
    outlines: codeSpans(row[3].tokens).slice(0, 1),
  }))
  const counts = new Map<string, number>()
  for (const row of rows) counts.set(row.base, (counts.get(row.base) ?? 0) + 1)
  return rows.map((row) => ({
    prompt: counts.get(row.base)! > 1 ? row.base + formattingSuffix(row.formatting) : row.base,
    outlines: row.outlines,
  }))
}

function commandItems(tokens: Token[]): Item[] {
  const start = tokens.findIndex((t) => t.type === 'heading' && plainText((t as Tokens.Heading).tokens) === 'Commands')
  if (start < 0) throw new Error('Chapter 20: no "Commands" heading')
  const depth = (tokens[start] as Tokens.Heading).depth
  const items: Item[] = []
  for (let i = start + 1; i < tokens.length; i++) {
    const token = tokens[i]
    if (token.type !== 'heading') continue
    const heading = token as Tokens.Heading
    if (heading.depth <= depth) break
    if (heading.depth !== 3) continue
    // The first #### heading before the next section must be "Outline: `X`".
    for (let j = i + 1; j < tokens.length; j++) {
      const next = tokens[j]
      if (next.type !== 'heading') continue
      const sub = next as Tokens.Heading
      if (sub.depth <= 3) break
      if (sub.depth !== 4) continue
      const spans = codeSpans(sub.tokens)
      if (plainText(sub.tokens).startsWith('Outline:') && spans.length > 0) {
        items.push({ prompt: plainText(heading.tokens), outlines: [spans[0]] })
      }
      break
    }
  }
  return items
}

function checked(id: string, chapter: number, items: Item[]): GeneratedList {
  if (items.length === 0) throw new Error(`Chapter ${chapter}: no items found for the generated list ${id}`)
  const seen = new Set<string>()
  for (const item of items) {
    for (const outline of item.outlines) {
      try {
        parseOutline(outline)
      } catch (e) {
        if (e instanceof StenoParseError) throw new Error(`Generated list ${id}: bad outline ${JSON.stringify(outline)} (${e.message})`)
        throw e
      }
    }
    if (item.outlines.length === 0) throw new Error(`Generated list ${id}: no outline for ${JSON.stringify(item.prompt)}`)
    if (seen.has(item.prompt)) throw new Error(`Generated list ${id}: duplicate prompt ${JSON.stringify(item.prompt)}`)
    seen.add(item.prompt)
  }
  return { id, chapter, items }
}

// Drill lists for the table-only chapters; [] for every other chapter. Pure: markdown in, lists out.
export function generatedLists(chapter: number, markdown: string): GeneratedList[] {
  if (chapter !== 18 && chapter !== 20 && chapter !== 21) return []
  const tokens = new Lexer({ gfm: true }).lex(markdown)
  if (chapter === 18) {
    return [
      checked('18-lowercase', 18, letterItems(18, tokens, 'Lowercase', (letter) => letter)),
      checked('18-numbers', 18, numberItems(tokens)),
      checked('18-uppercase', 18, letterItems(18, tokens, 'Uppercase', (letter) => letter.toUpperCase())),
    ]
  }
  if (chapter === 20) {
    const punctuation = checked('20-punctuation', 20, punctuationItems(tokens))
    return [checked('20-commands', 20, commandItems(tokens)), punctuation]
  }
  const items = parseExampleItems(21, markdown).map((row) => ({ prompt: row.word, outlines: row.outlines }))
  return [checked('21-uk-spellings', 21, items)]
}
