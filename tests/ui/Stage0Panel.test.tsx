// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HidDeviceLike, HidLike } from '../../src/hid/uni-link.ts'
import { UniProvider } from '../../src/state/uni-context.tsx'
import { App } from '../../src/ui/App.tsx'
import { Reader } from '../../src/ui/Reader.tsx'
import { Stage0Panel } from '../../src/ui/Stage0Panel.tsx'
import { Stage0Route } from '../../src/ui/Stage0Route.tsx'

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
const TAP = [0x41, 0x02] // T- A- -P

type Json = unknown
type Call = { method: string; url: string; body: unknown }

/** A fake server: `routes` maps "METHOD url" to a reply (or an Error to reject, or 'fail' for HTTP 500). */
function mockServer(routes: Record<string, Json | Error | 'fail'> = {}) {
  const calls: Call[] = []
  let nextId = 1
  const fn = vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
    const method = init?.method ?? 'GET'
    calls.push({ method, url, body: init?.body ? JSON.parse(init.body) : undefined })
    const reply = routes[`${method} ${url}`] ?? routes[url]
    if (reply instanceof Error) throw reply
    if (reply === 'fail') return { ok: false, status: 500, json: async () => ({}) }
    if (reply !== undefined) return { ok: true, status: 200, json: async () => reply }
    if (method === 'POST' && (url === '/api/sessions' || url === '/api/tests')) return { ok: true, status: 200, json: async () => ({ id: nextId++ }) }
    if (method === 'GET' && url.startsWith('/api/tests/last')) return { ok: true, status: 200, json: async () => null }
    if (method === 'GET' && url === '/api/settings') return { ok: true, status: 200, json: async () => ({ boardVisibility: 'always' }) }
    if (method === 'PUT' && url === '/api/settings') return { ok: true, status: 200, json: async () => JSON.parse(init!.body!) }
    if (method === 'POST') return { ok: true, status: 200, json: async () => ({}) }
    return { ok: false, status: 404, json: async () => ({}) }
  })
  vi.stubGlobal('fetch', fn)
  return { fn, calls, count: (method: string, url: string) => calls.filter((c) => c.method === method && c.url === url).length }
}

const lastRow = (over: Record<string, unknown>) => ({
  id: 1, sessionId: 1, startedAt: 1, endedAt: 2, mode: 'stage0', chapter: 4, section: 'x', itemCount: 1,
  wpm: 12.4, accuracy: 0.94, meta: {}, ...over,
})
const lastUrl = (id: string): string => `GET /api/tests/last?mode=stage0&section=${id}`
const pageFile = (id: string, html: string) => ({ id, title: id, html, headings: [], practiceLinks: [] })
const TINY = { test: ['SAP'], extra: [['SAP'], ['SAP']] }

