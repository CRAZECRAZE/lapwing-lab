import { useLayoutEffect, useRef, useState } from 'preact/hooks'
import { getJournal, getNote, putJournal, putNote } from '../api.ts'

export type LoadPhase = 'loading' | 'error' | 'ready'
export type SaveStatus = 'saved' | 'pending' | 'saving' | 'failed'

const DEBOUNCE_MS = 800
const RETRY_MS = 5000
/** How long a failing save keeps retrying after its view has closed (about 120 tries). */
export const ORPHAN_RETRY_MS = 10 * 60 * 1000

/** Where a kind of text lives: the queue below is the same for every store. */
export type AutosaveStore = {
  id: string
  get(key: string): Promise<string>
  put(key: string, text: string): Promise<void>
}

export const journalStore: AutosaveStore = {
  id: 'journal',
  get: (key) => getJournal(key),
  put: (key, text) => putJournal(key, text),
}

/** Notes are keyed by chapter, as `String(chapter)`; any other key is refused before a request. */
function chapterOf(key: string): number {
  const chapter = Number(key)
  if (!Number.isInteger(chapter) || String(chapter) !== key) throw new RangeError(`Not a chapter key: ${key}`)
  return chapter
}

export const notesStore: AutosaveStore = {
  id: 'notes',
  get: async (key) => getNote(chapterOf(key)),
  put: async (key, text) => putNote(chapterOf(key), text),
}

// ---------------------------------------------------------------------------------------------
// Per-key save registry (one entry per store and key, e.g. a journal date or a note's chapter). It
// lives at module level so the owner's words outlive the view: a save that is in flight or failing
// when the view closes keeps going, and a view that opens the same key again waits for it (or shows
// its unsaved text) instead of trusting an older file.

type Listener = (status: SaveStatus) => void

interface Entry {
  store: AutosaveStore
  key: string // the key within the store (the registry key adds the store's id)
  text: string // the latest text the owner wants on disk
  saved: string // the last text known to be on disk
  inFlight: Promise<void> | null // settles (never rejects) when the current PUT is done
  retry: ReturnType<typeof setTimeout> | undefined
  listeners: Set<Listener> // open views of this key
  giveUpAt: number // for an entry with no open view: stop retrying after this time
}

const entries = new Map<string, Entry>()

/** The registry key: the store id keeps a journal date and a note key from ever colliding. */
const slot = (store: AutosaveStore, key: string): string => `${store.id}:${key}`

function notify(e: Entry, status: SaveStatus): void {
  for (const l of e.listeners) l(status)
}

function clearRetry(e: Entry): void {
  clearTimeout(e.retry)
  e.retry = undefined
}

/** Drops an entry once nothing is pending and no view holds it. */
function prune(store: AutosaveStore, key: string): void {
  const e = entries.get(slot(store, key))
  if (e && e.listeners.size === 0 && !e.inFlight && e.text === e.saved) {
    clearRetry(e)
    entries.delete(slot(store, key))
  }
}

/**
 * Saves the entry's latest text if it differs from what is on disk. One PUT per key at a time;
 * text that changed during a PUT goes out right after it settles. A failure retries every 5 s:
 * indefinitely while a view is open, and until `giveUpAt` once none is.
 */
function kick(store: AutosaveStore, key: string): void {
  const e = entries.get(slot(store, key))
  if (!e || e.inFlight) return
  clearRetry(e)
  if (e.text === e.saved) {
    prune(store, key)
    return
  }
  const sending = e.text
  notify(e, 'saving')
  e.inFlight = store.put(key, sending).then(
    () => {
      e.inFlight = null
      e.saved = sending
      if (e.text !== e.saved) return kick(store, key)
      notify(e, 'saved')
      prune(store, key)
    },
    () => {
      e.inFlight = null
      notify(e, 'failed')
      if (e.listeners.size === 0 && Date.now() >= e.giveUpAt) {
        entries.delete(slot(store, key))
        return
      }
      e.retry = setTimeout(() => {
        e.retry = undefined
        kick(store, key)
      }, RETRY_MS)
    },
  )
}

/**
 * The text to show for a key: waits for any save in flight for it, then prefers unsaved text
 * still held here over the file (which would be older).
 */
