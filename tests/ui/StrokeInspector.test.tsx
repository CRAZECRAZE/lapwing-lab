// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/preact'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { maskToSlots, parseStroke } from '../../src/core/steno.ts'
import { LEVERS, leverSlot } from '../../src/core/uni.ts'
import type { HidDeviceLike, HidLike } from '../../src/hid/uni-link.ts'
import { UniProvider } from '../../src/state/uni-context.tsx'
import { StrokeInspector } from '../../src/ui/StrokeInspector.tsx'

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
  requestDevice = vi.fn(async () => [] as HidDeviceLike[])
  getDevices = vi.fn(async () => this.known)
  addEventListener(): void {}
  removeEventListener(): void {}
}

/** Report bytes, most significant bit first, in LEVERS order (see src/core/uni.ts). */
function bytesOf(stroke: string): number[] {
  const slots = maskToSlots(parseStroke(stroke))
  const bytes = new Array<number>(4).fill(0)
  LEVERS.forEach((lever, i) => {
    if (slots.includes(leverSlot(lever))) bytes[i >> 3]! |= 0x80 >> (i & 7)
  })
  return bytes
}

const SAP = [0x81, 0x02] // S1- A- -P, spelled out so bytesOf is not trusted blindly
const TAP = [0x41, 0x02] // T- A- -P
const MULTI = 'KOPL/PHREU/KAEUT'

type Rig = {
  rerender(outline: string | null): void
  /** Unmounts the inspector but keeps the provider (and its device listener) alive. */
  removeInspector(): void
  unmount(): void
  /** Presses and releases the given report bytes. */
  press(bytes: number[]): void
}

async function mount(outline: string | null): Promise<Rig> {
  const hid = new FakeHid()
  const device = new FakeDevice()
  hid.known = [device]
  const tree = (o: string | null, show = true) => (
    <UniProvider hid={hid}>{show && <StrokeInspector outline={o} />}</UniProvider>
  )
  const { rerender, unmount } = render(tree(outline))
  // Let the provider's async attach finish so the device's report listener is in place.
  await act(async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve()
  })
  expect(device.listeners.size).toBe(1)
  return {
    rerender: (o) => rerender(tree(o)),
    removeInspector: () => rerender(tree(null, false)),
    unmount,
    press(bytes) {
      act(() => device.report(bytes))
      act(() => device.report([]))
    },
  }
}

const card = (): Element => document.querySelector('.inspector')!
const confirmed = (): boolean => card().classList.contains('confirmed')
const keys = (cls: string): string[] =>
  [...document.querySelectorAll(`.${cls}`)].map((el) => el.getAttribute('data-lever')!).sort()
