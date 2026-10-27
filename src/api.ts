// Client for the local archive server. Type-only imports from server/ keep
// node:sqlite and node:fs out of the browser bundle.
import type { StrokeRecord, TestRow } from '../server/archive.ts'
import type { Settings } from '../server/settings.ts'

type FetchFn = typeof fetch

const DEFAULT_SETTINGS: Settings = { boardVisibility: 'always' }

// Resolved lazily so tests (and browsers) never see a detached `fetch`.
const defaultFetch: FetchFn = (input, init) => fetch(input, init)

// Sends one JSON request and returns the parsed body; throws on a rejected
// fetch, a non-2xx status or an unreadable body.
async function request(fetchFn: FetchFn, method: string, url: string, body?: unknown): Promise<unknown> {
  const res = await fetchFn(
    url,
    body === undefined
      ? { method }
      : { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
  )
  if (!res.ok) throw new Error(`${method} ${url} failed with ${res.status}`)
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

// Falls back to the defaults when the server is unreachable or answers nonsense.
export async function getSettings(fetchFn: FetchFn = defaultFetch): Promise<Settings> {
  try {
    const s = (await request(fetchFn, 'GET', '/api/settings')) as Partial<Settings> | null
    const v = s?.boardVisibility
    if (v === 'always' || v === 'hover' || v === 'hidden') return { boardVisibility: v }
  } catch {
    // fall through to defaults
  }
  return { ...DEFAULT_SETTINGS }
}

// Unlike the other calls this REJECTS on failure: the caller changed a setting
// and needs to know it was not stored.
export async function putSettings(patch: Partial<Settings>, fetchFn: FetchFn = defaultFetch): Promise<Settings> {
  const s = (await request(fetchFn, 'PUT', '/api/settings', patch)) as Settings
  return s
}
