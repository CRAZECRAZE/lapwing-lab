import { Lexer } from 'marked'
import type { Tokens } from 'marked'

export type Stage0Words = { test: string[]; extra: string[][] }

const MIN_WORDS = 50

export function parseStage0Words(chapter4Markdown: string): Stage0Words {
  const blocks = new Lexer({ gfm: true })
    .lex(chapter4Markdown)
    .filter((t): t is Tokens.Code => t.type === 'code')
    .map((t) => t.text.split(/\s+/).filter((w) => w !== ''))
    .filter((words) => words.length > MIN_WORDS)
  if (blocks.length === 0) throw new Error('Chapter 4: no fenced word block with more than 50 words')
  return { test: blocks[0], extra: blocks.slice(1) }
}