const advance = (ms: number): void => void act(() => void vi.advanceTimersByTime(ms))

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('StrokeInspector press-to-confirm', () => {
  it('confirms the outline when the device stroke equals it, for 600 ms', async () => {
    const rig = await mount('SAP')
    expect(confirmed()).toBe(false)
    expect(screen.queryByText('✓')).toBeNull()
    rig.press(SAP)
    expect(confirmed()).toBe(true)
    expect(screen.getByText('✓')).toBeTruthy()
    advance(599)
    expect(confirmed()).toBe(true)
    advance(1)
    expect(confirmed()).toBe(false)
    expect(screen.queryByText('✓')).toBeNull()
  })

  it('shows the diff for a wrong stroke for 600 ms and does not confirm', async () => {
    const rig = await mount('SAP')
    rig.press(TAP)
    expect(confirmed()).toBe(false)
    expect(screen.queryByText('✓')).toBeNull()
    expect(keys('key--extra')).toEqual(['T-'])
    expect(keys('key--missing')).toEqual(['S1-', 'S2-']) // the board draws one S slot on two levers
    expect(keys('key--target')).toEqual(['-P', 'A-', 'S1-', 'S2-'])
    advance(599)
    expect(keys('key--extra')).toEqual(['T-'])
    advance(1)
    expect(keys('key--extra')).toEqual([])
    expect(keys('key--missing')).toEqual([])
  })

  it('treats a lone star as a wrong stroke when the displayed stroke is not a star', async () => {
    const rig = await mount('SAP')
    rig.press([0x00, 0x40])
    expect(confirmed()).toBe(false)
    expect(keys('key--extra')).toEqual(['*1', '*2', '*3', '*4']) // one * slot, four levers
  })

  it('steps through a multi-stroke outline only as each stroke is pressed in order', async () => {
    const rig = await mount(MULTI)
    expect(screen.getByText('1/3')).toBeTruthy()
    rig.press(bytesOf('KOPL'))
    expect(confirmed()).toBe(true)
    expect(screen.getByText('2/3')).toBeTruthy()
    rig.press(bytesOf('PHREU'))
    expect(screen.getByText('3/3')).toBeTruthy()
    // Paused: the owner is mid-sequence, so the display does not cycle on by itself.
    advance(2000)
    expect(screen.getByText('3/3')).toBeTruthy()
    expect(confirmed()).toBe(false)
  })

  it('confirms the whole outline on the last stroke, then returns to 1/n after the flash', async () => {
    const rig = await mount(MULTI)
    rig.press(bytesOf('KOPL'))
    rig.press(bytesOf('PHREU'))
    rig.press(bytesOf('KAEUT'))
    expect(confirmed()).toBe(true)
    expect(screen.getByText('✓')).toBeTruthy()
    expect(screen.getByText('3/3')).toBeTruthy()
    advance(599)
    expect(screen.getByText('3/3')).toBeTruthy()
    advance(1)
    expect(confirmed()).toBe(false)
    expect(screen.getByText('1/3')).toBeTruthy()
    // Cycling resumes: 800 ms after the flash ended.
    advance(800)
    expect(screen.getByText('2/3')).toBeTruthy()
  })

  it('does nothing but show the diff when a later stroke is pressed first', async () => {
    const rig = await mount(MULTI)
    rig.press(bytesOf('PHREU'))
    expect(screen.getByText('1/3')).toBeTruthy()
    expect(confirmed()).toBe(false)
    expect(keys('key--extra').length).toBeGreaterThan(0)
    expect(keys('key--missing').length).toBeGreaterThan(0)
    advance(600)
    expect(keys('key--extra')).toEqual([])
  })

  it('does not advance on a wrong stroke in the middle of a sequence', async () => {
    const rig = await mount(MULTI)
    rig.press(bytesOf('KOPL'))
    rig.press(bytesOf('KOPL')) // stroke 1 again while 2 is displayed
    expect(screen.getByText('2/3')).toBeTruthy()
    expect(keys('key--extra').length).toBeGreaterThan(0)
  })

  it('resumes cycling from 1/n after 3000 ms without a press mid-sequence', async () => {
    const rig = await mount(MULTI)
    rig.press(bytesOf('KOPL'))
    advance(2999)
    expect(screen.getByText('2/3')).toBeTruthy()
    advance(1)
    expect(screen.getByText('1/3')).toBeTruthy()
    advance(800)
    expect(screen.getByText('2/3')).toBeTruthy()
  })

  it('re-arms the 3000 ms inactivity window on every press', async () => {
    const rig = await mount(MULTI)
    rig.press(bytesOf('KOPL'))
    advance(2500)
    rig.press(bytesOf('PHREU'))
    advance(2500)
    expect(screen.getByText('3/3')).toBeTruthy()
    advance(500)
    expect(screen.getByText('1/3')).toBeTruthy()
  })

  it('resets confirm, diff and sequence state at once when the outline changes', async () => {
    const rig = await mount(MULTI)
    rig.press(bytesOf('KOPL'))
    expect(confirmed()).toBe(true)
    rig.rerender('SAP')
    expect(confirmed()).toBe(false)
    expect(screen.queryByText('✓')).toBeNull()
    rig.press(TAP)
    expect(keys('key--extra')).toEqual(['T-'])
    rig.rerender(MULTI)
    expect(keys('key--extra')).toEqual([])
    expect(screen.getByText('1/3')).toBeTruthy()
    // The old flash timer must not clear or advance anything in the new outline.
    rig.press(bytesOf('KOPL'))
    advance(300)
    rig.rerender('SAP')
    rig.press(SAP)
    advance(599)
    expect(confirmed()).toBe(true)
  })

  it('does not bring a flash back when the hover returns to the outline it left', async () => {
    const rig = await mount('SAP')
    rig.press(SAP)
    expect(confirmed()).toBe(true)
    rig.rerender('TAP')
    rig.rerender('SAP')
    expect(confirmed()).toBe(false)
    expect(screen.queryByText('✓')).toBeNull()
  })

  it('ignores device strokes while no outline is shown', async () => {
    const rig = await mount(null)
    rig.press(SAP)
    expect(confirmed()).toBe(false)
    expect(keys('key--extra')).toEqual([])
    expect(screen.queryByText('✓')).toBeNull()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('leaves no timers behind on unmount, mid-flash or mid-sequence, and ignores later strokes', async () => {
    const rig = await mount(MULTI)
    rig.press(bytesOf('KOPL'))
    expect(vi.getTimerCount()).toBeGreaterThan(0)
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    rig.removeInspector()
    expect(vi.getTimerCount()).toBe(0)
    rig.press(bytesOf('PHREU'))
    advance(5000)
    expect(vi.getTimerCount()).toBe(0)
    expect(errors).not.toHaveBeenCalled()
    errors.mockRestore()
  })

  it('leaves no timers behind on unmount mid-flash of a single stroke', async () => {
    const rig = await mount('SAP')
    rig.press(TAP)
    rig.removeInspector()
    expect(vi.getTimerCount()).toBe(0)
  })
})
