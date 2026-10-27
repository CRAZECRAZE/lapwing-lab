// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact'
import type { ComponentChildren } from 'preact'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RawStroke } from '../../src/core/uni.ts'
import type { HidDeviceLike, HidLike } from '../../src/hid/uni-link.ts'
import { UniProvider, useUni } from '../../src/state/uni-context.tsx'
import type { UniState } from '../../src/state/uni-context.tsx'
import { App } from '../../src/ui/App.tsx'
import { StatusLine } from '../../src/ui/StatusLine.tsx'

type ReportListener = (e: { reportId: number; data: DataView }) => void
type HidListener = (e: { device: HidDeviceLike }) => void

class FakeDevice implements HidDeviceLike {
  opened = false
  closeCalls = 0
  listeners = new Set<ReportListener>()
  collections = [{ usagePage: 0xff50, usage: 0x4c56 }]
  async open(): Promise<void> {
    this.opened = true
  }
  async close(): Promise<void> {
    this.closeCalls++
    this.opened = false
  }
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
  requestError: Error | null = null
  requestDevice = vi.fn(async (_o: { filters: { usagePage: number; usage: number }[] }) => {
    if (this.requestError) throw this.requestError
    return this.requestResult
  })
  getDevices = vi.fn(async () => this.known)
  listeners: Record<'connect' | 'disconnect', Set<HidListener>> = { connect: new Set(), disconnect: new Set() }
  addEventListener(t: 'connect' | 'disconnect', cb: HidListener): void {
    this.listeners[t].add(cb)
  }
  removeEventListener(t: 'connect' | 'disconnect', cb: unknown): void {
    this.listeners[t].delete(cb as HidListener)
  }
}

/** Mirrors the context into `latest` so a test can read what a consumer would see. */
function Probe({ out }: { out: { latest: UniState | null } }) {
  out.latest = useUni()
  return null
}

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 20))

function withUni(hid: HidLike | null, children: ComponentChildren) {
  return render(<UniProvider hid={hid}>{children}</UniProvider>)
}

beforeEach(() => {
  history.replaceState(null, '', '/nope')
  vi.stubGlobal('scrollTo', vi.fn())
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('StatusLine', () => {
  it('without WebHID says it needs a Chromium-based browser and offers no Connect button', () => {
    withUni(null, <StatusLine />)
    expect(screen.getByText(/needs a Chromium-based browser/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /connect/i })).toBeNull()
    expect(screen.getByText('Plover output: turn it off while practicing')).toBeTruthy()
  })

  it('still renders the reader when WebHID is unavailable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ commit: 'abc', pages: [] }) })),
    )
    history.replaceState(null, '', '/nope')
    render(<App />)
    expect(await screen.findByText(/no such page/i)).toBeTruthy()
    expect(screen.getByText(/needs a Chromium-based browser/)).toBeTruthy()
  })

  it('defaults to navigator.hid when no hid prop is given', async () => {
    const hid = new FakeHid()
    vi.stubGlobal('navigator', { hid })
    render(
      <UniProvider>
        <StatusLine />
      </UniProvider>,
    )
    await settle()
    expect(screen.getByRole('button', { name: 'Connect' })).toBeTruthy()
    expect(hid.getDevices).toHaveBeenCalledTimes(1)
  })

  it('shows Not connected and a Connect button that asks for a device', async () => {
    const hid = new FakeHid()
    hid.requestResult = [new FakeDevice()]
    withUni(hid, <StatusLine />)
    await settle()
    expect(screen.getByText(/Not connected/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }))
    await waitFor(() => expect(screen.getByText(/Uni v4 connected/)).toBeTruthy())
    expect(hid.requestDevice).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: 'Connect' })).toBeNull()
  })

  it('ignores a second click while a connect is pending, then re-enables the button', async () => {
    const hid = new FakeHid()
    let finish!: (devices: HidDeviceLike[]) => void
    hid.requestDevice.mockImplementation(() => new Promise<HidDeviceLike[]>((resolve) => (finish = resolve)))
    withUni(hid, <StatusLine />)
    await settle()
    const button = screen.getByRole('button', { name: 'Connect' })
    fireEvent.click(button)
    fireEvent.click(button)
    await settle()
    expect(hid.requestDevice).toHaveBeenCalledTimes(1)
    const pending = screen.getByRole('button', { name: 'Connecting…' }) as HTMLButtonElement
    expect(pending.disabled).toBe(true)

    finish([])
    const again = (await screen.findByRole('button', { name: 'Connect' })) as HTMLButtonElement
    expect(again.disabled).toBe(false)
    expect(screen.queryByText(/user gesture/)).toBeNull()
  })

  it('shows the reason after a failed attach and clears it on the next click', async () => {
    const hid = new FakeHid()
    hid.requestError = new Error('Permission denied')
    withUni(hid, <StatusLine />)
    await settle()
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }))
    expect(await screen.findByText('Permission denied')).toBeTruthy()

    hid.requestError = null
    hid.requestResult = [new FakeDevice()]
    fireEvent.click(await screen.findByRole('button', { name: 'Connect' }))
    await waitFor(() => expect(screen.getByText(/Uni v4 connected/)).toBeTruthy())
    expect(screen.queryByText('Permission denied')).toBeNull()
  })

  it('connects by itself to an already-permitted Uni', async () => {
    const hid = new FakeHid()
    hid.known = [new FakeDevice()]
    withUni(hid, <StatusLine />)
    expect(await screen.findByText(/Uni v4 connected/)).toBeTruthy()
    expect(hid.requestDevice).not.toHaveBeenCalled()
  })
})

