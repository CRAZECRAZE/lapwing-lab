import type { JSX } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import { appendJournal } from '../api.ts'
import { formatNoteBlock } from '../core/journal.ts'
import { localDate } from '../core/days.ts'
import { isPlainClick, navigate } from '../router.ts'
import './quicknote.css'

const JOURNAL_HREF = '/journal'

type Phase = 'closed' | 'editing' | 'saving' | 'failed' | 'saved'

/** A quiet way to jot a note under a result: it is appended to today's journal file. */
export function QuickNote({ title, stats }: { title: string; stats: { accuracy: number; wpm: number } | null }): JSX.Element {
  const [phase, setPhase] = useState<Phase>('closed')
  const [text, setText] = useState('')
  const live = useRef(true)
  const busy = useRef(false)

  // The result card can be left while a save is pending.
  useEffect(() => {
    live.current = true
    return () => {
      live.current = false
    }
  }, [])

  if (phase === 'closed') {
    return (
      <div class="quicknote">
        <button type="button" class="quicknote__open" onClick={() => setPhase('editing')}>Add a note</button>
      </div>
    )
  }

  if (phase === 'saved') {
    return (
      <div class="quicknote">
        <p class="quicknote__saved">
          <span>Saved to today's journal</span>{' '}
          <a
            href={JOURNAL_HREF}
            onClick={(e) => {
              if (!isPlainClick(e)) return
              e.preventDefault()
              navigate(JOURNAL_HREF)
            }}
          >
            Open journal
          </a>
        </p>
      </div>
    )
  }

  const saving = phase === 'saving'

  const save = (): void => {
    if (busy.current || text.trim() === '') return
    busy.current = true
    setPhase('saving')
    const now = new Date()
    appendJournal(localDate(now.getTime()), formatNoteBlock(now, title, stats, text)).then(
      () => {
        busy.current = false
        if (live.current) setPhase('saved')
      },
      () => {
        busy.current = false
        if (live.current) setPhase('failed')
      },
    )
  }

  return (
    <form
      class="quicknote__form"
      onSubmit={(e) => {
        e.preventDefault()
        save()
      }}
    >
      <label class="quicknote__label">
        <span>Note for today</span>
        <textarea
          class="quicknote__text"
          rows={3}
          value={text}
          onInput={(e) => setText((e.currentTarget as HTMLTextAreaElement).value)}
        />
      </label>
      {phase === 'failed' && (
        <p class="quicknote__error" role="alert">Couldn't save the note. Your text is still here.</p>
      )}
      <div class="quicknote__actions">
        <button type="submit" class="stage0-button" disabled={saving || text.trim() === ''}>Save</button>
        <button
          type="button"
          class="stage0-button"
          onClick={() => {
            setText('')
            setPhase('closed')
          }}
        >
          Cancel
        </button>
      </div>
    </form>
  )
}
