// Lookup search over the generated dictionary: translations (words) and outlines.
// Pure: no DOM, no fetch, no Node.
import type { DictCard } from '../../scripts/lib/dictionary.ts'
import { compareOutlines, outlineKeys, outlineStrokes } from './outline.ts'

export type DictMatch = 'exact' | 'prefix' | 'contains' | 'outline-exact' | 'outline-prefix' | 'outline-contains'
/** `hit` holds the outlines that matched, for outline matches only. */
export type DictResult = { card: DictCard; match: DictMatch; hit?: ReadonlySet<string> }

const STENO_TEXT = /^[#STKPWHRAO*EUFRPBLGTSDZ\-/]+$/
const LETTERS = /^[a-z]+$/

/** True when the trimmed query is upper-case stroke text, so it is worth searching outlines for. */
export function looksLikeSteno(query: string): boolean {
  return STENO_TEXT.test(query.trim())
}

/**
 * A translation for display: a real newline, carriage return and tab become the two characters `\n`, `\r`, `\t`,
 * so they show. Every other character is left alone, including other control characters.
 */
export function visibleText(text: string): string {
  return text.replace(/[\n\r\t]/g, (ch) => (ch === '\n' ? '\\n' : ch === '\r' ? '\\r' : '\\t'))
}

/**
 * The fingerspelling outlines of a query that is one run of lower-case letters (after trimming), in order.
 * Null for any other query, and when `letters` lacks one of the letters.
 */
export function fingerspell(query: string, letters: Readonly<Record<string, string>>): string[] | null {
  const text = query.trim()
  if (!LETTERS.test(text)) return null
  const outlines: string[] = []
  for (const letter of text) {
    if (!Object.hasOwn(letters, letter)) return null
    outlines.push(letters[letter])
  }
  return outlines
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/** What is worked out once per cards array. */
type Index = {
  /** The lower-cased text of each card. */
  lower: string[]
  /** The position of each card when all cards are ordered by lower-cased text, exact text, dictionary before named. */
  rank: Uint32Array
  /** The card at each position of that order. */
  byRank: Uint32Array
  /** Strokes and keys of the outlines seen as a best match so far: counting keys is the slow part of sorting. */
  sizes: Map<string, readonly [strokes: number, keys: number]>
}

const indexes = new WeakMap<readonly DictCard[], Index>()

function indexFor(cards: readonly DictCard[]): Index {
  const cached = indexes.get(cards)
  if (cached) return cached
  const count = cards.length
  const lower = cards.map((c) => c.t.toLowerCase())
  const before = (a: number, b: number): number =>
    compare(lower[a], lower[b]) || compare(cards[a].t, cards[b].t) || (cards[a].n ? 1 : 0) - (cards[b].n ? 1 : 0)
  const byRank = new Uint32Array(count)
  for (let i = 0; i < count; i++) byRank[i] = i
  // The build writes cards already in this order, so the sort is usually skipped.
  let sorted = true
  for (let i = 1; i < count && sorted; i++) sorted = before(i - 1, i) <= 0
  if (!sorted) byRank.sort(before)
  const rank = new Uint32Array(count)
  for (let r = 0; r < count; r++) rank[byRank[r]] = r
  const index: Index = { lower, rank, byRank, sizes: new Map() }
  indexes.set(cards, index)
  return index
}

/**
 * Card indexes in the order word results use inside a group: a card whose text is the query exactly first, then
 * shorter text, then lower-cased text, then exact text, then dictionary before named. Sorts one number per card
 * (length and rank) instead of calling a comparison.
 */
function wordOrder(cards: readonly DictCard[], index: Index, found: number[], text: string): number[] {
  const count = cards.length
  const keys = new Float64Array(found.length)
  for (let k = 0; k < found.length; k++) {
    const t = cards[found[k]].t
    keys[k] = (t === text ? 0 : t.length + 1) * count + index.rank[found[k]]
  }
  keys.sort()
  return Array.from(keys, (key) => index.byRank[key % count])
}

type Class = 0 | 1 | 2 | 3
const NONE = 3

/** How an outline matches a query: equal (0), starts with it (1), a stroke boundary after which it starts (2), or no (3). */
function classify(outline: string, query: string): Class {
  if (outline === query) return 0
  if (outline.startsWith(query)) return 1
  for (let slash = outline.indexOf('/'); slash >= 0; slash = outline.indexOf('/', slash + 1)) {
    if (outline.startsWith(query, slash + 1)) return 2
  }
  return NONE
}

const OUTLINE_MATCH = ['outline-exact', 'outline-prefix', 'outline-contains'] as const
const WORD_MATCH = ['exact', 'prefix', 'contains'] as const

/** A card with a matching outline, and its best matching outline's sort key (what `compareOutlines` compares). */
type OutlineCandidate = { i: number; best: string; strokes: number; keys: number; hit: Set<string> }

/**
 * Search the dictionary: for an upper-case stroke query the cards with a matching outline first (exact, starts with,
 * at a stroke start), then, for every query, the cards whose translation matches (exact, starts with, contains),
 * ignoring case. The whole ordered list; the caller shows part of it.
 */
export function searchDictionary(cards: readonly DictCard[], query: string): DictResult[] {
  const text = query.trim()
  if (text === '') return []
  const index = indexFor(cards)
  const results: DictResult[] = []
  const listed = new Uint8Array(cards.length)

  if (looksLikeSteno(text)) {
    const groups: OutlineCandidate[][] = [[], [], []]
    for (let i = 0; i < cards.length; i++) {
      let best: Class = NONE
      let hit: Set<string> | undefined
      for (const row of cards[i].r) {
        const how = classify(row.o, text)
        if (how === NONE || how > best) continue
        if (how < best || !hit) {
          best = how
          hit = new Set()
        }
        hit.add(row.o)
      }
      if (best === NONE || !hit) continue
      let first: string | undefined
      for (const outline of hit) if (first === undefined || compareOutlines(outline, first) < 0) first = outline
      const outline = first ?? ''
      let size = index.sizes.get(outline)
      if (!size) {
        size = [outlineStrokes(outline), outlineKeys(outline)]
        index.sizes.set(outline, size)
      }
      groups[best].push({ i, best: outline, strokes: size[0], keys: size[1], hit })
    }
    groups.forEach((group, how) => {
      group.sort(
        (a, b) =>
          a.strokes - b.strokes ||
          a.keys - b.keys ||
          compare(a.best, b.best) ||
          cards[a.i].t.length - cards[b.i].t.length ||
          index.rank[a.i] - index.rank[b.i],
      )
      for (const { i, hit } of group) {
        listed[i] = 1
        results.push({ card: cards[i], match: OUTLINE_MATCH[how], hit })
      }
    })
  }

  const lowerQuery = text.toLowerCase()
  const words: number[][] = [[], [], []]
  for (let i = 0; i < cards.length; i++) {
    if (listed[i]) continue
    const lower = index.lower[i]
    const at = lower.indexOf(lowerQuery)
    if (at < 0) continue
    words[at > 0 ? 2 : lower.length === lowerQuery.length ? 0 : 1].push(i)
  }
  words.forEach((found, how) => {
    for (const i of wordOrder(cards, index, found, text)) results.push({ card: cards[i], match: WORD_MATCH[how] })
  })
  return results
}
