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

const TOKEN = /^\p{L}[\p{L}'\u2019-]*\^?$/u
const BAD_FIRST = new Set(['if', 'in', 'to', 'the', 'this', 'these', 'when', 'closest', 'index', 'instead', 'as'])
const BAD_LAST = new Set(['is', 'are', 'be', 'presses', 'use', 'of'])

// The word of an example item, or null when the text before the code span is prose rather than a word or short phrase:
// one wrapping pair of double quotes is dropped, then 1 to 3 tokens of letters (a token may end in - or ^) must remain,
// without a sentence-opening first word or, in a phrase, a sentence-ending last word.
function exampleWord(text: string): string | null {
  let word = text
  if (word.length >= 2 && /^["\u201c\u201d]/.test(word) && /["\u201c\u201d]$/.test(word)) word = word.slice(1, -1).trim()
  const tokens = word.split(/\s+/)
  if (tokens.length > 3 || !tokens.every((t) => TOKEN.test(t))) return null
  if (BAD_FIRST.has(tokens[0].toLowerCase())) return null
  // A sentence-ending word only counts against a phrase; a lone "use" is a real example word.
  if (tokens.length > 1 && BAD_LAST.has(tokens[tokens.length - 1].toLowerCase())) return null
  return tokens.join(' ')
}

function collect(tokens: Token[], found: { word: string; outline: string }[]): void {
  for (const token of tokens) {
    if (token.type === 'blockquote') collect((token as Tokens.Blockquote).tokens, found)
    if (token.type !== 'list') continue
    for (const item of (token as Tokens.List).items) {
      const inline = ownInline(item)
      const at = inline.findIndex((t) => t.type === 'codespan')
      if (at > 0) {
        const word = exampleWord(plainText(inline.slice(0, at)))
        const outline = (inline[at] as Tokens.Codespan).text
        if (word !== null && isOutline(outline)) found.push({ word, outline })
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
