// @vitest-environment jsdom
import { cleanup, screen, waitFor, within, fireEvent } from '@testing-library/preact'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FixupLists, FixupPattern, FixupWord } from '../../src/core/fixup.ts'
import { FIXUP_MAX_SHOWINGS } from '../../src/core/fixupdrill.ts'
import { FixupRun } from '../../src/ui/FixupRun.tsx'
import { CHAPTERS, INDEX, SAP, TAP, fakeLogger, mountRig, passed, prompt, stubContent } from './helpers/practice-rig.tsx'
import type { FakeLogger, Rig } from './helpers/practice-rig.tsx'

vi.mock('../../src/api.ts', () => ({
  createTestLogger: vi.fn(),
  getSettings: vi.fn(),
  putSettings: vi.fn(),
  getGhosts: vi.fn(),
  getResults: vi.fn(),
  getProgress: vi.fn(),
  getFixup: vi.fn(),
  appendJournal: vi.fn(),
}))
const api = await import('../../src/api.ts')
const createTestLogger = vi.mocked(api.createTestLogger)
const getSettings = vi.mocked(api.getSettings)
const getGhosts = vi.mocked(api.getGhosts)
const getResults = vi.mocked(api.getResults)
const getProgress = vi.mocked(api.getProgress)
const getFixup = vi.mocked(api.getFixup)

const KAP = [0x21, 0x02]
const PAP = [0x11, 0x02]
const BYTES: Record<string, number[]> = { sap: SAP, tap: TAP, kap: KAP, pap: PAP }

const word = (prompt: string, outline: string): FixupWord => ({
  prompt,
  outlines: [outline],
  kind: 'word',
  attempts: 10,
  misses: 4,
  rate: 0.4,
  lastTsMs: 1,
})
const pattern = (needed: FixupPattern['needed']): FixupPattern =>
  ({ kind: 'missing', needed, id: `missing:${needed}`, count: 5, required: 40, rate: 0.12, lastTsMs: 1 }) as FixupPattern

function lists(words: FixupWord[], patterns: FixupPattern[] = []): FixupLists {
  return { from: '2026-10-01', to: '2026-10-30', words, patterns }
}

const PRACTICE = {
  '/content/practice-index.json': INDEX,
  '/content/practice/5-cvc.json': {
    id: '5-cvc',
    items: [
      { prompt: 'sap', outlines: ['SAP'] },
      { prompt: 'tap', outlines: ['TAP'] },
      { prompt: 'kap', outlines: ['KAP'] },
      { prompt: 'pap', outlines: ['PAP'] },
      { prompt: 'sat', outlines: ['SAT'] },
    ],
  },
  '/content/practice/5-test.json': { id: '5-test', items: [{ prompt: 'tat', outlines: ['TAT'] }] },
  '/content/practice/6-fqm.json': { id: '6-fqm', items: [] },
}

let loggers: FakeLogger[] = []

