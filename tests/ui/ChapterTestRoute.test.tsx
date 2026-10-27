// @vitest-environment jsdom
import { cleanup, screen, waitFor, within } from '@testing-library/preact'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChapterTestRoute } from '../../src/ui/ChapterTestRoute.tsx'
import { CONTENT, SAP, drillStats, fakeLogger, mountRig, passed, stubContent } from './helpers/practice-rig.tsx'
import type { FakeLogger, Rig } from './helpers/practice-rig.tsx'

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

let loggers: FakeLogger[] = []

beforeEach(() => {
  history.replaceState(null, '', '/drill/test/5')
  vi.stubGlobal('scrollTo', vi.fn())
  Element.prototype.scrollIntoView = vi.fn()
  stubContent(CONTENT)
  loggers = []
  createTestLogger.mockReset().mockImplementation(() => {
    const logger = fakeLogger()
    loggers.push(logger)
    return logger
  })
  getSettings.mockReset().mockResolvedValue({ boardVisibility: 'always', hints: 'miss' })
  putSettings.mockReset().mockImplementation(async (s) => ({ boardVisibility: 'always', hints: 'miss', ...s }))
  getResults.mockReset().mockImplementation(async (mode) => (mode === 'stage0' ? [passed('pseudo-test')] : []))
  getProgress.mockReset().mockResolvedValue([])
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const TOTAL = 135

/** Strikes every prompt right: the first stroke at t=0, the last one `ms` later on the session clock. */
function runAll(rig: Rig, ms: number): void {
  for (let i = 0; i < TOTAL; i++) {
    if (i === TOTAL - 1) vi.setSystemTime(ms)
    rig.stroke(SAP)
  }
}

describe('ChapterTestRoute', () => {
  it('runs 45 distinct words, 3 times each in a row, and says so', async () => {
    const rig = await mountRig(<ChapterTestRoute chapter="5" />)
    expect(screen.getByRole('region', { name: 'Chapter 5 test' })).toBeTruthy()
    expect(screen.getByText('45 words, 3 times each')).toBeTruthy()
    expect(drillStats()).toMatch(/^0 \/ 135 /)
    for (let i = 0; i < TOTAL; i++) rig.stroke(SAP)
    await screen.findByRole('region', { name: 'Result' })
    const prompts = loggers[0].stroke.mock.calls.map((c) => (c[0] as { prompt: string }).prompt)
    expect(prompts).toHaveLength(TOTAL)
    expect(new Set(prompts).size).toBe(45)
    for (let i = 0; i < TOTAL; i += 3) {
      expect(prompts[i + 1]).toBe(prompts[i])
      expect(prompts[i + 2]).toBe(prompts[i])
    }
    expect(loggers[0].start).toHaveBeenCalledWith({ mode: 'chapter-test', chapter: 5, section: '5-test', itemCount: TOTAL })
  })

  it('records a fast perfect run as passed and shows the verdict with the requirement', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(0)
    const rig = await mountRig(<ChapterTestRoute chapter="5" />)
    runAll(rig, 60_000) // 135 wpm
    const card = await screen.findByRole('region', { name: 'Result' })
    expect(loggers[0].finish.mock.calls[0][0].meta).toMatchObject({ passed: true })
    expect(within(card).getByText('Passed')).toBeTruthy()
    expect(within(card).getByText('Pass the chapter test: 90% accuracy and at least 30 wpm')).toBeTruthy()
    await waitFor(() => expect(getProgress).toHaveBeenCalledTimes(2))
  })

  it('records a slow perfect run as not passed', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(0)
    const rig = await mountRig(<ChapterTestRoute chapter="5" />)
    runAll(rig, 10 * 60_000) // 13.5 wpm, under the 30 wpm mark
    const card = await screen.findByRole('region', { name: 'Result' })
    expect(loggers[0].finish.mock.calls[0][0].meta).toMatchObject({ passed: false })
    expect(within(card).getByText('Not yet')).toBeTruthy()
  })

  it('says a chapter without a test has none, with a link to its page', async () => {
    await mountRig(<ChapterTestRoute chapter="6" />)
    expect(screen.getByText(/Chapter 6 has no chapter test/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Back to Chapter 6' }).getAttribute('href')).toBe('/page/ch06')
    expect(createTestLogger).not.toHaveBeenCalled()
  })

  it('says so for an unknown chapter, with a link home', async () => {
    await mountRig(<ChapterTestRoute chapter="99" />)
    expect(screen.getByText(/No such chapter/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Back to the book' }).getAttribute('href')).toBe('/')
  })

  it('still runs and grades the test when only the progress call failed, because the chapter list loaded', async () => {
    getProgress.mockRejectedValue(new Error('offline'))
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(0)
    const rig = await mountRig(<ChapterTestRoute chapter="5" />)
    expect(screen.queryByText(/Couldn't load the chapter list/)).toBeNull()
    expect(screen.queryByRole('region', { name: 'Locked' })).toBeNull()
    expect(screen.getByRole('region', { name: 'Chapter 5 test' })).toBeTruthy()
    runAll(rig, 60_000)
    const card = await screen.findByRole('region', { name: 'Result' })
    expect(loggers[0].finish.mock.calls[0][0].meta).toMatchObject({ passed: true })
    expect(within(card).getByText('Passed')).toBeTruthy()
  })

  it('never locks the test while progress is in error, even for a chapter that would be locked', async () => {
    getResults.mockRejectedValue(new Error('offline')) // Chapter 4 unknown, so nothing can be locked
    await mountRig(<ChapterTestRoute chapter="5" />)
    expect(screen.queryByRole('region', { name: 'Locked' })).toBeNull()
    expect(document.querySelector('.drill__prompt')).not.toBeNull()
  })

  it('shows the locked notice while an earlier chapter blocks it', async () => {
    getResults.mockResolvedValue([]) // Chapter 4 not passed
    const rig = await mountRig(<ChapterTestRoute chapter="5" />)
    const notice = screen.getByRole('region', { name: 'Locked' })
    expect(within(notice).getByText(/Pass the Chapter 4 test: 90% accuracy within 10 minutes/)).toBeTruthy()
    expect(within(notice).getByRole('link', { name: 'Go to Chapter 4' }).getAttribute('href')).toBe('/page/ch04')
    rig.stroke(SAP)
    expect(document.querySelector('.drill__prompt')).toBeNull()
    for (const logger of loggers) expect(logger.start).not.toHaveBeenCalled()
  })
})
