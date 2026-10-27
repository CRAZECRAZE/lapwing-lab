import type { ExampleRow } from './examples.ts'
import type { PracticeItem } from './practice.ts'
import type { BriefRow } from './tables.ts'

export type LookupSource = 'practice' | 'brief' | 'example'
export type LookupHit = { outline: string; chapter: number; source: LookupSource; note?: string }
export type LookupEntry = { word: string; hits: LookupHit[] }
export type LookupList = { id: string; chapter: number; items: PracticeItem[] }

const SOURCE_ORDER: Record<LookupSource, number> = { practice: 0, brief: 1, example: 2 }

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

function compareHits(a: LookupHit, b: LookupHit): number {
  return a.chapter - b.chapter || SOURCE_ORDER[a.source] - SOURCE_ORDER[b.source] || compare(a.outline, b.outline)
}

// The words the book has taught, each with every outline it appears with: the words of the book's practice lists,
// the brief tables and the example words in the chapter text. Words merge by lower-cased trimmed text; the display
// form is the first one seen (lists, then briefs, then examples).
export function buildLookup(input: { lists: LookupList[]; briefs: BriefRow[]; examples: ExampleRow[] }): LookupEntry[] {
  const entries = new Map<string, { word: string; hits: Map<string, LookupHit> }>()

  function add(rawWord: string, hit: LookupHit): void {
    const word = rawWord.trim()
    if (word === '') return
    const key = word.toLowerCase()
    let entry = entries.get(key)
    if (!entry) {
      entry = { word, hits: new Map() }
      entries.set(key, entry)
    }
    const hitKey = JSON.stringify([hit.outline, hit.chapter, hit.source])
    const known = entry.hits.get(hitKey)
    if (!known || (known.note === undefined && hit.note !== undefined)) entry.hits.set(hitKey, hit)
  }

  for (const list of input.lists) {
    for (const item of list.items) {
      for (const outline of item.outlines) add(item.prompt, { outline, chapter: list.chapter, source: 'practice' })
    }
  }
  for (const row of input.briefs) {
    for (const outline of row.outlines) {
      const hit: LookupHit = { outline, chapter: row.chapter, source: 'brief' }
      if (row.explanation !== '') hit.note = row.explanation
      add(row.translation, hit)
    }
  }
  for (const row of input.examples) {
    for (const outline of row.outlines) add(row.word, { outline, chapter: row.chapter, source: 'example' })
  }

  return [...entries.entries()]
    .sort(([a], [b]) => compare(a, b))
    .map(([, entry]) => ({ word: entry.word, hits: [...entry.hits.values()].sort(compareHits) }))
}
