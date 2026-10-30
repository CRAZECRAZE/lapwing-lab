// The fix-up drill's two lists (words and patterns), built from the archive rows of a date range.
import { buildLists } from '../src/core/fixup.ts'
import type { FixupLists } from '../src/core/fixup.ts'
import type { Archive } from './archive.ts'

export function buildFixup(archive: Archive, q: { from: string; to: string }): FixupLists {
  const { words, patterns } = buildLists(archive.fixupRowsInRange(q.from, q.to))
  return { from: q.from, to: q.to, words, patterns }
}

export function emptyFixup(q: { from: string; to: string }): FixupLists {
  return { from: q.from, to: q.to, words: [], patterns: [] }
}
