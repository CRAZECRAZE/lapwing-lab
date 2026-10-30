// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HidDeviceLike, HidLike } from '../../src/hid/uni-link.ts'
import type { TestLogger } from '../../src/api.ts'
import { DockProvider } from '../../src/state/dock.tsx'
import { UniProvider } from '../../src/state/uni-context.tsx'
import { DockHost } from '../../src/ui/DockHost.tsx'
import { FreeRoute } from '../../src/ui/FreeRoute.tsx'

vi.mock('../../src/api.ts', () => ({
  createTestLogger: vi.fn(),
  getSettings: vi.fn(),
  putSettings: vi.fn(),
  getLastTest: vi.fn(),
  appendJournal: vi.fn(),
}))
const api = await import('../../src/api.ts')
const createTestLogger = vi.mocked(api.createTestLogger)
const getSettings = vi.mocked(api.getSettings)
const putSettings = vi.mocked(api.putSettings)

type ReportListener = (e: { reportId: number; data: DataView }) => void

class FakeDevice implements HidDeviceLike {
  opened = false
  listeners = new Set<ReportListener>()
  collections = [{ usagePage: 0xff50, usage: 0x4c56 }]
  async open(): Promise<void> {
    this.opened = true
  }
  async close(): Promise<void> {}
  addEventListener(_t: 'inputreport', cb: ReportListener): void {
    this.listeners.add(cb)
  }
  removeEventListener(_t: 'inputreport', cb: unknown): void {
    this.listeners.delete(cb as ReportListener)
  }
  report(bytes: number[]): void {
    const buffer = new Uint8Array(8)
    buffer.set(bytes)
    for (const cb of [...this.listeners]) cb({ reportId: 0x50, data: new DataView(buffer.buffer) })
  }
}

class FakeHid implements HidLike {
  known: HidDeviceLike[] = []
  requestDevice = vi.fn(async () => [])
  getDevices = vi.fn(async () => this.known)
  addEventListener(): void {}
  removeEventListener(): void {}
}

const SAP = [0x81, 0x02] // S1- A- -P

type FakeLogger = TestLogger & { start: ReturnType<typeof vi.fn>; stroke: ReturnType<typeof vi.fn>; finish: ReturnType<typeof vi.fn> }

function fakeLogger(): FakeLogger {
  return {
    unsaved: 0,
    start: vi.fn(async () => {}),
    stroke: vi.fn(),
    finish: vi.fn(async () => {}),
    onUnsaved: () => () => {},
  } as FakeLogger
}

const INDEX = [
  { id: '5-cvc', chapter: 5, items: 1 },
  { id: '6-fqm', chapter: 6, items: 1 },
]

