// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setPasted } from '../../src/state/pastedtext.ts'
import { UniProvider } from '../../src/state/uni-context.tsx'
import { TextRun } from '../../src/ui/TextRun.tsx'
import { __resetDictionaryCacheForTests } from '../../src/ui/tools/Lookup.tsx'
import { FakeDevice, FakeHid, SAP, TAP, fakeLogger, stubContent } from './helpers/practice-rig.tsx'
import type { FakeLogger } from './helpers/practice-rig.tsx'

vi.mock('../../src/api.ts', () => ({
  createTestLogger: vi.fn(),
  getSettings: vi.fn(),
  putSettings: vi.fn(),
  getGhosts: vi.fn(),
  getText: vi.fn(),
  appendJournal: vi.fn(),
}))
const api = await import('../../src/api.ts')
const createTestLogger = vi.mocked(api.createTestLogger)
const getSettings = vi.mocked(api.getSettings)
const getGhosts = vi.mocked(api.getGhosts)
const getText = vi.mocked(api.getText)
const appendJournal = vi.mocked(api.appendJournal)

const DICTIONARY = {
  commit: 'x',
  letters: {},
  cards: [
    { t: 'sap', r: [{ o: 'SAP' }] },
    { t: 'tap', r: [{ o: 'TAP' }] },
  ],
}
const CONTENT = { '/content/dictionary.json': DICTIONARY }
const GHOST_RUN = { testId: 7, endedAt: Date.now(), wpm: 50, completions: [1000, 2000, 3000, 4000, 5000] }
const BYTES: Record<string, number[]> = { sap: SAP, tap: TAP }

let loggers: FakeLogger[] = []

