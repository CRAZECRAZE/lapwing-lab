// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/preact'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DrillItem } from '../../src/core/drill.ts'
import { DockProvider } from '../../src/state/dock.tsx'
import { DockHost } from '../../src/ui/DockHost.tsx'
import { DrillRunner } from '../../src/ui/DrillRunner.tsx'
import type { DrillRunnerProps } from '../../src/ui/DrillRunner.tsx'
import { CONTENT, SAP, TAP, fakeLogger, mountRig, passed, prompt, stubContent } from './helpers/practice-rig.tsx'
import type { FakeLogger } from './helpers/practice-rig.tsx'

vi.mock('../../src/api.ts', () => ({
  createTestLogger: vi.fn(),
  getSettings: vi.fn(),
  putSettings: vi.fn(),
  getGhosts: vi.fn(),
  getLastTest: vi.fn(),
  appendJournal: vi.fn(),
  getResults: vi.fn(),
  getProgress: vi.fn(),
  putMark: vi.fn(),
  deleteMark: vi.fn(),
}))
const api = await import('../../src/api.ts')
const createTestLogger = vi.mocked(api.createTestLogger)
const getSettings = vi.mocked(api.getSettings)
const putSettings = vi.mocked(api.putSettings)
const getGhosts = vi.mocked(api.getGhosts)
const getResults = vi.mocked(api.getResults)
const getProgress = vi.mocked(api.getProgress)
const putMark = vi.mocked(api.putMark)

let loggers: FakeLogger[] = []

