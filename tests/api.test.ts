import { describe, expect, it, vi } from 'vitest'
import {
  HttpStatusError,
  appendJournal,
  createTestLogger,
  deleteMark,
  getDays,
  getFixup,
  getJournal,
  getLastTest,
  getNote,
  getProgress,
  getReport,
  getResults,
  getSettings,
  getStats,
  getTest,
  listJournal,
  listNotes,
  listReports,
  listTests,
  putJournal,
  putMark,
  putNote,
  putReport,
  putSettings,
} from '../src/api.ts'
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

  it('sends strokes to the test that was current when they were logged, even after a second start', async () => {
    let releaseFirst!: () => void
    const gate = new Promise<void>((r) => (releaseFirst = r))
    let tests = 0
    const { calls, fetch } = fakeFetch(async (c) => {
      if (c.url !== '/api/tests') return healthy(c)
      const id = 100 + tests++
      if (id === 100) await gate
      return json({ id })
    })
    const log = createTestLogger(fetch)
    const first = log.start(TEST)
    log.stroke(stroke('A'))
    const second = log.start(TEST)
    log.stroke(stroke('B'))
    releaseFirst()
    await Promise.all([first, second])
    await log.finish({ wpm: 1, accuracy: 1, meta: null })
    const strokes = calls.filter((c) => c.url.endsWith('/strokes'))
    expect(strokes.map((c) => [c.url, (c.body as { prompt: string }).prompt])).toEqual([
      ['/api/tests/100/strokes', 'A'],
      ['/api/tests/101/strokes', 'B'],
    ])
  })

  it.each([
    ['an empty object', {}],
    ['a non-numeric id', { id: 'x' }],
  ])('counts exactly one unsaved write when POST /api/tests answers 200 with %s', async (_name, body) => {
    const { fetch } = fakeFetch((c) => (c.url === '/api/tests' ? json(body) : healthy(c)))
    const log = createTestLogger(fetch)
    await log.start(TEST)
    expect(log.unsaved).toBe(1)
  })

  it('aborts a request that hangs for 5000 ms and counts it as one unsaved write', async () => {
    // Node's AbortSignal.timeout runs on internal timers that fake timers cannot advance, so the
    // test swaps in a signal it controls and checks that the logger asked for 5000 ms.
    const controller = new AbortController()
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal)
    const hanging = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      const signal = init?.signal
      if (!signal) return new Promise<Response>(() => {}) // would hang forever
      return new Promise<Response>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason))
      })
    })
    try {
      const log = createTestLogger(hanging as unknown as typeof fetch)
      const started = log.start(TEST)
      await Promise.resolve()
      expect(timeout).toHaveBeenCalledWith(5000)
      expect(log.unsaved).toBe(0)
      controller.abort(new DOMException('timed out', 'TimeoutError'))
      await expect(started).resolves.toBeUndefined()
      expect(hanging).toHaveBeenCalledTimes(1) // the session request; no test request followed
      expect(log.unsaved).toBe(1)
    } finally {
      timeout.mockRestore()
    }
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

describe('GET timeouts', () => {
  it('getLastTest and getSettings send the 5000 ms timeout signal too', async () => {
    const controller = new AbortController()
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal)
    const seen: (AbortSignal | null | undefined)[] = []
    const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      seen.push(init?.signal)
      return json({ boardVisibility: 'hover' })
    }) as unknown as typeof globalThis.fetch
    try {
      await getLastTest('stage0', 'rows', fetch)
      await getSettings(fetch)
      expect(timeout).toHaveBeenCalledTimes(2)
      expect(timeout).toHaveBeenCalledWith(5000)
      expect(seen).toEqual([controller.signal, controller.signal])
    } finally {
      timeout.mockRestore()
    }
  })
})

