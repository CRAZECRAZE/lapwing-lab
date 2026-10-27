import { useLayoutEffect, useRef, useState } from 'preact/hooks'
import { getJournal, putJournal } from '../api.ts'

export type LoadPhase = 'loading' | 'error' | 'ready'
export type SaveStatus = 'saved' | 'pending' | 'saving' | 'failed'

const DEBOUNCE_MS = 800
const RETRY_MS = 5000

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
 * - one save at a time; edits made during a save are sent right after it settles;
 * - a failed save keeps the text and retries every 5 s while it is still unsaved.
 */
export function useAutosave(date: string, enabled: boolean): Autosave {
  const [phase, setPhase] = useState<LoadPhase>('loading')
  const [status, setStatus] = useState<SaveStatus>('saved')
  const [text, setText] = useState('')

  // Everything the save machine reads lives in one ref, so timers and promises always see the latest.
  const s = useRef({
    date,
    live: true,
    loaded: false,
    text: '',
    saved: '', // last text known to be on disk
    inFlight: false,
    finalAfterSettle: false, // unmounted while a save was in flight: one last save after it settles
    debounce: undefined as ReturnType<typeof setTimeout> | undefined,
    retry: undefined as ReturnType<typeof setTimeout> | undefined,
    loadSeq: 0,
  }).current

  const clearTimers = (): void => {
    clearTimeout(s.debounce)
    clearTimeout(s.retry)
    s.debounce = undefined
    s.retry = undefined
  }

  const show = (next: SaveStatus): void => {
    if (s.live) setStatus(next)
  }

  const save = (): void => {
    if (!s.loaded || s.inFlight || s.text === s.saved) return
    clearTimers()
    const sending = s.text
    s.inFlight = true
    show('saving')
    putJournal(s.date, sending).then(
      () => {
        s.inFlight = false
        s.saved = sending
        if (s.text !== s.saved) {
          // Newer edits arrived during the save (or the view closed with them pending).
          if (s.live || s.finalAfterSettle) {
            s.finalAfterSettle = false
            save()
          }
          return
        }
        show('saved')
      },
      () => {
        s.inFlight = false
        if (!s.live) {
          // Gone: try once more with the latest text, but leave no timers behind.
          if (s.finalAfterSettle) {
            s.finalAfterSettle = false
            save()
          }
          return
        }
        show('failed')
        s.retry = setTimeout(() => {
          s.retry = undefined
          save()
        }, RETRY_MS)
      },
    )
  }

  const load = (): void => {
    const seq = ++s.loadSeq
    setPhase('loading')
    getJournal(s.date).then(
      (stored) => {
        if (!s.live || seq !== s.loadSeq) return
        s.text = stored
        s.saved = stored
        s.loaded = true
        setText(stored)
        setStatus('saved')
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
      // Runs synchronously at unmount: flush the pending text to this instance's date, leave no timers.
      s.live = false
      document.removeEventListener('visibilitychange', onVisibility)
      clearTimers()
      if (s.inFlight) s.finalAfterSettle = true
      else save()
    }
  }, [])

  const edit = (value: string): void => {
    if (!s.loaded) return
    s.text = value
    setText(value)
    clearTimeout(s.debounce)
    s.debounce = undefined
    if (s.inFlight) return // the settle handler sends the latest text
    if (value === s.saved) {
      clearTimeout(s.retry)
      s.retry = undefined
      setStatus('saved')
      return
    }
    setStatus((prev) => (prev === 'failed' ? 'failed' : 'pending'))
    s.debounce = setTimeout(() => {
      s.debounce = undefined
      save()
    }, DEBOUNCE_MS)
  }

  const reload = (): void => {
    if (!s.loaded) load()
  }

  return { phase, status, text, edit, flush: save, reload }
}
