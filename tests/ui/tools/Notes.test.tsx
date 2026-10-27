// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/preact'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChapterInfo } from '../../../scripts/build-content.ts'
import { chapterStates } from '../../../src/core/progress.ts'
import type { ResultsByMode } from '../../../src/core/progress.ts'
import { DockProvider, useDock } from '../../../src/state/dock.tsx'
import type { Dock } from '../../../src/state/dock.tsx'
import type { Progress } from '../../../src/state/progress.tsx'
import { DockHost } from '../../../src/ui/DockHost.tsx'
import { Notes, __resetNotesForTests } from '../../../src/ui/tools/Notes.tsx'
import { __resetPendingSavesForTests } from '../../../src/ui/useAutosave.ts'

// Notes reads the owner's current chapter through `useProgress`; each test hands it a fake value.
const fake = vi.hoisted(() => ({ value: null as Progress | null }))
vi.mock('../../../src/state/progress.tsx', async (importActual) => {
  const actual = await importActual<typeof import('../../../src/state/progress.tsx')>()
  return { ...actual, useProgress: () => fake.value ?? actual.useProgress() }
})

vi.mock('../../../src/api.ts', () => ({
  listNotes: vi.fn(),
  getNote: vi.fn(),
  putNote: vi.fn(),
}))
const api = await import('../../../src/api.ts')
const listNotes = vi.mocked(api.listNotes)
const getNote = vi.mocked(api.getNote)
const putNote = vi.mocked(api.putNote)

const chapter = (n: number): ChapterInfo => ({ chapter: n, pageId: `ch${n}`, title: `Chapter ${n}`, gate: 'read', listIds: [] })
const CHAPTERS: ChapterInfo[] = Array.from({ length: 23 }, (_, i) => chapter(i + 4))

/** Progress whose current chapter is `limit`: every chapter below it is cleared by an override mark. */
function progress(status: Progress['status'], limit = 4): Progress {
  const marks = CHAPTERS.filter((c) => c.chapter < limit).map((c) => ({ chapter: c.chapter, kind: 'override' as const, at: 1 }))
  const results: ResultsByMode = { stage0: [], section: [], 'chapter-test': [] }
  return {
    status,
    chapters: CHAPTERS,
    index: [],
    results,
    marks,
    states: status === 'ready' ? chapterStates(CHAPTERS, results, marks) : new Map(),
    reload: async () => {},
    setMark: async () => {},
    setMarks: async () => {},
    clearMark: async () => {},
  }
}

/** Lets pending promises and the given amount of fake time run, inside act. */
async function advance(ms = 0): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