describe('settings', () => {
  it('round-trips through GET and PUT', async () => {
    let stored = { boardVisibility: 'always', hints: 'miss', plateauSnoozedUntil: null, reportSeen: null }
    const { calls, fetch } = fakeFetch((c) => {
      if (c.method === 'PUT') stored = { ...stored, ...(c.body as object) }
      return json(stored)
    })
    await expect(getSettings(fetch)).resolves.toEqual({ boardVisibility: 'always', hints: 'miss', plateauSnoozedUntil: null, reportSeen: null })
    await expect(putSettings({ boardVisibility: 'hover' }, fetch)).resolves.toEqual({ boardVisibility: 'hover', hints: 'miss', plateauSnoozedUntil: null, reportSeen: null })
    await expect(getSettings(fetch)).resolves.toEqual({ boardVisibility: 'hover', hints: 'miss', plateauSnoozedUntil: null, reportSeen: null })
    expect(calls[1]).toMatchObject({ method: 'PUT', url: '/api/settings', body: { boardVisibility: 'hover' } })
  })

  it('putSettings sends only the patch', async () => {
    const { calls, fetch } = fakeFetch(() => json({ boardVisibility: 'always', hints: 'always', plateauSnoozedUntil: null, reportSeen: null }))
    await expect(putSettings({ hints: 'always' }, fetch)).resolves.toEqual({ boardVisibility: 'always', hints: 'always', plateauSnoozedUntil: null, reportSeen: null })
    expect(calls[0]).toMatchObject({ method: 'PUT', url: '/api/settings', body: { hints: 'always' } })
  })

  it('getSettings falls back to defaults on failure or a bad body', async () => {
    const defaults = { boardVisibility: 'always', hints: 'miss', plateauSnoozedUntil: null, reportSeen: null }
    await expect(getSettings(fakeFetch(() => new Error('down')).fetch)).resolves.toEqual(defaults)
    await expect(getSettings(fakeFetch(() => json({ error: 'x' }, 500)).fetch)).resolves.toEqual(defaults)
    await expect(getSettings(fakeFetch(() => json(null)).fetch)).resolves.toEqual(defaults)
    await expect(getSettings(fakeFetch(() => json({ boardVisibility: 'nope', hints: 'nope' })).fetch)).resolves.toEqual(defaults)
  })

  it('getSettings falls back per field', async () => {
    await expect(getSettings(fakeFetch(() => json({ boardVisibility: 'hover', hints: 'nope' })).fetch)).resolves.toEqual({
      boardVisibility: 'hover',
      hints: 'miss',
      plateauSnoozedUntil: null,
      reportSeen: null,
    })
    await expect(getSettings(fakeFetch(() => json({ boardVisibility: 'nope', hints: 'always' })).fetch)).resolves.toEqual({
      boardVisibility: 'always',
      hints: 'always',
      plateauSnoozedUntil: null,
      reportSeen: null,
    })
    await expect(getSettings(fakeFetch(() => json({ boardVisibility: 'hidden' })).fetch)).resolves.toEqual({
      boardVisibility: 'hidden',
      hints: 'miss',
      plateauSnoozedUntil: null,
      reportSeen: null,
    })
  })

  it('getSettings passes valid snooze and report values through and falls back per field', async () => {
    const full = { boardVisibility: 'hover', hints: 'always', plateauSnoozedUntil: '2026-11-13', reportSeen: '2026-10' }
    await expect(getSettings(fakeFetch(() => json(full)).fetch)).resolves.toEqual(full)
    for (const bad of ['2026-02-30', '2026-13-01', 'tomorrow', '2026-11', 7, {}, '']) {
      await expect(
        getSettings(fakeFetch(() => json({ ...full, plateauSnoozedUntil: bad })).fetch),
      ).resolves.toEqual({ ...full, plateauSnoozedUntil: null })
    }
    for (const bad of ['2026-13', '2026-00', '2026-1', '2026-10-01', 7, {}, '']) {
      await expect(getSettings(fakeFetch(() => json({ ...full, reportSeen: bad })).fetch)).resolves.toEqual({
        ...full,
        reportSeen: null,
      })
    }
    await expect(
      getSettings(fakeFetch(() => json({ boardVisibility: 'hidden', plateauSnoozedUntil: null, reportSeen: '2026-09' })).fetch),
    ).resolves.toEqual({ boardVisibility: 'hidden', hints: 'miss', plateauSnoozedUntil: null, reportSeen: '2026-09' })
  })

  it('putSettings sends a null patch value to clear a field', async () => {
    const { calls, fetch } = fakeFetch(() => json({ boardVisibility: 'always', hints: 'miss', plateauSnoozedUntil: null, reportSeen: null }))
    await putSettings({ plateauSnoozedUntil: null }, fetch)
    expect(calls[0]).toMatchObject({ method: 'PUT', url: '/api/settings', body: { plateauSnoozedUntil: null } })
  })

  it('putSettings rejects on failure so callers can react', async () => {
    await expect(putSettings({ boardVisibility: 'hidden' }, fakeFetch(() => new Error('down')).fetch)).rejects.toThrow()
    await expect(
      putSettings({ boardVisibility: 'hidden' }, fakeFetch(() => json({ error: 'bad' }, 400)).fetch),
    ).rejects.toThrow(/400/)
  })
})

