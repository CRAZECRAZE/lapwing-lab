import { describe, expect, it, vi } from 'vitest'
import { createTestLogger, getLastTest, getSettings, putSettings } from '../src/api.ts'
import type { StrokeRecord, TestRow } from '../server/archive.ts'

type Call = { url: string; method: string; body: unknown }
type Reply = Response | Error

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
}

// A fake fetch that records every call and answers from `reply`.
function fakeFetch(reply: (call: Call) => Reply | Promise<Reply>) {
  const calls: Call[] = []
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const call: Call = {
      url: String(input),
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    }
    calls.push(call)
    const r = await reply(call)
    if (r instanceof Error) throw r
    return r
  })
  return { calls, fetch: fn as unknown as typeof fetch }
}

// Healthy server: sessions -> id 7, tests -> id 42, everything else -> ok.
function healthy(call: Call): Reply {
  if (call.url === '/api/sessions') return json({ id: 7 })
  if (call.url === '/api/tests') return json({ id: 42 })
  return json({ ok: true })
}

const TEST = { mode: 'stage0', chapter: 4, section: 'rows-left-bottom', itemCount: 3 }

function stroke(prompt: string, extra: Partial<Omit<StrokeRecord, 'testId'>> = {}): Omit<StrokeRecord, 'testId'> {
  return {
    tsMs: 100,
    prompt,
    expected: [prompt],
    pressedLevers: [],
    pressedMask: 5,
    correct: true,
    latencyMs: 250,
    attemptNo: 1,
    ...extra,
  }
}

