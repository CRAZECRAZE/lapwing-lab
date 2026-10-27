import { Lexer } from 'marked'
import type { Token, Tokens } from 'marked'
import { parseOutline, StenoParseError, tryParseStroke } from '../../src/core/steno.ts'

export type BriefRow = {
  chapter: number
  kind: 'chapter' | 'extra'
  translation: string
  outlines: string[]
  explanation: string
}
export type SentenceRow = { chapter: number; text: string; outline: string }

export function plainText(tokens: Token[]): string {
  let out = ''
  for (const token of tokens) {
    if (token.type === 'html' || token.type === 'br') continue
    if ('tokens' in token && Array.isArray(token.tokens)) out += plainText(token.tokens)
    else if ('text' in token && typeof token.text === 'string') out += token.text
  }
  return out.replace(/\s+/g, ' ').trim()
}

export function codeSpans(tokens: Token[]): string[] {
  const spans: string[] = []
  for (const token of tokens) {
    if (token.type === 'codespan') spans.push((token as Tokens.Codespan).text)
    else if ('tokens' in token && Array.isArray(token.tokens)) spans.push(...codeSpans(token.tokens))
  }
  return spans
}

export function isOutline(text: string): boolean {
  return text.split('/').every((stroke) => tryParseStroke(stroke) !== null)
}

// First token of `type` between the heading titled `title` and the next heading.
export function blockAfterHeading<T extends Token>(tokens: Token[], title: string, type: T['type']): T | undefined {
  const start = tokens.findIndex((t) => t.type === 'heading' && plainText((t as Tokens.Heading).tokens) === title)
  if (start < 0) return undefined
  for (let i = start + 1; i < tokens.length && tokens[i].type !== 'heading'; i++) {
    if (tokens[i].type === type) return tokens[i] as T
  }
  return undefined
}

function parseTable(chapter: number, kind: BriefRow['kind'], table: Tokens.Table): BriefRow[] {
  return table.rows.map((row) => {
    const translation = plainText(row[0].tokens)
    const where = `Chapter ${chapter} ${kind} briefs, row ${JSON.stringify(translation)}`
    const outlines = codeSpans(row[1].tokens)
    if (outlines.length === 0) throw new Error(`${where}: no stroke in outline cell ${JSON.stringify(row[1].text)}`)
    for (const outline of outlines) {
      if (!isOutline(outline)) throw new Error(`${where}: bad stroke ${JSON.stringify(outline)}`)
    }
    return { chapter, kind, translation, outlines, explanation: row[2] ? plainText(row[2].tokens) : '' }
  })
}

export function parseBriefTables(chapter: number, markdown: string): BriefRow[] {
  const tokens = new Lexer({ gfm: true }).lex(markdown)
  const rows: BriefRow[] = []
  const sections: [string, BriefRow['kind']][] = [['Chapter briefs', 'chapter'], ['Extra briefs', 'extra']]
  for (const [title, kind] of sections) {
    const table = blockAfterHeading<Tokens.Table>(tokens, title, 'table')
    if (table) rows.push(...parseTable(chapter, kind, table))
  }
  return rows
}

export function parseSentences(chapter: number, markdown: string): SentenceRow[] {
  const tokens = new Lexer({ gfm: true }).lex(markdown)
  const sentences = blockAfterHeading<Tokens.List>(tokens, 'Practice sentences', 'list')
  const answers = blockAfterHeading<Tokens.List>(tokens, 'Answers', 'list')
  if (!sentences && !answers) return []
  if (!sentences || !answers) {
    throw new Error(`Chapter ${chapter}: "Practice sentences" and "Answers" lists must both be present`)
  }
  if (sentences.items.length !== answers.items.length) {
    throw new Error(
      `Chapter ${chapter}: ${sentences.items.length} practice sentences but ${answers.items.length} answers`,
    )
  }
  return sentences.items.map((item, index) => {
    const text = plainText(item.tokens)
    const spans = codeSpans(answers.items[index].tokens)
    const where = `Chapter ${chapter} sentence ${index + 1}`
    if (spans.length !== 1) throw new Error(`${where}: expected one outline code span in the answer, got ${spans.length}`)
    try {
      parseOutline(spans[0])
    } catch (e) {
      if (e instanceof StenoParseError) throw new Error(`${where}: bad outline ${JSON.stringify(spans[0])} (${e.message})`)
      throw e
    }
    return { chapter, text, outline: spans[0] }
  })
}
