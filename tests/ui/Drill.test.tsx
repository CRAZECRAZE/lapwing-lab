// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TestLogger } from '../../src/api.ts'
import type { DrillItem } from '../../src/core/drill.ts'
import type { HidDeviceLike, HidLike } from '../../src/hid/uni-link.ts'
import { UniProvider } from '../../src/state/uni-context.tsx'
import { Drill } from '../../src/ui/Drill.tsx'
import type { DrillResult } from '../../src/ui/Drill.tsx'

type ReportListener = (e: { reportId: number; data: DataView }) => void
type HidListener = (e: { device: HidDeviceLike }) => void

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
  requestResult: HidDeviceLike[] = []
  requestDevice = vi.fn(async () => this.requestResult)
  getDevices = vi.fn(async () => this.known)
  listeners: Record<'connect' | 'disconnect', Set<HidListener>> = { connect: new Set(), disconnect: new Set() }
  addEventListener(t: 'connect' | 'disconnect', cb: HidListener): void {
    this.listeners[t].add(cb)
  }
  removeEventListener(t: 'connect' | 'disconnect', cb: unknown): void {
    this.listeners[t].delete(cb as HidListener)
  }
}

// Report bytes, most significant bit first: S1- T- K- P- W- H- R- A- | O- *1 -E -U -F -R -P -B | -L -G -T -S -D -Z #1 S2-
const SAP = [0x81, 0x02] // S1- A- -P
const TAP = [0x41, 0x02] // T- A- -P
const KAT = [0x21, 0x00, 0x20] // K- A- -T
const LONE_STAR = [0x00, 0x40] // *1

type LoggerFake = TestLogger & {
  starts: Parameters<TestLogger['start']>[0][]
  strokes: Parameters<TestLogger['stroke']>[0][]
  finishes: Parameters<TestLogger['finish']>[0][]
  setUnsaved(n: number): void
}

function fakeLogger(opts: { startPending?: boolean; finishHangs?: boolean } = {}): LoggerFake {
  let unsaved = 0
  const listeners = new Set<(n: number) => void>()
  const log: LoggerFake = {
    starts: [],
    strokes: [],
    finishes: [],
    get unsaved() {
      return unsaved
    },
    start(t) {
      log.starts.push(t)
      return opts.startPending ? new Promise<void>(() => {}) : Promise.resolve()
    },
    stroke(s) {
      log.strokes.push(s)
    },
    finish(r) {
      log.finishes.push(r)
      return opts.finishHangs ? new Promise<void>(() => {}) : Promise.resolve()
    },
    onUnsaved(cb) {
      listeners.add(cb)
      return () => {
        listeners.delete(cb)
      }
    },
    setUnsaved(n) {
      unsaved = n
      for (const cb of [...listeners]) cb(n)
    },
  }
  return log
}

const item = (prompt: string, ...outlines: string[]): DrillItem => ({ prompt, outlines })
const LOG_TEST = { mode: 'stage0', chapter: 4, section: 'rows' }

type Rig = {
  hid: FakeHid
  device: FakeDevice
  logger: LoggerFake
  onDone: ReturnType<typeof vi.fn<(r: DrillResult) => void>>
  onExit: ReturnType<typeof vi.fn<() => void>>
  /** Presses and releases the given report bytes. */
  stroke(bytes: number[]): void
  unmount(): void
}

type DrillProps = Parameters<typeof Drill>[0]

async function mountDrill(
  props: Partial<DrillProps> = {},
  opts: { connected?: boolean; logger?: LoggerFake } = {},
): Promise<Rig> {
  const hid = new FakeHid()
  const device = new FakeDevice()
  if (opts.connected !== false) hid.known = [device]
  const logger = opts.logger ?? fakeLogger()
  const onDone = vi.fn<(r: DrillResult) => void>()
  const onExit = vi.fn<() => void>()
  const { unmount } = render(
    <UniProvider hid={hid}>
      <Drill
        title="Chapter 4 test"
        kind="stroke"
        items={[item('SAP', 'SAP')]}
        logger={logger}
        logTest={LOG_TEST}
        onDone={onDone}
        onExit={onExit}
        {...props}
      />
    </UniProvider>,
  )
  if (opts.connected !== false) await waitFor(() => expect(screen.queryByText(/Board disconnected/)).toBeNull())
  return {
    hid,
    device,
    logger,
    onDone,
    onExit,
    stroke(bytes) {
      act(() => device.report(bytes))
      act(() => device.report([]))
    },
    unmount,
  }
}

