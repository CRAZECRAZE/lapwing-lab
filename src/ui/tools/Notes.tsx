import type { JSX } from 'preact'
import { useEffect, useState } from 'preact/hooks'
import { listNotes } from '../../api.ts'
import { currentChapter } from '../../core/progress.ts'
import { useProgress } from '../../state/progress.tsx'
import type { Progress } from '../../state/progress.tsx'
import { notesStore, SAVE_STATUS_TEXT, useAutosave } from '../useAutosave.ts'
import './notes.css'

const CHAPTERS = Array.from({ length: 26 }, (_, i) => i + 1)
/** Where the picker opens while the owner's current chapter is not known. */
const FALLBACK_CHAPTER = 4

/** The chapter the owner picked last, kept while the app is open so the next open starts there. */
let lastPick: number | null = null

export function __resetNotesForTests(): void {
  lastPick = null
}

function startChapter(progress: Progress): number {
  if (lastPick !== null) return lastPick
  if (progress.status === 'ready' && progress.chapters.length > 0) return currentChapter(progress.chapters, progress.states)
  return FALLBACK_CHAPTER
}

/** One note per chapter, as plain text that is saved as it is typed. */
export function Notes(): JSX.Element {
  const progress = useProgress()
  // Chosen once, from what is known at the first render; later changes to the progress never move the picker.
  const [chapter, setChapter] = useState(() => startChapter(progress))
  const [withNotes, setWithNotes] = useState<ReadonlySet<number>>(new Set())

  useEffect(() => {
    let live = true
    listNotes().then(
      (list) => {
        if (live) setWithNotes(new Set(list.map((e) => e.chapter)))
      },
      () => {}, // the suffixes are a convenience; the editor works without them
    )
    return () => {
      live = false
    }
  }, [])

  return (
    <div class="notes">
      <div class="notes__field">
        <label class="notes__label" for="notes-chapter">
          Chapter
        </label>
        <select
          id="notes-chapter"
          class="notes__picker"
          value={chapter}
          onChange={(e) => {
            const next = Number(e.currentTarget.value)
            lastPick = next
            setChapter(next)
          }}
        >
          {CHAPTERS.map((n) => (
            <option key={n} value={n}>
              {withNotes.has(n) ? `Chapter ${n} — has notes` : `Chapter ${n}`}
            </option>
          ))}
        </select>
      </div>
      {/* Remounted per chapter: the editor's saving is bound to one chapter for its whole life. */}
      <NotesEditor key={chapter} chapter={chapter} />
    </div>
  )
}

function NotesEditor({ chapter }: { chapter: number }): JSX.Element {
  const note = useAutosave(notesStore, String(chapter), true)
  return (
    <>
      <textarea
        class="notes__text"
        aria-label={`Notes for Chapter ${chapter}`}
        data-autofocus
        value={note.text}
        readOnly={note.phase !== 'ready'}
        spellcheck
        onInput={(e) => {
          const el = e.currentTarget
          if (note.phase !== 'ready') {
            el.value = note.text
            return
          }
          note.edit(el.value)
        }}
        onBlur={note.flush}
      />
      <div class="notes__state">
        {note.phase === 'loading' && <span class="notes__muted">Loading…</span>}
        {note.phase === 'error' && (
          <span role="alert">
            Couldn't load your notes for Chapter {chapter}.{' '}
            <button type="button" class="notes__button" onClick={note.reload}>
              Try again
            </button>
          </span>
        )}
        {note.phase === 'ready' && (
          <span class={note.status === 'failed' ? 'notes__warn' : 'notes__muted'} aria-live="polite">
            {SAVE_STATUS_TEXT[note.status]}
          </span>
        )}
      </div>
    </>
  )
}
