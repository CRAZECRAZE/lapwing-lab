import { useEffect, useState } from 'preact/hooks'
import type { DictionaryFile } from '../../scripts/lib/dictionary.ts'
import { buildLookup } from '../core/realtext.ts'
import { loadDictionary } from './tools/Lookup.tsx'

export type TextLookup =
  { status: 'loading' } | { status: 'error' } | { status: 'ready'; lookup: ReadonlyMap<string, string[]> }

/** One lookup per loaded dictionary file, built on first use and kept for as long as the file is. */
const built = new WeakMap<DictionaryFile, ReadonlyMap<string, string[]>>()

function lookupOf(file: DictionaryFile): ReadonlyMap<string, string[]> {
  let lookup = built.get(file)
  if (!lookup) {
    lookup = buildLookup(file.cards)
    built.set(file, lookup)
  }
  return lookup
}

/** The word → outlines lookup of the dictionary, and a `retry` for when it would not load. */
export function useTextLookup(): { lookup: TextLookup; retry(): void } {
  const [lookup, setLookup] = useState<TextLookup>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let live = true
    loadDictionary().then(
      (file) => live && setLookup({ status: 'ready', lookup: lookupOf(file) }),
      () => live && setLookup({ status: 'error' }),
    )
    return () => {
      live = false
    }
  }, [attempt])
  return {
    lookup,
    retry: () => {
      setLookup({ status: 'loading' })
      setAttempt((n) => n + 1)
    },
  }
}
