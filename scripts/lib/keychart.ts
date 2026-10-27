import { Lexer } from 'marked'
import type { Token, Tokens } from 'marked'
import { SLOTS } from '../../src/core/steno.ts'
import { codeSpans, plainText } from './tables.ts'

export type KeyChartGroup = 'left' | 'vowel' | 'right' | 'special'
export type KeyChartEntry = { slot: string; group: KeyChartGroup; sounds: string[]; examples: string[]; source: string }
export type KeyChartSources = { ch4: string; ch5: string; ch18: string }

const MAX_EXAMPLES = 6
const LEFT = ['S-', 'T-', 'K-', 'P-', 'W-', 'H-', 'R-']
const VOWELS = ['A-', 'O-', '-E', '-U']
const SPECIAL = ['#', '*']
// The short-vowel subsection each vowel slot is read from (the i sound is the EU chord, not a slot).
const VOWEL_SECTIONS: Record<string, string> = { 'A-': 'Short a', 'O-': 'Short o', '-E': 'Short e', '-U': 'Short u' }

function groupOf(slot: string): KeyChartGroup {
  if (LEFT.includes(slot)) return 'left'
  if (VOWELS.includes(slot)) return 'vowel'
  if (SPECIAL.includes(slot)) return 'special'
  return 'right'
}

// The tokens under the heading titled `title`, up to the next heading of the same or a higher level.
function section(tokens: Token[], title: string, where: string): Token[] {
  const start = tokens.findIndex((t) => t.type === 'heading' && plainText((t as Tokens.Heading).tokens) === title)
  if (start < 0) throw new Error(`${where}: no heading titled ${JSON.stringify(title)}`)
  const depth = (tokens[start] as Tokens.Heading).depth
  const body: Token[] = []
  for (let i = start + 1; i < tokens.length; i++) {
    const token = tokens[i]
    if (token.type === 'heading' && (token as Tokens.Heading).depth <= depth) break
    body.push(token)
  }
  return body
}

function sentenceWith(body: Token[], needle: string, where: string): string {
  for (const token of body) {
    if (token.type !== 'paragraph') continue
    const found = plainText((token as Tokens.Paragraph).tokens)
      .split(/(?<=[.!?])\s+/)
      .find((sentence) => sentence.includes(needle))
    if (found) return found
  }
  throw new Error(`${where}: no sentence mentioning ${JSON.stringify(needle)}`)
}

// Table key cell (`S`, `-F`, `-S`*) to a SLOTS name: left keys are written without a hyphen.
function tableSlot(cell: Tokens.TableCell): string {
  const key = codeSpans(cell.tokens)[0] ?? cell.text.replace(/[`*\s]/g, '')
  const slot = key.startsWith('-') ? key : `${key}-`
  if (!(SLOTS as readonly string[]).includes(slot)) {
    throw new Error(`Chapter 5 "Consonant keys": ${JSON.stringify(key)} is not a key on the layout`)
  }
  return slot
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}

function consonantEntries(ch5: Token[]): KeyChartEntry[] {
  const body = section(ch5, 'Consonant keys', 'Chapter 5')
  const table = body.find((t) => t.type === 'table') as Tokens.Table | undefined
  if (!table) throw new Error('Chapter 5 "Consonant keys": no table')
  return table.rows.map((row) => {
    const markup = row[1].text
    const slot = tableSlot(row[0])
    return {
      slot,
      group: groupOf(slot),
      sounds: unique([...markup.matchAll(/<ins>(.*?)<\/ins>/g)].map((m) => m[1].trim())),
      examples: markup.replace(/<\/?ins>/g, '').split(/\s+/).filter((w) => w !== ''),
      source: 'Consonant keys',
    }
  })
}

function vowelEntry(ch5: Token[], slot: string): KeyChartEntry {
  const title = VOWEL_SECTIONS[slot]
  const where = `Chapter 5, slot ${slot}`
  const body = section(ch5, title, where)
  const sounds: string[] = []
  const examples: string[] = []
  for (const token of body) {
    if (token.type === 'paragraph') {
      const ipa = /^IPA:\s*(.+)$/.exec(plainText((token as Tokens.Paragraph).tokens))
      if (ipa) sounds.push(ipa[1])
    } else if (token.type === 'list') {
      for (const item of (token as Tokens.List).items) examples.push(plainText(item.tokens))
    }
  }
  if (sounds.length === 0 && examples.length === 0) throw new Error(`${where}: section ${JSON.stringify(title)} has no IPA or examples`)
  return { slot, group: 'vowel', sounds, examples: examples.slice(0, MAX_EXAMPLES), source: title }
}

// The book never gives the right-hand R a table row; its "Steno order" section says "car" uses it and underlines
// that R in the layout string.
function rightREntry(ch5: Token[]): KeyChartEntry {
  const title = 'Steno order'
  const where = 'Chapter 5, slot -R'
  const body = section(ch5, title, where)
  let example: string | undefined
  let sound: string | undefined
  for (const token of body) {
    if (token.type !== 'paragraph') continue
    example ??= /"([^"]+)"[^?.]*`-R`/.exec(token.raw)?.[1]
    sound ??= /EUF<ins>([A-Za-z]+)<\/ins>PBLGTSDZ/.exec(token.raw)?.[1]
  }
  if (example === undefined || sound === undefined) {
    throw new Error(`${where}: the ${JSON.stringify(title)} section does not describe -R`)
  }
  return { slot: '-R', group: 'right', sounds: [sound.toLowerCase()], examples: [example], source: title }
}

function specialEntries(ch4: Token[], ch18: Token[]): KeyChartEntry[] {
  const backspace = 'The backspace key'
  const numbers = 'Numbers'
  return [
    {
      slot: '*',
      group: 'special',
      sounds: [sentenceWith(section(ch4, backspace, 'Chapter 4, slot *'), 'asterisk key', 'Chapter 4, slot *')],
      examples: [],
      source: backspace,
    },
    {
      slot: '#',
      group: 'special',
      sounds: [sentenceWith(section(ch18, numbers, 'Chapter 18, slot #'), 'number key', 'Chapter 18, slot #')],
      examples: [],
      source: numbers,
    },
  ]
}

export function parseKeyChart(sources: KeyChartSources): KeyChartEntry[] {
  const lex = (markdown: string): Token[] => new Lexer({ gfm: true }).lex(markdown)
  const ch5 = lex(sources.ch5)
  const found = new Map<string, KeyChartEntry>()
  const add = (entry: KeyChartEntry): void => {
    if (found.has(entry.slot)) throw new Error(`key chart: duplicate entry for slot ${entry.slot}`)
    found.set(entry.slot, entry)
  }
  for (const entry of consonantEntries(ch5)) add(entry)
  add(rightREntry(ch5))
  for (const slot of VOWELS) add(vowelEntry(ch5, slot))
  for (const entry of specialEntries(lex(sources.ch4), lex(sources.ch18))) add(entry)
  return SLOTS.map((slot) => {
    const entry = found.get(slot)
    if (!entry) throw new Error(`key chart: missing entry for slot ${slot}`)
    return entry
  })
}