describe('history and journal calls', () => {
  it('listTests builds the query string and omits absent options', async () => {
    const { calls, fetch } = fakeFetch(() => json([]))
    await expect(listTests(undefined, fetch)).resolves.toEqual([])
    await listTests({}, fetch)
    await listTests({ limit: 20, beforeId: 99, date: '2026-10-27' }, fetch)
    await listTests({ date: '2026-10-27' }, fetch)
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'GET /api/tests',
      'GET /api/tests',
      'GET /api/tests?limit=20&beforeId=99&date=2026-10-27',
      'GET /api/tests?date=2026-10-27',
    ])
  })

  it('listTests rejects on failure', async () => {
    await expect(listTests({}, fakeFetch(() => json({ error: 'x' }, 500)).fetch)).rejects.toThrow(/500/)
    await expect(listTests({}, fakeFetch(() => new Error('down')).fetch)).rejects.toThrow()
  })

  it('getTest fetches one test with its strokes', async () => {
    const payload = { test: { id: 5 }, strokes: [] }
    const { calls, fetch } = fakeFetch(() => json(payload))
    await expect(getTest(5, fetch)).resolves.toEqual(payload)
    expect(calls[0]).toMatchObject({ method: 'GET', url: '/api/tests/5' })
  })

  it('getTest returns null on 404 and rejects on any other failure', async () => {
    await expect(getTest(5, fakeFetch(() => json({ error: 'nope' }, 404)).fetch)).resolves.toBeNull()
    await expect(getTest(5, fakeFetch(() => json({ error: 'x' }, 500)).fetch)).rejects.toThrow(/500/)
    await expect(getTest(5, fakeFetch(() => new Error('down')).fetch)).rejects.toThrow()
  })

  it('getDays sends from and to', async () => {
    const days = [{ date: '2026-10-27', tests: 1, strokes: 2, activeMs: 3 }]
    const { calls, fetch } = fakeFetch(() => json(days))
    await expect(getDays('2026-10-01', '2026-10-31', fetch)).resolves.toEqual(days)
    expect(calls[0]).toMatchObject({ method: 'GET', url: '/api/days?from=2026-10-01&to=2026-10-31' })
  })

  it('getStats sends from, to and mode and returns the response', async () => {
    const stats = { from: '2026-10-01', to: '2026-10-31', mode: 'drills', days: [], keys: [], mixups: [], allTimeStrokes: 0 }
    const { calls, fetch } = fakeFetch(() => json(stats))
    await expect(getStats('2026-10-01', '2026-10-31', 'drills', fetch)).resolves.toEqual(stats)
    expect(calls[0]).toMatchObject({ method: 'GET', url: '/api/stats?from=2026-10-01&to=2026-10-31&mode=drills' })
    await expect(getStats('a', 'b', 'free', fakeFetch(() => json({ error: 'bad' }, 400)).fetch)).rejects.toThrow(/400/)
    await expect(getStats('a', 'b', 'free', fakeFetch(() => new Error('down')).fetch)).rejects.toThrow()
  })

  it('getFixup sends from and to and returns the lists', async () => {
    const lists = { from: '2026-10-01', to: '2026-10-30', words: [], patterns: [] }
    const { calls, fetch } = fakeFetch(() => json(lists))
    await expect(getFixup('2026-10-01', '2026-10-30', fetch)).resolves.toEqual(lists)
    expect(calls[0]).toMatchObject({ method: 'GET', url: '/api/fixup?from=2026-10-01&to=2026-10-30' })
    await expect(getFixup('a', 'b', fakeFetch(() => json({ error: 'bad' }, 400)).fetch)).rejects.toThrow(/400/)
    await expect(getFixup('a', 'b', fakeFetch(() => new Error('down')).fetch)).rejects.toThrow()
  })

  it('listJournal returns the entries', async () => {
    const { calls, fetch } = fakeFetch(() => json([{ date: '2026-10-27', chars: 12 }]))
    await expect(listJournal(fetch)).resolves.toEqual([{ date: '2026-10-27', chars: 12 }])
    expect(calls[0]).toMatchObject({ method: 'GET', url: '/api/journal' })
  })

  it('getJournal returns the text of one day', async () => {
    const { calls, fetch } = fakeFetch(() => json({ date: '2026-10-27', text: 'hello' }))
    await expect(getJournal('2026-10-27', fetch)).resolves.toBe('hello')
    expect(calls[0]).toMatchObject({ method: 'GET', url: '/api/journal/2026-10-27' })
  })

  it('putJournal PUTs the text and appendJournal POSTs to /append', async () => {
    const { calls, fetch } = fakeFetch((c) => json({ date: '2026-10-27', text: String((c.body as { text: string }).text) }))
    await expect(putJournal('2026-10-27', 'a b', fetch)).resolves.toBeUndefined()
    await expect(appendJournal('2026-10-27', 'more', fetch)).resolves.toBeUndefined()
    expect(calls[0]).toMatchObject({ method: 'PUT', url: '/api/journal/2026-10-27', body: { text: 'a b' } })
    expect(calls[1]).toMatchObject({ method: 'POST', url: '/api/journal/2026-10-27/append', body: { text: 'more' } })
  })

  it('encodes journal dates in the path', async () => {
    const { calls, fetch } = fakeFetch(() => json({ date: 'x', text: '' }))
    await getJournal('a/b', fetch)
    expect(calls[0].url).toBe('/api/journal/a%2Fb')
  })

  it('journal writes and reads reject on a non-2xx', async () => {
    const bad = () => fakeFetch(() => json({ error: 'bad' }, 400)).fetch
    await expect(putJournal('2026-10-27', 'x', bad())).rejects.toThrow(/400/)
    await expect(appendJournal('2026-10-27', 'x', bad())).rejects.toThrow(/400/)
    await expect(getJournal('2026-10-27', bad())).rejects.toThrow(/400/)
    await expect(getDays('a', 'b', bad())).rejects.toThrow(/400/)
    await expect(listJournal(bad())).rejects.toThrow(/400/)
  })

  it('request failures are HttpStatusError with a numeric status and the usual message', async () => {
    const err = await putJournal('2026-10-27', 'x', fakeFetch(() => json({ error: 'bad' }, 409)).fetch).catch((e) => e)
    expect(err).toBeInstanceOf(HttpStatusError)
    expect(err.status).toBe(409)
    expect(err.message).toBe('PUT /api/journal/2026-10-27 failed with 409')
  })
})