beforeEach(() => {
  history.replaceState(null, '', '/')
  vi.stubGlobal('scrollTo', vi.fn())
  Element.prototype.scrollIntoView = vi.fn()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('Stage0Panel on the Chapter 4 page', () => {
  it('lists the nine drills and shows each last result as quiet text', async () => {
    mockServer({
      [lastUrl('pseudo-test')]: lastRow({ accuracy: 0.94, meta: { elapsedMs: 8 * 60000, passed: true } }),
      [lastUrl('rows-vowels')]: lastRow({ accuracy: 0.94, wpm: 12.4, meta: {} }),
      [lastUrl('pseudo-extra-1')]: lastRow({ accuracy: 0.82, meta: { elapsedMs: 11 * 60000, passed: false } }),
    })
    render(<Stage0Panel />)
    expect(screen.getByRole('heading', { name: 'Practice — Stage 0' })).toBeTruthy()
    const links = screen.getAllByRole('link')
    expect(links).toHaveLength(9) // rendered at once, before any result arrived
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      '/drill/stage0/rows-left-bottom',
      '/drill/stage0/rows-right-bottom',
      '/drill/stage0/rows-left-top',
      '/drill/stage0/rows-right-top',
      '/drill/stage0/rows-vowels',
      '/drill/stage0/rows-star',
      '/drill/stage0/pseudo-test',
      '/drill/stage0/pseudo-extra-1',
      '/drill/stage0/pseudo-extra-2',
    ])
    await screen.findByText('Passed 94% · 8 min')
    const row = (title: RegExp) => screen.getByText(title).closest('a')!
    expect(within(row(/Chapter 4 test — 100 words/)).getByText('Passed 94% · 8 min')).toBeTruthy()
    expect(within(row(/Vowels/)).getByText('94% · 12 wpm')).toBeTruthy()
    // extra lists have no pass mark: plain accuracy and speed, never a verdict
    expect(within(row(/Extra practice 1/)).getByText('82% · 12 wpm')).toBeTruthy()
    expect(within(row(/Extra practice 2/)).getByText('—')).toBeTruthy()
  })

  it('says "Not yet" for a test that missed the mark', async () => {
    mockServer({ [lastUrl('pseudo-test')]: lastRow({ accuracy: 0.82, meta: { elapsedMs: 11 * 60000, passed: false } }) })
    render(<Stage0Panel />)
    expect(await screen.findByText('Not yet · 82% · 11 min')).toBeTruthy()
  })

  it('shows a dash, not an error, when the last-result lookup fails', async () => {
    const server = mockServer({ [lastUrl('pseudo-test')]: new Error('offline'), [lastUrl('rows-star')]: 'fail' })
    render(<Stage0Panel />)
    await waitFor(() => expect(server.count('GET', '/api/tests/last?mode=stage0&section=rows-star')).toBe(1))
    await act(async () => void (await new Promise((r) => setTimeout(r, 20))))
    expect(screen.getAllByText('—')).toHaveLength(9)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('opens the drill route when an entry is chosen', async () => {
    mockServer()
    render(<Stage0Panel />)
    fireEvent.click(screen.getByRole('link', { name: /Vowels/ }))
    expect(location.pathname).toBe('/drill/stage0/rows-vowels')
  })

  it('appears on ch04 only', async () => {
    mockServer({
      '/content/pages/ch04.json': pageFile('ch04', '<h1>Four</h1>'),
      '/content/pages/ch05.json': pageFile('ch05', '<h1>Five</h1>'),
    })
    const { rerender } = render(<Reader id="ch04" />)
    await screen.findByText('Four')
    expect(screen.getByRole('heading', { name: 'Practice — Stage 0' })).toBeTruthy()
    // the panel sits above the chapter text
    expect(document.querySelector('.stage0')!.compareDocumentPosition(document.querySelector('article')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    rerender(<Reader id="ch05" />)
    await screen.findByText('Five')
    expect(screen.queryByText(/Practice — Stage 0/)).toBeNull()
  })
})

type Rig = { device: FakeDevice; server: ReturnType<typeof mockServer>; stroke(bytes: number[]): void }

async function mountRoute(
  id: string,
  routes: Record<string, Json | Error | 'fail'> = { '/content/stage0.json': TINY },
): Promise<Rig> {
  const server = mockServer(routes)
  const hid = new FakeHid()
  const device = new FakeDevice()
  hid.known = [device]
  render(
    <UniProvider hid={hid}>
      <Stage0Route id={id} />
    </UniProvider>,
  )
  await waitFor(() => expect(screen.queryByText(/Board disconnected|Loading/)).toBeNull())
  return {
    device,
    server,
    stroke(bytes) {
      act(() => device.report(bytes))
      act(() => device.report([]))
    },
  }
}

describe('Stage 0 drill route', () => {
  it('runs a drill with the stored board visibility', async () => {
    await mountRoute('pseudo-test', { '/content/stage0.json': TINY, 'GET /api/settings': { boardVisibility: 'hidden' } })
    expect(document.querySelector('.drill__prompt')!.textContent).toBe('SAP')
    await waitFor(() => expect(document.querySelector('.drill__board')).toBeNull())
    expect(screen.getByRole('button', { name: 'hidden' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'always' }).getAttribute('aria-pressed')).toBe('false')
  })

  it('shows the board by default and saves a new visibility choice', async () => {
    const rig = await mountRoute('pseudo-test', { '/content/stage0.json': TINY, 'GET /api/settings': 'fail' })
    expect(document.querySelector('.drill__board')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'hidden' }))
    expect(screen.getByRole('button', { name: 'hidden' }).getAttribute('aria-pressed')).toBe('true')
    expect(document.querySelector('.drill__board')).toBeNull()
    expect(rig.server.calls.filter((c) => c.method === 'PUT')).toEqual([
      { method: 'PUT', url: '/api/settings', body: { boardVisibility: 'hidden' } },
    ])
  })

  it('keeps the choice for this session when saving it fails', async () => {
    await mountRoute('pseudo-test', { '/content/stage0.json': TINY, 'PUT /api/settings': 'fail' })
    fireEvent.click(screen.getByRole('button', { name: 'hover' }))
    await act(async () => void (await new Promise((r) => setTimeout(r, 20))))
    expect(screen.getByRole('button', { name: 'hover' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('logs the run as a stage0 test for chapter 4 and the drill id', async () => {
    const rig = await mountRoute('pseudo-test')
    expect(rig.server.count('POST', '/api/tests')).toBe(0) // nothing is written until the first stroke
    rig.stroke(SAP)
    await waitFor(() => expect(rig.server.count('POST', '/api/tests')).toBe(1))
    expect(rig.server.calls.find((c) => c.url === '/api/tests')!.body).toMatchObject({
      mode: 'stage0', chapter: 4, section: 'pseudo-test', itemCount: 1,
    })
  })

  it('shows Passed with Again and Back when the one-item test is struck right', async () => {
    const rig = await mountRoute('pseudo-test')
    rig.stroke(SAP)
    expect(await screen.findByText('Passed')).toBeTruthy()
    expect(screen.getByText('100%')).toBeTruthy()
    expect(screen.getByText(/wpm/)).toBeTruthy()
    expect(screen.getByText(/^\d+:\d\d$/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Again' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Add a note' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Back to Chapter 4' }))
    expect(location.pathname).toBe('/page/ch04')
  })

  it('shows Not yet when the test was not clean', async () => {
    const rig = await mountRoute('pseudo-test')
    rig.stroke(TAP)
    rig.stroke(SAP)
    expect(await screen.findByText('Not yet')).toBeTruthy()
    expect(screen.getByText('0%')).toBeTruthy()
  })

  it('gives a drill without a pass mark a summary with no verdict', async () => {
    const rig = await mountRoute('pseudo-extra-1')
    rig.stroke(SAP)
    await screen.findByRole('button', { name: 'Again' })
    expect(screen.queryByText('Passed')).toBeNull()
    expect(screen.queryByText('Not yet')).toBeNull()
  })

  it('starts a fresh run, with its own logger, when Again is pressed', async () => {
    const rig = await mountRoute('pseudo-test')
    rig.stroke(SAP)
    fireEvent.click(await screen.findByRole('button', { name: 'Again' }))
    expect(document.querySelector('.drill__prompt')!.textContent).toBe('SAP')
    expect(screen.getByText(/0 \/ 1 · acc —/)).toBeTruthy()
    expect(rig.server.count('POST', '/api/tests')).toBe(1)
    rig.stroke(SAP)
    await screen.findByText('Passed')
    await waitFor(() => expect(rig.server.count('POST', '/api/tests')).toBe(2))
    expect(rig.server.count('POST', '/api/tests')).toBe(2)
  })

  it('runs a row drill without needing the word lists', async () => {
    const rig = await mountRoute('rows-star', { '/content/stage0.json': new Error('down') })
    expect(document.querySelector('.drill__prompt')!.textContent).toBe('*')
    expect(rig.server.calls.some((c) => c.url === '/content/stage0.json')).toBe(false)
    expect(screen.getByText(/0 \/ 5/)).toBeTruthy()
  })

  it('leaves for Chapter 4 on exit', async () => {
    await mountRoute('pseudo-test')
    fireEvent.click(screen.getByRole('button', { name: 'Exit' }))
    expect(location.pathname).toBe('/page/ch04')
  })

  it('gives calm messages for an unknown drill and for word lists that will not load', async () => {
    mockServer({ '/content/stage0.json': 'fail' })
    const { unmount } = render(<Stage0Route id="nope" />)
    expect(screen.getByText(/No such drill/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Back to Chapter 4' })).toBeTruthy()
    unmount()
    render(<Stage0Route id="pseudo-test" />)
    expect(await screen.findByText(/Couldn't load the word lists/)).toBeTruthy()
    fireEvent.click(screen.getByRole('link', { name: 'Back to Chapter 4' }))
    expect(location.pathname).toBe('/page/ch04')
  })

  it('is reached from the app router, and other drill ids are unknown', async () => {
    mockServer({ '/content/book.json': { commit: 'abc', pages: [] } })
    history.replaceState(null, '', '/drill/stage0/rows-star')
    render(<App />)
    expect(await screen.findByRole('region', { name: /The star/ })).toBeTruthy()
    cleanup()
    history.replaceState(null, '', '/drill/other/thing')
    render(<App />)
    expect(await screen.findByText(/No such drill/)).toBeTruthy()
  })
})
