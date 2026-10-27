// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/preact'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  __resetPendingSavesForTests,
  journalStore,
  notesStore,
  useAutosave,
  type AutosaveStore,
} from '../../src/ui/useAutosave.ts'

vi.mock('../../src/api.ts', () => ({
  getJournal: vi.fn(),
  putJournal: vi.fn(),
  getNote: vi.fn(),
  putNote: vi.fn(),
}))
const api = await import('../../src/api.ts')
const getJournal = vi.mocked(api.getJournal)
const putJournal = vi.mocked(api.putJournal)
const getNote = vi.mocked(api.getNote)
const putNote = vi.mocked(api.putNote)

/** Lets pending promises and the given amount of fake time run, inside act. */
async function advance(ms = 0): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

function deferred(): { promise: Promise<void>; resolve: () => void; reject: (e: Error) => void } {
  let resolve!: () => void
  let reject!: (e: Error) => void
  const promise = new Promise<void>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/** A tiny view over the hook: a box that shows the text and the phase/status. */
function Probe({ store, id, label }: { store: AutosaveStore; id: string; label: string }) {
  const note = useAutosave(store, id, true)
  return (
    <div>
      <textarea
        aria-label={label}
        value={note.text}
        readOnly={note.phase !== 'ready'}
        onInput={(e) => note.edit(e.currentTarget.value)}
        onBlur={note.flush}
      />
      <output aria-label={`${label} state`}>{`${note.phase}/${note.status}`}</output>
    </div>
  )
}

const box = (label = 'note'): HTMLTextAreaElement => screen.getByRole('textbox', { name: label }) as HTMLTextAreaElement
const state = (label = 'note'): string => screen.getByLabelText(`${label} state`).textContent ?? ''

function type(el: HTMLTextAreaElement, value: string): void {
  fireEvent.input(el, { target: { value } })
}

describe('useAutosave over the notes store', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 9, 27, 12, 0, 0))
    for (const m of [getJournal, putJournal, getNote, putNote]) m.mockReset()
    getJournal.mockResolvedValue('journal words')
    putJournal.mockResolvedValue(undefined)
    getNote.mockResolvedValue('note words')
    putNote.mockResolvedValue(undefined)
  })
  afterEach(() => {
    cleanup()
    __resetPendingSavesForTests()
    vi.useRealTimers()
  })

  it('loads through getNote and saves a typed change through putNote after the debounce', async () => {
    render(<Probe store={notesStore} id="5" label="note" />)
    await advance()
    expect(getNote).toHaveBeenCalledWith(5)
    expect(getJournal).not.toHaveBeenCalled()
    expect(box().value).toBe('note words')
    expect(state()).toBe('ready/saved')

    type(box(), 'note words, more')
    await advance(799)
    expect(putNote).not.toHaveBeenCalled()
    await advance(1)
    expect(putNote).toHaveBeenCalledTimes(1)
    expect(putNote).toHaveBeenCalledWith(5, 'note words, more')
    expect(putJournal).not.toHaveBeenCalled()
    expect(state()).toBe('ready/saved')
  })

  it('never writes when nothing was edited', async () => {
    const { unmount } = render(<Probe store={notesStore} id="5" label="note" />)
    await advance()
    fireEvent.blur(box())
    type(box(), 'note words')
    await advance(10000)
    unmount()
    await advance()
    expect(putNote).not.toHaveBeenCalled()
    expect(putJournal).not.toHaveBeenCalled()
  })

  it('keeps a journal entry and a note with the same key apart', async () => {
    // A journal save for '5' is in flight and then fails; a note '5' must neither wait for it nor replace its text.
    const gate = deferred()
    putJournal.mockReturnValueOnce(gate.promise)
    const journal = render(<Probe store={journalStore} id="5" label="journal" />)
    await advance()
    expect(box('journal').value).toBe('journal words')
    type(box('journal'), 'journal words, edited')
    await advance(800)
    expect(putJournal).toHaveBeenCalledTimes(1)
    journal.unmount()

    // The journal save is still in flight; the note loads regardless, with the note's own text.
    render(<Probe store={notesStore} id="5" label="note" />)
    await advance()
    expect(getNote).toHaveBeenCalledWith(5)
    expect(state()).toBe('ready/saved')
    expect(box().value).toBe('note words')

    // Editing the note goes to putNote while the journal PUT is still pending.
    type(box(), 'note edited')
    await advance(800)
    expect(putNote).toHaveBeenCalledTimes(1)
    expect(putNote).toHaveBeenCalledWith(5, 'note edited')

    // The journal save fails and retries (and keeps failing) with ITS text, to ITS api.
    putJournal.mockRejectedValue(new Error('still down'))
    gate.reject(new Error('down'))
    await advance(5000)
    expect(putJournal).toHaveBeenCalledTimes(2)
    expect(putJournal).toHaveBeenLastCalledWith('5', 'journal words, edited')
    expect(putNote).toHaveBeenCalledTimes(1)

    // And reopening the journal '5' shows its unsaved text, not the note's (nor the older file's).
    cleanup()
    render(<Probe store={journalStore} id="5" label="journal" />)
    await advance()
    expect(box('journal').value).toBe('journal words, edited')
  })

  it('does not show a pending journal text in the note with the same key', async () => {
    putJournal.mockRejectedValue(new Error('down'))
    const journal = render(<Probe store={journalStore} id="5" label="journal" />)
    await advance()
    type(box('journal'), 'unsaved journal text')
    await advance(800)
    journal.unmount()

    render(<Probe store={notesStore} id="5" label="note" />)
    await advance()
    expect(box().value).toBe('note words')
    expect(putNote).not.toHaveBeenCalled()
  })

  it('never writes after a failed note load: not on typing, blur, or unmount', async () => {
    getNote.mockRejectedValue(new Error('down'))
    const { unmount } = render(<Probe store={notesStore} id="5" label="note" />)
    await advance()
    expect(state()).toBe('error/saved')
    expect(box().readOnly).toBe(true)
    type(box(), 'typed anyway')
    fireEvent.blur(box())
    await advance(20000)
    unmount()
    await advance(20000)
    expect(putNote).not.toHaveBeenCalled()
    expect(putJournal).not.toHaveBeenCalled()
  })

  it('flushes the latest text to its own chapter on unmount', async () => {
    const { unmount } = render(<Probe store={notesStore} id="5" label="note" />)
    await advance()
    type(box(), 'last words')
    unmount()
    await advance()
    expect(putNote).toHaveBeenCalledTimes(1)
    expect(putNote).toHaveBeenCalledWith(5, 'last words')
  })

  it('keeps the text of a failing save and retries every 5 s until it works', async () => {
    putNote.mockRejectedValueOnce(new Error('down'))
    render(<Probe store={notesStore} id="5" label="note" />)
    await advance()
    type(box(), 'precious')
    await advance(800)
    expect(putNote).toHaveBeenCalledTimes(1)
    expect(state()).toBe('ready/failed')
    expect(box().value).toBe('precious')

    await advance(4999)
    expect(putNote).toHaveBeenCalledTimes(1)
    await advance(1)
    expect(putNote).toHaveBeenCalledTimes(2)
    expect(putNote).toHaveBeenLastCalledWith(5, 'precious')
    expect(state()).toBe('ready/saved')
    await advance(20000)
    expect(putNote).toHaveBeenCalledTimes(2)
  })

  it('switching the key saves the old text to its own chapter and loads the new chapter', async () => {
    getNote.mockImplementation(async (chapter) => `words of ${chapter}`)
    const view = render(<Probe store={notesStore} id="5" label="note" />)
    await advance()
    expect(box().value).toBe('words of 5')
    type(box(), 'words of 5, edited')

    view.unmount()
    render(<Probe store={notesStore} id="6" label="note" />)
    await advance()
    expect(putNote).toHaveBeenCalledTimes(1)
    expect(putNote).toHaveBeenCalledWith(5, 'words of 5, edited')
    expect(getNote).toHaveBeenLastCalledWith(6)
    expect(box().value).toBe('words of 6')
  })

  it('rejects a non-integer note key without any request', async () => {
    await expect(notesStore.get('5/../6')).rejects.toBeInstanceOf(Error)
    await expect(notesStore.put('x', 'text')).rejects.toBeInstanceOf(Error)
    await expect(notesStore.get('')).rejects.toBeInstanceOf(Error)
    expect(getNote).not.toHaveBeenCalled()
    expect(putNote).not.toHaveBeenCalled()
  })
})
