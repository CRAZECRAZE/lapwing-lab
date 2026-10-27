// Client for the local archive server. Type-only imports from server/ keep
// node:sqlite and node:fs out of the browser bundle.
import type { DayStat, StrokeRecord, TestRow, TestSummary } from '../server/archive.ts'
import type { Settings } from '../server/settings.ts'

type FetchFn = typeof fetch

const DEFAULT_SETTINGS: Settings = { boardVisibility: 'always', hints: 'miss' }

// Resolved lazily so tests (and browsers) never see a detached `fetch`.
const defaultFetch: FetchFn = (input, init) => fetch(input, init)

const REQUEST_TIMEOUT_MS = 5000

export class HttpStatusError extends Error {
  readonly status: number

  constructor(method: string, url: string, status: number) {
    super(`${method} ${url} failed with ${status}`)
    this.name = 'HttpStatusError'
    this.status = status
  }
}

// Sends one JSON request and returns the parsed body; throws on a rejected
// fetch, a timeout, a non-2xx status (HttpStatusError) or an unreadable body.
async function request(fetchFn: FetchFn, method: string, url: string, body?: unknown): Promise<unknown> {
  const signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  const res = await fetchFn(
    url,
    body === undefined
      ? { method, signal }
      : { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal },
  )
  if (!res.ok) throw new HttpStatusError(method, url, res.status)
  return res.json()
}

function readId(value: unknown): number {
  const id = (value as { id?: unknown } | null)?.id
  if (typeof id !== 'number' || !Number.isSafeInteger(id)) throw new Error('Server returned no id')
  return id
}

export interface TestLogger {
  /** Number of writes that failed (or could not be attempted) so far. */
  readonly unsaved: number
  /** Starts a new test. Never rejects; a failure is counted as one unsaved write. */
  start(t: { mode: string; chapter: number | null; section: string | null; itemCount: number }): Promise<void>
  /** Fire-and-forget. Never throws; strokes are sent one at a time, in call order. */
  stroke(s: Omit<StrokeRecord, 'testId'>): void
  /** Waits for pending stroke writes, then closes the test. Never rejects; sends at most once per start. */
  finish(r: { wpm: number; accuracy: number; meta: unknown }): Promise<void>
  /** Calls `cb` with the new total after every failed write. Returns an unsubscribe function. */
  onUnsaved(cb: (n: number) => void): () => void
}

export function createTestLogger(fetchFn: FetchFn = defaultFetch): TestLogger {
  let unsaved = 0
  const listeners = new Set<(n: number) => void>()
  let sessionId: Promise<number> | null = null
  // Resolves to the current test's id, or null when it could not be created.
  let testId: Promise<number | null> | null = null
  let finished = false
  // Every stroke write is appended here, so order is kept and writes never overlap.
  // Links never reject.
  let writes: Promise<void> = Promise.resolve()

  function fail() {
    unsaved++
    for (const cb of [...listeners]) {
      try {
        cb(unsaved)
      } catch {
        // a broken listener must not break the logger
      }
    }
  }

  async function write(url: string, body: unknown): Promise<void> {
    try {
      await request(fetchFn, 'POST', url, body)
    } catch {
      fail()
    }
  }

  async function create(t: { mode: string; chapter: number | null; section: string | null; itemCount: number }) {
    try {
      sessionId ??= request(fetchFn, 'POST', '/api/sessions', { startedAt: Date.now() }).then(readId)
      const session = sessionId
      let sid: number
      try {
        sid = await session
      } catch (err) {
        if (sessionId === session) sessionId = null // retry on the next start
        throw err
      }
      return readId(await request(fetchFn, 'POST', '/api/tests', { sessionId: sid, startedAt: Date.now(), ...t }))
    } catch {
      fail()
      return null
    }
  }

  return {
    get unsaved() {
      return unsaved
    },

    async start(t) {
      finished = false
      const created = create(t)
      testId = created
      await created
    },

    stroke(s) {
      const test = testId
      if (!test) {
        fail()
        return
      }
      writes = writes.then(async () => {
        const id = await test
        if (id === null) fail()
        else await write(`/api/tests/${id}/strokes`, s)
      })
    },

    async finish(r) {
      const test = testId
      if (test && finished) return
      finished = true
      if (!test) {
        fail()
        return
      }
      await writes
      const id = await test
      if (id === null) fail()
      else await write(`/api/tests/${id}/finish`, { endedAt: Date.now(), ...r })
    },

    onUnsaved(cb) {
      listeners.add(cb)
      return () => {
        listeners.delete(cb)
      }
    },
  }
}

