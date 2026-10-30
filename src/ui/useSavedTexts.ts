import { useEffect, useState } from 'preact/hooks'
import { listTexts } from '../api.ts'
import type { SavedTextSummary } from '../api.ts'

/** The most texts that can be saved, and the longest name (the server holds the same limits). */
export const MAX_SAVED_TEXTS = 50
export const MAX_NAME_CHARS = 60

export type SavedTexts = { status: 'loading' } | { status: 'error' } | { status: 'ready'; texts: SavedTextSummary[] }

const byName = (a: SavedTextSummary, b: SavedTextSummary): number =>
  a.name.localeCompare(b.name, 'en') || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

/** The saved texts, loaded once; `add` and `remove` edit the loaded list in place (a text saved or deleted) and `retry` reloads it. */
export function useSavedTexts(): {
  saved: SavedTexts
  retry(): void
  add(text: SavedTextSummary): void
  remove(id: string): void
} {
  const [saved, setSaved] = useState<SavedTexts>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let live = true
    listTexts().then(
      (texts) => live && setSaved({ status: 'ready', texts }),
      () => live && setSaved({ status: 'error' }),
    )
    return () => {
      live = false
    }
  }, [attempt])
  const edit = (change: (texts: SavedTextSummary[]) => SavedTextSummary[]): void =>
    setSaved((now) => (now.status === 'ready' ? { status: 'ready', texts: change(now.texts) } : now))
  return {
    saved,
    retry: () => {
      setSaved({ status: 'loading' })
      setAttempt((n) => n + 1)
    },
    add: (text) => edit((texts) => [...texts.filter((t) => t.id !== text.id), text].sort(byName)),
    remove: (id) => edit((texts) => texts.filter((t) => t.id !== id)),
  }
}