describe('UniProvider', () => {
  it('tracks the pressed levers and clears them on an all-zero report', async () => {
    const hid = new FakeHid()
    const device = new FakeDevice()
    hid.known = [device]
    const out: { latest: UniState | null } = { latest: null }
    withUni(hid, <Probe out={out} />)
    await waitFor(() => expect(out.latest?.connected).toBe(true))
    expect(out.latest?.pressed).toEqual([])

    act(() => device.report([0x81]))
    expect(out.latest?.pressed).toEqual(['S1-', 'A-'])
    act(() => device.report([0x81, 0x02]))
    expect(out.latest?.pressed).toEqual(['S1-', 'A-', '-P'])
    act(() => device.report([]))
    expect(out.latest?.pressed).toEqual([])
  })

  it('clears pressed levers when the device is unplugged', async () => {
    const hid = new FakeHid()
    const device = new FakeDevice()
    hid.known = [device]
    const out: { latest: UniState | null } = { latest: null }
    withUni(hid, <Probe out={out} />)
    await waitFor(() => expect(out.latest?.connected).toBe(true))
    act(() => device.report([0x80]))
    expect(out.latest?.pressed).toEqual(['S1-'])
    act(() => {
      for (const cb of [...hid.listeners.disconnect]) cb({ device })
    })
    expect(out.latest?.connected).toBe(false)
    expect(out.latest?.pressed).toEqual([])
  })

  it('delivers strokes to subscribers until they unsubscribe', async () => {
    const hid = new FakeHid()
    const device = new FakeDevice()
    hid.known = [device]
    const out: { latest: UniState | null } = { latest: null }
    withUni(hid, <Probe out={out} />)
    await waitFor(() => expect(out.latest?.connected).toBe(true))

    const first: RawStroke[] = []
    const second: RawStroke[] = []
    const off = out.latest!.onStroke((s) => first.push(s))
    out.latest!.onStroke((s) => second.push(s))
    act(() => device.report([0x80]))
    act(() => device.report([]))
    expect(first).toHaveLength(1)
    expect(second).toHaveLength(1)
    expect(first[0]?.levers).toEqual(['S1-'])

    off()
    act(() => device.report([0x40]))
    act(() => device.report([]))
    expect(first).toHaveLength(1)
    expect(second).toHaveLength(2)
  })

  it('keeps delivering to the other subscribers when one throws', async () => {
    const hid = new FakeHid()
    const device = new FakeDevice()
    hid.known = [device]
    const out: { latest: UniState | null } = { latest: null }
    withUni(hid, <Probe out={out} />)
    await waitFor(() => expect(out.latest?.connected).toBe(true))
    const failure = new Error('subscriber bug')
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    const collected: RawStroke[] = []
    out.latest!.onStroke(() => {
      throw failure
    })
    out.latest!.onStroke((s) => collected.push(s))

    expect(() => {
      act(() => device.report([0x80]))
      act(() => device.report([]))
    }).not.toThrow()
    expect(collected).toHaveLength(1)
    act(() => device.report([0x40]))
    act(() => device.report([]))
    expect(collected).toHaveLength(2)
    expect(collected[1]?.levers).toEqual(['T-'])
    expect(logged).toHaveBeenCalledTimes(2)
    expect(logged).toHaveBeenCalledWith(failure)
    logged.mockRestore()
  })

  it('closes the link on unmount: listeners removed, device closed, no more strokes', async () => {
    const hid = new FakeHid()
    const device = new FakeDevice()
    hid.known = [device]
    const out: { latest: UniState | null } = { latest: null }
    const { unmount } = withUni(hid, <Probe out={out} />)
    await waitFor(() => expect(out.latest?.connected).toBe(true))
    const strokes: RawStroke[] = []
    out.latest!.onStroke((s) => strokes.push(s))

    unmount()
    await settle()
    expect(device.listeners.size).toBe(0)
    expect(hid.listeners.connect.size).toBe(0)
    expect(hid.listeners.disconnect.size).toBe(0)
    expect(device.closeCalls).toBe(1)
    device.report([0x80])
    device.report([])
    expect(strokes).toEqual([])
  })

  it('does nothing with a hid of null', async () => {
    const out: { latest: UniState | null } = { latest: null }
    withUni(null, <Probe out={out} />)
    await settle()
    expect(out.latest?.available).toBe(false)
    await expect(out.latest!.connect()).resolves.toBeUndefined()
  })
})

describe('useUni outside a provider', () => {
  it('is inert', async () => {
    const out: { latest: UniState | null } = { latest: null }
    render(<Probe out={out} />)
    const uni = out.latest!
    expect(uni.available).toBe(false)
    expect(uni.connected).toBe(false)
    expect(uni.pressed).toEqual([])
    await expect(uni.connect()).resolves.toBeUndefined()
    const cb = vi.fn()
    expect(() => uni.onStroke(cb)()).not.toThrow()
    expect(cb).not.toHaveBeenCalled()
  })
})