export async function getLastTest(mode: string, section: string, fetchFn: FetchFn = defaultFetch): Promise<TestRow | null> {
  try {
    const row = await request(
      fetchFn,
      'GET',
      `/api/tests/last?mode=${encodeURIComponent(mode)}&section=${encodeURIComponent(section)}`,
    )
    return (row as TestRow | null) ?? null
  } catch {
    return null
  }
}

// Falls back to the defaults when the server is unreachable or answers nonsense, one field at a time.
export async function getSettings(fetchFn: FetchFn = defaultFetch): Promise<Settings> {
  const settings = { ...DEFAULT_SETTINGS }
  try {
    const s = (await request(fetchFn, 'GET', '/api/settings')) as Partial<Settings> | null
    const v = s?.boardVisibility
    if (v === 'always' || v === 'hover' || v === 'hidden') settings.boardVisibility = v
    const h = s?.hints
    if (h === 'miss' || h === 'always') settings.hints = h
  } catch {
    // keep the defaults
  }
  return settings
}

// Unlike the other calls this REJECTS on failure: the caller changed a setting
// and needs to know it was not stored.
export async function putSettings(patch: Partial<Settings>, fetchFn: FetchFn = defaultFetch): Promise<Settings> {
  const s = (await request(fetchFn, 'PUT', '/api/settings', patch)) as Settings
  return s
}

// The calls below REJECT on failure so views can show an error line.

export async function listTests(
  q: { limit?: number; beforeId?: number; date?: string } = {},
  fetchFn: FetchFn = defaultFetch,
): Promise<TestSummary[]> {
  const params = new URLSearchParams()
  if (q.limit !== undefined) params.set('limit', String(q.limit))
  if (q.beforeId !== undefined) params.set('beforeId', String(q.beforeId))
  if (q.date !== undefined) params.set('date', q.date)
  const qs = params.toString()
  return (await request(fetchFn, 'GET', qs ? `/api/tests?${qs}` : '/api/tests')) as TestSummary[]
}

// null when the test does not exist (404); any other failure rejects.
export async function getTest(
  id: number,
  fetchFn: FetchFn = defaultFetch,
): Promise<{ test: TestRow; strokes: StrokeRecord[] } | null> {
  try {
    return (await request(fetchFn, 'GET', `/api/tests/${encodeURIComponent(String(id))}`)) as {
      test: TestRow
      strokes: StrokeRecord[]
    }
  } catch (err) {
    if (err instanceof HttpStatusError && err.status === 404) return null
    throw err
  }
}

export async function getDays(from: string, to: string, fetchFn: FetchFn = defaultFetch): Promise<DayStat[]> {
  const params = new URLSearchParams({ from, to })
  return (await request(fetchFn, 'GET', `/api/days?${params}`)) as DayStat[]
}

export async function listJournal(fetchFn: FetchFn = defaultFetch): Promise<{ date: string; chars: number }[]> {
  return (await request(fetchFn, 'GET', '/api/journal')) as { date: string; chars: number }[]
}

export async function getJournal(date: string, fetchFn: FetchFn = defaultFetch): Promise<string> {
  const entry = (await request(fetchFn, 'GET', `/api/journal/${encodeURIComponent(date)}`)) as { text: string }
  return entry.text
}

export async function putJournal(date: string, text: string, fetchFn: FetchFn = defaultFetch): Promise<void> {
  await request(fetchFn, 'PUT', `/api/journal/${encodeURIComponent(date)}`, { text })
}

export async function appendJournal(date: string, text: string, fetchFn: FetchFn = defaultFetch): Promise<void> {
  await request(fetchFn, 'POST', `/api/journal/${encodeURIComponent(date)}/append`, { text })
}