function deferred<T = void>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: Error) => void } {
  let resolve!: (v: T) => void
  let reject!: (e: Error) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const picker = (): HTMLSelectElement => screen.getByRole('combobox', { name: 'Chapter' }) as HTMLSelectElement
const box = (n: number): HTMLTextAreaElement => screen.getByRole('textbox', { name: `Notes for Chapter ${n}` }) as HTMLTextAreaElement

function type(el: HTMLTextAreaElement, value: string): void {
  fireEvent.input(el, { target: { value } })
}

async function pick(n: number): Promise<void> {
  fireEvent.change(picker(), { target: { value: String(n) } })
  await advance()
}

/** The server's files: what GET returns and what PUT stores. */
let files: Map<number, string>

beforeEach(() => {
  vi.useFakeTimers()
  fake.value = progress('ready')
  files = new Map()
  listNotes.mockReset()
  getNote.mockReset()
  putNote.mockReset()
  listNotes.mockResolvedValue([])
  getNote.mockImplementation(async (n) => files.get(n) ?? '')
  putNote.mockImplementation(async (n, text) => {
    files.set(n, text)
  })
})
afterEach(() => {
  cleanup()
  __resetPendingSavesForTests()
  __resetNotesForTests()
  fake.value = null
  vi.useRealTimers()
})

describe('Notes: the chapter picker', () => {
  it('lists Chapter 1 to 26, with the suffix only on chapters that have notes', async () => {
    listNotes.mockResolvedValue([
      { chapter: 3, chars: 10 },
      { chapter: 12, chars: 40 },
    ])
    render(<Notes />)
    await advance()
    const options = [...picker().options].map((o) => o.textContent)
    expect(options).toHaveLength(26)
    expect(options[0]).toBe('Chapter 1')
    expect(options[2]).toBe('Chapter 3 — has notes')
    expect(options[11]).toBe('Chapter 12 — has notes')
    expect(options[25]).toBe('Chapter 26')
    expect(options.filter((o) => o!.endsWith(' — has notes'))).toHaveLength(2)
    expect([...picker().options].map((o) => o.value)).toEqual(Array.from({ length: 26 }, (_, i) => String(i + 1)))
  })

  it('asks which chapters have notes once per open, not once per chapter picked', async () => {
    render(<Notes />)
    await advance()
    await pick(9)
    await pick(2)
    expect(listNotes).toHaveBeenCalledTimes(1)
  })

  it('opens on the current chapter when the progress is ready', async () => {
    fake.value = progress('ready', 9)
    render(<Notes />)
    await advance()
    expect(picker().value).toBe('9')
    expect(box(9)).toBeTruthy()
    expect(getNote).toHaveBeenCalledWith(9)
  })

  it('opens on Chapter 4 when the progress is not ready', async () => {
    fake.value = progress('loading', 9)
    render(<Notes />)
    await advance()
    expect(picker().value).toBe('4')
    expect(getNote).toHaveBeenCalledWith(4)
  })

  it('does not jump to another chapter when the progress becomes ready later', async () => {
    fake.value = progress('loading', 9)
    const { rerender } = render(<Notes />)
    await advance()
    fake.value = progress('ready', 9)
    rerender(<Notes />)
    await advance()
    expect(picker().value).toBe('4')
  })

  it('a failing list of notes leaves plain options and a usable editor', async () => {
    listNotes.mockRejectedValue(new Error('offline'))
    render(<Notes />)
    await advance()
    const options = [...picker().options].map((o) => o.textContent)
    expect(options.every((o) => !o!.includes('has notes'))).toBe(true)
    expect(options).toHaveLength(26)
    expect(box(4).readOnly).toBe(false)
    type(box(4), 'still works')
    await advance(800)
    expect(putNote).toHaveBeenCalledWith(4, 'still works')
  })

  it('remembers the last pick while the app is open, and the reset helper forgets it', async () => {
    fake.value = progress('ready', 7)
    const first = render(<Notes />)
    await advance()
    expect(picker().value).toBe('7')
    await pick(12)
    first.unmount()

    render(<Notes />)
    await advance()
    expect(picker().value).toBe('12')
    expect(box(12)).toBeTruthy()
    cleanup()

    __resetNotesForTests()
    render(<Notes />)
    await advance()
    expect(picker().value).toBe('7')
  })

  it('opens and closes without a single write when nothing was edited', async () => {
    const { unmount } = render(<Notes />)
    await advance()
    fireEvent.blur(box(4))
    await pick(8)
    unmount()
    await advance(10000)
    expect(putNote).not.toHaveBeenCalled()
  })
})

describe('Notes: the editor', () => {
  it('loads the stored note into the textarea', async () => {
    files.set(4, 'Remember the star key.')
    render(<Notes />)
    await advance()
    expect(getNote).toHaveBeenCalledWith(4)
    expect(box(4).value).toBe('Remember the star key.')
    expect(box(4).readOnly).toBe(false)
  })

  it('is read-only until the note has loaded, and keeps typing out of it', async () => {
    const load = deferred<string>()
    getNote.mockReturnValueOnce(load.promise)
    render(<Notes />)
    expect(box(4).readOnly).toBe(true)
    expect(box(4).hasAttribute('data-autofocus')).toBe(true)
    type(box(4), 'too early')
    expect(box(4).value).toBe('')
    load.resolve('Stored.')
    await advance()
    expect(box(4).value).toBe('Stored.')
    expect(box(4).readOnly).toBe(false)
    await advance(10000)
    expect(putNote).not.toHaveBeenCalled()
  })

  it('a failed load shows the error, stays read-only and never writes; Try again loads and enables it', async () => {
    getNote.mockRejectedValueOnce(new Error('boom'))
    files.set(4, 'Precious words.')
    const { unmount } = render(<Notes />)
    await advance()
    expect(screen.getByText(/Couldn't load your notes for Chapter 4\./)).toBeTruthy()
    expect(box(4).readOnly).toBe(true)
    type(box(4), 'overwrite')
    fireEvent.blur(box(4))
    expect(box(4).value).toBe('')
    await advance(10000)
    expect(putNote).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await advance()
    expect(getNote).toHaveBeenCalledTimes(2)
    expect(box(4).value).toBe('Precious words.')
    expect(box(4).readOnly).toBe(false)
    expect(screen.queryByText(/Couldn't load/)).toBeNull()

    getNote.mockRejectedValueOnce(new Error('boom again'))
    await pick(5)
    expect(screen.getByText(/Couldn't load your notes for Chapter 5\./)).toBeTruthy()
    await pick(4)
    getNote.mockRejectedValueOnce(new Error('boom a third time'))
    await pick(6)
    unmount()
    await advance(10000)
    expect(putNote).not.toHaveBeenCalled()
  })

  it('typing saves 800 ms after the last keystroke: Saving… while the PUT runs, then Saved', async () => {
    const put = deferred()
    putNote.mockReturnValueOnce(put.promise)
    render(<Notes />)
    await advance()
    expect(screen.getByText('Saved')).toBeTruthy()
    type(box(4), 'a')
    await advance(500)
    type(box(4), 'ab')
    await advance(799)
    expect(putNote).not.toHaveBeenCalled()
    await advance(1)
    expect(putNote).toHaveBeenCalledTimes(1)
    expect(putNote).toHaveBeenCalledWith(4, 'ab')
    expect(screen.getByText('Saving…')).toBeTruthy()
    put.resolve()
    await advance()
    expect(screen.getByText('Saved')).toBeTruthy()
    await advance(10000)
    expect(putNote).toHaveBeenCalledTimes(1)
  })

  it('leaving the textarea saves a pending change at once', async () => {
    render(<Notes />)
    await advance()
    type(box(4), 'before the blur')
    expect(putNote).not.toHaveBeenCalled()
    fireEvent.blur(box(4))
    await advance()
    expect(putNote).toHaveBeenCalledTimes(1)
    expect(putNote).toHaveBeenCalledWith(4, 'before the blur')
  })

  it('a failed save keeps the text, says so, and retries', async () => {
    putNote.mockRejectedValueOnce(new Error('disk'))
    render(<Notes />)
    await advance()
    type(box(4), 'keep me')
    await advance(800)
    expect(screen.getByText('Not saved — will retry')).toBeTruthy()
    expect(box(4).value).toBe('keep me')
    await advance(5000)
    expect(putNote).toHaveBeenCalledTimes(2)
    expect(putNote).toHaveBeenLastCalledWith(4, 'keep me')
    expect(screen.getByText('Saved')).toBeTruthy()
    expect(files.get(4)).toBe('keep me')
  })

  it('labels the textarea per chapter', async () => {
    render(<Notes />)
    await advance()
    expect(box(4)).toBeTruthy()
    await pick(11)
    expect(box(11)).toBeTruthy()
    expect(screen.queryByRole('textbox', { name: 'Notes for Chapter 4' })).toBeNull()
  })
})

describe('Notes: switching chapters', () => {
  it('saves unsaved text to the chapter it was typed in, never to the new one, and shows the new chapter\'s own text', async () => {
    files.set(9, 'Nine says hello.')
    render(<Notes />)
    await advance()
    type(box(4), 'Words for four')
    await pick(9)
    expect(putNote).toHaveBeenCalledWith(4, 'Words for four')
    expect(putNote.mock.calls.every(([n]) => n === 4)).toBe(true)
    expect(files.get(4)).toBe('Words for four')
    expect(files.has(9)).toBe(true)
    expect(files.get(9)).toBe('Nine says hello.')
    expect(box(9).value).toBe('Nine says hello.')
    expect(screen.queryByDisplayValue('Words for four')).toBeNull()
    await advance(10000)
    expect(putNote.mock.calls.every(([n]) => n === 4)).toBe(true)
  })

  it('keeps the words when the switch happens while the save is still in flight', async () => {
    const put = deferred()
    putNote.mockImplementationOnce((n, text) => put.promise.then(() => void files.set(n, text)))
    render(<Notes />)
    await advance()
    type(box(4), 'in flight')
    await advance(800)
    expect(putNote).toHaveBeenCalledWith(4, 'in flight')
    await pick(5)
    put.resolve()
    await advance()
    expect(putNote).toHaveBeenCalledTimes(1)
    await pick(4)
    expect(box(4).value).toBe('in flight')
  })

  it('remounts the editor per chapter: going back shows the saved text fetched again', async () => {
    render(<Notes />)
    await advance()
    type(box(4), 'Four, saved')
    await advance(800)
    await pick(5)
    type(box(5), 'Five, saved')
    await advance(800)
    expect(box(5).value).toBe('Five, saved')
    await pick(4)
    expect(box(4).value).toBe('Four, saved')
    expect(getNote.mock.calls.filter(([n]) => n === 4)).toHaveLength(2)
    await pick(5)
    expect(box(5).value).toBe('Five, saved')
  })

  it('closing the tool flushes the pending text to its own chapter', async () => {
    const { unmount } = render(<Notes />)
    await advance()
    await pick(7)
    type(box(7), 'last words')
    unmount()
    await advance()
    expect(putNote).toHaveBeenCalledTimes(1)
    expect(putNote).toHaveBeenCalledWith(7, 'last words')
  })
})

let dock: Dock
function Probe(): null {
  dock = useDock()
  return null
}

function mountHost(): void {
  render(
    <DockProvider>
      <Probe />
      <DockHost />
    </DockProvider>,
  )
}

describe('Notes: inside the real DockHost', () => {
  it('opens as the My notes drawer with the focus in the textarea', async () => {
    fake.value = progress('ready', 6)
    mountHost()
    act(() => dock.open('notes'))
    const dialog = screen.getByRole('dialog', { name: 'My notes' })
    expect(dialog.textContent).not.toContain('Coming in this milestone.')
    expect(document.activeElement).toBe(box(6))
    await advance()
    expect(document.activeElement).toBe(box(6))
  })

  it('keeps the focus on the picker when the chapter changes', async () => {
    mountHost()
    act(() => dock.open('notes'))
    await advance()
    picker().focus()
    await pick(10)
    expect(box(10)).toBeTruthy()
    expect(document.activeElement).toBe(picker())
  })

  it('opening and closing the drawer without edits writes nothing, and the next open uses the last pick', async () => {
    mountHost()
    act(() => dock.open('notes'))
    await advance()
    await pick(13)
    act(() => dock.close())
    await advance(10000)
    expect(putNote).not.toHaveBeenCalled()
    act(() => dock.open('notes'))
    await advance()
    expect(picker().value).toBe('13')
  })
})
