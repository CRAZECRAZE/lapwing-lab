// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProgressProvider } from '../../src/state/progress.tsx'
import { ListDrillRoute } from '../../src/ui/ListDrillRoute.tsx'
import { CONTENT, SAP, TAP, fakeLogger, mountRig, passed, prompt, stubContent } from './helpers/practice-rig.tsx'
import type { FakeLogger } from './helpers/practice-rig.tsx'

vi.mock('../../src/api.ts', () => ({
  createTestLogger: vi.fn(),
  getSettings: vi.fn(),
  putSettings: vi.fn(),
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
const getResults = vi.mocked(api.getResults)
const getProgress = vi.mocked(api.getProgress)
const putMark = vi.mocked(api.putMark)

let loggers: FakeLogger[] = []

beforeEach(() => {
  history.replaceState(null, '', '/drill/list/x')
  vi.stubGlobal('scrollTo', vi.fn())
  Element.prototype.scrollIntoView = vi.fn()
  loggers = []
  createTestLogger.mockReset().mockImplementation(() => {
    const logger = fakeLogger()
    loggers.push(logger)
    return logger
  })
  getSettings.mockReset().mockResolvedValue({ boardVisibility: 'always', hints: 'miss' })
  putSettings.mockReset().mockImplementation(async (s) => ({ boardVisibility: 'always', hints: 'miss', ...s }))
  // Chapter 4 passed and Chapter 5 overridden: 5 and 6 are open.
  getResults.mockReset().mockImplementation(async (mode) => (mode === 'stage0' ? [passed('pseudo-test')] : []))
  getProgress.mockReset().mockResolvedValue([{ chapter: 5, kind: 'override', at: 1 }])
  putMark.mockReset().mockResolvedValue({ chapter: 5, kind: 'override', at: 1 })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('ListDrillRoute', () => {
  it('runs every item of the list and logs it as a section drill of its chapter', async () => {
    const fetch = stubContent(CONTENT)
    const rig = await mountRig(<ListDrillRoute listId="5-cvc" />)
    expect(fetch.mock.calls.map((c) => c[0])).toContain('/content/practice/5-cvc.json')
    expect(screen.getByRole('region', { name: 'Chapter 5 · 5-cvc' })).toBeTruthy()
    expect(prompt()).toBe('sap')
    expect(document.querySelector('.drill__stats')!.textContent).toMatch(/^0 \/ 2/)
    rig.stroke(SAP)
    await waitFor(() => expect(loggers[0].start).toHaveBeenCalled())
    expect(loggers[0].start).toHaveBeenCalledWith({ mode: 'section', chapter: 5, section: '5-cvc', itemCount: 2 })
  })

  it('has no pass mark for a list of a chapter with a test gate', async () => {
    stubContent(CONTENT)
    const rig = await mountRig(<ListDrillRoute listId="5-cvc" />)
    rig.stroke(SAP)
    rig.stroke(SAP)
    const card = await screen.findByRole('region', { name: 'Result' })
    expect(loggers[0].finish.mock.calls[0][0].meta).toMatchObject({ passed: null })
    expect(within(card).queryByText('Passed')).toBeNull()
    expect(within(card).queryByText('Not yet')).toBeNull()
  })

  it('passes a clean run of a drills-gate list at 90%', async () => {
    stubContent(CONTENT)
    const rig = await mountRig(<ListDrillRoute listId="6-fqm" />)
    rig.stroke(SAP)
    rig.stroke(SAP)
    const card = await screen.findByRole('region', { name: 'Result' })
    expect(loggers[0].finish.mock.calls[0][0].meta).toMatchObject({ passed: true })
    expect(within(card).getByText('Passed')).toBeTruthy()
    expect(within(card).getByText('Do each section drill once at 90% accuracy or better')).toBeTruthy()
  })

  it('fails a drills-gate list below 90%', async () => {
    stubContent(CONTENT)
    const rig = await mountRig(<ListDrillRoute listId="6-fqm" />)
    rig.stroke(TAP)
    rig.stroke(SAP)
    rig.stroke(SAP)
    const card = await screen.findByRole('region', { name: 'Result' })
    expect(loggers[0].finish.mock.calls[0][0].meta).toMatchObject({ passed: false })
    expect(within(card).getByText('Not yet')).toBeTruthy()
  })

  it('leads back to the chapter page from Exit', async () => {
    stubContent(CONTENT)
    await mountRig(<ListDrillRoute listId="6-fqm" />)
    fireEvent.click(screen.getByRole('button', { name: 'Exit' }))
    expect(location.pathname).toBe('/page/ch06')
  })

  it('shows the locked notice for a list of a locked chapter', async () => {
    getProgress.mockResolvedValue([])
    stubContent(CONTENT)
    const rig = await mountRig(<ListDrillRoute listId="6-fqm" />)
    expect(screen.getByRole('region', { name: 'Locked' })).toBeTruthy()
    expect(prompt()).toBeNull()
    rig.stroke(SAP)
    for (const logger of loggers) expect(logger.start).not.toHaveBeenCalled()
    getProgress.mockResolvedValue([{ chapter: 5, kind: 'override', at: 1 }])
    fireEvent.click(screen.getByRole('button', { name: 'Open anyway' }))
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Open anyway' }))
    expect(putMark).toHaveBeenCalledWith(5, 'override')
    await waitFor(() => expect(prompt()).toBe('sap'))
  })

  describe('Open anyway on a chapter two ahead', () => {
    // Chapter 4 not passed and nothing marked: 6 is locked by 4, and 5 would block it next.
    let stored: { chapter: number; kind: 'read' | 'override'; at: number }[] = []
    beforeEach(() => {
      stored = []
      getResults.mockReset().mockResolvedValue([])
      getProgress.mockReset().mockImplementation(async () => stored)
      putMark.mockReset().mockImplementation(async (chapter, kind) => {
        const written = { chapter, kind, at: 1 }
        stored = [...stored, written]
        return written
      })
    })

    const dialog = (): HTMLElement => screen.getByRole('alertdialog')
    const confirm = (): HTMLElement => within(dialog()).getByRole('button', { name: 'Open anyway' })

    it('asks first, naming every blocking chapter, and writes nothing until Confirm', async () => {
      stubContent(CONTENT)
      await mountRig(<ListDrillRoute listId="6-fqm" />)
      expect(screen.getByRole('heading', { name: 'Chapter 6 opens after Chapter 4' })).toBeTruthy()
      fireEvent.click(screen.getByRole('button', { name: 'Open anyway' }))
      expect(screen.getByRole('alertdialog', { name: 'Open Chapter 6 anyway?' })).toBe(dialog())
      expect(dialog().textContent).toContain('Chapters 4 and 5 will be marked as moved on anyway so Chapter 6 opens.')
      expect(putMark).not.toHaveBeenCalled()
      fireEvent.click(within(dialog()).getByRole('button', { name: 'Cancel' }))
      expect(screen.queryByRole('alertdialog')).toBeNull()
      fireEvent.click(screen.getByRole('button', { name: 'Open anyway' }))
      fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
      expect(screen.queryByRole('alertdialog')).toBeNull()
      await act(async () => {})
      expect(putMark).not.toHaveBeenCalled()
      expect(screen.getByRole('region', { name: 'Locked' })).toBeTruthy()
      expect(prompt()).toBeNull()
    })

    it('on Confirm moves on from every blocking chapter in order, and the drill appears without a reload of the page', async () => {
      stubContent(CONTENT)
      await mountRig(<ListDrillRoute listId="6-fqm" />)
      fireEvent.click(screen.getByRole('button', { name: 'Open anyway' }))
      fireEvent.click(confirm())
      await waitFor(() => expect(prompt()).toBe('sap'))
      expect(putMark.mock.calls).toEqual([
        [4, 'override'],
        [5, 'override'],
      ])
      expect(screen.queryByRole('region', { name: 'Locked' })).toBeNull()
      expect(screen.queryByRole('alertdialog')).toBeNull()
    })

    it('keeps the notice with its error and a working button when a write fails', async () => {
      putMark.mockReset().mockRejectedValue(new Error('offline'))
      stubContent(CONTENT)
      await mountRig(<ListDrillRoute listId="6-fqm" />)
      fireEvent.click(screen.getByRole('button', { name: 'Open anyway' }))
      fireEvent.click(confirm())
      expect(await screen.findByRole('alert')).toBeTruthy()
      expect(screen.queryByRole('alertdialog')).toBeNull()
      expect(screen.getByRole('region', { name: 'Locked' })).toBeTruthy()
      expect((screen.getByRole('button', { name: 'Open anyway' }) as HTMLButtonElement).disabled).toBe(false)
      expect(prompt()).toBeNull()
    })
  })

  it('says so for a list id that is not in the index, with a link home', async () => {
    stubContent(CONTENT)
    await mountRig(<ListDrillRoute listId="9-nope" />)
    expect(screen.getByText(/No such word list/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Back to the book' }).getAttribute('href')).toBe('/')
    expect(createTestLogger).not.toHaveBeenCalled()
  })

  it('shows Loading while progress loads', async () => {
    stubContent(CONTENT)
    let release!: () => void
    getProgress.mockImplementation(() => new Promise((r) => (release = () => r([]))))
    render(
      <ProgressProvider>
        <ListDrillRoute listId="5-cvc" />
      </ProgressProvider>,
    )
    expect(screen.getByText('Loading…')).toBeTruthy()
    await waitFor(() => expect(release).toBeTypeOf('function'))
    release()
    await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull())
  })

  describe('when progress failed to load', () => {
    beforeEach(() => {
      getResults.mockRejectedValue(new Error('offline'))
    })

    it('still runs the list, unlocked', async () => {
      stubContent(CONTENT)
      const rig = await mountRig(<ListDrillRoute listId="6-fqm" />)
      expect(screen.queryByRole('region', { name: 'Locked' })).toBeNull()
      expect(prompt()).toBe('sap')
      rig.stroke(SAP)
      await waitFor(() => expect(loggers[0].start).toHaveBeenCalled())
      expect(loggers[0].start).toHaveBeenCalledWith({ mode: 'section', chapter: 6, section: '6-fqm', itemCount: 2 })
    })

    it('still grades a drills-gate list, because the chapter list loaded', async () => {
      stubContent(CONTENT)
      const rig = await mountRig(<ListDrillRoute listId="6-fqm" />)
      rig.stroke(SAP)
      rig.stroke(SAP)
      const card = await screen.findByRole('region', { name: 'Result' })
      expect(loggers[0].finish.mock.calls[0][0].meta).toMatchObject({ passed: true })
      expect(within(card).getByText('Passed')).toBeTruthy()
    })

    it('grades a drills-gate list as not passed below 90%', async () => {
      stubContent(CONTENT)
      const rig = await mountRig(<ListDrillRoute listId="6-fqm" />)
      rig.stroke(TAP)
      rig.stroke(SAP)
      rig.stroke(SAP)
      await screen.findByRole('region', { name: 'Result' })
      expect(loggers[0].finish.mock.calls[0][0].meta).toMatchObject({ passed: false })
    })

    it('treats a missing list file as unknown', async () => {
      stubContent(CONTENT)
      await mountRig(<ListDrillRoute listId="9-nope" />)
      expect(screen.getByText(/No such word list/)).toBeTruthy()
    })

    it('gives a calm message when the list will not load', async () => {
      stubContent({ ...CONTENT, '/content/practice/6-fqm.json': 'fail' })
      await mountRig(<ListDrillRoute listId="6-fqm" />)
      expect(screen.getByText(/Couldn't load the word list/)).toBeTruthy()
    })
  })
})