describe('createTestLogger', () => {
  it('runs session, test, strokes in order, then finish', async () => {
    const { calls, fetch } = fakeFetch(healthy)
    const log = createTestLogger(fetch)
    await log.start(TEST)
    log.stroke(stroke('KAT'))
    log.stroke(stroke('TAP', { attemptNo: 2 }))
    await log.finish({ wpm: 12.5, accuracy: 0.9, meta: { note: 'x' } })

    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'POST /api/sessions',
      'POST /api/tests',
      'POST /api/tests/42/strokes',
      'POST /api/tests/42/strokes',
      'POST /api/tests/42/finish',
    ])
    expect(calls[0].body).toEqual({ startedAt: expect.any(Number) })
    expect(calls[1].body).toEqual({ sessionId: 7, startedAt: expect.any(Number), ...TEST })
    expect(calls[2].body).toMatchObject({ prompt: 'KAT', attemptNo: 1 })
    expect(calls[3].body).toMatchObject({ prompt: 'TAP', attemptNo: 2 })
    expect(calls[4].body).toEqual({ endedAt: expect.any(Number), wpm: 12.5, accuracy: 0.9, meta: { note: 'x' } })
    expect(log.unsaved).toBe(0)
  })

  it('never throws and counts every failed write when all requests reject', async () => {
    const { calls, fetch } = fakeFetch(() => new Error('connection refused'))
    const log = createTestLogger(fetch)
    await expect(log.start(TEST)).resolves.toBeUndefined()
    expect(() => {
      log.stroke(stroke('KAT'))
      log.stroke(stroke('TAP'))
    }).not.toThrow()
    await expect(log.finish({ wpm: 1, accuracy: 1, meta: null })).resolves.toBeUndefined()
    // start (1) + two strokes + finish
    expect(log.unsaved).toBe(4)
    expect(calls).toHaveLength(1) // only the session request was attempted
  })

  it('counts failures when the test exists but stroke and finish writes reject', async () => {
    const { fetch } = fakeFetch((c) => (c.url.startsWith('/api/tests/') ? new Error('boom') : healthy(c)))
    const log = createTestLogger(fetch)
    await log.start(TEST)
    log.stroke(stroke('KAT'))
    log.stroke(stroke('TAP'))
    await expect(log.finish({ wpm: 1, accuracy: 1, meta: null })).resolves.toBeUndefined()
    expect(log.unsaved).toBe(3)
  })

  it('counts a non-2xx response as unsaved', async () => {
    const { fetch } = fakeFetch((c) => (c.url.endsWith('/strokes') ? json({ error: 'nope' }, 400) : healthy(c)))
    const log = createTestLogger(fetch)
    await log.start(TEST)
    log.stroke(stroke('KAT'))
    await log.finish({ wpm: 1, accuracy: 1, meta: null })
    expect(log.unsaved).toBe(1)
  })

  it('treats an unreadable success body from start as a failed start', async () => {
    const { fetch } = fakeFetch(() => new Response('not json', { status: 200 }))
    const log = createTestLogger(fetch)
    await log.start(TEST)
    expect(log.unsaved).toBe(1)
  })

  it('notifies onUnsaved with each new count and stops after unsubscribe', async () => {
    const { fetch } = fakeFetch(() => new Error('down'))
    const log = createTestLogger(fetch)
    const seen: number[] = []
    const off = log.onUnsaved((n) => seen.push(n))
    await log.start(TEST)
    log.stroke(stroke('KAT'))
    await log.finish({ wpm: 1, accuracy: 1, meta: null })
    expect(seen).toEqual([1, 2, 3])
    off()
    log.stroke(stroke('TAP'))
    await new Promise((r) => setTimeout(r, 0))
    expect(log.unsaved).toBe(4)
    expect(seen).toEqual([1, 2, 3])
  })

  it('keeps working when an onUnsaved listener throws', async () => {
    const { fetch } = fakeFetch(() => new Error('down'))
    const log = createTestLogger(fetch)
    const seen: number[] = []
    log.onUnsaved(() => {
      throw new Error('bad listener')
    })
    log.onUnsaved((n) => seen.push(n))
    await log.start(TEST)
    log.stroke(stroke('KAT'))
    await log.finish({ wpm: 1, accuracy: 1, meta: null })
    expect(seen).toEqual([1, 2, 3])
  })

  it('delivers strokes queued before start resolves, in order, after the test id is known', async () => {
    let releaseTest!: () => void
    const gate = new Promise<void>((r) => (releaseTest = r))
    const { calls, fetch } = fakeFetch(async (c) => {
      if (c.url === '/api/tests') await gate
      return healthy(c)
    })
    const log = createTestLogger(fetch)
    const started = log.start(TEST)
    log.stroke(stroke('A'))
    log.stroke(stroke('B'))
    log.stroke(stroke('C'))
    await Promise.resolve()
    expect(calls.some((c) => c.url.includes('/strokes'))).toBe(false)
    releaseTest()
    await started
    await log.finish({ wpm: 1, accuracy: 1, meta: null })
    const strokes = calls.filter((c) => c.url === '/api/tests/42/strokes')
    expect(strokes.map((c) => (c.body as { prompt: string }).prompt)).toEqual(['A', 'B', 'C'])
    expect(calls[calls.length - 1].url).toBe('/api/tests/42/finish')
  })

  it('sends stroke writes one at a time', async () => {
    let inFlight = 0
    let peak = 0
    const { fetch } = fakeFetch(async (c) => {
      if (c.url.endsWith('/strokes')) {
        inFlight++
        peak = Math.max(peak, inFlight)
        await new Promise((r) => setTimeout(r, 2))
        inFlight--
      }
      return healthy(c)
    })
    const log = createTestLogger(fetch)
    await log.start(TEST)
    for (let i = 0; i < 5; i++) log.stroke(stroke(`S${i}`))
    await log.finish({ wpm: 1, accuracy: 1, meta: null })
    expect(peak).toBe(1)
  })

  it('counts strokes and finish as unsaved with no network calls once start failed', async () => {
    const { calls, fetch } = fakeFetch((c) => (c.url === '/api/tests' ? json({ error: 'x' }, 500) : healthy(c)))
    const log = createTestLogger(fetch)
    await log.start(TEST)
    expect(log.unsaved).toBe(1)
    const before = calls.length
    log.stroke(stroke('KAT'))
    log.stroke(stroke('TAP'))
    await log.finish({ wpm: 1, accuracy: 1, meta: null })
    expect(calls).toHaveLength(before)
    expect(log.unsaved).toBe(4)
  })

  it('drops and counts strokes when start was never called', async () => {
    const { calls, fetch } = fakeFetch(healthy)
    const log = createTestLogger(fetch)
    log.stroke(stroke('KAT'))
    await log.finish({ wpm: 1, accuracy: 1, meta: null })
    expect(calls).toHaveLength(0)
    expect(log.unsaved).toBe(2)
  })

  it('a second start begins a new test on the same session', async () => {
    let tests = 0
    const { calls, fetch } = fakeFetch((c) => (c.url === '/api/tests' ? json({ id: 100 + tests++ }) : healthy(c)))
    const log = createTestLogger(fetch)
    await log.start(TEST)
    log.stroke(stroke('A'))
    await log.finish({ wpm: 1, accuracy: 1, meta: null })
    await log.start(TEST)
    log.stroke(stroke('B'))
    await log.finish({ wpm: 2, accuracy: 1, meta: null })
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'POST /api/sessions',
      'POST /api/tests',
      'POST /api/tests/100/strokes',
      'POST /api/tests/100/finish',
      'POST /api/tests',
      'POST /api/tests/101/strokes',
      'POST /api/tests/101/finish',
    ])
    expect(calls[4].body).toMatchObject({ sessionId: 7 })
  })

  it('sends finish only once', async () => {
    const { calls, fetch } = fakeFetch(healthy)
    const log = createTestLogger(fetch)
    await log.start(TEST)
    await log.finish({ wpm: 1, accuracy: 1, meta: null })
    await log.finish({ wpm: 1, accuracy: 1, meta: null })
    expect(calls.filter((c) => c.url.endsWith('/finish'))).toHaveLength(1)
    expect(log.unsaved).toBe(0)
  })

  it('retries session creation on the next start after it failed', async () => {
    let up = false
    const { fetch } = fakeFetch((c) => (up ? healthy(c) : new Error('down')))
    const log = createTestLogger(fetch)
    await log.start(TEST)
    expect(log.unsaved).toBe(1)
    up = true
    await log.start(TEST)
    log.stroke(stroke('A'))
    await log.finish({ wpm: 1, accuracy: 1, meta: null })
    expect(log.unsaved).toBe(1)
  })
})

