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
  /** On a named card, the dictionary's translations of this outline (an empty array means none). */
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
