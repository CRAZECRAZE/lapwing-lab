// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QuickNote } from '../../src/ui/QuickNote.tsx'

vi.mock('../../src/api.ts', () => ({ appendJournal: vi.fn() }))

// Records every state update so a test can see one arriving after the component is gone.
const stateSets: unknown[] = []
vi.mock('preact/hooks', async (importActual) => {
  const actual = await importActual<typeof import('preact/hooks')>()
  return {
    ...actual,
    useState: (initial: unknown) => {
      const [value, set] = actual.useState(initial)
      return [value, (next: unknown) => (stateSets.push(next), set(next as never))]
    },
  }
})
const { appendJournal } = await import('../../src/api.ts')
const append = vi.mocked(appendJournal)

const STATS = { accuracy: 0.92, wpm: 41 }

function open(): HTMLTextAreaElement {
  fireEvent.click(screen.getByRole('button', { name: 'Add a note' }))
  return screen.getByRole('textbox', { name: 'Note for today' }) as HTMLTextAreaElement
}

function type(box: HTMLTextAreaElement, value: string): void {
  fireEvent.input(box, { target: { value } })
}

const save = (): HTMLButtonElement => screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement

describe('QuickNote', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 9, 27, 18, 42, 0))
    append.mockReset()
    append.mockResolvedValue(undefined)
  })
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('starts as one quiet button', () => {
    render(<QuickNote title="Row drill" stats={STATS} />)
    expect(screen.getByRole('button', { name: 'Add a note' })).toBeTruthy()
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('keeps Save disabled while the text is blank', () => {
    render(<QuickNote title="Row drill" stats={STATS} />)
    const box = open()
    expect(save().disabled).toBe(true)
    type(box, '  \n ')
    expect(save().disabled).toBe(true)
    type(box, 'ok')
    expect(save().disabled).toBe(false)
  })

  it("appends the block to today's journal once, then shows the saved line and a journal link", async () => {
    render(<QuickNote title="Row drill" stats={STATS} />)
    type(open(), '  Felt steady.  ')
    fireEvent.click(save())
    await screen.findByText("Saved to today's journal")
    expect(append).toHaveBeenCalledTimes(1)
    expect(append).toHaveBeenCalledWith('2026-10-27', '### 18:42 — Row drill · 92% · 41 wpm\n\nFelt steady.')
    expect((screen.getByRole('link', { name: 'Open journal' }) as HTMLAnchorElement).getAttribute('href')).toBe('/journal')
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('leaves the stats off the heading when there are none', async () => {
    render(<QuickNote title="Row drill" stats={null} />)
    type(open(), 'hi')
    fireEvent.click(save())
    await screen.findByText("Saved to today's journal")
    expect(append).toHaveBeenCalledWith('2026-10-27', '### 18:42 — Row drill\n\nhi')
  })

  it('keeps the text and shows an error when saving fails, and Save works again', async () => {
    append.mockRejectedValueOnce(new Error('HTTP 500'))
    render(<QuickNote title="Row drill" stats={STATS} />)
    const box = open()
    type(box, 'keep me')
    fireEvent.click(save())
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe("Couldn't save the note. Your text is still here.")
    expect((screen.getByRole('textbox', { name: 'Note for today' }) as HTMLTextAreaElement).value).toBe('keep me')
    expect(save().disabled).toBe(false)
    fireEvent.click(save())
    await screen.findByText("Saved to today's journal")
    expect(append).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('sends once when Save is double-clicked', async () => {
    let finish: () => void = () => {}
    append.mockReturnValueOnce(new Promise<void>((resolve) => (finish = resolve)))
    render(<QuickNote title="Row drill" stats={STATS} />)
    type(open(), 'once')
    const button = save()
    fireEvent.click(button)
    fireEvent.click(button)
    expect(append).toHaveBeenCalledTimes(1)
    expect(save().disabled).toBe(true)
    finish()
    await screen.findByText("Saved to today's journal")
    expect(append).toHaveBeenCalledTimes(1)
  })

  it('discards the text on Cancel and collapses', () => {
    render(<QuickNote title="Row drill" stats={STATS} />)
    type(open(), 'gone')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(append).not.toHaveBeenCalled()
    expect(open().value).toBe('')
  })

  it('keeps Cancel disabled while a save is in flight, then settles normally', async () => {
    let finish: () => void = () => {}
    append.mockReturnValueOnce(new Promise<void>((resolve) => (finish = resolve)))
    render(<QuickNote title="Row drill" stats={STATS} />)
    type(open(), 'mine')
    fireEvent.click(save())
    const cancel = screen.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement
    await waitFor(() => expect(cancel.disabled).toBe(true))
    fireEvent.click(cancel)
    expect((screen.getByRole('textbox', { name: 'Note for today' }) as HTMLTextAreaElement).value).toBe('mine')
    finish()
    await screen.findByText("Saved to today's journal")
    expect(append).toHaveBeenCalledTimes(1)
  })

  it('keeps Cancel disabled in flight and shows the true error when the save then fails', async () => {
    let fail: (e: Error) => void = () => {}
    append.mockReturnValueOnce(new Promise<void>((_, reject) => (fail = reject)))
    render(<QuickNote title="Row drill" stats={STATS} />)
    type(open(), 'mine')
    fireEvent.click(save())
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    fail(new Error('HTTP 500'))
    await screen.findByRole('alert')
    expect((screen.getByRole('textbox', { name: 'Note for today' }) as HTMLTextAreaElement).value).toBe('mine')
    expect((screen.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled).toBe(false)
    expect(save().disabled).toBe(false)
  })

  it('makes no state update when the card is left while a save is pending', async () => {
    let finish: () => void = () => {}
    append.mockReturnValueOnce(new Promise<void>((resolve) => (finish = resolve)))
    const view = render(<QuickNote title="Row drill" stats={STATS} />)
    type(open(), 'bye')
    fireEvent.click(save())
    view.unmount()
    stateSets.length = 0
    finish()
    await waitFor(() => expect(append).toHaveBeenCalledTimes(1))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(stateSets).toEqual([])
  })
})