describe('getLastTest', () => {
  const row: TestRow = {
    id: 3,
    sessionId: 1,
    startedAt: 1,
    endedAt: 2,
    mode: 'stage0',
    chapter: 4,
    section: 'rows-left-bottom',
    itemCount: 3,
    wpm: 10,
    accuracy: 0.9,
    meta: null,
  }

  it('requests the encoded URL and returns the row', async () => {
    const { calls, fetch } = fakeFetch(() => json(row))
    await expect(getLastTest('stage0', 'rows-left-bottom', fetch)).resolves.toEqual(row)
    expect(calls[0]).toMatchObject({ method: 'GET', url: '/api/tests/last?mode=stage0&section=rows-left-bottom' })
  })

  it('encodes query parameters', async () => {
    const { calls, fetch } = fakeFetch(() => json(null))
    await expect(getLastTest('a&b', 'x y/z', fetch)).resolves.toBeNull()
    expect(calls[0].url).toBe('/api/tests/last?mode=a%26b&section=x%20y%2Fz')
  })

  it('returns null on a rejected fetch or non-2xx', async () => {
    await expect(getLastTest('m', 's', fakeFetch(() => new Error('down')).fetch)).resolves.toBeNull()
    await expect(getLastTest('m', 's', fakeFetch(() => json({ error: 'x' }, 500)).fetch)).resolves.toBeNull()
  })
})

describe('settings', () => {
  it('round-trips through GET and PUT', async () => {
    let stored = { boardVisibility: 'always' }
    const { calls, fetch } = fakeFetch((c) => {
      if (c.method === 'PUT') stored = { ...stored, ...(c.body as object) }
      return json(stored)
    })
    await expect(getSettings(fetch)).resolves.toEqual({ boardVisibility: 'always' })
    await expect(putSettings({ boardVisibility: 'hover' }, fetch)).resolves.toEqual({ boardVisibility: 'hover' })
    await expect(getSettings(fetch)).resolves.toEqual({ boardVisibility: 'hover' })
    expect(calls[1]).toMatchObject({ method: 'PUT', url: '/api/settings', body: { boardVisibility: 'hover' } })
  })

  it('getSettings falls back to defaults on failure or a bad body', async () => {
    const defaults = { boardVisibility: 'always' }
    await expect(getSettings(fakeFetch(() => new Error('down')).fetch)).resolves.toEqual(defaults)
    await expect(getSettings(fakeFetch(() => json({ error: 'x' }, 500)).fetch)).resolves.toEqual(defaults)
    await expect(getSettings(fakeFetch(() => json({ boardVisibility: 'nope' })).fetch)).resolves.toEqual(defaults)
  })

  it('putSettings rejects on failure so callers can react', async () => {
    await expect(putSettings({ boardVisibility: 'hidden' }, fakeFetch(() => new Error('down')).fetch)).rejects.toThrow()
    await expect(
      putSettings({ boardVisibility: 'hidden' }, fakeFetch(() => json({ error: 'bad' }, 400)).fetch),
    ).rejects.toThrow(/400/)
  })
})