beforeEach(() => {
  history.replaceState(null, '', '/practice/fixup/run/words?pick=sap&pick=tap')
  vi.stubGlobal('scrollTo', vi.fn())
  Element.prototype.scrollIntoView = vi.fn()
  stubContent({ '/content/chapters.json': CHAPTERS, ...PRACTICE })
  loggers = []
  createTestLogger.mockReset().mockImplementation(() => {
    const logger = fakeLogger()
    loggers.push(logger)
    return logger
  })
  getSettings.mockReset().mockResolvedValue({ boardVisibility: 'always', hints: 'miss', plateauSnoozedUntil: null, reportSeen: null, ghost: 'best' })
  getGhosts.mockReset().mockResolvedValue({ best: null, last: null })
  getResults.mockReset().mockImplementation(async (mode) => (mode === 'stage0' ? [passed('pseudo-test')] : []))
  getProgress.mockReset().mockResolvedValue([])
  getFixup.mockReset().mockResolvedValue(lists([word('sap', 'SAP'), word('tap', 'TAP')], [pattern('-P')]))
  vi.mocked(api.appendJournal).mockReset().mockResolvedValue(undefined as never)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const mountRun = (kind: 'words' | 'patterns' = 'words'): Promise<Rig> => mountRig(<FixupRun kind={kind} />)
const text = (selector: string): string => document.querySelector(selector)?.textContent ?? ''
const filled = (): number => document.querySelectorAll('.fixup-run__dot--filled').length
const stat = (card: HTMLElement, label: string): string => within(card).getByText(label).nextElementSibling?.textContent ?? ''
const streakText = (): string => text('.fixup-run__streak')
const position = (): string => text('.fixup-run__position')
const announced = (): string => text('.fixup-run__announce')

function ten(rig: Rig, bytes: number[] = SAP): void {
  for (let i = 0; i < 10; i++) rig.stroke(bytes)
}
/** Types whichever word is on screen. */
const typeCurrent = (rig: Rig): void => rig.stroke(BYTES[prompt()!])

describe('FixupRun ghost', () => {
  it('runs without a ghost: nothing asked, nothing drawn', async () => {
    getGhosts.mockResolvedValue({
      best: { testId: 7, endedAt: Date.now(), wpm: 50, completions: [1000, 2000, 3000, 4000, 5000] },
      last: null,
    })
    const rig = await mountRun()
    await screen.findByText('0 clean in a row')
    rig.stroke(SAP)
    expect(getGhosts).not.toHaveBeenCalled()
    expect(document.querySelector('.ghost')).toBeNull()
    expect(screen.queryByRole('group', { name: 'Ghost' })).toBeNull()
  })
})

describe('FixupRun words', () => {
  it('starts on the first pick with empty dots', async () => {
    await mountRun()
    expect(await screen.findByText('0 clean in a row')).toBeTruthy()
    expect(prompt()).toBe('sap')
    expect(filled()).toBe(0)
    expect(document.querySelectorAll('.fixup-run__dot')).toHaveLength(10)
    expect(document.querySelector('.fixup-run__dots')!.getAttribute('aria-hidden')).toBe('true')
    // one polite live line carries streak and item counter; the visible lines are not live themselves
    expect(document.querySelector('.fixup-run__announce')!.getAttribute('aria-live')).toBe('polite')
    expect(document.querySelector('.fixup-run__streak')!.hasAttribute('aria-live')).toBe(false)
    expect(announced()).toBe('0 clean in a row, item 1 of 2')
    expect(position()).toBe('Item 1 of 2 · 0 fixed')
    expect(text('.fixup-run__label')).toBe('sap')
    expect(document.body.textContent).not.toMatch(/wpm/i)
  })

  it('fills a dot per clean stroke, then moves to the next word', async () => {
    const rig = await mountRun()
    await screen.findByText('0 clean in a row')
    for (let k = 1; k <= 10; k++) {
      rig.stroke(SAP)
      if (k < 10) {
        expect(streakText()).toBe(`${k} clean in a row`)
        expect(filled()).toBe(k)
      }
    }
    expect(prompt()).toBe('tap')
    expect(position()).toBe('Item 2 of 2 · 1 fixed')
    expect(streakText()).toBe('0 clean in a row')
    expect(filled()).toBe(0)
  })

  it('announces the streak and the item counter together, and the item when it moves on', async () => {
    const rig = await mountRun()
    await screen.findByText('0 clean in a row')
    for (let k = 1; k < 10; k++) rig.stroke(SAP)
    expect(announced()).toBe('9 clean in a row, item 1 of 2')
    rig.stroke(SAP)
    expect(announced()).toBe('0 clean in a row, item 2 of 2')
  })

  it('resets the dots on a miss and shows the right stroke', async () => {
    const rig = await mountRun()
    await screen.findByText('0 clean in a row')
    for (let i = 0; i < 5; i++) rig.stroke(SAP)
    expect(streakText()).toBe('5 clean in a row')
    rig.stroke(TAP)
    expect(streakText()).toBe('0 clean in a row')
    expect(filled()).toBe(0)
    expect(text('.drill__expected')).toBe('SAP')
    expect(prompt()).toBe('sap')
    rig.stroke(SAP)
    // the showing that needed a retry is not clean
    expect(streakText()).toBe('0 clean in a row')
  })

  it('logs a fixup run with no chapter and the kind as its section', async () => {
    const rig = await mountRun()
    await screen.findByText('0 clean in a row')
    rig.stroke(SAP)
    expect(loggers[0].start).toHaveBeenCalledWith(expect.objectContaining({ mode: 'fixup', chapter: null, section: 'words' }))
    for (let i = 0; i < 9; i++) rig.stroke(SAP) // one is already typed: ten fix sap
    ten(rig, TAP)
    await screen.findByRole('region', { name: 'Result' })
    expect(loggers[0].finish).toHaveBeenCalledTimes(1)
    const call = loggers[0].finish.mock.calls[0][0]
    expect(call.wpm).toBe(0)
    expect(call.meta).toMatchObject({
      section: 'words',
      targets: [
        { id: 'sap', label: 'sap' },
        { id: 'tap', label: 'tap' },
      ],
      fixed: ['sap', 'tap'],
      showings: 20,
    })
    expect(call.meta).not.toHaveProperty('abandoned')
  })

  it('logs an abandoned run with the same extra meta when left mid-drill', async () => {
    const rig = await mountRun()
    await screen.findByText('0 clean in a row')
    for (let i = 0; i < 3; i++) rig.stroke(SAP)
    rig.unmount()
    expect(loggers[0].finish).toHaveBeenCalledTimes(1)
    expect(loggers[0].finish.mock.calls[0][0].meta).toMatchObject({
      abandoned: true,
      section: 'words',
      targets: [
        { id: 'sap', label: 'sap' },
        { id: 'tap', label: 'tap' },
      ],
      fixed: [],
      showings: 3,
    })
  })

  it('shows a result card with the counts, a note box and no wpm', async () => {
    const rig = await mountRun()
    await screen.findByText('0 clean in a row')
    rig.stroke(TAP) // a miss: sap's first showing is not clean
    for (let i = 0; i < 11; i++) rig.stroke(SAP) // the showing after the miss, then ten clean ones
    ten(rig, TAP)
    const card = await screen.findByRole('region', { name: 'Result' })
    expect(card.textContent).not.toMatch(/wpm/i)
    for (const label of ['Fixed', 'Not finished', 'Showings', 'First try', 'Time']) expect(within(card).getByText(label)).toBeTruthy()
    expect(stat(card, 'Fixed')).toBe('2')
    expect(stat(card, 'Not finished')).toBe('0')
    expect(stat(card, 'Showings')).toBe('21')
    expect(stat(card, 'First try')).toBe('95%')
    expect(stat(card, 'Time')).toMatch(/^\d:\d\d$/)
    expect(within(card).getByRole('button', { name: 'Add a note' })).toBeTruthy()
    expect(within(card).getByRole('link', { name: 'Back to Fix-up' }).getAttribute('href')).toBe('/practice/fixup')
    expect(within(card).queryByRole('button', { name: 'Keep going' })).toBeNull()
  })

  it('saves a note under the result without a percentage or wpm in the journal heading', async () => {
    const rig = await mountRun()
    await screen.findByText('0 clean in a row')
    ten(rig, SAP)
    ten(rig, TAP)
    const card = await screen.findByRole('region', { name: 'Result' })
    fireEvent.click(within(card).getByRole('button', { name: 'Add a note' }))
    fireEvent.input(within(card).getByLabelText('Note for today'), { target: { value: 'Slow and steady' } })
    fireEvent.click(within(card).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(vi.mocked(api.appendJournal)).toHaveBeenCalledTimes(1))
    const block = vi.mocked(api.appendJournal).mock.calls[0][1]
    const heading = block.split('\n')[0]
    expect(heading).toMatch(/^### \d\d:\d\d — Fix-up · words$/)
    expect(block).not.toMatch(/wpm|%/)
    expect(block).toContain('Slow and steady')
  })

  it('finds picks such as a comma or a slash', async () => {
    history.replaceState(null, '', '/practice/fixup/run/words?pick=a%2Fb&pick=%2C')
    getFixup.mockResolvedValue(lists([word('a/b', 'SAP'), word(',', 'TAP')]))
    const rig = await mountRun()
    await screen.findByText('0 clean in a row')
    expect(prompt()).toBe('a/b')
    ten(rig, SAP)
    expect(prompt()).toBe(',')
    expect(position()).toBe('Item 2 of 2 · 1 fixed')
  })

  it('drops a pick that is no longer listed', async () => {
    history.replaceState(null, '', '/practice/fixup/run/words?pick=gone&pick=tap')
    await mountRun()
    await screen.findByText('Item 1 of 1 · 0 fixed')
    expect(prompt()).toBe('tap')
  })

  it('says so when nothing ticked is left, and logs nothing', async () => {
    history.replaceState(null, '', '/practice/fixup/run/words?pick=gone')
    await mountRun()
    expect(await screen.findByText('Nothing ticked is left to fix.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Back to Fix-up' }).getAttribute('href')).toBe('/practice/fixup')
    expect(document.querySelector('.drill')).toBeNull()
    expect(createTestLogger).not.toHaveBeenCalled()
  })

  it('says so when no pick is given', async () => {
    history.replaceState(null, '', '/practice/fixup/run/words')
    await mountRun()
    expect(await screen.findByText('Nothing ticked is left to fix.')).toBeTruthy()
  })

  it('is calm when the fix-up lists fail to load', async () => {
    getFixup.mockReset().mockRejectedValue(new Error('down'))
    await mountRun()
    expect(await screen.findByText(/Couldn't load the fix-up lists/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Back to Fix-up' })).toBeTruthy()
    expect(document.querySelector('.drill')).toBeNull()
  })

  it('stops at the cap, says so, and offers Keep going', async () => {
    const rig = await mountRun()
    await screen.findByText('0 clean in a row')
    // A miss after nine clean showings keeps every showing from reaching ten in a row.
    for (let n = 1; n <= FIXUP_MAX_SHOWINGS; n++) {
      if (n % 10 === 0) rig.stroke(TAP)
      rig.stroke(SAP)
    }
    const card = await screen.findByRole('region', { name: 'Result' })
    expect(within(card).getByText(`Stopped at ${FIXUP_MAX_SHOWINGS} showings.`)).toBeTruthy()
    expect(within(card).getByRole('button', { name: 'Keep going' })).toBeTruthy()
    expect(stat(card, 'Fixed')).toBe('0')
    expect(stat(card, 'Not finished')).toBe('2')
    expect(stat(card, 'Showings')).toBe(String(FIXUP_MAX_SHOWINGS))
  })

  it('Keep going runs only the targets not yet fixed, with a fresh logger', async () => {
    const rig = await mountRun()
    await screen.findByText('0 clean in a row')
    // sap is fixed; tap then runs into the cap
    ten(rig, SAP)
    expect(position()).toBe('Item 2 of 2 · 1 fixed')
    for (let n = 1; n <= FIXUP_MAX_SHOWINGS - 10; n++) {
      if (n % 10 === 0) rig.stroke(SAP)
      rig.stroke(TAP)
    }
    const card = await screen.findByRole('region', { name: 'Result' })
    fireEvent.click(within(card).getByRole('button', { name: 'Keep going' }))
    await screen.findByText('0 clean in a row')
    expect(prompt()).toBe('tap')
    expect(position()).toBe('Item 1 of 1 · 0 fixed')
    expect(loggers).toHaveLength(2)
  })
})

describe('FixupRun patterns', () => {
  beforeEach(() => {
    history.replaceState(null, '', '/practice/fixup/run/patterns?pick=missing%3A-P')
  })

  it('drills only words containing the needed key, and a miss on another key is not clean', async () => {
    const rig = await mountRun('patterns')
    await screen.findByText('0 clean in a row')
    expect(text('.fixup-run__label')).toBe('-P missing')
    expect(position()).toBe('Item 1 of 1 · 0 fixed')
    const seen = new Set<string>()
    for (let i = 0; i < 3; i++) {
      seen.add(prompt()!)
      typeCurrent(rig)
    }
    expect(streakText()).toBe('3 clean in a row')
    // another word that has -P, but not this one's other keys
    const now = prompt()!
    rig.stroke(BYTES[Object.keys(BYTES).find((k) => k !== now)!])
    expect(streakText()).toBe('0 clean in a row')
    typeCurrent(rig)
    expect(streakText()).toBe('0 clean in a row')
    for (let i = 0; i < 10; i++) {
      seen.add(prompt()!)
      typeCurrent(rig)
    }
    for (const p of seen) expect(['sap', 'tap', 'kap', 'pap']).toContain(p)
    const card = await screen.findByRole('region', { name: 'Result' })
    expect(within(card).getByRole('link', { name: 'Back to Fix-up' }).getAttribute('href')).toBe('/practice/fixup/patterns')
    expect(loggers[0].start).toHaveBeenCalledWith(expect.objectContaining({ mode: 'fixup', chapter: null, section: 'patterns' }))
    expect(loggers[0].finish.mock.calls[0][0].meta).toMatchObject({
      section: 'patterns',
      targets: [{ id: 'missing:-P', label: '-P missing' }],
      fixed: ['missing:-P'],
    })
  })

  it('labels a mix-up as the key typed for the key needed', async () => {
    getFixup.mockResolvedValue(
      lists([], [{ kind: 'mixup', pressed: '-T', needed: '-P', id: 'mixup:-T>-P', count: 5, required: 40, rate: 0.12, lastTsMs: 1 }]),
    )
    history.replaceState(null, '', '/practice/fixup/run/patterns?pick=mixup%3A-T%3E-P')
    await mountRun('patterns')
    await screen.findByText('0 clean in a row')
    expect(text('.fixup-run__label')).toBe('-T typed for -P')
  })

  it('skips a pattern with too few words, and says nothing is left when none remain', async () => {
    getFixup.mockResolvedValue(lists([], [pattern('-B')]))
    history.replaceState(null, '', '/practice/fixup/run/patterns?pick=missing%3A-B')
    await mountRun('patterns')
    expect(await screen.findByText('Nothing ticked is left to fix.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Back to Fix-up' }).getAttribute('href')).toBe('/practice/fixup/patterns')
  })

  it('is calm when the word lists fail to load', async () => {
    stubContent({ '/content/chapters.json': CHAPTERS, ...PRACTICE, '/content/practice/5-cvc.json': 'fail' })
    await mountRun('patterns')
    expect(await screen.findByText(/Couldn't load the word lists/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Back to Fix-up' })).toBeTruthy()
  })
})
