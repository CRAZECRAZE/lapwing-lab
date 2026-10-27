import { describe, expect, it } from 'vitest'
import { parseStroke } from '../../src/core/steno.ts'
import { UniLink } from '../../src/hid/uni-link.ts'
import type { HidDeviceLike, HidLike, UniStatus } from '../../src/hid/uni-link.ts'
import type { Lever, RawStroke } from '../../src/core/uni.ts'

type ReportListener = (e: { reportId: number; data: DataView }) => void
type HidListener = (e: { device: HidDeviceLike }) => void

const UNI_COLLECTION = { usagePage: 0xff50, usage: 0x4c56 }

class FakeDevice implements HidDeviceLike {
  opened = false
  openCalls = 0
  closeCalls = 0
  addCalls = 0
  openError: Error | null = null
  listeners = new Set<ReportListener>()
  collections: { usagePage: number; usage: number }[] | undefined = [UNI_COLLECTION]

  async open(): Promise<void> {
    this.openCalls++
    if (this.openError) throw this.openError
    this.opened = true
  }
  async close(): Promise<void> {
    this.closeCalls++
    this.opened = false
  }
  addEventListener(_type: 'inputreport', cb: ReportListener): void {
    this.addCalls++
    this.listeners.add(cb)
  }
  removeEventListener(_type: 'inputreport', cb: unknown): void {
    this.listeners.delete(cb as ReportListener)
  }
  /** Mimics WebHID: the report id is separate and `data` holds only the 8-byte payload. */
  report(bytes: number[], reportId = 0x50): void {
    const buffer = new Uint8Array(8)
    buffer.set(bytes)
    for (const cb of [...this.listeners]) cb({ reportId, data: new DataView(buffer.buffer) })
  }
}

class FakeHid implements HidLike {
  requested: { filters: { usagePage: number; usage: number }[] }[] = []
  requestResult: HidDeviceLike[] = []
  requestError: Error | null = null
  known: HidDeviceLike[] = []
  getDevicesCalls = 0
  listeners: Record<'connect' | 'disconnect', Set<HidListener>> = {
    connect: new Set(),
    disconnect: new Set(),
  }