beforeEach(() => {
  history.replaceState(null, '', '/practice/text/run/pasted/1')
  vi.stubGlobal('scrollTo', vi.fn())
  Element.prototype.scrollIntoView = vi.fn()
  __resetDictionaryCacheForTests()
  stubContent(CONTENT)
  setPasted('')
  loggers = []
  createTestLogger.mockReset().mockImplementation(() => {
    const logger = fakeLogger()
    loggers.push(logger)
    return logger
  })
  getSettings
    .mockReset()
    .mockResolvedValue({
      boardVisibility: 'always',
      hints: 'miss',
      plateauSnoozedUntil: null,
      reportSeen: null,
      ghost: 'best',
    })
  getGhosts.mockReset().mockResolvedValue({ best: null, last: null })
  getText.mockReset().mockResolvedValue(null)
  appendJournal.mockReset().mockResolvedValue(undefined as never)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

type Rig = { stroke(bytes: number[]): void }

/** Mounts the run on a fake board and waits for the drill (or a message) to appear. */
async function mount(id: string, part: number): Promise<Rig> {
  const hid = new FakeHid()
  const device = new FakeDevice()
  hid.known = [device]
  render(
    <UniProvider hid={hid}>
      <TextRun id={id} part={part} />
    </UniProvider>,
  )
  await waitFor(() => expect(screen.queryByText(/Loading/)).toBeNull())
  return {
    stroke(bytes) {
      act(() => device.report(bytes))
      act(() => device.report([]))
    },
  }
}

const flow = (): string[] => [...document.querySelectorAll('.drill__flow-word')].map((w) => w.textContent ?? '')
const WORDS_250 = Array.from({ length: 250 }, () => 'sap').join(' ')

describe('TextRun', () => {
  it('runs the words of a pasted text in text order as a flowing word drill', async () => {
    setPasted('Tap sap, tap! 42 xyzzy sap.')
    await mount('pasted', 1)
    expect(document.querySelector('.drill__flow--word')).not.toBeNull()
    expect(flow().slice(0, 4)).toEqual(['tap', 'sap', 'tap', 'sap'])
    expect(screen.getByText('Part 1 of 1')).toBeTruthy()
    expect(screen.getByText('4 words in this part')).toBeTruthy()
  })

  it('says Part 2 of 3 and cuts the words into parts of 100', async () => {
    setPasted(WORDS_250)
    await mount('pasted', 2)
    expect(screen.getByText('Part 2 of 3')).toBeTruthy()
    expect(screen.getByText('100 words in this part')).toBeTruthy()
  })

  it('has a shorter last part', async () => {
    setPasted(WORDS_250)
    await mount('pasted', 3)
    expect(screen.getByText('Part 3 of 3')).toBeTruthy()
    expect(screen.getByText('50 words in this part')).toBeTruthy()
  })

  it('logs the run as mode text, chapter null, section text/<id>/<part>', async () => {
    setPasted(WORDS_250)
    const rig = await mount('pasted', 3)
    expect(loggers).toHaveLength(1)
    expect(loggers[0].start).not.toHaveBeenCalled()
    rig.stroke(SAP)
    await waitFor(() => expect(loggers[0].start).toHaveBeenCalled())
    expect(loggers[0].start).toHaveBeenCalledWith({
      mode: 'text',
      chapter: null,
      section: 'text/pasted/3',
      itemCount: 50,
    })
  })

  it('loads a saved text by its id and logs under that id', async () => {
    getText.mockResolvedValue({ id: 'moby', name: 'Moby Dick', text: 'sap tap' })
    const rig = await mount('moby', 1)
    expect(getText).toHaveBeenCalledWith('moby')
    expect(screen.getByText('Moby Dick')).toBeTruthy()
    rig.stroke(SAP)
    await waitFor(() => expect(loggers[0].start).toHaveBeenCalled())
    expect(loggers[0].start).toHaveBeenCalledWith({ mode: 'text', chapter: null, section: 'text/moby/1', itemCount: 2 })
  })

  it('asks for the ghost of the text section and has a Ghost picker', async () => {
    setPasted('sap tap')
    await mount('pasted', 1)
    await waitFor(() => expect(getGhosts).toHaveBeenCalledWith('text', 'text/pasted/1'))
    expect(screen.getByRole('group', { name: 'Ghost' })).toBeTruthy()
  })

  it('does not ask for a ghost while the stored choice is unknown', async () => {
    setPasted('sap tap')
    getSettings.mockReturnValue(new Promise(() => {}))
    await mount('pasted', 1)
    await act(async () => {})
    expect(getGhosts).not.toHaveBeenCalled()
  })

  it('shows a result card with the stats, the ghost note, a note box and Again', async () => {
    setPasted('sap tap sap')
    getGhosts.mockResolvedValue({ best: GHOST_RUN, last: null })
    const rig = await mount('pasted', 1)
    await waitFor(() => expect(document.querySelector('.ghost__text')).not.toBeNull())
    for (const w of ['sap', 'tap', 'sap']) rig.stroke(BYTES[w])
    const card = await screen.findByRole('region', { name: 'Result' })
    expect(within(card).getByRole('heading', { name: 'Text · pasted · part 1' })).toBeTruthy()
    expect(card.textContent).toContain('100%')
    expect(card.textContent).toMatch(/\d+ wpm/)
    expect(within(card).getByText('Words').nextElementSibling!.textContent).toBe('3')
    expect(within(card).getByText('Time')).toBeTruthy()
    expect(card.querySelector('.ghost__note')!.textContent).toMatch(
      /^Best run \(today\) had 0 words by 0:00\. You: 3 — 3 ahead\.$/,
    )
    expect(within(card).queryByRole('link', { name: 'Next part' })).toBeNull()
    expect(within(card).getByRole('link', { name: 'Back to text' }).getAttribute('href')).toBe('/practice/text')
    fireEvent.click(within(card).getByRole('button', { name: 'Again' }))
    expect(loggers).toHaveLength(2)
    expect(screen.queryByRole('region', { name: 'Result' })).toBeNull()
    expect(flow()[0]).toBe('sap')
  })

  it('titles the journal note like the run label and passes the stats', async () => {
    getText.mockResolvedValue({ id: 'moby', name: 'Moby Dick', text: 'sap' })
    const rig = await mount('moby', 1)
    rig.stroke(SAP)
    const card = await screen.findByRole('region', { name: 'Result' })
    fireEvent.click(within(card).getByRole('button', { name: 'Add a note' }))
    fireEvent.input(within(card).getByRole('textbox'), { target: { value: 'steady' } })
    fireEvent.click(within(card).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(appendJournal).toHaveBeenCalled())
    expect(appendJournal.mock.calls[0][1]).toMatch(/— Text · Moby Dick · part 1 · 100% · \d+ wpm\n\nsteady$/)
  })

  it('offers Next part, to the next part, only when one exists', async () => {
    setPasted(WORDS_250)
    const rig = await mount('pasted', 1)
    for (let i = 0; i < 100; i++) rig.stroke(SAP)
    const card = await screen.findByRole('region', { name: 'Result' })
    const next = within(card).getByRole('link', { name: 'Next part' })
    expect(next.getAttribute('href')).toBe('/practice/text/run/pasted/2')
    expect(fireEvent.click(next)).toBe(false)
    expect(location.pathname).toBe('/practice/text/run/pasted/2')
  })

  it('leaves for the text page on Exit', async () => {
    setPasted('sap tap')
    await mount('pasted', 1)
    fireEvent.click(screen.getByRole('button', { name: 'Exit' }))
    expect(location.pathname).toBe('/practice/text')
  })

  it.each([
    ['a part beyond the last', () => setPasted('sap tap'), 'pasted', 2],
    ['an empty pasted text', () => setPasted('   '), 'pasted', 1],
    ['a pasted text with nothing to stroke', () => setPasted('xyzzy 42'), 'pasted', 1],
  ])('shows a calm message and a way back for %s', async (_name, arrange, id, part) => {
    arrange()
    await mount(id, part)
    expect(screen.getByRole('alert').textContent).toMatch(/\./)
    expect(screen.getByRole('link', { name: 'Back to text' }).getAttribute('href')).toBe('/practice/text')
    expect(createTestLogger).not.toHaveBeenCalled()
  })

  it('says so for an unknown saved text', async () => {
    getText.mockResolvedValue(null)
    await mount('nope', 1)
    expect(getText).toHaveBeenCalledWith('nope')
    expect(screen.getByRole('alert')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Back to text' }).getAttribute('href')).toBe('/practice/text')
  })

  it('says so for a part beyond the last of a saved text', async () => {
    getText.mockResolvedValue({ id: 'moby', name: 'Moby Dick', text: 'sap tap' })
    await mount('moby', 5)
    expect(screen.getByRole('alert')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Back to text' })).toBeTruthy()
  })

  it('shows a calm error when the dictionary will not load, and Try again reloads it', async () => {
    setPasted('sap tap')
    stubContent({})
    await mount('pasted', 1)
    expect(screen.getByRole('alert').textContent).toMatch(/Couldn't load the dictionary/)
    stubContent(CONTENT)
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('Part 1 of 1')).toBeTruthy()
  })

  it('shows a calm error when the saved text will not load, and Try again reloads it', async () => {
    getText.mockRejectedValueOnce(new Error('offline'))
    getText.mockResolvedValue({ id: 'moby', name: 'Moby Dick', text: 'sap tap' })
    await mount('moby', 1)
    expect(screen.getByRole('alert').textContent).toMatch(/Couldn't load the text/)
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('Part 1 of 1')).toBeTruthy()
  })
})

describe('TextRun opened from a routine', () => {
  beforeEach(() => history.replaceState(null, '', '/practice/text/run/pasted/1?from=routine'))

  it('leads back to the routine on Exit', async () => {
    setPasted('sap tap')
    await mount('pasted', 1)
    fireEvent.click(screen.getByRole('button', { name: 'Exit' }))
    expect(location.pathname).toBe('/practice/routine')
  })

  it('leads back to the routine from the result card', async () => {
    setPasted('sap')
    const rig = await mount('pasted', 1)
    rig.stroke(SAP)
    const card = await screen.findByRole('region', { name: 'Result' })
    expect(within(card).queryByRole('link', { name: 'Back to text' })).toBeNull()
    expect(within(card).getByRole('link', { name: 'Back to routine' }).getAttribute('href')).toBe('/practice/routine')
  })

  it('keeps the marker on Next part, and only then', async () => {
    setPasted(WORDS_250)
    const rig = await mount('pasted', 1)
    for (let i = 0; i < 100; i++) rig.stroke(SAP)
    const card = await screen.findByRole('region', { name: 'Result' })
    expect(within(card).getByRole('link', { name: 'Next part' }).getAttribute('href')).toBe(
      '/practice/text/run/pasted/2?from=routine',
    )
  })

  it('leads back to the routine from a message', async () => {
    getText.mockResolvedValue(null)
    await mount('nope', 1)
    expect(screen.getByRole('link', { name: 'Back to routine' }).getAttribute('href')).toBe('/practice/routine')
  })
})
