// Lookup search over the prebuilt word index: words and outlines, limited to the chapters taught so far.
// Pure: no DOM, no fetch, no Node.
import type { LookupEntry, LookupHit } from '../../scripts/lib/lookup.ts'

export type SearchOptions = { maxChapter?: number; limit?: number }
export type SearchResult = { word: string; hits: LookupHit[]; match: 'exact' | 'prefix' | 'contains' | 'outline' }

const DEFAULT_LIMIT = 30
const STENO_TEXT = /^[#STKPWHRAO*EUFRPBLGTSDZ\-/]+$/

/** True when the trimmed query is upper-case stroke text, so it is worth searching outlines for. */
export function looksLikeSteno(query: string): boolean {
  return STENO_TEXT.test(query.trim())
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

type Candidate = { word: string; lower: string; hits: LookupHit[] }

function byWord(a: Candidate, b: Candidate): number {
  return compare(a.lower, b.lower) || compare(a.word, b.word)
}

/** Search the index: outlines first for stroke-looking queries, then the exact word, prefix and substring matches. */
export function searchLookup(entries: readonly LookupEntry[], query: string, opts: SearchOptions = {}): SearchResult[] {
  const text = query.trim()
  const limit = opts.limit ?? DEFAULT_LIMIT
  if (text === '' || limit <= 0) return []
  const maxChapter = opts.maxChapter

  const candidates: Candidate[] = []
  for (const entry of entries) {
    const hits = maxChapter === undefined ? [...entry.hits] : entry.hits.filter((h) => h.chapter <= maxChapter)
    if (hits.length > 0) candidates.push({ word: entry.word, lower: entry.word.toLowerCase(), hits })
  }

  const results: SearchResult[] = []
  const listed = new Set<Candidate>()
  function add(candidate: Candidate, match: SearchResult['match'], hits = candidate.hits): void {
    listed.add(candidate)
    results.push({ word: candidate.word, hits, match })
  }

  if (looksLikeSteno(text)) {
    const exact: Candidate[] = []
    const prefix: Candidate[] = []
    const matching = new Map<Candidate, LookupHit[]>()
    for (const candidate of candidates) {
      const equal = candidate.hits.filter((h) => h.outline === text)
      const starting = candidate.hits.filter((h) => h.outline !== text && h.outline.startsWith(text))
      if (equal.length === 0 && starting.length === 0) continue
      ;(equal.length > 0 ? exact : prefix).push(candidate)
      const first = new Set([...equal, ...starting])
      matching.set(candidate, [...equal, ...starting, ...candidate.hits.filter((h) => !first.has(h))])
    }
    for (const group of [exact, prefix]) {
      for (const candidate of group.sort(byWord)) add(candidate, 'outline', matching.get(candidate))
    }
  }

  const lowerQuery = text.toLowerCase()
  const exactWord = candidates.filter((c) => c.lower === lowerQuery).sort(byWord)
  const prefixWord = candidates.filter((c) => c.lower !== lowerQuery && c.lower.startsWith(lowerQuery)).sort(byWord)
  const containsWord = candidates.filter((c) => !c.lower.startsWith(lowerQuery) && c.lower.includes(lowerQuery)).sort(byWord)
  for (const [group, match] of [
    [exactWord, 'exact'],
    [prefixWord, 'prefix'],
    [containsWord, 'contains'],
  ] as const) {
    for (const candidate of group) if (!listed.has(candidate)) add(candidate, match)
  }

  return results.slice(0, limit)
}
