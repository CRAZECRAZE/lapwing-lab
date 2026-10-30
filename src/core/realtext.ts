// Real-text practice: turn pasted text into drill words using the generated dictionary.
// Pure: no DOM, no fetch, no Node.
import type { DictCard } from '../../scripts/lib/dictionary.ts'
import type { DrillItem } from './drill.ts'
import { parseOutline } from './steno.ts'

/** A text is drilled in parts of this many words. */
export const PART_SIZE = 100
/** The longest text, in characters, that is checked or saved. */
export const MAX_TEXT_CHARS = 200000
const ID_MAX = 40

export type TextPlan = {
  /** The drill: words that can be stroked, in text order; a hyphenated word with no entry of its own gives one per part. */
  items: DrillItem[]
  /** Tokens with a letter in them. */
  words: number
  /** Words that matched an entry, whole or by their parts: `words` less the missing counts. Never above `words`. */
  covered: number
  /** Tokens with no letter in them (numbers, symbols). */
  skipped: number
  /** Words with no entry, as written, most frequent first, then alphabetical. */
  missing: { word: string; count: number }[]
}

function valid(outline: string): boolean {
  try {
    parseOutline(outline)
    return true
  } catch {
    return false
  }
}

/**
 * Card text → its outlines in row order, for dictionary cards only (named key and command cards never match).
 * Outlines that do not parse are dropped, and so is a card left with none. Built once, then used for any number of texts.
 */
export function buildLookup(cards: readonly DictCard[]): ReadonlyMap<string, string[]> {
  const lookup = new Map<string, string[]>()
  for (const card of cards) {
    if (card.n || lookup.has(card.t)) continue
    const outlines = card.r.map((row) => row.o).filter(valid)
    if (outlines.length > 0) lookup.set(card.t, outlines)
  }
  return lookup
}

const HAS_LETTER = /\p{L}/u
const EDGE_PUNCTUATION = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu

/** The card text and outlines a word matches: exactly as written first, then in lower case. */
function find(word: string, lookup: ReadonlyMap<string, string[]>): { text: string; outlines: string[] } | undefined {
  let outlines = lookup.get(word)
  if (outlines) return { text: word, outlines }
  const lower = word.toLowerCase()
  outlines = lower === word ? undefined : lookup.get(lower)
  return outlines ? { text: lower, outlines } : undefined
}

/** A token as it is looked up: composed, straight apostrophes, and no punctuation around it. */
function clean(token: string): string {
  return token.normalize('NFC').replaceAll('\u2019', "'").replace(EDGE_PUNCTUATION, '')
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/**
 * Plan a text for drilling. A word is the text between whitespace with the punctuation around it removed; inner
 * apostrophes and hyphens stay, and a curly apostrophe counts as a straight one. A hyphenated word with no entry is
 * tried as its parts; when any part is unknown the whole word is missing. A token with no letter is skipped.
 */
export function planText(text: string, lookup: ReadonlyMap<string, string[]>): TextPlan {
  const items: DrillItem[] = []
  const unknown = new Map<string, number>()
  let words = 0
  let skipped = 0
  let unmatched = 0

  const take = (found: { text: string; outlines: string[] }): void => {
    items.push({
      prompt: found.text,
      outlines: found.outlines.slice(),
      kind: 'word',
    })
  }

  for (const token of text.split(/\s+/u)) {
    if (token === '') continue
    if (!HAS_LETTER.test(token)) {
      skipped++
      continue
    }
    words++
    const word = clean(token)
    const whole = find(word, lookup)
    if (whole) {
      take(whole)
      continue
    }
    const found: { text: string; outlines: string[] }[] = []
    if (word.includes('-')) {
      for (const piece of word.split('-')) {
        const part = clean(piece)
        if (part === '') continue
        const hit = find(part, lookup)
        if (!hit) {
          found.length = 0
          break
        }
        found.push(hit)
      }
    }
    if (found.length > 1) for (const hit of found) take(hit)
    else {
      unknown.set(word, (unknown.get(word) ?? 0) + 1)
      unmatched++
    }
  }

  const missing = [...unknown].map(([word, count]) => ({ word, count }))
  missing.sort((a, b) => b.count - a.count || compare(a.word, b.word))
  return { items, words, covered: words - unmatched, skipped, missing }
}

/** The items cut into consecutive parts of `size` (the last may be shorter); no parts for no items. */
export function partsOf<T>(items: readonly T[], size: number = PART_SIZE): T[][] {
  const parts: T[][] = []
  for (let at = 0; at < items.length; at += size) parts.push(items.slice(at, at + size))
  return parts
}

/**
 * An id for a saved text, from its name: lower-case letters and digits with single dashes between, at most 40
 * characters, `text` when nothing is left, and `-2`, `-3`… added (the base cut to fit) while the id is in `taken`.
 */
export function textIdFor(name: string, taken: readonly string[]): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
  const cut = (room: number): string => slug.slice(0, room).replace(/-+$/, '')
  const base = cut(ID_MAX) || 'text'
  let id = base
  // The suffix counts toward the limit, so the base is cut to leave room for it.
  for (let n = 2; taken.includes(id); n++) {
    const suffix = `-${n}`
    id = `${cut(ID_MAX - suffix.length) || 'text'}${suffix}`
  }
  return id
}