const lever = (name: string): Element => document.querySelector(`[data-lever="${name}"]`)!
const sink = (): HTMLTextAreaElement => document.querySelector('textarea')!

beforeEach(() => {
  vi.stubGlobal('scrollTo', vi.fn())
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('Drill prompt and progress', () => {
  it('shows the prompt big, in monospace for strokes, and the quiet title', async () => {
    await mountDrill({ items: [item('SAP', 'SAP')] })
    const prompt = document.querySelector('.drill__prompt')!
    expect(prompt.textContent).toBe('SAP')
    expect(prompt.classList.contains('drill__prompt--stroke')).toBe(true)
    expect(screen.getByText('Chapter 4 test')).toBeTruthy()
  })

  it('shows a word prompt in the word style', async () => {
    await mountDrill({ kind: 'word', items: [item('sap', 'SAP')] })
    const prompt = document.querySelector('.drill__prompt')!
    expect(prompt.textContent).toBe('sap')
    expect(prompt.classList.contains('drill__prompt--word')).toBe(true)
  })

  it('advances the counter and logs a correct stroke when SAP is struck', async () => {
    const rig = await mountDrill({ items: [item('SAP', 'SAP'), item('KAT', 'KAT')] })
    expect(screen.getByText(/0 \/ 2 · acc 0% · 0 wpm/)).toBeTruthy()
    rig.stroke(SAP)
    expect(screen.getByText(/1 \/ 2 · acc 100% · /)).toBeTruthy()
    expect(document.querySelector('.drill__prompt')!.textContent).toBe('KAT')
    expect(rig.logger.strokes).toHaveLength(1)
    expect(rig.logger.strokes[0]).toMatchObject({
      prompt: 'SAP',
      expected: ['SAP'],
      pressedLevers: ['S1-', 'A-', '-P'],
      correct: true,
      attemptNo: 1,
    })
    expect(rig.logger.strokes[0].pressedMask).toBeGreaterThan(0)
    expect(rig.logger.strokes[0].latencyMs).toBeGreaterThanOrEqual(0)
    expect(rig.logger.strokes[0].tsMs).toBeGreaterThan(1e12)
  })

  it('draws the live pressed keys on the board', async () => {
    const rig = await mountDrill()
    act(() => rig.device.report([0x80]))
    expect(lever('S1-').classList.contains('key--down')).toBe(true)
    act(() => rig.device.report([]))
    expect(lever('S1-').classList.contains('key--down')).toBe(false)
  })
})

describe('Drill misses', () => {
  it('shows the expected notation and the diff, logs the miss with attempt numbers', async () => {
    const rig = await mountDrill({ items: [item('SAP', 'SAP'), item('KAT', 'KAT')] })
    rig.stroke(TAP)
    expect(document.querySelector('.drill__expected')!.textContent).toBe('SAP')
    expect(lever('S1-').classList.contains('key--missing')).toBe(true)
    expect(lever('S2-').classList.contains('key--missing')).toBe(true)
    expect(lever('T-').classList.contains('key--extra')).toBe(true)
    expect(rig.logger.strokes).toHaveLength(1)
    expect(rig.logger.strokes[0]).toMatchObject({ correct: false, attemptNo: 1, prompt: 'SAP' })
    expect(rig.logger.strokes[0].pressedLevers).toContain('T-')
    expect(screen.getByText(/0 \/ 2/)).toBeTruthy()

    rig.stroke(TAP) // second miss
    expect(rig.logger.strokes[1]).toMatchObject({ correct: false, attemptNo: 2 })

    rig.stroke(SAP) // correct on the third attempt clears the overlay
    expect(rig.logger.strokes[2]).toMatchObject({ correct: true, attemptNo: 3 })
    expect(document.querySelector('.drill__expected')!.textContent).toBe('')
    expect(document.querySelector('.key--missing, .key--extra')).toBeNull()

    rig.stroke(KAT) // next item starts again at attempt 1
    expect(rig.logger.strokes[3]).toMatchObject({ prompt: 'KAT', attemptNo: 1 })
  })

  it('keeps the miss overlay across a lone star and clears it on the next judged stroke', async () => {
    const rig = await mountDrill({ items: [item('SAP', 'SAP')] })
    rig.stroke(TAP)
    rig.stroke(LONE_STAR)
    expect(rig.logger.strokes).toHaveLength(1) // ignored strokes are not logged
    expect(document.querySelector('.drill__expected')!.textContent).toBe('SAP')
  })

  it('does not log an ignored stroke', async () => {
    const rig = await mountDrill({ items: [item('KOPL/PHREU', 'KOPL/PHREU')] })
    rig.stroke(LONE_STAR) // nothing entered yet: ignored
    expect(rig.logger.strokes).toHaveLength(0)
  })

  it('hides the word target until a miss, then shows it with the hint', async () => {
    const rig = await mountDrill({ kind: 'word', items: [item('sap', 'SAP')] })
    expect(document.querySelectorAll('.key').length).toBeGreaterThan(0)
    expect(document.querySelector('.key--target')).toBeNull()
    expect(document.querySelector('.drill__expected')!.textContent).toBe('')
    rig.stroke(TAP)
    expect(document.querySelector('.drill__expected')!.textContent).toBe('SAP')
    expect(lever('A-').classList.contains('key--target')).toBe(true)
    expect(lever('-P').classList.contains('key--target')).toBe(true)
    rig.stroke(SAP)
    expect(document.querySelector('.key--target')).toBeNull()
  })

  it('lights the target for stroke drills and follows the stroke of a multi-stroke item', async () => {
    const rig = await mountDrill({ items: [item('KOPL/PHREU', 'KOPL/PHREU')] })
    expect(lever('K-').classList.contains('key--target')).toBe(true)
    expect(lever('O-').classList.contains('key--target')).toBe(true)
    expect(lever('R-').classList.contains('key--target')).toBe(false)
    rig.stroke([0x20, 0x82, 0x80]) // KOPL
    expect(lever('K-').classList.contains('key--target')).toBe(false)
    expect(lever('P-').classList.contains('key--target')).toBe(true) // PHREU is next
    expect(lever('-U').classList.contains('key--target')).toBe(true)
  })
})

describe('Drill board visibility', () => {
  it('hidden: no keys in the DOM at all', async () => {
    await mountDrill({ boardVisibility: 'hidden' })
    expect(document.querySelector('.key')).toBeNull()
  })

  it('hover: a placeholder until the pointer is over the board area, then the keys', async () => {
    await mountDrill({ boardVisibility: 'hover' })
    expect(document.querySelector('.key')).toBeNull()
    const area = document.querySelector('.drill__board')!
    expect(area.querySelector('.drill__board-placeholder')).toBeTruthy()
    fireEvent.pointerEnter(area)
    expect(document.querySelectorAll('.key').length).toBeGreaterThan(0)
    expect(area.querySelector('.drill__board-placeholder')).toBeNull()
    fireEvent.pointerLeave(area)
    expect(document.querySelector('.key')).toBeNull()
  })

  it('always is the default and lights the target', async () => {
    await mountDrill()
    expect(document.querySelectorAll('.key').length).toBe(28)
    expect(lever('-P').classList.contains('key--target')).toBe(true)
  })
})

describe('Drill stray-output sink', () => {
  it('is focused on mount and keeps typed text out of document-level shortcuts', async () => {
    await mountDrill()
    expect(document.activeElement).toBe(sink())
    const onDocument = vi.fn()
    document.addEventListener('keydown', onDocument)
    document.addEventListener('keypress', onDocument)
    document.addEventListener('keyup', onDocument)
    document.addEventListener('input', onDocument)
    try {
      for (const key of ['a', 'b', 'c']) {
        fireEvent.keyDown(sink(), { key })
        fireEvent.keyPress(sink(), { key, charCode: key.charCodeAt(0) })
        sink().value += key
        fireEvent.input(sink())
        fireEvent.keyUp(sink(), { key })
      }
    } finally {
      document.removeEventListener('keydown', onDocument)
      document.removeEventListener('keypress', onDocument)
      document.removeEventListener('keyup', onDocument)
      document.removeEventListener('input', onDocument)
    }
    expect(onDocument).not.toHaveBeenCalled()
    expect(sink().value).toBe('')
  })

  it('Escape calls onExit and does not reach the document', async () => {
    const rig = await mountDrill()
    const onDocument = vi.fn()
    document.addEventListener('keydown', onDocument)
    try {
      fireEvent.keyDown(sink(), { key: 'Escape' })
    } finally {
      document.removeEventListener('keydown', onDocument)
    }
    expect(rig.onExit).toHaveBeenCalledTimes(1)
    expect(onDocument).not.toHaveBeenCalled()
  })

  it('takes focus back when it is lost, but not to a control inside the drill', async () => {
    await mountDrill()
    const outside = document.createElement('button')
    document.body.append(outside)
    try {
      outside.focus()
      await waitFor(() => expect(document.activeElement).toBe(sink()))
    } finally {
      outside.remove()
    }
    const exit = screen.getByRole('button', { name: 'Exit' })
    exit.focus()
    await new Promise((r) => setTimeout(r, 20))
    expect(document.activeElement).toBe(exit)
  })

  it('the Exit button calls onExit', async () => {
    const rig = await mountDrill()
    fireEvent.click(screen.getByRole('button', { name: 'Exit' }))
    expect(rig.onExit).toHaveBeenCalledTimes(1)
  })
})

describe('Drill connection', () => {
  it('shows a banner with a Connect button while disconnected, and strokes cannot arrive', async () => {
    const rig = await mountDrill({}, { connected: false })
    await waitFor(() => expect(screen.getByText('Board disconnected — reconnect to continue')).toBeTruthy())
    expect(screen.getByRole('button', { name: 'Connect' })).toBeTruthy()
    expect(rig.logger.strokes).toHaveLength(0)
  })

  it('removes the banner on connect and again shows it after the device is unplugged', async () => {
    const rig = await mountDrill()
    expect(screen.queryByText(/Board disconnected/)).toBeNull()
    act(() => {
      for (const cb of [...rig.hid.listeners.disconnect]) cb({ device: rig.device })
    })
    expect(screen.getByText(/Board disconnected/)).toBeTruthy()
  })

  it('says it needs a Chromium-based browser when WebHID is unavailable', async () => {
    render(
      <UniProvider hid={null}>
        <Drill
          title="t"
          kind="stroke"
          items={[item('SAP', 'SAP')]}
          logger={fakeLogger()}
          logTest={LOG_TEST}
          onDone={() => {}}
          onExit={() => {}}
        />
      </UniProvider>,
    )
    expect(screen.getByText(/needs a Chromium-based browser/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Connect' })).toBeNull()
  })

  it('does not count disconnected time in the session clock', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(1_000_000)
    const rig = await mountDrill({ items: [item('SAP', 'SAP'), item('KAT', 'KAT')] })
    vi.setSystemTime(1_010_000)
    rig.stroke(SAP) // the session starts here
    vi.setSystemTime(1_020_000)
    act(() => {
      for (const cb of [...rig.hid.listeners.disconnect]) cb({ device: rig.device })
    })
    expect(screen.getByText(/Board disconnected/)).toBeTruthy()
    vi.setSystemTime(1_080_000) // unplugged for 60 s
    act(() => {
      for (const cb of [...rig.hid.listeners.connect]) cb({ device: rig.device })
    })
    await waitFor(() => expect(screen.queryByText(/Board disconnected/)).toBeNull())
    vi.setSystemTime(1_085_000)
    rig.stroke(KAT)
    // 10 s before the unplug + 5 s after the reconnect, not 75 s.
    expect(rig.logger.finishes[0].meta).toMatchObject({ elapsedMs: 15_000 })
  })
})

describe('Drill logging', () => {
  it('calls logger.start once with the test fields and accepts input while it is pending', async () => {
    const logger = fakeLogger({ startPending: true })
    const rig = await mountDrill({ items: [item('SAP', 'SAP'), item('KAT', 'KAT')] }, { logger })
    expect(logger.starts).toEqual([{ mode: 'stage0', chapter: 4, section: 'rows', itemCount: 2 }])
    rig.stroke(SAP)
    expect(screen.getByText(/1 \/ 2/)).toBeTruthy()
    expect(logger.strokes).toHaveLength(1)
    expect(logger.starts).toHaveLength(1)
  })

  it('shows a quiet unsaved line while the logger reports failures', async () => {
    const logger = fakeLogger()
    await mountDrill({}, { logger })
    expect(screen.queryByText(/not saved/)).toBeNull()
    act(() => logger.setUnsaved(3))
    expect(screen.getByText('⚠ 3 strokes not saved')).toBeTruthy()
  })

  it('shows the unsaved line when the logger already has failures at mount', async () => {
    const logger = fakeLogger()
    logger.setUnsaved(1)
    await mountDrill({}, { logger })
    expect(screen.getByText('⚠ 1 stroke not saved')).toBeTruthy()
  })

  it('unsubscribes from the stroke stream and the logger on unmount', async () => {
    const logger = fakeLogger()
    const rig = await mountDrill({ items: [item('SAP', 'SAP'), item('KAT', 'KAT')] }, { logger })
    rig.stroke(SAP)
    expect(logger.strokes).toHaveLength(1)
    rig.unmount()
    await new Promise((r) => setTimeout(r, 20)) // Preact runs unmount cleanups a tick later
    // the provider is gone too, so push the report straight to the device's listeners
    rig.device.report(KAT)
    rig.device.report([])
    expect(logger.strokes).toHaveLength(1)
    expect(() => logger.setUnsaved(2)).not.toThrow()
  })
})

describe('Drill finishing', () => {
  it('finishes the logger and calls onDone once with passed:true under the pass mark', async () => {
    const rig = await mountDrill({ passMark: { accuracy: 0.9, maxMinutes: 10 } })
    rig.stroke(SAP)
    await waitFor(() => expect(rig.onDone).toHaveBeenCalledTimes(1))
    const result = rig.onDone.mock.calls[0][0]
    expect(result.passed).toBe(true)
    expect(result.stats.completed).toBe(1)
    expect(result.stats.accuracy).toBe(1)
    expect(rig.logger.finishes).toHaveLength(1)
    expect(rig.logger.finishes[0]).toMatchObject({
      accuracy: 1,
      meta: { kind: 'stroke', itemCount: 1, firstTryCorrect: 1, passed: true },
    })
    expect(result.meta).toEqual(rig.logger.finishes[0].meta)
    rig.stroke(SAP) // input is over
    await new Promise((r) => setTimeout(r, 20))
    expect(rig.onDone).toHaveBeenCalledTimes(1)
  })

  it('fails the pass mark on accuracy, and has passed:null without a pass mark', async () => {
    const failing = await mountDrill({ passMark: { accuracy: 0.9 } })
    failing.stroke(TAP)
    failing.stroke(SAP)
    await waitFor(() => expect(failing.onDone).toHaveBeenCalledTimes(1))
    expect(failing.onDone.mock.calls[0][0].passed).toBe(false)
    cleanup()

    const none = await mountDrill()
    none.stroke(SAP)
    await waitFor(() => expect(none.onDone).toHaveBeenCalledTimes(1))
    expect(none.onDone.mock.calls[0][0].passed).toBeNull()
  })

  it('fails the pass mark when it took longer than maxMinutes', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(0)
    const rig = await mountDrill({
      items: [item('SAP', 'SAP'), item('KAT', 'KAT')],
      passMark: { accuracy: 0.5, maxMinutes: 1 },
    })
    rig.stroke(SAP)
    vi.setSystemTime(61_000)
    rig.stroke(KAT)
    await waitFor(() => expect(rig.onDone).toHaveBeenCalledTimes(1))
    expect(rig.onDone.mock.calls[0][0].passed).toBe(false)
  })

  it('calls onDone 1500 ms after a logger.finish that never settles', async () => {
    const logger = fakeLogger({ finishHangs: true })
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    const rig = await mountDrill({}, { logger })
    rig.stroke(SAP)
    expect(logger.finishes).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1499)
    expect(rig.onDone).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(rig.onDone).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(5000)
    expect(rig.onDone).toHaveBeenCalledTimes(1)
  })

  it('does not call onDone after unmount while the logger is still finishing', async () => {
    const logger = fakeLogger({ finishHangs: true })
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    const rig = await mountDrill({}, { logger })
    rig.stroke(SAP)
    rig.unmount()
    await vi.advanceTimersByTimeAsync(2000)
    expect(rig.onDone).not.toHaveBeenCalled()
  })

  it('calls onDone at once with zero stats for empty items, without touching the logger', async () => {
    const rig = await mountDrill({ items: [], passMark: { accuracy: 0.9 } })
    expect(rig.onDone).toHaveBeenCalledTimes(1)
    expect(rig.onDone.mock.calls[0][0].stats).toEqual({
      completed: 0,
      firstTryCorrect: 0,
      accuracy: 0,
      elapsedMs: 0,
      wpm: 0,
    })
    expect(rig.onDone.mock.calls[0][0].passed).toBe(false)
    expect(rig.logger.starts).toHaveLength(0)
    expect(rig.logger.finishes).toHaveLength(0)
  })
})