  async requestDevice(o: { filters: { usagePage: number; usage: number }[] }): Promise<HidDeviceLike[]> {
    this.requested.push(o)
    if (this.requestError) throw this.requestError
    return this.requestResult
  }
  async getDevices(): Promise<HidDeviceLike[]> {
    this.getDevicesCalls++
    return this.known
  }
  addEventListener(type: 'connect' | 'disconnect', cb: HidListener): void {
    this.listeners[type].add(cb)
  }
  removeEventListener(type: 'connect' | 'disconnect', cb: unknown): void {
    this.listeners[type].delete(cb as HidListener)
  }
  emit(type: 'connect' | 'disconnect', device: HidDeviceLike): void {
    for (const cb of [...this.listeners[type]]) cb({ device })
  }
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

function setup() {
  const hid = new FakeHid()
  const strokes: RawStroke[] = []
  const snapshots: Lever[][] = []
  const statuses: UniStatus[] = []
  const link = new UniLink(hid, {
    onSnapshot: (levers) => snapshots.push(levers),
    onStroke: (stroke) => strokes.push(stroke),
    onStatus: (status) => statuses.push(status),
  })
  return { hid, link, strokes, snapshots, statuses }
}

async function connected() {
  const ctx = setup()
  const device = new FakeDevice()
  ctx.hid.requestResult = [device]
  await ctx.link.request()
  ctx.statuses.length = 0
  return { ...ctx, device }
}

describe('UniLink input', () => {
  it('turns stripped-id reports (reportId 0x50, 8-byte data) into one SAP stroke', async () => {
    const { device, strokes, snapshots, link } = await connected()
    expect(link.connected).toBe(true)
    device.report([0x81]) // S1- + A-
    device.report([0x81, 0x02]) // S1- + A- + -P (chart entry 14: byte 1, mask 0x02)
    expect(strokes).toEqual([])
    device.report([])
    expect(strokes).toHaveLength(1)
    expect(strokes[0]?.levers).toEqual(['S1-', 'A-', '-P'])
    expect(strokes[0]?.mask).toBe(parseStroke('SAP'))
    expect(snapshots).toEqual([['S1-', 'A-'], ['S1-', 'A-', '-P'], []])
  })

  it('ignores reports with another report id', async () => {
    const { device, strokes, snapshots } = await connected()
    device.report([0x80], 0x51)
    device.report([], 0x51)
    expect(snapshots).toEqual([])
    expect(strokes).toEqual([])
  })

  it('works without an onSnapshot handler', async () => {
    const hid = new FakeHid()
    const strokes: RawStroke[] = []
    const link = new UniLink(hid, { onStroke: (s) => strokes.push(s), onStatus: () => {} })
    const device = new FakeDevice()
    hid.requestResult = [device]
    await link.request()
    device.report([0x80])
    device.report([])
    expect(strokes).toHaveLength(1)
  })
})

describe('UniLink.request', () => {
  it('asks for the Uni usage page and usage, opens, listens and reports connected', async () => {
    const { hid, link, statuses } = setup()
    const device = new FakeDevice()
    hid.requestResult = [device]
    await link.request()
    expect(hid.requested).toEqual([{ filters: [{ usagePage: 0xff50, usage: 0x4c56 }] }])
    expect(device.openCalls).toBe(1)
    expect(device.listeners.size).toBe(1)
    expect(statuses).toEqual([{ state: 'connected' }])
  })

  it('attaches the first returned device', async () => {
    const { hid, link } = setup()
    const first = new FakeDevice()
    const second = new FakeDevice()
    hid.requestResult = [first, second]
    await link.request()
    expect(first.listeners.size).toBe(1)
    expect(second.listeners.size).toBe(0)
  })

  it('does not reopen a device that is already open', async () => {
    const { hid, link } = setup()
    const device = new FakeDevice()
    device.opened = true
    hid.requestResult = [device]
    await link.request()
    expect(device.openCalls).toBe(0)
    expect(device.listeners.size).toBe(1)
  })

  it('does nothing, and does not throw, when the user picks no device', async () => {
    const { hid, link, statuses } = setup()
    hid.requestResult = []
    await expect(link.request()).resolves.toBeUndefined()
    expect(link.connected).toBe(false)
    expect(statuses).toEqual([])
  })

  it('opens and listens once when called twice in a row', async () => {
    const { hid, link, statuses } = setup()
    const device = new FakeDevice()
    hid.requestResult = [device]
    await link.request()
    await link.request()
    expect(hid.requested).toHaveLength(1)
    expect(device.openCalls).toBe(1)
    expect(device.addCalls).toBe(1)
    expect(statuses).toEqual([{ state: 'connected' }])
  })

  it('opens and listens once when called twice at the same time', async () => {
    const { hid, link, statuses } = setup()
    const device = new FakeDevice()
    hid.requestResult = [device]
    await Promise.all([link.request(), link.request()])
    expect(hid.requested).toHaveLength(1)
    expect(device.openCalls).toBe(1)
    expect(device.addCalls).toBe(1)
    expect(statuses).toEqual([{ state: 'connected' }])
  })

  it('reports a failed open and stays reusable', async () => {
    const { hid, link, statuses } = setup()
    const busy = new FakeDevice()
    busy.openError = new Error('The device is in use')
    hid.requestResult = [busy]
    await expect(link.request()).resolves.toBeUndefined()
    expect(link.connected).toBe(false)
    expect(busy.listeners.size).toBe(0)
    expect(statuses).toEqual([{ state: 'disconnected', reason: 'The device is in use' }])

    const good = new FakeDevice()
    hid.requestResult = [good]
    await link.request()
    expect(link.connected).toBe(true)
    expect(good.listeners.size).toBe(1)
    expect(statuses.at(-1)).toEqual({ state: 'connected' })
  })

  it('reports a rejected permission request and stays reusable', async () => {
    const { hid, link, statuses } = setup()
    hid.requestError = new Error('Must be handling a user gesture')
    await expect(link.request()).resolves.toBeUndefined()
    expect(statuses).toEqual([{ state: 'disconnected', reason: 'Must be handling a user gesture' }])
    hid.requestError = null
    hid.requestResult = [new FakeDevice()]
    await link.request()
    expect(link.connected).toBe(true)
  })
})

describe('UniLink.autoConnect', () => {
  it('attaches the first matching known device without prompting', async () => {
    const { hid, link, statuses } = setup()
    const other = new FakeDevice()
    other.collections = [{ usagePage: 0x0001, usage: 0x0006 }]
    const uni = new FakeDevice()
    hid.known = [other, uni]
    await expect(link.autoConnect()).resolves.toBe(true)
    expect(hid.requested).toEqual([])
    expect(hid.getDevicesCalls).toBe(1)
    expect(other.listeners.size).toBe(0)
    expect(uni.listeners.size).toBe(1)
    expect(statuses).toEqual([{ state: 'connected' }])
  })

  it('returns false when no known device matches', async () => {
    const { hid, link, statuses } = setup()
    const unknown = new FakeDevice()
    unknown.collections = undefined
    hid.known = [unknown]
    await expect(link.autoConnect()).resolves.toBe(false)
    expect(unknown.listeners.size).toBe(0)
    expect(statuses).toEqual([])
  })

  it('returns true without touching anything when already connected', async () => {
    const { hid, link, device } = await connected()
    hid.known = [device]
    await expect(link.autoConnect()).resolves.toBe(true)
    expect(hid.getDevicesCalls).toBe(0)
    expect(device.addCalls).toBe(1)
  })

  it('attaches a device that is plugged in later', async () => {
    const { hid, link, statuses } = setup()
    await expect(link.autoConnect()).resolves.toBe(false)
    const device = new FakeDevice()
    hid.emit('connect', device)
    await flush()
    expect(link.connected).toBe(true)
    expect(statuses).toEqual([{ state: 'connected' }])
  })

  it('reports a failed open and stays reusable', async () => {
    const { hid, link, statuses } = setup()
    const busy = new FakeDevice()
    busy.openError = new Error('denied')
    hid.known = [busy]
    await expect(link.autoConnect()).resolves.toBe(false)
    expect(statuses).toEqual([{ state: 'disconnected', reason: 'denied' }])
    busy.openError = null
    await expect(link.autoConnect()).resolves.toBe(true)
  })
})

describe('UniLink.close', () => {
  it('removes every listener, closes the device and reports disconnected', async () => {
    const { hid, link, device, statuses, strokes } = await connected()
    await link.close()
    expect(device.listeners.size).toBe(0)
    expect(hid.listeners.connect.size).toBe(0)
    expect(hid.listeners.disconnect.size).toBe(0)
    expect(device.closeCalls).toBe(1)
    expect(link.connected).toBe(false)
    expect(statuses).toEqual([{ state: 'disconnected' }])
    device.report([0x80])
    device.report([])
    expect(strokes).toEqual([])
  })

  it('is quiet when nothing was attached', async () => {
    const { link, statuses } = setup()
    await link.close()
    expect(statuses).toEqual([])
  })

  it('can be used again afterwards, without a stale half-held chord', async () => {
    const { hid, link, device, strokes, statuses } = await connected()
    device.report([0x80])
    await link.close()
    await link.request()
    expect(statuses).toEqual([{ state: 'disconnected' }, { state: 'connected' }])
    expect(device.listeners.size).toBe(1)
    expect(hid.listeners.disconnect.size).toBe(1)
    device.report([])
    expect(strokes).toEqual([])
  })

  it('does not attach a device that was still being looked up', async () => {
    const { hid, link, statuses } = setup()
    const device = new FakeDevice()
    hid.known = [device]
    const pending = link.autoConnect()
    await link.close()
    await expect(pending).resolves.toBe(false)
    expect(device.listeners.size).toBe(0)
    expect(statuses).toEqual([])
  })
})

describe('UniLink unplug and replug', () => {
  it('ignores a disconnect of a different device', async () => {
    const { hid, device, link, statuses, strokes } = await connected()
    hid.emit('disconnect', new FakeDevice())
    expect(statuses).toEqual([])
    expect(link.connected).toBe(true)
    device.report([0x80])
    device.report([])
    expect(strokes).toHaveLength(1)
  })

  it('reports the current device unplugged and stops listening to it', async () => {
    const { hid, device, link, statuses } = await connected()
    hid.emit('disconnect', device)
    expect(statuses).toEqual([{ state: 'disconnected' }])
    expect(link.connected).toBe(false)
    expect(device.listeners.size).toBe(0)
  })

  it('drops a half-held chord and re-attaches on a later connect', async () => {
    const { hid, device, link, statuses, strokes, snapshots } = await connected()
    device.report([0x80]) // S1- held when the cable comes out
    hid.emit('disconnect', device)

    const replugged = new FakeDevice()
    hid.emit('connect', replugged)
    await flush()
    expect(link.connected).toBe(true)
    expect(statuses).toEqual([{ state: 'disconnected' }, { state: 'connected' }])
    expect(replugged.listeners.size).toBe(1)

    replugged.report([])
    expect(strokes).toEqual([])
    replugged.report([0x40]) // T-
    replugged.report([])
    expect(strokes).toHaveLength(1)
    expect(strokes[0]?.mask).toBe(parseStroke('T'))
    expect(snapshots).toEqual([['S1-'], [], ['T-'], []])
  })

  it('re-attaches when the very same device object comes back', async () => {
    const { hid, device, strokes } = await connected()
    hid.emit('disconnect', device)
    device.opened = false
    hid.emit('connect', device)
    await flush()
    expect(device.listeners.size).toBe(1)
    expect(device.openCalls).toBe(2)
    device.report([0x80])
    device.report([])
    expect(strokes).toHaveLength(1)
  })

  it('ignores a connect for a device that is not a Uni', async () => {
    const { hid, link, statuses } = setup()
    await link.autoConnect()
    const keyboard = new FakeDevice()
    keyboard.collections = [{ usagePage: 0x0001, usage: 0x0006 }]
    const bare = new FakeDevice()
    bare.collections = undefined
    hid.emit('connect', keyboard)
    hid.emit('connect', bare)
    await flush()
    expect(link.connected).toBe(false)
    expect(keyboard.listeners.size + bare.listeners.size).toBe(0)
    expect(statuses).toEqual([])
  })

  it('ignores a connect while a device is already attached', async () => {
    const { hid, device, link, statuses } = await connected()
    const second = new FakeDevice()
    hid.emit('connect', second)
    await flush()
    expect(second.listeners.size).toBe(0)
    expect(device.addCalls).toBe(1)
    expect(link.connected).toBe(true)
    expect(statuses).toEqual([])
  })

  it('reports a failed open after replug and keeps listening for the next connect', async () => {
    const { hid, device, link, statuses } = await connected()
    hid.emit('disconnect', device)
    const busy = new FakeDevice()
    busy.openError = new Error('busy')
    hid.emit('connect', busy)
    await flush()
    expect(statuses.at(-1)).toEqual({ state: 'disconnected', reason: 'busy' })
    expect(link.connected).toBe(false)
    const good = new FakeDevice()
    hid.emit('connect', good)
    await flush()
    expect(link.connected).toBe(true)
  })
})
