// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TestRow } from '../../server/archive.ts'
import { Practice } from '../../src/ui/Practice.tsx'

vi.mock('../../src/api.ts', () => ({ getLastTest: vi.fn() }))
const api = await import('../../src/api.ts')
const getLastTest = vi.mocked(api.getLastTest)

const INDEX = [
  { id: '5-cvc', chapter: 5, items: 1 },
  { id: '8-x', chapter: 8, items: 1 },
]

const row = (over: Partial<TestRow>): TestRow => ({
  id: 1, sessionId: 1, startedAt: 1, endedAt: 2, mode: 'free', chapter: 4, section: 'x', itemCount: 25,
  wpm: 41.2, accuracy: 0.92, meta: {}, ...over,
})

function stubIndex(reply: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url !== '/content/practice-index.json' || reply === 'fail') return { ok: false, status: 500, json: async () => ({}) }
      return { ok: true, status: 200, json: async () => reply }
    }),
  )
}

beforeEach(() => {
  history.replaceState(null, '', '/practice')
  getLastTest.mockReset().mockImplementation(async (mode, section) => {
    if (mode === 'free' && section === 'pseudo/words-25') return row({ accuracy: 0.92, wpm: 41.2 })
    if (mode === 'free' && section === 'ch-8/words-25') return row({ accuracy: 0.81, wpm: 30.6 })
    return null
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('Practice', () => {
  it('offers the sources from the index, pseudo-words first and chosen', async () => {
    stubIndex(INDEX)
    render(<Practice />)
    expect(screen.getByRole('heading', { name: 'Practice' })).toBeTruthy()
    const select = screen.getByRole('combobox', { name: 'Words from' }) as HTMLSelectElement
    await waitFor(() => expect(select.options).toHaveLength(3))
    expect([...select.options].map((o) => [o.value, o.text])).toEqual([
      ['pseudo', 'Chapter 4 pseudo-words'],
      ['ch-5', 'Chapter 5 word lists'],
      ['ch-8', 'Chapters 5–8 word lists'],
    ])
    expect(select.value).toBe('pseudo')
    const modes = within(screen.getByRole('radiogroup', { name: 'Mode' })).getAllByRole('radio') as HTMLInputElement[]
    expect(modes.map((r) => r.value)).toEqual(['words-25', 'words-50', 'time-30', 'time-60'])
    expect(screen.getByRole('radio', { name: '25 words' })).toHaveProperty('checked', true)
  })

  it('falls back to the pseudo-words when the index will not load', async () => {
    stubIndex('fail')
    render(<Practice />)
    const select = screen.getByRole('combobox', { name: 'Words from' }) as HTMLSelectElement
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalled())
    await new Promise((r) => setTimeout(r, 10))
    expect([...select.options].map((o) => o.value)).toEqual(['pseudo'])
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('starts the chosen source and mode', async () => {
    stubIndex(INDEX)
    render(<Practice />)
    const select = screen.getByRole('combobox', { name: 'Words from' }) as HTMLSelectElement
    await waitFor(() => expect(select.options).toHaveLength(3))
    fireEvent.change(select, { target: { value: 'ch-8' } })
    fireEvent.click(screen.getByRole('radio', { name: '60 seconds' }))
    const start = screen.getByRole('link', { name: 'Start' })
    expect(start.getAttribute('href')).toBe('/practice/free/ch-8/time-60')
    fireEvent.click(start)
    expect(location.pathname).toBe('/practice/free/ch-8/time-60')
  })

  it('shows the last result for the chosen combination', async () => {
    stubIndex(INDEX)
    render(<Practice />)
    expect(await screen.findByText('Last: 92% · 41 wpm')).toBeTruthy()
    const select = screen.getByRole('combobox', { name: 'Words from' }) as HTMLSelectElement
    await waitFor(() => expect(select.options).toHaveLength(3))
    fireEvent.change(select, { target: { value: 'ch-8' } })
    expect(await screen.findByText('Last: 81% · 31 wpm')).toBeTruthy()
    expect(getLastTest).toHaveBeenCalledWith('free', 'ch-8/words-25')
    fireEvent.click(screen.getByRole('radio', { name: '50 words' }))
    expect(await screen.findByText('Last: —')).toBeTruthy()
    expect(getLastTest).toHaveBeenCalledWith('free', 'ch-8/words-50')
  })

  it('lists the Chapter 4 drills below', async () => {
    stubIndex(INDEX)
    render(<Practice />)
    const drills = screen.getByRole('region', { name: 'Chapter 4 drills' })
    expect(within(drills).getAllByRole('link')).toHaveLength(9)
    expect(within(drills).getByRole('link', { name: /Vowels/ }).getAttribute('href')).toBe('/drill/stage0/rows-vowels')
    await waitFor(() => expect(getLastTest).toHaveBeenCalledWith('stage0', 'rows-vowels'))
  })
})
