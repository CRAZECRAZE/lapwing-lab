import { compareOutlines } from '../../src/core/outline.ts'
import type { ExampleRow } from './examples.ts'
import type { PracticeItem } from './practice.ts'
import type { BriefRow } from './tables.ts'

/** The six upstream dictionary files, in the order they are merged and displayed. */
export const DICT_FILES = ['main', 'uk', 'names', 'numbers', 'commands', 'movement'] as const
export type DictFile = typeof DICT_FILES[number]

/** The vendored file each dictionary is read from, under content/lapwing-dictionary/. */
export const DICT_FILE_NAMES: Record<DictFile, string> = {
  main: 'lapwing-base.json',
  uk: 'lapwing-uk-additions.json',
  names: 'lapwing-proper-nouns.json',
  numbers: 'lapwing-numbers.json',
  commands: 'lapwing-commands.json',
  movement: 'lapwing-semi-modal-movement.json',
}

/**
 * The generated lists whose items name keys, symbols and commands rather than words. Their items always become
 * named cards, even when a name equals a dictionary word (the book's `Enter` is the key, not the word `enter`).
 */
export const NAMED_LIST_IDS = ['18-lowercase', '18-numbers', '18-uppercase', '20-commands', '20-punctuation'] as const

/**
 * A practice list as the dictionary build reads it. `named` marks a list of names (of keys, symbols, commands) that
 * the build never joins to word cards.
 */
export type LookupList = { id: string; chapter: number; items: PracticeItem[]; named?: true }

/** Where in the book an outline appears: a practice list, a brief form, or an example. */
export type BookSource = 'practice' | 'brief' | 'example'

/** One place the book uses an outline. */
export type BookLabel = {
  /** Chapter number. */
  chapter: number
  source: BookSource
  /** A short remark from the book, when it has one. */
  note?: string
}

/** One outline row of a card. Short keys keep the generated file small. */
export type DictRow = {
  /** The outline, strokes joined by '/'. */
  o: string
  /** The non-main files that also hold this exact outline and translation. */
  f?: DictFile[]
  /** Where the book uses this outline. */
  b?: BookLabel[]
  /** True for a row only the book has: the dictionary does not hold this pair. */
  x?: true
  /**
   * What the dictionary writes for this outline, sorted: on a named card always (an empty array means none); on a
   * book-only (`x`) row only when the dictionary holds the outline under other translations, never empty.
   */
  w?: string[]
}

/** One card: a translation and the outlines that write it. */
export type DictCard = {
  /** The exact translation, or the book's text for a named card. */
  t: string
  /** The rows, already in display order. */
  r: DictRow[]
  /** True for a card the book names that has no dictionary translation of that text. */
  n?: true
}

/** The generated dictionary file the client loads. */
export type DictionaryFile = {
  /** The upstream commit the dictionary files were vendored from. */
  commit: string
  cards: DictCard[]
  /** Letter or symbol name → the outline that writes it. */
  letters: Record<string, string>
}

/**
 * Translation (exact string) → outline → the files that hold that exact pair, in DICT_FILES order.
 * Iterates files in DICT_FILES order and each file in its key order, so the result is deterministic;
 * a pair held by several files becomes one outline with several files. Does not change its input.
 */
export function mergeDictionaries(
  files: Record<DictFile, Record<string, string>>,
): Map<string, Map<string, DictFile[]>> {
  const merged = new Map<string, Map<string, DictFile[]>>()
  for (const file of DICT_FILES) {
    for (const [outline, translation] of Object.entries(files[file])) {
      let outlines = merged.get(translation)
      if (!outlines) {
        outlines = new Map()
        merged.set(translation, outlines)
      }
      const held = outlines.get(outline)
      if (held) held.push(file)
      else outlines.set(outline, [file])
    }
  }
  return merged
}

const SOURCE_ORDER: Record<BookSource, number> = { practice: 0, brief: 1, example: 2 }

/** One place the book uses an outline for a text. */
type BookEntry = { text: string; outline: string; chapter: number; source: BookSource; note: string; named: boolean }

type RowState = { o: string; f: DictFile[]; labels: Map<string, BookLabel>; x: boolean; named: boolean }
type CardState = { t: string; named: boolean; rows: Map<string, RowState> }

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

function addLabel(row: RowState, entry: BookEntry): void {
  const key = `${entry.chapter}|${entry.source}`
  const known = row.labels.get(key)
  if (!known) {
    const label: BookLabel = { chapter: entry.chapter, source: entry.source }
    if (entry.note !== '') label.note = entry.note
    row.labels.set(key, label)
  } else if (known.note === undefined && entry.note !== '') {
    known.note = entry.note
  }
}

function newRow(o: string): RowState {
  return { o, f: [], labels: new Map(), x: false, named: false }
}

