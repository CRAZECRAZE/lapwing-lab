// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/preact'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { StrokeRecord, TestRow } from '../../server/archive.ts'
import { parseStroke } from '../../src/core/steno.ts'
import { TestDetail } from '../../src/ui/TestDetail.tsx'

vi.mock('../../src/api.ts', () => ({ listTests: vi.fn(), getTest: vi.fn() }))
const { getTest } = await import('../../src/api.ts')
const get = vi.mocked(getTest)

const at = (h: number, m: number, s = 0): number => new Date(2026, 9, 27, h, m, s).getTime()

const row = (over: Partial<TestRow> = {}): TestRow => ({
  id: 5,
  sessionId: 1,
  startedAt: at(9, 0),
  endedAt: at(9, 20),
  mode: 'stage0',
  chapter: 4,
  section: 'rows-vowels',
  itemCount: 4,
  wpm: 41.4,
  accuracy: 0.75,
  meta: {},
  ...over,
})

function stroke(tsMs: number, prompt: string, over: Partial<StrokeRecord> & { pressed?: string } = {}): StrokeRecord {
  const { pressed, ...rest } = over
  return {
    testId: 5,
    tsMs,
    prompt,
    expected: ['SAP'],
    pressedLevers: [],
    pressedMask: parseStroke(pressed ?? 'SAP'),
    correct: true,
    latencyMs: 400,
    attemptNo: 1,
    ...rest,
  }
}

beforeEach(() => get.mockReset())
afterEach(cleanup)

describe('TestDetail', () => {
  it('shows stats and a table of misses', async () => {
    get.mockResolvedValue({
      test: row(),
      strokes: [
        stroke(at(9, 5), 'sap'),
        stroke(at(9, 6), 'sap', { correct: false, pressed: 'STAP' }),
        stroke(at(9, 7), 'sap', { correct: false, pressed: 'S-P' }),
        stroke(at(9, 17), 'sap'),
      ],
    })
    render(<TestDetail id={5} />)
    await screen.findByRole('heading', { name: /Chapter 4 · / })
    expect(get).toHaveBeenCalledWith(5)
    const stats = document.querySelector('.detail__stats')!
    expect(stats.textContent).toContain('75%')
    expect(stats.textContent).toContain('41 wpm')
    expect(stats.textContent).toContain('4')
    expect(stats.textContent).toContain('12 min') // first stroke 09:05 to last 09:17
    expect(screen.queryByText('No misses.')).toBeNull()
    const table = screen.getByRole('table')
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual([
      'Word', 'Required', 'Pressed', 'Missing', 'Extra',
    ])
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows).toHaveLength(2)
    expect(within(rows[0]).getAllByRole('cell').map((c) => c.textContent)).toEqual(['sap', 'SAP', 'STAP', '—', 'T-'])
    expect(within(rows[1]).getAllByRole('cell').map((c) => c.textContent)).toEqual(['sap', 'SAP', 'S-P', 'A-', '—'])
  })

  it('says No misses. for a clean run', async () => {
    get.mockResolvedValue({ test: row(), strokes: [stroke(at(9, 5), 'sap')] })
    render(<TestDetail id={5} />)
    expect(await screen.findByText('No misses.')).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('lists the five slowest words', async () => {
    const strokes = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((p, i) => stroke(at(9, i), p, { latencyMs: 1000 + i * 100 }))
    get.mockResolvedValue({ test: row(), strokes })
    render(<TestDetail id={5} />)
    const heading = await screen.findByRole('heading', { name: 'Slowest words' })
    const items = within(heading.parentElement!).getAllByRole('listitem')
    expect(items).toHaveLength(5)
    expect(items[0].textContent).toContain('g')
    expect(items[0].textContent).toContain('1.6 s')
    expect(items[4].textContent).toContain('c')
  })

  it('notes a test that was left early, and an unfinished one has no numbers', async () => {
    get.mockResolvedValue({ test: row({ meta: { abandoned: true } }), strokes: [stroke(at(9, 5), 'sap')] })
    const { unmount } = render(<TestDetail id={5} />)
    expect(await screen.findByText('Left early')).toBeTruthy()
    unmount()
    get.mockResolvedValue({ test: row({ endedAt: null, accuracy: null, wpm: null, meta: null }), strokes: [] })
    render(<TestDetail id={5} />)
    expect(await screen.findByText('Unfinished')).toBeTruthy()
    expect(screen.queryByText('Left early')).toBeNull()
    expect(document.body.textContent).not.toContain('NaN')
  })

  it('says No such test. for a missing one', async () => {
    get.mockResolvedValue(null)
    render(<TestDetail id={99} />)
    expect(await screen.findByText('No such test.')).toBeTruthy()
  })

  it('shows a calm error and retries', async () => {
    get.mockRejectedValueOnce(new Error('HTTP 500 secret detail'))
    render(<TestDetail id={5} />)
    expect(await screen.findByText(/Couldn't load/)).toBeTruthy()
    expect(document.body.textContent).not.toContain('secret detail')
    get.mockResolvedValueOnce({ test: row(), strokes: [stroke(at(9, 5), 'sap')] })
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('No misses.')).toBeTruthy()
  })

  it('links back to the history list', async () => {
    get.mockResolvedValue({ test: row(), strokes: [] })
    render(<TestDetail id={5} />)
    fireEvent.click(await screen.findByRole('link', { name: /History/ }))
    expect(location.pathname).toBe('/history')
  })
})