async function loadText(store: AutosaveStore, key: string): Promise<void> {
  const id = slot(store, key)
  for (let e = entries.get(id); e?.inFlight; e = entries.get(id)) await e.inFlight
  if (entries.has(id)) return
  const text = await store.get(key)
  for (let e = entries.get(id); e?.inFlight; e = entries.get(id)) await e.inFlight
  if (!entries.has(id)) {
    entries.set(id, { store, key, text, saved: text, inFlight: null, retry: undefined, listeners: new Set(), giveUpAt: 0 })
  }
}

/** For tests: forgets every pending save and stops its timer. */
export function __resetPendingSavesForTests(): void {
  for (const e of entries.values()) clearRetry(e)
  entries.clear()
}

// ---------------------------------------------------------------------------------------------

export interface Autosave {
  phase: LoadPhase
  status: SaveStatus
  text: string
  /** The owner typed; ignored until the note has loaded. */
  edit(value: string): void
  /** Saves a pending change now (blur). */
  flush(): void
  /** Loads the note again after a failed load. */
  reload(): void
}

/**
 * Loads one note (a journal day, a chapter's note, ...) from `store` and keeps it saved. The store and
 * key are fixed at mount: switching to another key is an unmount + mount, and the unmount flush sends
 * the pending text to the key this instance was made for.
 *
 * Guards that keep the owner's words safe:
 * - nothing is ever written until the note has loaded (a failed load would otherwise overwrite the file);
 * - never written when the text equals the last text known to be on disk;
 * - one save per key at a time (shared registry); edits made during a save are sent right after it;
 * - a failed save keeps the text and retries every 5 s, also after the view has closed;
 * - opening a key waits for that key's pending save, or shows its unsaved text.
 */
export function useAutosave(store: AutosaveStore, key: string, enabled: boolean): Autosave {
  const [phase, setPhase] = useState<LoadPhase>('loading')
  const [status, setStatus] = useState<SaveStatus>('saved')
  const [text, setText] = useState('')

  const s = useRef({
    store,
    key,
    live: true,
    entry: null as Entry | null, // set once the note has loaded; saving is impossible before
    debounce: undefined as ReturnType<typeof setTimeout> | undefined,
    loadSeq: 0,
    listener: ((next: SaveStatus) => {
      if (s.live) setStatus(next)
    }) as Listener,
  }).current

  const save = (): void => {
    if (!s.entry) return
    clearTimeout(s.debounce)
    s.debounce = undefined
    kick(s.store, s.key)
  }

  const load = (): void => {
    const seq = ++s.loadSeq
    setPhase('loading')
    loadText(s.store, s.key).then(
      () => {
        const e = entries.get(slot(s.store, s.key))
        if (!s.live || seq !== s.loadSeq || !e) {
          prune(s.store, s.key)
          return
        }
        e.listeners.add(s.listener)
        s.entry = e
        setText(e.text)
        setStatus(e.text === e.saved ? 'saved' : e.inFlight ? 'saving' : 'failed')
        setPhase('ready')
      },
      () => {
        if (!s.live || seq !== s.loadSeq) return
        setPhase('error')
      },
    )
  }

  useLayoutEffect(() => {
    s.live = true
    if (!enabled) return
    load()
    const onVisibility = (): void => {
      if (document.visibilityState === 'hidden') save()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      // Runs synchronously at unmount: hand the pending text to the registry for this instance's key.
      s.live = false
      document.removeEventListener('visibilitychange', onVisibility)
      clearTimeout(s.debounce)
      s.debounce = undefined
      const e = s.entry
      if (!e) return
      e.listeners.delete(s.listener)
      e.giveUpAt = Date.now() + ORPHAN_RETRY_MS
      kick(s.store, s.key)
    }
  }, [])

  const edit = (value: string): void => {
    const e = s.entry
    if (!e) return
    e.text = value
    setText(value)
    clearTimeout(s.debounce)
    s.debounce = undefined
    if (e.inFlight) return // the settle handler sends the latest text
    if (value === e.saved) {
      clearRetry(e)
      setStatus('saved')
      return
    }
    setStatus((prev) => (prev === 'failed' ? 'failed' : 'pending'))
    s.debounce = setTimeout(() => {
      s.debounce = undefined
      kick(s.store, s.key)
    }, DEBOUNCE_MS)
  }

  const reload = (): void => {
    if (!s.entry) load()
  }

  return { phase, status, text, edit, flush: save, reload }
}