describe('results and progress calls', () => {
  const result = { section: '5-test', runs: 1, passed: true, best: { accuracy: 0.95, wpm: 12 }, last: null }
  const mark = { chapter: 5, kind: 'override', at: 1000 }

  it('getResults GETs the mode and returns the rows', async () => {
    const { calls, fetch } = fakeFetch(() => json([result]))
    await expect(getResults('chapter-test', fetch)).resolves.toEqual([result])
    expect(calls[0]).toMatchObject({ method: 'GET', url: '/api/results?mode=chapter-test', body: undefined })
  })

  it('getProgress GETs the marks', async () => {
    const { calls, fetch } = fakeFetch(() => json([mark]))
    await expect(getProgress(fetch)).resolves.toEqual([mark])
    expect(calls[0]).toMatchObject({ method: 'GET', url: '/api/progress' })
  })

  it('putMark PUTs the kind and returns the mark', async () => {
    const { calls, fetch } = fakeFetch(() => json(mark))
    await expect(putMark(5, 'override', fetch)).resolves.toEqual(mark)
    expect(calls[0]).toMatchObject({ method: 'PUT', url: '/api/progress/5', body: { kind: 'override' } })
  })

  it('deleteMark sends DELETE with no body', async () => {
    const { calls, fetch } = fakeFetch(() => json({ ok: true }))
    await expect(deleteMark(5, fetch)).resolves.toBeUndefined()
    expect(calls[0]).toEqual({ method: 'DELETE', url: '/api/progress/5', body: undefined })
  })

  it('all four reject on a non-2xx or a failed fetch', async () => {
    const bad = () => fakeFetch(() => json({ error: 'bad' }, 500)).fetch
    const down = () => fakeFetch(() => new Error('down')).fetch
    await expect(getResults('section', bad())).rejects.toThrow(/500/)
    await expect(getProgress(bad())).rejects.toThrow(/500/)
    await expect(putMark(5, 'read', bad())).rejects.toThrow(/500/)
    await expect(deleteMark(5, bad())).rejects.toThrow(/500/)
    await expect(getResults('stage0', down())).rejects.toThrow()
    await expect(getProgress(down())).rejects.toThrow()
    await expect(putMark(5, 'read', down())).rejects.toThrow()
    await expect(deleteMark(5, down())).rejects.toThrow()
  })

  it('listNotes returns the chapters with notes', async () => {
    const { calls, fetch } = fakeFetch(() => json([{ chapter: 5, chars: 12 }]))
    await expect(listNotes(fetch)).resolves.toEqual([{ chapter: 5, chars: 12 }])
    expect(calls[0]).toMatchObject({ method: 'GET', url: '/api/notes' })
  })

  it('getNote returns the text of one chapter', async () => {
    const { calls, fetch } = fakeFetch(() => json({ chapter: 5, text: 'hello' }))
    await expect(getNote(5, fetch)).resolves.toBe('hello')
    expect(calls[0]).toMatchObject({ method: 'GET', url: '/api/notes/5' })
  })

  it('putNote PUTs the text to its chapter', async () => {
    const { calls, fetch } = fakeFetch((c) => json({ chapter: 5, text: String((c.body as { text: string }).text) }))
    await expect(putNote(5, 'a b', fetch)).resolves.toBeUndefined()
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ method: 'PUT', url: '/api/notes/5', body: { text: 'a b' } })
  })

  it('note calls reject on a non-2xx with an HttpStatusError', async () => {
    const bad = () => fakeFetch(() => json({ error: 'bad' }, 400)).fetch
    await expect(listNotes(bad())).rejects.toBeInstanceOf(HttpStatusError)
    await expect(getNote(5, bad())).rejects.toBeInstanceOf(HttpStatusError)
    const err = await putNote(5, 'x', fakeFetch(() => json({ error: 'bad' }, 409)).fetch).catch((e) => e)
    expect(err).toBeInstanceOf(HttpStatusError)
    expect(err.status).toBe(409)
    expect(err.message).toBe('PUT /api/notes/5 failed with 409')
  })

  it('note calls reject a non-integer chapter with a RangeError and make no request', async () => {
    const { calls, fetch } = fakeFetch(() => json({ chapter: 1, text: '' }))
    await expect(putNote(1.5, 'x', fetch)).rejects.toBeInstanceOf(RangeError)
    await expect(getNote(NaN, fetch)).rejects.toBeInstanceOf(RangeError)
    await expect(getNote(Infinity, fetch)).rejects.toBeInstanceOf(RangeError)
    await expect(putNote('5/../6' as unknown as number, 'x', fetch)).rejects.toBeInstanceOf(RangeError)
    expect(calls).toHaveLength(0)
  })

  it('listReports returns the months with notes', async () => {
    const { calls, fetch } = fakeFetch(() => json([{ month: '2026-10', chars: 12 }]))
    await expect(listReports(fetch)).resolves.toEqual([{ month: '2026-10', chars: 12 }])
    expect(calls[0]).toMatchObject({ method: 'GET', url: '/api/reports' })
  })

  it('getReport returns the text of one month', async () => {
    const { calls, fetch } = fakeFetch(() => json({ month: '2026-10', text: 'hello' }))
    await expect(getReport('2026-10', fetch)).resolves.toBe('hello')
    expect(calls[0]).toMatchObject({ method: 'GET', url: '/api/reports/2026-10' })
  })

  it('putReport PUTs the text to its month', async () => {
    const { calls, fetch } = fakeFetch((c) => json({ month: '2026-10', text: String((c.body as { text: string }).text) }))
    await expect(putReport('2026-10', 'a b', fetch)).resolves.toBeUndefined()
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ method: 'PUT', url: '/api/reports/2026-10', body: { text: 'a b' } })
  })

  it('report calls reject on a non-2xx with an HttpStatusError', async () => {
    const bad = () => fakeFetch(() => json({ error: 'bad' }, 400)).fetch
    await expect(listReports(bad())).rejects.toBeInstanceOf(HttpStatusError)
    await expect(getReport('2026-10', bad())).rejects.toBeInstanceOf(HttpStatusError)
    const err = await putReport('2026-10', 'x', fakeFetch(() => json({ error: 'bad' }, 409)).fetch).catch((e) => e)
    expect(err).toBeInstanceOf(HttpStatusError)
    expect(err.status).toBe(409)
    expect(err.message).toBe('PUT /api/reports/2026-10 failed with 409')
  })

  it('report calls reject a non-month with a RangeError and make no request', async () => {
    const { calls, fetch } = fakeFetch(() => json({ month: '2026-10', text: '' }))
    for (const m of ['2026-13', '2026-1', '../x', '2026-10/../..', '']) {
      await expect(putReport(m, 'x', fetch), m).rejects.toBeInstanceOf(RangeError)
      await expect(getReport(m, fetch), m).rejects.toBeInstanceOf(RangeError)
    }
    expect(calls).toHaveLength(0)
  })
})
