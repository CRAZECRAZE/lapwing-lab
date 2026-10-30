// Shared fakes for the M3 drill-route suites: a fake Uni board, a fake test logger, content fixtures
// and a mount inside the real UniProvider and ProgressProvider. The suites mock `src/api.ts` themselves.
import { act, render, screen, waitFor } from '@testing-library/preact'
import type { ComponentChildren } from 'preact'
import { expect, vi } from 'vitest'
import type { ChapterInfo, PracticeIndexEntry } from '../../../scripts/build-content.ts'
import type { SectionResult } from '../../../server/archive.ts'
import type { TestLogger } from '../../../src/api.ts'
import type { HidDeviceLike, HidLike } from '../../../src/hid/uni-link.ts'
import { ProgressProvider } from '../../../src/state/progress.tsx'
import { UniProvider } from '../../../src/state/uni-context.tsx'

type ReportListener = (e: { reportId: number; data: DataView }) => void

export class FakeDevice implements HidDeviceLike {
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

export class FakeHid implements HidLike {
  known: HidDeviceLike[] = []
  requestDevice = vi.fn(async () => [])
  getDevices = vi.fn(async () => this.known)
  addEventListener(): void {}
  removeEventListener(): void {}
}

// Report bytes, most significant bit first: S1- T- K- P- W- H- R- A- | O- *1 -E -U -F -R -P -B | -L -G -T -S -D -Z #1 S2-
export const SAP = [0x81, 0x02] // S1- A- -P
export const TAP = [0x41, 0x02] // T- A- -P

export type FakeLogger = TestLogger & {
  start: ReturnType<typeof vi.fn>
  stroke: ReturnType<typeof vi.fn>
  finish: ReturnType<typeof vi.fn>
}

export function fakeLogger(): FakeLogger {
  return {
    unsaved: 0,
    start: vi.fn(async () => {}),
    stroke: vi.fn(),
    finish: vi.fn(async () => {}),
    onUnsaved: () => () => {},
  } as FakeLogger
}

export const CHAPTERS: ChapterInfo[] = [
  { chapter: 4, pageId: 'ch04', title: 'Chapter 4: The layout', gate: 'stage0', passMark: { accuracy: 0.9, maxMinutes: 10 }, listIds: [] },
  {
    chapter: 5,
    pageId: 'ch05',
    title: 'Chapter 5: First words',
    gate: 'test',
    passMark: { accuracy: 0.9, minWpm: 30 },
    testListId: '5-test',
    listIds: ['5-cvc'],
  },
  { chapter: 6, pageId: 'ch06', title: 'Chapter 6: More words', gate: 'drills', listIds: ['6-fqm'] },
  { chapter: 7, pageId: 'ch07', title: 'Chapter 7: Reading', gate: 'read', listIds: [] },
]

export const INDEX: PracticeIndexEntry[] = [
  { id: '5-cvc', chapter: 5, items: 2 },
  { id: '5-test', chapter: 5, items: 50 },
  { id: '6-fqm', chapter: 6, items: 2 },
]

/** Fifty distinct words, all struck as SAP, so a fake board can run a whole chapter test. */
export const TEST_WORDS = Array.from({ length: 50 }, (_, i) => ({ prompt: `w${String(i).padStart(2, '0')}`, outlines: ['SAP'] }))

export const CONTENT: Record<string, unknown> = {
  '/content/chapters.json': CHAPTERS,
  '/content/practice-index.json': INDEX,
  '/content/practice/5-cvc.json': { id: '5-cvc', items: [{ prompt: 'sap', outlines: ['SAP'] }, { prompt: 'sap', outlines: ['SAP'] }] },
  '/content/practice/5-test.json': { id: '5-test', items: TEST_WORDS },
  '/content/practice/6-fqm.json': { id: '6-fqm', items: [{ prompt: 'sap', outlines: ['SAP'] }, { prompt: 'sap', outlines: ['SAP'] }] },
}

export const passed = (section: string): SectionResult => ({
  section,
  runs: 1,
  passed: true,
  best: { accuracy: 1, wpm: 40 },
  last: { accuracy: 1, wpm: 40, endedAt: 1, passed: true },
  firstPassedAt: 1,
})

/** Stubs fetch for `/content/...`: a reply per URL, an Error to reject, or 'fail' for HTTP 500; anything else is a 404. */
export function stubContent(files: Record<string, unknown>): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async (url: string) => {
    const reply = files[url]
    if (reply instanceof Error) throw reply
    if (reply === undefined || reply === 'fail') return { ok: false, status: reply ? 500 : 404, json: async () => ({}) }
    return { ok: true, status: 200, json: async () => structuredClone(reply) }
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

export type Rig = { device: FakeDevice; stroke(bytes: number[]): void; unmount(): void }

/** Renders `node` with a connected fake board and the real progress provider, once nothing says Loading. */
export async function mountRig(node: ComponentChildren): Promise<Rig> {
  const hid = new FakeHid()
  const device = new FakeDevice()
  hid.known = [device]
  const { unmount } = render(
    <UniProvider hid={hid}>
      <ProgressProvider>{node}</ProgressProvider>
    </UniProvider>,
  )
  await waitFor(() => expect(device.opened).toBe(true))
  await waitFor(() => expect(screen.queryByText(/Board disconnected|Loading/)).toBeNull())
  return {
    device,
    stroke(bytes) {
      act(() => device.report(bytes))
      act(() => device.report([]))
    },
    unmount,
  }
}

/** The text of the drill's progress line, e.g. `3 / 135 · acc 100% · 40 wpm`. */
export const drillStats = (): string => document.querySelector('.drill__stats')?.textContent ?? ''
export const prompt = (): string | null => document.querySelector('.drill__prompt')?.textContent ?? null
