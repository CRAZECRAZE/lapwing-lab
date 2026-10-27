// Free type: a flowing run of words drawn from the Chapter 4 pseudo-words or the chapter word lists.
import type { PracticeIndexEntry } from '../../scripts/build-content.ts'
import type { PracticeList } from '../../scripts/lib/practice.ts'
import type { Stage0Words } from '../../scripts/lib/stage0.ts'
import type { DrillItem } from '../core/drill.ts'
import type { DrillKind } from '../ui/Drill.tsx'

export type FreeMode = { id: string; label: string; words?: number; seconds?: number }

export const FREE_MODES: readonly FreeMode[] = [
  { id: 'words-25', label: '25 words', words: 25 },
  { id: 'words-50', label: '50 words', words: 50 },
  { id: 'time-30', label: '30 seconds', seconds: 30 },
  { id: 'time-60', label: '60 seconds', seconds: 60 },
]

/** The owner's own amounts: 1 to 500 words, or 5 to 600 seconds. */
export const MAX_CUSTOM_WORDS = 500
export const MIN_CUSTOM_SECONDS = 5
export const MAX_CUSTOM_SECONDS = 600

/** Items prepared for a short timed run; a longer one gets five a second so it cannot run out. */
const MIN_TIMED_ITEMS = 400
const ITEMS_PER_SECOND = 5

/** Digits only, no leading zero: the only shape a custom amount takes in a mode id. */
const CUSTOM_ID = /^(words|time)-([1-9]\d*)$/

const inRange = (unit: 'words' | 'seconds', n: number): boolean =>
  Number.isInteger(n) && (unit === 'words' ? n >= 1 && n <= MAX_CUSTOM_WORDS : n >= MIN_CUSTOM_SECONDS && n <= MAX_CUSTOM_SECONDS)

/** The mode id for a custom amount (`words-40`, `time-90`), or undefined when it is not a whole number in range. */
export function customModeId(unit: 'words' | 'seconds', value: number): string | undefined {
  return inRange(unit, value) ? `${unit === 'words' ? 'words' : 'time'}-${value}` : undefined
}

/** A preset, or any custom amount in range; anything else is undefined. */
export function parseMode(id: string): FreeMode | undefined {
  const preset = FREE_MODES.find((m) => m.id === id)
  if (preset) return preset
  const match = CUSTOM_ID.exec(id)
  if (!match) return undefined
  const n = Number(match[2])
  if (match[1] === 'words') {
    return inRange('words', n) ? { id, label: `${n} ${n === 1 ? 'word' : 'words'}`, words: n } : undefined
  }
  return inRange('seconds', n) ? { id, label: `${n} seconds`, seconds: n } : undefined
}

export type FreeSource = { id: string; label: string; chapter: number; kind: DrillKind }

export const PSEUDO_SOURCE: FreeSource = { id: 'pseudo', label: 'Chapter 4 pseudo-words', chapter: 4, kind: 'stroke' }

/** The first chapter with word lists; every chapter source runs from here up to its own chapter. */
const FIRST_LIST_CHAPTER = 5

function chapterSource(chapter: number): FreeSource {
  const label =
    chapter === FIRST_LIST_CHAPTER ? `Chapter ${chapter} word lists` : `Chapters ${FIRST_LIST_CHAPTER}–${chapter} word lists`
  return { id: `ch-${chapter}`, label, chapter, kind: 'word' }
}

const CHAPTER_ID = /^ch-(\d+)$/

/** The pseudo-words, then one cumulative source per chapter (5 and up) that has lists, in chapter order. */
export function sourcesFor(index: readonly PracticeIndexEntry[]): FreeSource[] {
  const chapters = [...new Set(index.map((e) => e.chapter))].filter((n) => n >= FIRST_LIST_CHAPTER).sort((a, b) => a - b)
  return [PSEUDO_SOURCE, ...chapters.map(chapterSource)]
}

export function parseSource(id: string, index: readonly PracticeIndexEntry[]): FreeSource | undefined {
  return sourcesFor(index).find((s) => s.id === id)
}

/** The lists a source draws from: every list up to its chapter (none for the pseudo-words). */
export function listIdsFor(source: FreeSource, index: readonly PracticeIndexEntry[]): string[] {
  if (source.kind === 'stroke') return []
  return index.filter((e) => e.chapter >= FIRST_LIST_CHAPTER && e.chapter <= source.chapter).map((e) => e.id)
}

function dedupe(items: Iterable<DrillItem>): DrillItem[] {
  const byPrompt = new Map<string, DrillItem>()
  for (const item of items) if (!byPrompt.has(item.prompt)) byPrompt.set(item.prompt, item)
  return [...byPrompt.values()]
}

/** Every distinct item the source offers; the first item with a given prompt wins. */
export function poolFor(source: FreeSource, data: { words?: Stage0Words; lists?: PracticeList[] }): DrillItem[] {
  if (source.kind === 'stroke') {
    // A pseudo-word is itself the raw steno to press.
    const words = data.words ? [...data.words.test, ...data.words.extra.flat()] : []
    return dedupe(words.map((w) => ({ prompt: w, outlines: [w] })))
  }
  return dedupe((data.lists ?? []).flatMap((list) => list.items))
}

export function itemCountFor(mode: FreeMode): number {
  return mode.words ?? Math.max(MIN_TIMED_ITEMS, (mode.seconds ?? 0) * ITEMS_PER_SECOND)
}

function shuffle<T>(items: readonly T[], random: () => number): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/**
 * `count` items made of whole shuffled passes over the (prompt-deduped) pool, the last pass cut short.
 * No prompt repeats within a pass, and no two equal prompts sit side by side across a pass boundary.
 */
export function buildFreeItems(pool: readonly DrillItem[], count: number, random: () => number = Math.random): DrillItem[] {
  const distinct = dedupe(pool)
  if (distinct.length === 0) return []
  const out: DrillItem[] = []
  while (out.length < count) {
    const pass = shuffle(distinct, random)
    const previous = out.at(-1)
    // Prompts within a pass are distinct, so only the first can clash with the previous pass's last.
    if (pass.length > 1 && previous && pass[0].prompt === previous.prompt) {
      const j = 1 + Math.floor(random() * (pass.length - 1))
      ;[pass[0], pass[j]] = [pass[j], pass[0]]
    }
    out.push(...pass.slice(0, count - out.length))
  }
  return out
}

/** A free-type section (`<source>/<mode>`) in words, or the section itself when either part is unknown. */
export function describeFree(section: string): string {
  const [sourceId, modeId, ...rest] = section.split('/')
  const mode = parseMode(modeId ?? '')
  const chapter = CHAPTER_ID.exec(sourceId)
  const source =
    sourceId === PSEUDO_SOURCE.id
      ? PSEUDO_SOURCE
      : chapter && Number(chapter[1]) >= FIRST_LIST_CHAPTER
        ? chapterSource(Number(chapter[1]))
        : undefined
  if (!source || !mode || rest.length > 0) return section
  return `Free type · ${source.label} · ${mode.label}`
}
