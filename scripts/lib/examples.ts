import { Lexer } from 'marked'
import type { Token, Tokens } from 'marked'
import { isOutline, plainText } from './tables.ts'

export type ExampleRow = { chapter: number; word: string; outlines: string[] }

// The inline tokens of an item's own first line (a tight item holds them in a text token, a loose one in a paragraph).
function ownInline(item: Tokens.ListItem): Token[] {
  for (const token of item.tokens) {
    if ((token.type === 'text' || token.type === 'paragraph') && 'tokens' in token && Array.isArray(token.tokens)) {
      return token.tokens
    }
  }
  return []
}

function collect(tokens: Token[], found: { word: string; outline: string }[]): void {
  for (const token of tokens) {
    if (token.type === 'blockquote') collect((token as Tokens.Blockquote).tokens, found)
    if (token.type !== 'list') continue
    for (const item of (token as Tokens.List).items) {
      const inline = ownInline(item)
      const at = inline.findIndex((t) => t.type === 'codespan')
      if (at > 0) {
        const word = plainText(inline.slice(0, at))
        const outline = (inline[at] as Tokens.Codespan).text
        if (word !== '' && isOutline(outline)) found.push({ word, outline })
      }
      collect(item.tokens, found)
    }
  }
}

// Every list item of the form "word `OUTLINE`", nested or not; tables and code fences are never entered.
export function parseExampleItems(chapter: number, markdown: string): ExampleRow[] {
  const found: { word: string; outline: string }[] = []
  collect(new Lexer({ gfm: true }).lex(markdown), found)
  const rows = new Map<string, ExampleRow>()
  for (const { word, outline } of found) {
    const key = word.toLowerCase()
    let row = rows.get(key)
    if (!row) {
      row = { chapter, word, outlines: [] }
      rows.set(key, row)
    }
    if (!row.outlines.includes(outline)) row.outlines.push(outline)
  }
  return [...rows.values()]
}
