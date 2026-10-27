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

function fakeLogger(
  opts: { startPending?: boolean; finishHangs?: boolean; unsavedOnSubscribe?: number } = {},
): LoggerFake {
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
      // a failure that lands between the first render and the subscription, without a callback
      if (opts.unsavedOnSubscribe !== undefined) unsaved = opts.unsavedOnSubscribe
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
    expect(document.querySelector('.drill__stats')!.textContent).toBe('0 / 2 · acc — · 0 wpm')
    rig.stroke(SAP)
    expect(document.querySelector('.drill__stats')!.textContent).toMatch(/^1 \/ 2 · acc 100% · \d+ wpm$/)
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

  it('shows acc 50% once one of two items needed a second try', async () => {
    const rig = await mountDrill({ items: [item('SAP', 'SAP'), item('KAT', 'KAT')] })
    rig.stroke(TAP) // first-try miss on item 1
    expect(document.querySelector('.drill__stats')!.textContent).toMatch(/^0 \/ 2 · acc — · /)
    rig.stroke(SAP)
    rig.stroke(KAT)
    expect(document.querySelector('.drill__stats')!.textContent).toMatch(/^2 \/ 2 · acc 50% · \d+ wpm$/)
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

describe('Drill hints on a multi-stroke word', () => {
  const KOPL = [0x20, 0x82, 0x80] // K- O- -P -L
  const PHREU = [0x16, 0x30] // P- H- R- -E -U

  it('keeps showing the remaining strokes after a miss until the item completes', async () => {
    const rig = await mountDrill({
      kind: 'word',
      items: [item('copy', 'KOPL/PHREU'), item('sap', 'SAP')],
    })
    expect(document.querySelector('.key--target')).toBeNull()
    rig.stroke(TAP) // miss on stroke 1
    expect(document.querySelector('.drill__expected')!.textContent).toBe('KOPL')
    rig.stroke(KOPL) // correct stroke 1: the hint moves on to stroke 2
    expect(document.querySelector('.drill__expected')!.textContent).toBe('PHREU')
    expect(lever('P-').classList.contains('key--target')).toBe(true)
    expect(lever('-U').classList.contains('key--target')).toBe(true)
    expect(lever('K-').classList.contains('key--target')).toBe(false)
    rig.stroke(PHREU) // item complete: the next word starts with no hint
    expect(document.querySelector('.drill__prompt')!.textContent).toBe('sap')
    expect(document.querySelector('.key--target')).toBeNull()
    expect(document.querySelector('.drill__expected')!.textContent).toBe('')
  })

  it('shows no hint for stroke 2 when stroke 1 was right the first time', async () => {
    const rig = await mountDrill({ kind: 'word', items: [item('copy', 'KOPL/PHREU')] })
    rig.stroke(KOPL)
    expect(document.querySelector('.key--target')).toBeNull()
    expect(document.querySelector('.drill__expected')!.textContent).toBe('')
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

  it('the Exit button calls onExit and hands focus back to the sink', async () => {
    const rig = await mountDrill()
    const exit = screen.getByRole('button', { name: 'Exit' })
    exit.focus()
    fireEvent.click(exit)
    expect(rig.onExit).toHaveBeenCalledTimes(1)
    expect(document.activeElement).toBe(sink())
  })

  it('prevents the default of Tab and Shift+Tab so stray typing cannot move focus off the sink', async () => {
    await mountDrill()
    expect(fireEvent.keyDown(sink(), { key: 'Tab' })).toBe(false)
    expect(fireEvent.keyDown(sink(), { key: 'Tab', shiftKey: true })).toBe(false)
    expect(document.activeElement).toBe(sink())
  })

  it('lets browser shortcuts through: Ctrl/Meta/Alt chords are not default-prevented, but still stay in the sink', async () => {
    await mountDrill()
    const onDocument = vi.fn()
    document.addEventListener('keydown', onDocument)
    try {
      expect(fireEvent.keyDown(sink(), { key: 'r', ctrlKey: true })).toBe(true)
      expect(fireEvent.keyDown(sink(), { key: 'F5', ctrlKey: true })).toBe(true)
      expect(fireEvent.keyDown(sink(), { key: 'l', metaKey: true })).toBe(true)
      expect(fireEvent.keyDown(sink(), { key: 'ArrowLeft', altKey: true })).toBe(true)
    } finally {
      document.removeEventListener('keydown', onDocument)
    }
    expect(onDocument).not.toHaveBeenCalled()
  })

  it('prevents the default of plain stray output: letters, Space, Enter, Backspace, Tab, Shift+Tab', async () => {
    await mountDrill()
    for (const init of [
      { key: 'a' },
      { key: 'A', shiftKey: true },
      { key: ' ' },
      { key: 'Enter' },
      { key: 'Backspace' },
      { key: 'Tab' },
      { key: 'Tab', shiftKey: true },
    ]) {
      expect(fireEvent.keyDown(sink(), init), init.key).toBe(false)
    }
  })

  it('prevents the default of every key but Escape, and stray Space/Enter activate no button', async () => {
    const rig = await mountDrill({}, { connected: false })
    await screen.findByRole('button', { name: 'Connect' })
    for (const key of [' ', 'Enter', 'a']) {
      expect(fireEvent.keyDown(sink(), { key })).toBe(false)
    }
    expect(rig.onExit).not.toHaveBeenCalled()
    expect(rig.hid.requestDevice).not.toHaveBeenCalled()
    // Escape is the one key that is acted on, and it is not swallowed as a no-op
    fireEvent.keyDown(sink(), { key: 'Escape' })
    expect(rig.onExit).toHaveBeenCalledTimes(1)
  })

  it('the Connect button asks for a device and hands focus back to the sink', async () => {
    const rig = await mountDrill({}, { connected: false })
    const connect = await screen.findByRole('button', { name: 'Connect' })
    connect.focus()
    expect(document.activeElement).toBe(connect)
    fireEvent.click(connect)
    expect(document.activeElement).toBe(sink())
    await waitFor(() => expect(rig.hid.requestDevice).toHaveBeenCalledTimes(1))
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

describe('Drill latency', () => {
  it('logs the time since the item appeared, resets it per item and leaves out disconnected time', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(1_000_000)
    const rig = await mountDrill({ items: [item('SAP', 'SAP'), item('KAT', 'KAT')] })
    vi.setSystemTime(1_003_000)
    rig.stroke(TAP) // miss, 3 s after item 1 appeared
    vi.setSystemTime(1_007_000)
    rig.stroke(SAP) // correct, 7 s after; item 2 appears now
    vi.setSystemTime(1_010_000)
    act(() => {
      for (const cb of [...rig.hid.listeners.disconnect]) cb({ device: rig.device })
    })
    vi.setSystemTime(1_070_000) // unplugged for 60 s
    act(() => {
      for (const cb of [...rig.hid.listeners.connect]) cb({ device: rig.device })
    })
    await waitFor(() => expect(screen.queryByText(/Board disconnected/)).toBeNull())
    vi.setSystemTime(1_072_000)
    rig.stroke(KAT) // 3 s before the unplug + 2 s after the reconnect since item 2 appeared
    expect(rig.logger.strokes.map((r) => [r.prompt, r.latencyMs])).toEqual([
      ['SAP', 3000],
      ['SAP', 7000],
      ['KAT', 5000],
    ])
  })
})

describe('Drill logging', () => {
  it('does not start the logger when mounted', async () => {
    const rig = await mountDrill({ items: [item('SAP', 'SAP'), item('KAT', 'KAT')] })
    expect(rig.logger.starts).toEqual([])
  })

  it('starts the logger on the first judged stroke, once, before logging it', async () => {
    const order: string[] = []
    const logger = fakeLogger()
    const start = logger.start
    const stroke = logger.stroke
    logger.start = (t) => {
      order.push('start')
      return start(t)
    }
    logger.stroke = (s) => {
      order.push('stroke')
      stroke(s)
    }
    const rig = await mountDrill({ items: [item('SAP', 'SAP'), item('KAT', 'KAT')] }, { logger })
    rig.stroke(SAP)
    expect(logger.starts).toEqual([{ mode: 'stage0', chapter: 4, section: 'rows', itemCount: 2 }])
    expect(logger.strokes).toHaveLength(1)
    expect(order).toEqual(['start', 'stroke'])
    rig.stroke(KAT)
    expect(logger.starts).toHaveLength(1)
    expect(order).toEqual(['start', 'stroke', 'stroke'])
  })

  it('starts the logger on a first stroke that misses', async () => {
    const rig = await mountDrill({ items: [item('SAP', 'SAP')] })
    rig.stroke(TAP)
    expect(rig.logger.starts).toHaveLength(1)
    expect(rig.logger.strokes).toHaveLength(1)
  })

  it('an ignored lone star does not start the test', async () => {
    const rig = await mountDrill({ items: [item('KOPL/PHREU', 'KOPL/PHREU')] })
    rig.stroke(LONE_STAR)
    expect(rig.logger.starts).toEqual([])
    expect(rig.logger.strokes).toEqual([])
  })

  it('accepts input while start is still pending, and has started once after the first stroke', async () => {
    const logger = fakeLogger({ startPending: true })
    const rig = await mountDrill({ items: [item('SAP', 'SAP'), item('KAT', 'KAT')] }, { logger })
    rig.stroke(SAP)
    expect(screen.getByText(/1 \/ 2/)).toBeTruthy()
    expect(logger.strokes).toHaveLength(1)
    expect(logger.starts).toHaveLength(1)
  })

  it('exiting before any stroke writes nothing', async () => {
    const rig = await mountDrill({ items: [item('SAP', 'SAP'), item('KAT', 'KAT')] })
    fireEvent.click(screen.getByRole('button', { name: 'Exit' }))
    rig.unmount()
    expect(rig.logger.starts).toEqual([])
    expect(rig.logger.finishes).toEqual([])
  })

  it('exiting after strokes finishes the test as abandoned with its partial stats', async () => {
    const rig = await mountDrill({ kind: 'word', items: [item('sap', 'SAP'), item('kat', 'KAT')] })
    rig.stroke(SAP)
    fireEvent.click(screen.getByRole('button', { name: 'Exit' }))
    rig.unmount()
    expect(rig.logger.finishes).toHaveLength(1)
    const [finish] = rig.logger.finishes
    expect(finish.meta).toMatchObject({ kind: 'word', abandoned: true, completed: 1, itemCount: 2, passed: null })
    expect(typeof finish.wpm).toBe('number')
    expect(finish.accuracy).toBeGreaterThanOrEqual(0)
    expect(finish.accuracy).toBeLessThanOrEqual(1)
    expect(rig.onDone).not.toHaveBeenCalled()
  })

  it('completing the drill finishes once and unmounting afterwards does not finish again', async () => {
    const rig = await mountDrill()
    rig.stroke(SAP)
    await waitFor(() => expect(rig.onDone).toHaveBeenCalledTimes(1))
    rig.unmount()
    expect(rig.logger.finishes).toHaveLength(1)
    expect(rig.logger.finishes[0].meta).not.toHaveProperty('abandoned')
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

  it('picks up a failure that happened between the first render and the subscription', async () => {
    const logger = fakeLogger({ unsavedOnSubscribe: 2 })
    await mountDrill({}, { logger })
    expect(screen.getByText('⚠ 2 strokes not saved')).toBeTruthy()
  })

  it('unsubscribes from the stroke stream and the logger on unmount', async () => {
    const logger = fakeLogger()
    const rig = await mountDrill({ items: [item('SAP', 'SAP'), item('KAT', 'KAT')] }, { logger })
    rig.stroke(SAP)
    expect(logger.strokes).toHaveLength(1)
    rig.unmount()
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

const flowWords = (): Element[] => [...document.querySelectorAll('.drill__flow-word')]
const current = (): Element | null => document.querySelector('.drill__flow [aria-current="true"]')
const statsText = (): string => document.querySelector('.drill__stats')!.textContent!

function unplug(rig: Rig): void {
  act(() => {
    for (const cb of [...rig.hid.listeners.disconnect]) cb({ device: rig.device })
  })
}

async function replug(rig: Rig): Promise<void> {
  act(() => {
    for (const cb of [...rig.hid.listeners.connect]) cb({ device: rig.device })
  })
  await waitFor(() => expect(screen.queryByText(/Board disconnected/)).toBeNull())
}

describe('Drill flow view', () => {
  it('shows the current prompt marked and the following prompts in order, with no big prompt', async () => {
    const rig = await mountDrill({
      view: 'flow',
      items: [item('SAP', 'SAP'), item('KAT', 'KAT'), item('TAP', 'TAP')],
    })
    expect(document.querySelector('.drill__prompt')).toBeNull()
    expect(flowWords().map((w) => w.textContent)).toEqual(['SAP', 'KAT', 'TAP'])
    expect(current()!.textContent).toBe('SAP')
    expect(flowWords()[0]).toBe(current())

    rig.stroke(SAP)
    expect(current()!.textContent).toBe('KAT')
    const [first, second] = flowWords()
    expect(first.textContent).toBe('SAP')
    expect(first.classList.contains('drill__flow-word--done')).toBe(true)
    expect(first.hasAttribute('aria-current')).toBe(false)
    expect(second).toBe(current())
    // the rest of the drill is unchanged: stats, hint line, board
    expect(statsText()).toMatch(/^1 \/ 3 · acc 100% · \d+ wpm$/)
    expect(document.querySelector('.drill__expected')).toBeTruthy()
    expect(lever('K-').classList.contains('key--target')).toBe(true)
  })

  it('keeps the last 3 completed prompts and the next 10, keyed by position for repeated prompts', async () => {
    const items = Array.from({ length: 20 }, () => item('SAP', 'SAP'))
    const rig = await mountDrill({ view: 'flow', items })
    expect(flowWords()).toHaveLength(11)
    expect(flowWords().indexOf(current()!)).toBe(0)
    const firstSpan = flowWords()[0]
    for (let i = 0; i < 5; i++) rig.stroke(SAP)
    // 3 done + current + 10 next
    expect(flowWords()).toHaveLength(14)
    expect(flowWords().indexOf(current()!)).toBe(3)
    expect(flowWords().filter((w) => w.classList.contains('drill__flow-word--done'))).toHaveLength(3)
    expect(document.querySelectorAll('.drill__flow [aria-current]')).toHaveLength(1)
    expect(firstSpan.isConnected).toBe(false) // item 0 scrolled out of the window
    expect(statsText()).toMatch(/^5 \/ 20 /)
  })

  it('shows the completed mark after the last prompt when the items run out', async () => {
    const rig = await mountDrill({ view: 'flow', items: [item('SAP', 'SAP'), item('KAT', 'KAT')] })
    rig.stroke(SAP)
    rig.stroke(KAT)
    expect(current()).toBeNull()
    expect(flowWords().map((w) => w.textContent)).toEqual(['SAP', 'KAT'])
    expect(flowWords().every((w) => w.classList.contains('drill__flow-word--done'))).toBe(true)
    expect(document.querySelector('.drill__flow')!.textContent).toContain('✓')
    await waitFor(() => expect(rig.onDone).toHaveBeenCalledTimes(1))
  })

  it('a word flow drill left early still finishes as abandoned', async () => {
    const rig = await mountDrill({ view: 'flow', kind: 'word', items: [item('sap', 'SAP'), item('kat', 'KAT')] })
    expect(document.querySelector('.drill__flow')!.classList.contains('drill__flow--word')).toBe(true)
    rig.stroke(SAP)
    rig.unmount()
    expect(rig.logger.finishes).toHaveLength(1)
    expect(rig.logger.finishes[0].meta).toMatchObject({ abandoned: true, completed: 1 })
    expect(rig.onDone).not.toHaveBeenCalled()
  })

  it('the prompt view stays the default', async () => {
    await mountDrill({ items: [item('SAP', 'SAP')] })
    expect(document.querySelector('.drill__flow')).toBeNull()
    expect(document.querySelector('.drill__prompt')!.textContent).toBe('SAP')
  })
})

describe('Drill time limit', () => {
  const many = (n = 40): DrillItem[] =>
    Array.from({ length: n }, (_, i) => (i % 2 === 0 ? item('SAP', 'SAP') : item('KAT', 'KAT')))
  const tick = (ms: number): void => {
    act(() => {
      vi.advanceTimersByTime(ms)
    })
  }

  /** The interval is faked (so waitFor cannot poll): let the finish promise chain run on a real timeout. */
  const settle = async (): Promise<void> => {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
    vi.setSystemTime(1_000_000)
  })

  it('shows the remaining time instead of the count, rounding up, and counts down from the first stroke', async () => {
    const rig = await mountDrill({ items: many(), timeLimitMs: 30_000 })
    expect(statsText()).toBe('0:30 left · acc — · 0 wpm')
    tick(5000)
    expect(statsText()).toBe('0:30 left · acc — · 0 wpm')
    rig.stroke(SAP)
    expect(statsText()).toMatch(/^0:30 left · acc 100% · /)
    tick(1200)
    expect(statsText()).toMatch(/^0:29 left · /)
    tick(28_700) // 100 ms remain
    expect(statsText()).toMatch(/^0:01 left · /)
    expect(rig.onDone).not.toHaveBeenCalled()
  })

  it('formats minutes', async () => {
    await mountDrill({ items: many(), timeLimitMs: 90_000 })
    expect(statsText()).toBe('1:30 left · acc — · 0 wpm')
  })

  it('does nothing before the first stroke, then finishes once at time-up and ignores later strokes', async () => {
    const rig = await mountDrill({ items: many(), timeLimitMs: 30_000 })
    expect(vi.getTimerCount()).toBe(0)
    tick(60_000)
    expect(rig.onDone).not.toHaveBeenCalled()
    expect(rig.logger.starts).toHaveLength(0)

    rig.stroke(SAP)
    expect(vi.getTimerCount()).toBe(1)
    tick(10_000)
    rig.stroke(KAT)
    tick(20_000)
    await settle()
    expect(rig.onDone).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
    expect(rig.logger.finishes).toHaveLength(1)
    const result = rig.onDone.mock.calls[0][0]
    expect(result.passed).toBeNull()
    expect(result.meta).toMatchObject({ timedOut: true, timeLimitMs: 30_000, passed: null, kind: 'stroke' })
    expect(rig.logger.finishes[0].meta).toEqual(result.meta)
    expect(result.stats.completed).toBe(2)
    expect(result.stats.elapsedMs).toBe(10_000) // wpm runs to the last completed word
    expect(rig.logger.finishes[0]).toMatchObject({ accuracy: 1, wpm: result.stats.wpm })

    rig.stroke(SAP)
    expect(rig.logger.strokes).toHaveLength(2)
    tick(5000)
    expect(rig.onDone).toHaveBeenCalledTimes(1)
  })

  it('undo and ignored strokes do not start the countdown', async () => {
    const KOPL = [0x20, 0x82, 0x80]
    const rig = await mountDrill({ items: [item('KOPL/PHREU', 'KOPL/PHREU'), ...many()], timeLimitMs: 30_000 })
    rig.stroke(LONE_STAR) // ignored
    tick(40_000)
    expect(statsText()).toMatch(/^0:30 left/)
    expect(vi.getTimerCount()).toBe(0)
    rig.stroke(KOPL) // the first judged stroke: the countdown starts here
    rig.stroke(LONE_STAR) // undo
    expect(vi.getTimerCount()).toBe(1)
    tick(29_000)
    expect(rig.onDone).not.toHaveBeenCalled()
    tick(1000)
    await settle()
    expect(rig.onDone).toHaveBeenCalledTimes(1)
  })

  it('is frozen while the board is disconnected', async () => {
    const rig = await mountDrill({ items: many(), timeLimitMs: 30_000 })
    rig.stroke(SAP)
    tick(10_000)
    unplug(rig)
    tick(60_000)
    expect(rig.onDone).not.toHaveBeenCalled()
    expect(statsText()).toMatch(/^0:20 left/)
    await replug(rig)
    tick(19_000)
    expect(rig.onDone).not.toHaveBeenCalled()
    expect(rig.logger.finishes).toHaveLength(0)
    tick(1000)
    await settle()
    expect(rig.onDone).toHaveBeenCalledTimes(1)
    expect(rig.onDone.mock.calls[0][0].meta).toMatchObject({ timedOut: true })
  })

  it('time up with zero completed words finishes with wpm 0 and accuracy 0', async () => {
    const rig = await mountDrill({ items: many(), timeLimitMs: 30_000 })
    rig.stroke(TAP) // a miss starts the test
    tick(30_000)
    await settle()
    expect(rig.onDone).toHaveBeenCalledTimes(1)
    const result = rig.onDone.mock.calls[0][0]
    expect(result.stats).toMatchObject({ completed: 0, wpm: 0, accuracy: 0 })
    expect(rig.logger.finishes[0]).toMatchObject({ wpm: 0, accuracy: 0 })
    expect(Number.isFinite(rig.logger.finishes[0].wpm)).toBe(true)
    expect(Number.isFinite(rig.logger.finishes[0].accuracy)).toBe(true)
  })

  it('a multi-stroke item in progress at time-up is not counted', async () => {
    const KOPL = [0x20, 0x82, 0x80]
    const rig = await mountDrill({ items: [item('SAP', 'SAP'), item('KOPL/PHREU', 'KOPL/PHREU')], timeLimitMs: 30_000 })
    rig.stroke(SAP)
    rig.stroke(KOPL)
    tick(30_000)
    await settle()
    expect(rig.onDone).toHaveBeenCalledTimes(1)
    expect(rig.onDone.mock.calls[0][0].stats.completed).toBe(1)
  })

  it('completes normally when the items run out first, and stops the countdown', async () => {
    const rig = await mountDrill({ items: [item('SAP', 'SAP'), item('KAT', 'KAT')], timeLimitMs: 30_000 })
    rig.stroke(SAP)
    tick(1000)
    rig.stroke(KAT)
    expect(vi.getTimerCount()).toBe(0)
    await settle()
    expect(rig.onDone).toHaveBeenCalledTimes(1)
    expect(rig.onDone.mock.calls[0][0].meta).not.toHaveProperty('timedOut')
    tick(60_000)
    expect(rig.onDone).toHaveBeenCalledTimes(1)
    expect(rig.logger.finishes).toHaveLength(1)
  })

  it('unmounting after a time-out does not finish a second time', async () => {
    const rig = await mountDrill({ view: 'flow', items: many(), timeLimitMs: 30_000 })
    rig.stroke(SAP)
    tick(30_000)
    await settle()
    expect(rig.onDone).toHaveBeenCalledTimes(1)
    rig.unmount()
    expect(rig.logger.finishes).toHaveLength(1)
    expect(rig.logger.finishes[0].meta).not.toHaveProperty('abandoned')
  })

  it('leaves no interval running after an unmount mid-countdown, and finishes as abandoned', async () => {
    const rig = await mountDrill({ view: 'flow', items: many(), timeLimitMs: 30_000 })
    rig.stroke(SAP)
    expect(vi.getTimerCount()).toBe(1)
    rig.unmount()
    expect(vi.getTimerCount()).toBe(0)
    expect(rig.logger.finishes).toHaveLength(1)
    expect(rig.logger.finishes[0].meta).toMatchObject({ abandoned: true })
    tick(60_000)
    expect(rig.onDone).not.toHaveBeenCalled()
    expect(rig.logger.finishes).toHaveLength(1)
  })
})