function finishRow(row: RowState, words: Map<string, string[]>): DictRow {
  const out: DictRow = { o: row.o }
  if (row.f.length > 0) out.f = row.f
  if (row.labels.size > 0) {
    out.b = [...row.labels.values()].sort((a, b) => a.chapter - b.chapter || SOURCE_ORDER[a.source] - SOURCE_ORDER[b.source])
  }
  if (row.x) out.x = true
  if (row.named) out.w = [...(words.get(row.o) ?? [])].sort(compareText)
  else if (row.x) {
    const written = words.get(row.o)
    if (written && written.length > 0) out.w = [...written].sort(compareText)
  }
  return out
}

/**
 * The dictionary file the client loads: one card per exact translation, every outline of it, and the
 * book's chapter labels joined on (text ignoring case and outline equal), never on outline alone.
 * Pure and deterministic. Book entries: every list item (practice), brief outline and example outline;
 * a text no card matches gets a named card (merged by exact trimmed text), as does every item of a `named` list
 * (NAMED_LIST_IDS); an outline its card lacks gets an `x` row.
 */
export function buildDictionary(input: {
  files: Record<DictFile, Record<string, string>>
  lists: LookupList[]
  briefs: BriefRow[]
  examples: ExampleRow[]
  commit: string
}): DictionaryFile {
  const merged = mergeDictionaries(input.files)

  // The dictionary's own cards, in card order, indexed by lower-cased and by exact text.
  const cards: CardState[] = []
  const words = new Map<string, string[]>()
  for (const [t, outlines] of merged) {
    const rows = new Map<string, RowState>()
    for (const [o, files] of outlines) {
      const row = newRow(o)
      row.f = files.filter((f) => f !== 'main')
      rows.set(o, row)
      const list = words.get(o)
      if (list) list.push(t)
      else words.set(o, [t])
    }
    cards.push({ t, named: false, rows })
  }
  cards.sort((a, b) => compareText(a.t.toLowerCase(), b.t.toLowerCase()) || compareText(a.t, b.t))
  const byLower = new Map<string, CardState[]>()
  const byExact = new Map<string, CardState>()
  for (const card of cards) {
    const key = card.t.toLowerCase()
    const same = byLower.get(key)
    if (same) same.push(card)
    else byLower.set(key, [card])
    byExact.set(card.t, card)
  }

  // Every place the book uses an outline, in processing order: lists, then briefs, then examples.
  const entries: BookEntry[] = []
  for (const list of input.lists) {
    for (const item of list.items) {
      for (const outline of item.outlines) {
        entries.push({ text: item.prompt, outline, chapter: list.chapter, source: 'practice', note: '', named: list.named === true })
      }
    }
  }
  for (const row of input.briefs) {
    for (const outline of row.outlines) {
      entries.push({ text: row.translation, outline, chapter: row.chapter, source: 'brief', note: row.explanation, named: false })
    }
  }
  for (const row of input.examples) {
    for (const outline of row.outlines) {
      entries.push({ text: row.word, outline, chapter: row.chapter, source: 'example', note: '', named: false })
    }
  }

  // First the labels that land on a row the dictionary has; the rest wait for the second pass.
  const unmatched: BookEntry[] = []
  const named = new Map<string, CardState>()
  const namedCards: CardState[] = []
  for (const entry of entries) {
    const text = entry.text.trim()
    if (text === '' || entry.outline === '') continue
    // A name from a list of names never joins a word card; any other text no card matches gets a named card too.
    const matching = entry.named ? undefined : byLower.get(text.toLowerCase())
    if (!matching) {
      let card = named.get(text)
      if (!card) {
        card = { t: text, named: true, rows: new Map() }
        named.set(text, card)
        namedCards.push(card)
      }
      let row = card.rows.get(entry.outline)
      if (!row) {
        row = newRow(entry.outline)
        row.named = true
        card.rows.set(entry.outline, row)
      }
      addLabel(row, entry)
      continue
    }
    let attached = false
    for (const card of matching) {
      const row = card.rows.get(entry.outline)
      if (row && !row.x) {
        addLabel(row, entry)
        attached = true
      }
    }
    if (!attached) unmatched.push({ ...entry, text })
  }
  for (const entry of unmatched) {
    const card = byExact.get(entry.text) ?? byLower.get(entry.text.toLowerCase())![0]
    let row = card.rows.get(entry.outline)
    if (!row) {
      row = newRow(entry.outline)
      row.x = true
      card.rows.set(entry.outline, row)
    }
    addLabel(row, entry)
  }

  const all = [...cards, ...namedCards]
  all.sort(
    (a, b) =>
      compareText(a.t.toLowerCase(), b.t.toLowerCase()) || compareText(a.t, b.t) || Number(a.named) - Number(b.named),
  )
  const out: DictCard[] = all.map((card) => {
    const rows = [...card.rows.values()].sort((a, b) => compareOutlines(a.o, b.o)).map((row) => finishRow(row, words))
    return card.named ? { t: card.t, n: true, r: rows } : { t: card.t, r: rows }
  })

  const letters: Record<string, string> = {}
  const lowercase = input.lists.find((list) => list.id === '18-lowercase')
  for (const item of lowercase?.items ?? []) {
    if (item.outlines.length > 0) letters[item.prompt] = item.outlines[0]
  }

  return { commit: input.commit, cards: out, letters }
}