/** Stubs fetch for `/content/...`: a reply per URL, an Error to reject, or 'fail' for HTTP 500. */
function stubContent(files: Record<string, unknown>) {
  const fn = vi.fn(async (url: string) => {
    const reply = files[url]
    if (reply instanceof Error) throw reply
    if (reply === undefined || reply === 'fail') return { ok: false, status: reply ? 500 : 404, json: async () => ({}) }
    return { ok: true, status: 200, json: async () => reply }
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

let loggers: FakeLogger[] = []

beforeEach(() => {
  history.replaceState(null, '', '/practice/free/pseudo/words-25')
  vi.stubGlobal('scrollTo', vi.fn())
  Element.prototype.scrollIntoView = vi.fn()
  loggers = []
  createTestLogger.mockReset().mockImplementation(() => {
    const logger = fakeLogger()
    loggers.push(logger)
    return logger
  })
  getSettings.mockReset().mockResolvedValue({ boardVisibility: 'always', hints: 'miss', plateauSnoozedUntil: null, reportSeen: null, ghost: 'best' })
  putSettings.mockReset().mockImplementation(async (s) => ({ boardVisibility: 'always', hints: 'miss', plateauSnoozedUntil: null, reportSeen: null, ghost: 'best', ...s }))
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

type Rig = { device: FakeDevice; stroke(bytes: number[]): void }

async function mount(source: string, mode: string, withDock = false): Promise<Rig> {
  const hid = new FakeHid()
  const device = new FakeDevice()
  hid.known = [device]
  render(
    <UniProvider hid={hid}>
      {withDock ? (
        <DockProvider>
          <FreeRoute source={source} mode={mode} />
          <DockHost />
        </DockProvider>
      ) : (
        <FreeRoute source={source} mode={mode} />
      )}
    </UniProvider>,
  )
  await waitFor(() => expect(screen.queryByText(/Board disconnected|Loading/)).toBeNull())
  return {
    device,
    stroke(bytes) {
      act(() => device.report(bytes))
      act(() => device.report([]))
    },
  }
}

describe('FreeRoute', () => {
  it('says so for an unknown mode, without fetching anything', async () => {
    const fetch = stubContent({})
    render(<FreeRoute source="pseudo" mode="words-501" />)
    expect(screen.getByText(/No such free-type mode/)).toBeTruthy()
    fireEvent.click(screen.getByRole('link', { name: 'Back to Practice' }))
    expect(location.pathname).toBe('/practice')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('says so for an unknown source, once the index has loaded', async () => {
    stubContent({ '/content/practice-index.json': INDEX })
    render(<FreeRoute source="ch-7" mode="words-25" />)
    expect(screen.getByText('Loading…')).toBeTruthy()
    expect(await screen.findByText(/No such word source/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Back to Practice' }).getAttribute('href')).toBe('/practice')
    expect(createTestLogger).not.toHaveBeenCalled()
  })

  it('says so for an empty pool', async () => {
    stubContent({ '/content/stage0.json': { test: [], extra: [] } })
    render(<FreeRoute source="pseudo" mode="words-25" />)
    expect(await screen.findByText(/no words to practise/i)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Back to Practice' })).toBeTruthy()
  })

  it('gives a calm message when a list will not load', async () => {
    stubContent({ '/content/practice-index.json': INDEX, '/content/practice/5-cvc.json': { id: '5-cvc', items: [] }, '/content/practice/6-fqm.json': 'fail' })
    render(<FreeRoute source="ch-6" mode="words-25" />)
    expect(await screen.findByText(/Couldn't load the word lists/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Back to Practice' })).toBeTruthy()
  })

  it('runs the chapter lists up to the chosen chapter as a word drill', async () => {
    const fetch = stubContent({
      '/content/practice-index.json': INDEX,
      '/content/practice/5-cvc.json': { id: '5-cvc', items: [{ prompt: 'sap', outlines: ['SAP'] }] },
      '/content/practice/6-fqm.json': { id: '6-fqm', items: [{ prompt: 'tap', outlines: ['TAP'] }] },
    })
    const rig = await mount('ch-6', 'words-25')
    expect(fetch.mock.calls.map((c) => c[0]).sort()).toEqual([
      '/content/practice-index.json',
      '/content/practice/5-cvc.json',
      '/content/practice/6-fqm.json',
    ])
    expect(document.querySelector('.drill__flow--word')).not.toBeNull()
    expect(screen.getByText(/0 \/ 25/)).toBeTruthy()
    rig.stroke(SAP)
    await waitFor(() => expect(loggers[0].start).toHaveBeenCalled())
    expect(loggers[0].start).toHaveBeenCalledWith({ mode: 'free', chapter: 6, section: 'ch-6/words-25', itemCount: 25 })
  })

  it('runs the pseudo-words as a timed stroke drill in the flowing line', async () => {
    stubContent({ '/content/stage0.json': { test: ['SAP'], extra: [] } })
    const rig = await mount('pseudo', 'time-30')
    expect(document.querySelector('.drill__flow--stroke')).not.toBeNull()
    expect(screen.getByRole('region', { name: 'Free type · Chapter 4 pseudo-words · 30 seconds' })).toBeTruthy()
    expect(screen.getByText(/0:30 left/)).toBeTruthy()
    expect(loggers).toHaveLength(1)
    expect(loggers[0].start).not.toHaveBeenCalled() // the route never starts the logger itself
    rig.stroke(SAP)
    await waitFor(() => expect(loggers[0].start).toHaveBeenCalled())
    expect(loggers[0].start).toHaveBeenCalledWith({ mode: 'free', chapter: 4, section: 'pseudo/time-30', itemCount: 400 })
  })

  it("ends a timed run when time is up and says so on the result card", async () => {
    stubContent({ '/content/stage0.json': { test: ['SAP'], extra: [] } })
    const rig = await mount('pseudo', 'time-30')
    rig.stroke(SAP)
    const now = Date.now()
    vi.spyOn(Date, 'now').mockReturnValue(now + 31_000)
    expect(await screen.findByText("Time's up.")).toBeTruthy()
    expect(loggers[0].finish).toHaveBeenCalledWith(expect.objectContaining({ meta: expect.objectContaining({ timedOut: true }) }))
  })

  it('writes nothing when the owner leaves before a stroke', async () => {
    stubContent({ '/content/stage0.json': { test: ['SAP'], extra: [] } })
    await mount('pseudo', 'words-25')
    fireEvent.click(screen.getByRole('button', { name: 'Exit' }))
    expect(location.pathname).toBe('/practice')
    cleanup()
    expect(loggers[0].start).not.toHaveBeenCalled()
    expect(loggers[0].finish).not.toHaveBeenCalled()
  })

  it('keeps the bare dock hotkeys off on the result card, and the Alt forms on', async () => {
    stubContent({ '/content/stage0.json': { test: ['SAP'], extra: [] } })
    const rig = await mount('pseudo', 'words-25', true)
    for (let i = 0; i < 25; i++) rig.stroke(SAP)
    await screen.findByRole('region', { name: 'Result' })
    // Plover's output for the last stroke lands on the page body after the result card has replaced the drill.
    for (const [key, code] of [['k', 'KeyK'], ['n', 'KeyN'], ['b', 'KeyB'], ['/', 'Slash']]) {
      fireEvent.keyDown(document.body, { key, code })
      expect(screen.queryByRole('dialog'), key).toBeNull()
    }
    fireEvent.keyDown(document.body, { key: 'k', code: 'KeyK', altKey: true })
    expect(screen.getByRole('dialog', { name: 'Key chart' })).toBeTruthy()
  })

  it('shows the result card, and Again starts a fresh run with a new logger', async () => {
    stubContent({ '/content/stage0.json': { test: ['SAP'], extra: [] } })
    const rig = await mount('pseudo', 'words-25')
    for (let i = 0; i < 25; i++) rig.stroke(SAP)
    const card = await screen.findByRole('region', { name: 'Result' })
    expect(card.textContent).toContain('100%')
    expect(card.textContent).toMatch(/\d+ wpm/)
    expect(card.textContent).toContain('25')
    expect(card.textContent).toMatch(/\d+:\d\d/)
    expect(screen.queryByText("Time's up.")).toBeNull()
    expect(within(card).getByRole('button', { name: 'Add a note' })).toBeTruthy()
    expect(loggers).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Again' }))
    expect(loggers).toHaveLength(2)
    expect(screen.getByText(/0 \/ 25/)).toBeTruthy()
    rig.stroke(SAP)
    await waitFor(() => expect(loggers[1].start).toHaveBeenCalled())
    expect(loggers[0].start).toHaveBeenCalledTimes(1)
  })

  it('leaves for Practice from the result card', async () => {
    stubContent({ '/content/stage0.json': { test: ['SAP'], extra: [] } })
    const rig = await mount('pseudo', 'words-25')
    for (let i = 0; i < 25; i++) rig.stroke(SAP)
    fireEvent.click(await screen.findByRole('button', { name: 'Back to Practice' }))
    expect(location.pathname).toBe('/practice')
  })

  it('honours the stored board visibility and saves a new choice', async () => {
    getSettings.mockResolvedValue({ boardVisibility: 'hidden', hints: 'miss', plateauSnoozedUntil: null, reportSeen: null, ghost: 'best' })
    stubContent({ '/content/stage0.json': { test: ['SAP'], extra: [] } })
    await mount('pseudo', 'words-25')
    await waitFor(() => expect(document.querySelector('.drill__board')).toBeNull())
    fireEvent.click(screen.getByRole('button', { name: 'always' }))
    expect(document.querySelector('.drill__board')).not.toBeNull()
    expect(putSettings).toHaveBeenCalledWith({ boardVisibility: 'always' })
  })

  describe('custom amounts', () => {
    it('runs a custom number of words with that many items', async () => {
      stubContent({ '/content/stage0.json': { test: ['SAP'], extra: [] } })
      const rig = await mount('pseudo', 'words-7')
      expect(screen.getByRole('region', { name: 'Free type · Chapter 4 pseudo-words · 7 words' })).toBeTruthy()
      expect(screen.getByText(/0 \/ 7\b/)).toBeTruthy()
      expect(screen.queryByText(/left/)).toBeNull()
      rig.stroke(SAP)
      await waitFor(() => expect(loggers[0].start).toHaveBeenCalled())
      expect(loggers[0].start).toHaveBeenCalledWith({ mode: 'free', chapter: 4, section: 'pseudo/words-7', itemCount: 7 })
      for (let i = 0; i < 6; i++) rig.stroke(SAP)
      expect(await screen.findByRole('region', { name: 'Result' })).toBeTruthy()
    })

    it('runs a custom number of seconds with that time limit and the matching item count', async () => {
      stubContent({ '/content/stage0.json': { test: ['SAP'], extra: [] } })
      const rig = await mount('pseudo', 'time-90')
      expect(screen.getByRole('region', { name: 'Free type · Chapter 4 pseudo-words · 90 seconds' })).toBeTruthy()
      expect(screen.getByText(/1:30 left/)).toBeTruthy()
      rig.stroke(SAP)
      await waitFor(() => expect(loggers[0].start).toHaveBeenCalled())
      expect(loggers[0].start).toHaveBeenCalledWith({ mode: 'free', chapter: 4, section: 'pseudo/time-90', itemCount: 450 })
    })

    it('prepares five items a second for the longest timed run', async () => {
      stubContent({ '/content/stage0.json': { test: ['SAP'], extra: [] } })
      const rig = await mount('pseudo', 'time-600')
      expect(screen.getByText(/10:00 left/)).toBeTruthy()
      rig.stroke(SAP)
      await waitFor(() => expect(loggers[0].start).toHaveBeenCalled())
      expect(loggers[0].start).toHaveBeenCalledWith(expect.objectContaining({ section: 'pseudo/time-600', itemCount: 3000 }))
    })

    it.each(['words-501', 'words-0', 'time-4', 'time-601', 'words-025'])('says so for the out-of-range id %s', (id) => {
      const fetch = stubContent({})
      render(<FreeRoute source="pseudo" mode={id} />)
      expect(screen.getByText(/No such free-type mode/)).toBeTruthy()
      expect(fetch).not.toHaveBeenCalled()
    })
  })

  describe('hint setting', () => {
    const CHAPTER = {
      '/content/practice-index.json': INDEX,
      '/content/practice/5-cvc.json': { id: '5-cvc', items: [{ prompt: 'sap', outlines: ['SAP'] }] },
      '/content/practice/6-fqm.json': { id: '6-fqm', items: [{ prompt: 'sap', outlines: ['SAP'] }] },
    }
    const picker = (): HTMLElement => screen.getByRole('group', { name: 'Hint' })
    const expected = (): string => document.querySelector('.drill__expected')!.textContent!

    it('is shown, as on miss by default, for a chapter source', async () => {
      stubContent(CHAPTER)
      await mount('ch-6', 'words-25')
      expect(within(picker()).getByRole('button', { name: 'on miss' }).getAttribute('aria-pressed')).toBe('true')
      expect(within(picker()).getByRole('button', { name: 'always' }).getAttribute('aria-pressed')).toBe('false')
      expect(document.querySelector('.key--target')).toBeNull()
      expect(expected()).toBe('')
    })

    it('is hidden for the pseudo-word source', async () => {
      stubContent({ '/content/stage0.json': { test: ['SAP'], extra: [] } })
      await mount('pseudo', 'words-25')
      expect(screen.queryByRole('group', { name: 'Hint' })).toBeNull()
      expect(screen.getByRole('group', { name: 'Board visibility' })).toBeTruthy()
    })

    it('choosing always saves it and lights the needed keys and the notation at once', async () => {
      stubContent(CHAPTER)
      await mount('ch-6', 'words-25')
      fireEvent.click(within(picker()).getByRole('button', { name: 'always' }))
      expect(putSettings).toHaveBeenCalledWith({ hints: 'always' })
      expect(within(picker()).getByRole('button', { name: 'always' }).getAttribute('aria-pressed')).toBe('true')
      expect(expected()).toBe('SAP')
      expect(document.querySelectorAll('.key--target')).toHaveLength(4)
      fireEvent.click(within(picker()).getByRole('button', { name: 'on miss' }))
      expect(putSettings).toHaveBeenLastCalledWith({ hints: 'miss' })
      expect(expected()).toBe('')
      expect(document.querySelector('.key--target')).toBeNull()
    })

    it('applies a stored always without a click', async () => {
      getSettings.mockResolvedValue({ boardVisibility: 'always', hints: 'always', plateauSnoozedUntil: null, reportSeen: null, ghost: 'best' })
      stubContent(CHAPTER)
      await mount('ch-6', 'words-25')
      await waitFor(() => expect(expected()).toBe('SAP'))
      expect(within(picker()).getByRole('button', { name: 'always' }).getAttribute('aria-pressed')).toBe('true')
      expect(document.querySelectorAll('.key--target')).toHaveLength(4)
      expect(putSettings).not.toHaveBeenCalled()
    })

    it('keeps the hint when the board is hidden: only the notation shows', async () => {
      getSettings.mockResolvedValue({ boardVisibility: 'hidden', hints: 'always', plateauSnoozedUntil: null, reportSeen: null, ghost: 'best' })
      stubContent(CHAPTER)
      await mount('ch-6', 'words-25')
      await waitFor(() => expect(expected()).toBe('SAP'))
      expect(document.querySelector('.key')).toBeNull()
    })
  })
})
