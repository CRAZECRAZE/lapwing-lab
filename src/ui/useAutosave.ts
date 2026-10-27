import { useLayoutEffect, useRef, useState } from 'preact/hooks'
import { getJournal, putJournal } from '../api.ts'

export type LoadPhase = 'loading' | 'error' | 'ready'
export type SaveStatus = 'saved' | 'pending' | 'saving' | 'failed'

const DEBOUNCE_MS = 800
const RETRY_MS = 5000
/** How long a failing save keeps retrying after its view has closed (about 120 tries). */
export const ORPHAN_RETRY_MS = 10 * 60 * 1000

// ---------------------------------------------------------------------------------------------
// Per-date save registry. It lives at module level so the owner's words outlive the view: a save
// that is in flight or failing when the view closes keeps going, and a view that opens the same day
// again waits for it (or shows its unsaved text) instead of trusting an older file.

type Listener = (status: SaveStatus) => void

interface Entry {
  text: string // the latest text the owner wants on disk
  saved: string // the last text known to be on disk
  inFlight: Promise<void> | null // settles (never rejects) when the current PUT is done
  retry: ReturnType<typeof setTimeout> | undefined
  listeners: Set<Listener> // open views of this date
  giveUpAt: number // for an entry with no open view: stop retrying after this time
}

const entries = new Map<string, Entry>()

function notify(e: Entry, status: SaveStatus): void {
  for (const l of e.listeners) l(status)
}

function clearRetry(e: Entry): void {
  clearTimeout(e.retry)
  e.retry = undefined
}

/** Drops an entry once nothing is pending and no view holds it. */
function prune(date: string): void {
  const e = entries.get(date)
  if (e && e.listeners.size === 0 && !e.inFlight && e.text === e.saved) {
    clearRetry(e)
    entries.delete(date)
  }
}

/**
 * Saves the entry's latest text if it differs from what is on disk. One PUT per date at a time;
 * text that changed during a PUT goes out right after it settles. A failure retries every 5 s:
 * indefinitely while a view is open, and until `giveUpAt` once none is.
 */
function kick(date: string): void {
  const e = entries.get(date)
  if (!e || e.inFlight) return
  clearRetry(e)
  if (e.text === e.saved) {
    prune(date)
    return
  }
  const sending = e.text
  notify(e, 'saving')
  e.inFlight = putJournal(date, sending).then(
    () => {
      e.inFlight = null
      e.saved = sending
      if (e.text !== e.saved) return kick(date)
      notify(e, 'saved')
      prune(date)
    },
    () => {
      e.inFlight = null
      notify(e, 'failed')
      if (e.listeners.size === 0 && Date.now() >= e.giveUpAt) {
        entries.delete(date)
        return
      }
      e.retry = setTimeout(() => {
        e.retry = undefined
        kick(date)
      }, RETRY_MS)
    },
  )
}

/**
 * The text to show for a date: waits for any save in flight for it, then prefers unsaved text
 * still held here over the file (which would be older).
 */
async function loadText(date: string): Promise<void> {
  for (let e = entries.get(date); e?.inFlight; e = entries.get(date)) await e.inFlight
  if (entries.has(date)) return
  const text = await getJournal(date)
  for (let e = entries.get(date); e?.inFlight; e = entries.get(date)) await e.inFlight
  if (!entries.has(date)) {
    entries.set(date, { text, saved: text, inFlight: null, retry: undefined, listeners: new Set(), giveUpAt: 0 })
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
 * Loads one day's journal note and keeps it saved. The date is fixed at mount: switching days is an
 * unmount + mount, and the unmount flush sends the pending text to the date this instance was made for.
 *
 * Guards that keep the owner's words safe:
 * - nothing is ever written until the note has loaded (a failed load would otherwise overwrite the file);
 * - never written when the text equals the last text known to be on disk;
 * - one save per date at a time (shared registry); edits made during a save are sent right after it;
 * - a failed save keeps the text and retries every 5 s, also after the view has closed;
 * - opening a day waits for that day's pending save, or shows its unsaved text.
 */
export function useAutosave(date: string, enabled: boolean): Autosave {
  const [phase, setPhase] = useState<LoadPhase>('loading')
  const [status, setStatus] = useState<SaveStatus>('saved')
  const [text, setText] = useState('')

  const s = useRef({
    date,
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
    kick(s.date)
  }

  const load = (): void => {
    const seq = ++s.loadSeq
    setPhase('loading')
    loadText(s.date).then(
      () => {
        const e = entries.get(s.date)
        if (!s.live || seq !== s.loadSeq || !e) {
          prune(s.date)
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
      // Runs synchronously at unmount: hand the pending text to the registry for this instance's date.
      s.live = false
      document.removeEventListener('visibilitychange', onVisibility)
      clearTimeout(s.debounce)
      s.debounce = undefined
      const e = s.entry
      if (!e) return
      e.listeners.delete(s.listener)
      e.giveUpAt = Date.now() + ORPHAN_RETRY_MS
      kick(s.date)
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
      kick(s.date)
    }, DEBOUNCE_MS)
  }

  const reload = (): void => {
    if (!s.entry) load()
  }

  return { phase, status, text, edit, flush: save, reload }
}
