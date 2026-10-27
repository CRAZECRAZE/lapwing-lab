import { ChordAccumulator, UNI_USAGE, UNI_USAGE_PAGE, decodeUniReport } from '../core/uni.ts'
import type { Lever, RawStroke } from '../core/uni.ts'

export interface HidDeviceLike {
  opened: boolean
  /** Present on real HIDDevices; used to recognise a Uni among devices the page already knows. */
  collections?: { usagePage: number; usage: number }[]
  open(): Promise<void>
  close(): Promise<void>
  addEventListener(t: 'inputreport', cb: (e: { reportId: number; data: DataView }) => void): void
  removeEventListener(t: 'inputreport', cb: unknown): void
}

export interface HidLike {
  requestDevice(o: { filters: { usagePage: number; usage: number }[] }): Promise<HidDeviceLike[]>
  getDevices(): Promise<HidDeviceLike[]>
  addEventListener(t: 'connect' | 'disconnect', cb: (e: { device: HidDeviceLike }) => void): void
  removeEventListener(t: 'connect' | 'disconnect', cb: unknown): void
}

export type UniStatus = { state: 'connected' | 'disconnected'; reason?: string }

export type UniHandlers = {
  onSnapshot?(levers: Lever[]): void
  onStroke(stroke: RawStroke): void
  onStatus(status: UniStatus): void
}

const isUni = (device: HidDeviceLike): boolean =>
  device.collections?.some((c) => c.usagePage === UNI_USAGE_PAGE && c.usage === UNI_USAGE) ?? false

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

export class UniLink {
  private readonly hid: HidLike
  private readonly handlers: UniHandlers
  private readonly accumulator = new ChordAccumulator()
  private device: HidDeviceLike | null = null
  private listening = false
  /** True from the moment a lookup starts until it has attached or failed. */
  private busy = false
  /** Bumped by close() so a lookup that was in flight cannot attach afterwards. */
  private epoch = 0

  constructor(hid: HidLike, handlers: UniHandlers) {
    this.hid = hid
    this.handlers = handlers
  }

  get connected(): boolean {
    return this.device !== null
  }

  /** Needs a user gesture: shows the browser's device picker. */
  async request(): Promise<void> {
    this.listen()
    await this.attachFrom(async () => {
      const devices = await this.hid.requestDevice({
        filters: [{ usagePage: UNI_USAGE_PAGE, usage: UNI_USAGE }],
      })
      return devices[0]
    })
  }

  /** Attaches the first already-permitted Uni, without a prompt. */
  async autoConnect(): Promise<boolean> {
    this.listen()
    if (this.device) return true
    return this.attachFrom(async () => (await this.hid.getDevices()).find(isUni))
  }

  async close(): Promise<void> {
    this.epoch++
    if (this.listening) {
      this.hid.removeEventListener('connect', this.onConnect)
      this.hid.removeEventListener('disconnect', this.onDisconnect)
      this.listening = false
    }
    const device = this.device
    if (!device) return
    this.detach()
    this.handlers.onStatus({ state: 'disconnected' })
    try {
      await device.close()
    } catch {
      // already gone
    }
  }

  private listen(): void {
    if (this.listening) return
    this.listening = true
    this.hid.addEventListener('connect', this.onConnect)
    this.hid.addEventListener('disconnect', this.onDisconnect)
  }

  private async attachFrom(find: () => Promise<HidDeviceLike | undefined>): Promise<boolean> {
    if (this.device || this.busy) return false
    this.busy = true
    const epoch = this.epoch
    try {
      const device = await find()
      if (!device || epoch !== this.epoch) return false
      if (!device.opened) await device.open()
      if (epoch !== this.epoch) {
        await device.close().catch(() => {})
        return false
      }
      device.addEventListener('inputreport', this.onReport)
      this.device = device
      this.accumulator.reset()
      this.handlers.onStatus({ state: 'connected' })
      return true
    } catch (error) {
      this.handlers.onStatus({ state: 'disconnected', reason: messageOf(error) })
      return false
    } finally {
      this.busy = false
    }
  }

  private detach(): void {
    this.device?.removeEventListener('inputreport', this.onReport)
    this.device = null
    this.accumulator.reset()
  }

  private readonly onReport = (e: { reportId: number; data: DataView }): void => {
    const levers = decodeUniReport(e.reportId, e.data)
    if (!levers) return
    this.handlers.onSnapshot?.(levers)
    const stroke = this.accumulator.push(levers)
    if (stroke) this.handlers.onStroke(stroke)
  }

  private readonly onConnect = (e: { device: HidDeviceLike }): void => {
    if (!isUni(e.device)) return
    void this.attachFrom(async () => e.device)
  }

  private readonly onDisconnect = (e: { device: HidDeviceLike }): void => {
    if (e.device !== this.device) return
    this.detach()
    this.handlers.onStatus({ state: 'disconnected' })
  }
}