beforeEach(() => {
  history.replaceState(null, '', '/drill/x')
  vi.stubGlobal('scrollTo', vi.fn())
  Element.prototype.scrollIntoView = vi.fn()
  stubContent(CONTENT)
  loggers = []
  createTestLogger.mockReset().mockImplementation(() => {
    const logger = fakeLogger()
    loggers.push(logger)
    return logger
  })
  getSettings.mockReset().mockResolvedValue({ boardVisibility: 'always', hints: 'miss', plateauSnoozedUntil: null, reportSeen: null, ghost: 'best' })
  putSettings.mockReset().mockImplementation(async (s) => ({ boardVisibility: 'always', hints: 'miss', plateauSnoozedUntil: null, reportSeen: null, ghost: 'best', ...s }))
  getGhosts.mockReset().mockResolvedValue({ best: null, last: null })
  // Chapter 4 is passed, so 5 is open and 6 is locked behind 5.
  getResults.mockReset().mockImplementation(async (mode) => (mode === 'stage0' ? [passed('pseudo-test')] : []))
  getProgress.mockReset().mockResolvedValue([])
  putMark.mockReset().mockResolvedValue({ chapter: 5, kind: 'override', at: 1 })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const two = (a: string, b: string): DrillItem[] => [
  { prompt: a, outlines: ['SAP'] },
  { prompt: b, outlines: ['SAP'] },
]

function runner(over: Partial<DrillRunnerProps> = {}) {
  return (
    <DrillRunner
      title="Chapter 5 test"
      backHref="/page/ch05"
      backLabel="Back to Chapter 5"
      chapter={5}
      items={() => two('cat', 'hat')}
      logTest={{ mode: 'chapter-test', chapter: 5, section: '5-test' }}
      passMark={{ accuracy: 0.9 }}
      requirement="Pass the chapter test: 90% accuracy and at least 30 wpm"
      {...over}
    />
  )
}

const GHOST_RUN = { testId: 7, endedAt: Date.now(), wpm: 50, completions: [1000, 2000, 3000, 4000, 5000] }
const ghostLine = (): string | null => document.querySelector('.ghost__text')?.textContent ?? null

describe('DrillRunner ghost', () => {
  it('asks for the ghost of the run\'s own mode and section, and has a Ghost picker', async () => {
    await mountRig(runner())
    await waitFor(() => expect(getGhosts).toHaveBeenCalledWith('chapter-test', '5-test'))
    expect(screen.getByRole('group', { name: 'Ghost' })).toBeTruthy()
    expect(ghostLine()).toBeNull() // nothing to race: nothing shown
  })

  it('races the ghost and says how the run compared on the result card, above the note', async () => {
    getGhosts.mockResolvedValue({ best: GHOST_RUN, last: null })
    const rig = await mountRig(runner())
    await waitFor(() => expect(ghostLine()).toMatch(/^Ghost \(best, today\) 0 · You 0$/))
    rig.stroke(SAP)
    rig.stroke(SAP)
    const card = await screen.findByRole('region', { name: 'Result' })
    const note = card.querySelector('.ghost__note')!
    expect(note.textContent).toBe('Best run (today) had 0 words by 0:00. You: 2 — 2 ahead.')
    const quick = within(card).getByRole('button', { name: 'Add a note' })
    expect(note.compareDocumentPosition(quick) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('has no note on the result card without a ghost', async () => {
    const rig = await mountRig(runner())
    rig.stroke(SAP)
    rig.stroke(SAP)
    const card = await screen.findByRole('region', { name: 'Result' })
    expect(card.querySelector('.ghost__note')).toBeNull()
  })

  it('keeps the raced ghost on the card, and Again races whatever is best by then', async () => {
    const newer = { ...GHOST_RUN, testId: 8, endedAt: Date.now() - 3 * 86_400_000 }
    getGhosts.mockResolvedValueOnce({ best: GHOST_RUN, last: null }).mockResolvedValueOnce({ best: newer, last: null })
    const rig = await mountRig(runner())
    await waitFor(() => expect(ghostLine()).toMatch(/^Ghost \(best, today\)/))
    rig.stroke(SAP)
    rig.stroke(SAP)
    const card = await screen.findByRole('region', { name: 'Result' })
    expect(getGhosts).toHaveBeenCalledTimes(1) // the card keeps the ghost the run raced
    expect(card.querySelector('.ghost__note')!.textContent).toMatch(/^Best run \(today\)/)
    fireEvent.click(screen.getByRole('button', { name: 'Again' }))
    expect(ghostLine()).toBeNull() // never the old attempt's ghost, not even for a frame
    await waitFor(() => expect(ghostLine()).toMatch(/^Ghost \(best, 3 days ago\)/))
    expect(getGhosts).toHaveBeenCalledTimes(2)
  })

  it.each(['off', 'last'] as const)('waits for the stored choice (%s) before asking or drawing a ghost', async (stored) => {
    let arrive!: (s: Awaited<ReturnType<typeof getSettings>>) => void
    getSettings.mockReturnValue(new Promise((resolve) => (arrive = resolve)))
    getGhosts.mockResolvedValue({ best: GHOST_RUN, last: { ...GHOST_RUN, testId: 9 } })
    await mountRig(runner())
    await act(async () => {})
    expect(getGhosts).not.toHaveBeenCalled()
    expect(ghostLine()).toBeNull()
    await act(async () =>
      arrive({ boardVisibility: 'always', hints: 'miss', plateauSnoozedUntil: null, reportSeen: null, ghost: stored }),
    )
    if (stored === 'off') {
      expect(getGhosts).not.toHaveBeenCalled()
      expect(ghostLine()).toBeNull()
    } else {
      await waitFor(() => expect(ghostLine()).toMatch(/^Ghost \(last, today\)/))
      expect(getGhosts).toHaveBeenCalledTimes(1)
    }
  })

  it('still races the default ghost when the settings cannot be read', async () => {
    // The board and hint pickers read the settings too (and do not mind a failure); only the ghost's read fails.
    const ok = await getSettings()
    getSettings.mockResolvedValueOnce(ok).mockResolvedValueOnce(ok).mockRejectedValue(new Error('down'))
    getGhosts.mockResolvedValue({ best: GHOST_RUN, last: null })
    await mountRig(runner())
    await waitFor(() => expect(ghostLine()).toMatch(/^Ghost \(best, today\)/))
  })

  it('shows no ghost with the picker on off, and saves the pick', async () => {
    getGhosts.mockResolvedValue({ best: GHOST_RUN, last: null })
    await mountRig(runner())
    await waitFor(() => expect(ghostLine()).not.toBeNull())
    fireEvent.click(within(screen.getByRole('group', { name: 'Ghost' })).getByRole('button', { name: 'off' }))
    expect(putSettings).toHaveBeenCalledWith({ ghost: 'off' })
    await waitFor(() => expect(ghostLine()).toBeNull())
  })

  it('does not hold the drill up for a ghost that never arrives, or one that fails', async () => {
    getGhosts.mockReturnValue(new Promise(() => {}))
    const rig = await mountRig(runner())
    rig.stroke(SAP)
    rig.stroke(SAP)
    expect(await screen.findByRole('region', { name: 'Result' })).toBeTruthy()
    cleanup()
    getGhosts.mockRejectedValue(new Error('down'))
    const again = await mountRig(runner())
    again.stroke(SAP)
    again.stroke(SAP)
    expect(await screen.findByRole('region', { name: 'Result' })).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('passes no ghost when the run has no section', async () => {
    getGhosts.mockResolvedValue({ best: GHOST_RUN, last: null })
    await mountRig(runner({ logTest: { mode: 'section', chapter: 5, section: null } }))
    expect(getGhosts).not.toHaveBeenCalled()
  })
})

describe('DrillRunner', () => {
  it('runs a word drill with the board and hint pickers', async () => {
    await mountRig(runner())
    expect(prompt()).toBe('cat')
    expect(document.querySelector('.drill__prompt--word')).not.toBeNull()
    expect(screen.getByRole('group', { name: 'Board visibility' })).toBeTruthy()
    expect(screen.getByRole('group', { name: 'Hint' })).toBeTruthy()
    // the outline stays hidden until a miss: the hint setting starts at `on miss`
    expect(document.querySelector('.drill__expected')!.textContent).toBe('')
  })

  it('honours a stored hint of always', async () => {
    getSettings.mockResolvedValue({ boardVisibility: 'hidden', hints: 'always', plateauSnoozedUntil: null, reportSeen: null, ghost: 'best' })
    await mountRig(runner())
    await waitFor(() => expect(document.querySelector('.drill__expected')!.textContent).toBe('SAP'))
    expect(document.querySelector('.drill__board')).toBeNull()
  })

  it('shows the verdict, the requirement and the stats on the result card, and reloads progress', async () => {
    const rig = await mountRig(runner())
    expect(getProgress).toHaveBeenCalledTimes(1)
    rig.stroke(SAP)
    rig.stroke(SAP)
    const card = await screen.findByRole('region', { name: 'Result' })
    expect(within(card).getByText('Passed')).toBeTruthy()
    expect(within(card).getByText('Pass the chapter test: 90% accuracy and at least 30 wpm')).toBeTruthy()
    for (const label of ['Accuracy', 'Speed', 'Words', 'Time']) expect(within(card).getByText(label)).toBeTruthy()
    expect(within(card).getByText('100%')).toBeTruthy()
    expect(within(card).getByText('2')).toBeTruthy()
    expect(within(card).getByRole('button', { name: 'Add a note' })).toBeTruthy()
    await waitFor(() => expect(getProgress).toHaveBeenCalledTimes(2))
    expect(loggers[0].finish).toHaveBeenCalledWith(expect.objectContaining({ meta: expect.objectContaining({ passed: true }) }))
  })

  it('keeps the bare dock hotkeys off on the result card, and the Alt forms on', async () => {
    const rig = await mountRig(
      <DockProvider>
        {runner()}
        <DockHost />
      </DockProvider>,
    )
    rig.stroke(SAP)
    rig.stroke(SAP)
    await screen.findByRole('region', { name: 'Result' })
    // Plover's output for the last stroke lands on the page body after the result card has replaced the drill.
    for (const [key, code] of [['k', 'KeyK'], ['n', 'KeyN'], ['b', 'KeyB'], ['/', 'Slash']]) {
      fireEvent.keyDown(document.body, { key, code })
      expect(screen.queryByRole('dialog'), key).toBeNull()
    }
    fireEvent.keyDown(document.body, { key: 'k', code: 'KeyK', altKey: true })
    expect(screen.getByRole('dialog', { name: 'Key chart' })).toBeTruthy()
  })

  it('says Not yet when the run misses the mark', async () => {
    const rig = await mountRig(runner())
    rig.stroke(TAP)
    rig.stroke(SAP)
    rig.stroke(SAP)
    const card = await screen.findByRole('region', { name: 'Result' })
    expect(within(card).getByText('Not yet')).toBeTruthy()
    expect(within(card).queryByText('Passed')).toBeNull()
  })

  it('shows one decimal beside Not yet when a score is just below the mark but would round up to it', async () => {
    const words = Array.from({ length: 29 }, (_, i) => ({ prompt: `w${i}`, outlines: ['SAP'] }))
    const rig = await mountRig(runner({ items: () => words, passMark: { accuracy: 0.9, minWpm: 10 } }))
    let now = 1_000_000_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    // 26 of 29 first try is 89.66%; 29 words in 181.25 seconds is 9.6 wpm.
    for (let i = 0; i < 29; i++) {
      if (i < 3) rig.stroke(TAP)
      if (i === 28) now += 181_250
      rig.stroke(SAP)
    }
    const card = await screen.findByRole('region', { name: 'Result' })
    expect(within(card).getByText('Not yet')).toBeTruthy()
    expect(within(card).getByText('89.6%')).toBeTruthy()
    expect(within(card).getByText('9.6 wpm')).toBeTruthy()
    expect(within(card).queryByText('90%')).toBeNull()
    expect(within(card).queryByText('10 wpm')).toBeNull()
  })

  it('rounds a score that has no pass mark beside it', async () => {
    const words = Array.from({ length: 29 }, (_, i) => ({ prompt: `w${i}`, outlines: ['SAP'] }))
    const rig = await mountRig(runner({ items: () => words, passMark: undefined, requirement: undefined }))
    for (let i = 0; i < 29; i++) {
      if (i < 3) rig.stroke(TAP)
      rig.stroke(SAP)
    }
    const card = await screen.findByRole('region', { name: 'Result' })
    expect(within(card).getByText('90%')).toBeTruthy()
  })

  it('shows no verdict and no requirement without a pass mark', async () => {
    const rig = await mountRig(runner({ passMark: undefined, requirement: undefined }))
    rig.stroke(SAP)
    rig.stroke(SAP)
    const card = await screen.findByRole('region', { name: 'Result' })
    expect(within(card).queryByText('Passed')).toBeNull()
    expect(within(card).queryByText('Not yet')).toBeNull()
    expect(loggers[0].finish).toHaveBeenCalledWith(expect.objectContaining({ meta: expect.objectContaining({ passed: null }) }))
  })

  it('Again makes a fresh logger and fresh items', async () => {
    const items = vi.fn<() => DrillItem[]>().mockReturnValueOnce(two('cat', 'hat')).mockReturnValueOnce(two('dog', 'log'))
    const rig = await mountRig(runner({ items }))
    expect(prompt()).toBe('cat')
    rig.stroke(SAP)
    rig.stroke(SAP)
    await screen.findByRole('region', { name: 'Result' })
    expect(loggers).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Again' }))
    expect(items).toHaveBeenCalledTimes(2)
    expect(loggers).toHaveLength(2)
    expect(prompt()).toBe('dog')
    expect(document.querySelector('.drill__stats')!.textContent).toMatch(/^0 \/ 2/)
    rig.stroke(SAP)
    await waitFor(() => expect(loggers[1].start).toHaveBeenCalled())
    expect(loggers[0].start).toHaveBeenCalledTimes(1)
  })

  it('leads back from the result card', async () => {
    const rig = await mountRig(runner())
    rig.stroke(SAP)
    rig.stroke(SAP)
    const card = await screen.findByRole('region', { name: 'Result' })
    const back = within(card).getByRole('link', { name: 'Back to Chapter 5' })
    expect(back.getAttribute('href')).toBe('/page/ch05')
    fireEvent.click(back)
    expect(location.pathname).toBe('/page/ch05')
  })

  it('offers the next chapter once this chapter shows as cleared after the run', async () => {
    const rig = await mountRig(runner())
    // The server now holds the passed test.
    getResults.mockImplementation(async (mode) =>
      mode === 'stage0' ? [passed('pseudo-test')] : mode === 'chapter-test' ? [passed('5-test')] : [],
    )
    rig.stroke(SAP)
    rig.stroke(SAP)
    const link = await screen.findByRole('link', { name: 'Next chapter' })
    expect(link.getAttribute('href')).toBe('/page/ch06')
  })

  it('offers no next chapter while this chapter is not cleared', async () => {
    const rig = await mountRig(runner())
    rig.stroke(SAP)
    rig.stroke(SAP)
    await screen.findByRole('region', { name: 'Result' })
    await waitFor(() => expect(getProgress).toHaveBeenCalledTimes(2))
    await act(async () => {})
    expect(screen.queryByRole('link', { name: 'Next chapter' })).toBeNull()
  })

  it('leaving early writes no verdict and does not reload progress', async () => {
    const rig = await mountRig(runner())
    rig.stroke(SAP)
    await waitFor(() => expect(loggers[0].start).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: 'Exit' }))
    expect(location.pathname).toBe('/page/ch05')
    rig.unmount()
    await act(async () => {})
    expect(loggers[0].finish).toHaveBeenCalledTimes(1)
    expect(loggers[0].finish.mock.calls[0][0].meta).toMatchObject({ passed: null, abandoned: true })
    expect(getProgress).toHaveBeenCalledTimes(1)
  })

  it('shows an intro line when given', async () => {
    await mountRig(runner({ intro: '45 words, 3 times each' }))
    expect(screen.getByText('45 words, 3 times each')).toBeTruthy()
  })

  describe('locked chapter', () => {
    const locked = () => runner({ chapter: 6, title: 'Chapter 6 · 6-fqm', backHref: '/page/ch06', backLabel: 'Back to Chapter 6' })

    it('shows the notice instead of the drill, and starts nothing', async () => {
      const rig = await mountRig(locked())
      const notice = screen.getByRole('region', { name: 'Locked' })
      expect(within(notice).getByText(/Pass the chapter test: 90% accuracy and at least 30 wpm/)).toBeTruthy()
      expect(within(notice).getByRole('link', { name: 'Go to Chapter 5' }).getAttribute('href')).toBe('/page/ch05')
      expect(prompt()).toBeNull()
      expect(document.querySelector('textarea')).toBeNull()
      rig.stroke(SAP)
      await act(async () => {})
      for (const logger of loggers) expect(logger.start).not.toHaveBeenCalled()
      expect(screen.queryByRole('region', { name: 'Result' })).toBeNull()
    })

    it('Open anyway writes an override for the blocking chapter and the drill appears', async () => {
      await mountRig(locked())
      getProgress.mockResolvedValue([{ chapter: 5, kind: 'override', at: 1 }])
      fireEvent.click(screen.getByRole('button', { name: 'Open anyway' }))
      fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Open anyway' }))
      expect(putMark).toHaveBeenCalledWith(5, 'override')
      await waitFor(() => expect(prompt()).toBe('cat'))
      expect(screen.queryByRole('region', { name: 'Locked' })).toBeNull()
    })

    it('disables Open anyway while saving', async () => {
      let resolve!: () => void
      putMark.mockImplementation(() => new Promise((r) => (resolve = () => r({ chapter: 5, kind: 'override', at: 1 }))))
      await mountRig(locked())
      const button = screen.getByRole('button', { name: 'Open anyway' }) as HTMLButtonElement
      fireEvent.click(button)
      const confirm = within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Open anyway' }) as HTMLButtonElement
      fireEvent.click(confirm)
      await waitFor(() => expect(button.disabled).toBe(true))
      expect(confirm.disabled).toBe(true)
      fireEvent.click(button)
      fireEvent.click(confirm)
      expect(putMark).toHaveBeenCalledTimes(1)
      getProgress.mockResolvedValue([{ chapter: 5, kind: 'override', at: 1 }])
      await act(async () => resolve())
      await waitFor(() => expect(prompt()).toBe('cat'))
    })

    it('keeps the notice with a short error when the override fails', async () => {
      putMark.mockRejectedValue(new Error('offline'))
      await mountRig(locked())
      fireEvent.click(screen.getByRole('button', { name: 'Open anyway' }))
      fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Open anyway' }))
      expect(await screen.findByRole('alert')).toBeTruthy()
      expect(screen.queryByRole('alertdialog')).toBeNull()
      expect(screen.getByRole('region', { name: 'Locked' })).toBeTruthy()
      expect((screen.getByRole('button', { name: 'Open anyway' }) as HTMLButtonElement).disabled).toBe(false)
      expect(prompt()).toBeNull()
    })

    it('runs the drill unlocked when progress failed to load', async () => {
      getResults.mockRejectedValue(new Error('offline'))
      await mountRig(locked())
      expect(screen.queryByRole('region', { name: 'Locked' })).toBeNull()
      expect(prompt()).toBe('cat')
    })
  })
})
