// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TestSummary } from '../../server/archive.ts'
import { History } from '../../src/ui/History.tsx'

vi.mock('../../src/api.ts', () => ({ listTests: vi.fn(), getTest: vi.fn() }))
const { listTests } = await import('../../src/api.ts')
const list = vi.mocked(listTests)

const at = (h: number, m: number): number => new Date(2026, 9, 27, h, m).getTime()

function summary(id: number, over: Partial<TestSummary> = {}): TestSummary {
  return {
    id,
    sessionId: 1,
    startedAt: at(9, 0),
    endedAt: at(9, 5),
    mode: 'stage0',
    chapter: 4,
    section: 'rows-vowels',
    itemCount: 10,
    wpm: 41.4,
    accuracy: 0.924,
    meta: {},
    strokeCount: 12,
    firstStrokeAt: at(9, 5),
    lastStrokeAt: at(9, 9),
    ...over,
  }
}

beforeEach(() => {
  list.mockReset()
  history.replaceState(null, '', '/history')
})
afterEach(cleanup)

describe('History', () => {
  it('shows Loading, then rows newest first with accuracy and speed', async () => {
    list.mockResolvedValue([summary(3, { firstStrokeAt: at(14, 7) }), summary(2, { accuracy: 0.5, wpm: 20 }), summary(1)])
    render(<History />)
    expect(screen.getByText('Loading…')).toBeTruthy()
    const items = await screen.findAllByRole('listitem')
    expect(items).toHaveLength(3)
    expect(list).toHaveBeenCalledWith({ limit: 50 })
    expect(items[0].textContent).toContain('14:07')
    expect(items[0].textContent).toContain('Tue 27 Oct 2026')
    expect(items[0].textContent).toContain('92% · 41 wpm')
    expect(items[0].textContent).toContain('12 strokes')
    expect(items[0].textContent).toContain('Chapter 4 · ')
    expect(items[1].textContent).toContain('50% · 20 wpm')
    expect(items[2].textContent).toContain('09:05')
    expect(screen.queryByText('Loading…')).toBeNull()
  })

  it('links each row to its test and navigates on a plain click', async () => {
    list.mockResolvedValue([summary(7)])
    render(<History />)
    const link = (await screen.findAllByRole('link'))[0]
    expect(link.getAttribute('href')).toBe('/history/7')
    fireEvent.click(link)
    expect(location.pathname).toBe('/history/7')
  })

  it('marks an unfinished row without numbers', async () => {
    list.mockResolvedValue([summary(1, { endedAt: null, wpm: null, accuracy: null, meta: null })])
    render(<History />)
    const [item] = await screen.findAllByRole('listitem')
    expect(item.textContent).toContain('Unfinished')
    expect(item.textContent).not.toContain('%')
    expect(item.textContent).not.toContain('Left early')
  })

  it('shows the numbers and Left early for an abandoned test that has an end time', async () => {
    list.mockResolvedValue([
      summary(2, { endedAt: at(9, 8), wpm: 30.2, accuracy: 0.6, meta: { abandoned: true } }),
      summary(1, { endedAt: null, wpm: null, accuracy: null, meta: { abandoned: true } }),
    ])
    render(<History />)
    const items = await screen.findAllByRole('listitem')
    expect(items[0].textContent).toContain('60% · 30 wpm')
    expect(items[0].textContent).toContain('Left early')
    expect(items[0].textContent).not.toContain('Unfinished')
    // a closed tab that was also marked abandoned still has no numbers
    expect(items[1].textContent).toContain('Unfinished')
    expect(items[1].textContent).not.toContain('%')
    expect(items[1].textContent).toContain('Left early')
  })

  it('offers Show older only after a full page, and asks for rows before the last id', async () => {
    const page = Array.from({ length: 50 }, (_, i) => summary(100 - i))
    list.mockResolvedValueOnce(page)
    render(<History />)
    const more = await screen.findByRole('button', { name: 'Show older' })
    list.mockResolvedValueOnce([summary(50), summary(49)])
    fireEvent.click(more)
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(52))
    expect(list).toHaveBeenLastCalledWith({ limit: 50, beforeId: 51 })
    expect(screen.queryByRole('button', { name: 'Show older' })).toBeNull()
  })

  it('has no Show older after a short page', async () => {
    list.mockResolvedValue([summary(2), summary(1)])
    render(<History />)
    await screen.findAllByRole('listitem')
    expect(screen.queryByRole('button', { name: 'Show older' })).toBeNull()
  })

  it('shows a calm error and reloads on Try again', async () => {
    list.mockRejectedValueOnce(new Error('HTTP 500 secret detail'))
    render(<History />)
    expect(await screen.findByText(/Couldn't load/)).toBeTruthy()
    expect(document.body.textContent).not.toContain('secret detail')
    list.mockResolvedValueOnce([summary(1)])
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findAllByRole('listitem')).toHaveLength(1)
    expect(screen.queryByText(/Couldn't load/)).toBeNull()
  })

  it('keeps the rows and offers a retry when Show older fails', async () => {
    list.mockResolvedValueOnce(Array.from({ length: 50 }, (_, i) => summary(100 - i)))
    render(<History />)
    list.mockRejectedValueOnce(new Error('down'))
    fireEvent.click(await screen.findByRole('button', { name: 'Show older' }))
    expect(await screen.findByText(/Couldn't load/)).toBeTruthy()
    expect(screen.getAllByRole('listitem')).toHaveLength(50)
    list.mockResolvedValueOnce([summary(50)])
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(51))
    expect(list).toHaveBeenLastCalledWith({ limit: 50, beforeId: 51 })
  })

  it('says so when nothing has been practiced', async () => {
    list.mockResolvedValue([])
    render(<History />)
    expect(await screen.findByText('Nothing practiced yet. Try a drill from the Practice tab.')).toBeTruthy()
    expect(within(document.body).queryByRole('list')).toBeNull()
  })
})
