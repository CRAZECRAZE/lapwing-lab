import { DatabaseSync } from 'node:sqlite'
import type { Lever } from '../src/core/uni.ts'
import type { SlotMask } from '../src/core/steno.ts'

export type StrokeRecord = {
  testId: number
  tsMs: number
  prompt: string
  expected: string[]
  pressedLevers: Lever[]
  pressedMask: SlotMask
  correct: boolean
  latencyMs: number
  attemptNo: number
}

export type TestRow = {
  id: number
  sessionId: number
  startedAt: number
  endedAt: number | null
  mode: string
  chapter: number | null
  section: string | null
  itemCount: number
  wpm: number | null
  accuracy: number | null
  meta: unknown
}

export type TestSummary = TestRow & { strokeCount: number; firstStrokeAt: number; lastStrokeAt: number }

export type DayStat = { date: string; tests: number; strokes: number; activeMs: number }

export type SectionResult = {
  section: string
  runs: number
  passed: boolean
  best: { accuracy: number; wpm: number } | null
  last: { accuracy: number; wpm: number; endedAt: number; passed: boolean | null } | null
}

export type ProgressMark = { chapter: number; kind: 'read' | 'override'; at: number }

export interface Archive {
  createSession(startedAt: number): number
  startTest(t: {
    sessionId: number
    startedAt: number
    mode: string
    chapter: number | null
    section: string | null
    itemCount: number
  }): number
  addStroke(s: StrokeRecord): void
  finishTest(id: number, r: { endedAt: number; wpm: number; accuracy: number; meta: unknown }): void
  lastTest(mode: string, section: string): TestRow | undefined
  listStrokes(testId: number): StrokeRecord[]
  listTests(q: { limit: number; beforeId?: number; date?: string }): TestSummary[]
  getTest(id: number): { test: TestRow; strokes: StrokeRecord[] } | undefined
  dayStats(from: string, to: string): DayStat[]
  sectionResults(mode: string): SectionResult[]
  listMarks(): ProgressMark[]
  setMark(chapter: number, kind: 'read' | 'override', at: number): void
  clearMark(chapter: number): void
  close(): void
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY,
  started_at INTEGER NOT NULL,
  ended_at INTEGER
);
CREATE TABLE IF NOT EXISTS tests (
  id INTEGER PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES sessions(id),
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  mode TEXT NOT NULL,
  chapter INTEGER,
  section TEXT,
  item_count INTEGER NOT NULL,
  wpm REAL,
  accuracy REAL,
  meta_json TEXT
);
CREATE TABLE IF NOT EXISTS strokes (
  id INTEGER PRIMARY KEY,
  test_id INTEGER NOT NULL REFERENCES tests(id),
  ts_ms INTEGER NOT NULL,
  prompt TEXT NOT NULL,
  expected_json TEXT NOT NULL,
  pressed_levers_json TEXT NOT NULL,
  pressed_slots_mask INTEGER NOT NULL,
  correct INTEGER NOT NULL,
  latency_ms INTEGER NOT NULL,
  attempt_no INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS strokes_test ON strokes(test_id, id);
CREATE INDEX IF NOT EXISTS tests_lookup ON tests(mode, section, ended_at);
CREATE TABLE IF NOT EXISTS progress_marks (chapter INTEGER PRIMARY KEY, kind TEXT NOT NULL, at INTEGER NOT NULL);
`

type Row = Record<string, unknown>

// Thrown when a write names a session or test that does not exist.
export class MissingRowError extends Error {}

function missingOnForeignKey<T>(what: string, fn: () => T): T {
  try {
    return fn()
  } catch (err) {
    if (err instanceof Error && /FOREIGN KEY/i.test(err.message)) {
      throw new MissingRowError(`No such ${what}`, { cause: err })
    }
    throw err
  }
}

// The read path cannot represent integers above 2^53, so a bad write would make
// the row (and everything that reads it) throw forever. Reject on the way in.
function timestamp(name: string, v: number): number {
  if (!Number.isSafeInteger(v) || v < 0) throw new RangeError(`${name} must be a non-negative safe integer`)
  return v
}

function count(name: string, v: number, min = 0): number {
  if (!Number.isSafeInteger(v) || v < min) throw new RangeError(`${name} must be an integer >= ${min}`)
  return v
}

function localDate(name: string, v: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new RangeError(`${name} must be a YYYY-MM-DD date`)
  return v
}

function measure(name: string, v: number, max = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isFinite(v) || v < 0 || v > max) throw new RangeError(`${name} must be a finite number between 0 and ${max}`)
  return v
}

function markChapter(v: number): number {
  if (!Number.isSafeInteger(v) || v < 1 || v > 99) throw new RangeError('chapter must be an integer between 1 and 99')
  return v
}

export function openArchive(path: string): Archive {
  const db = new DatabaseSync(path)
  db.exec('PRAGMA foreign_keys = ON')
  db.exec(SCHEMA)

  const insertSession = db.prepare('INSERT INTO sessions (started_at) VALUES (?)')
  const insertTest = db.prepare(
    'INSERT INTO tests (session_id, started_at, mode, chapter, section, item_count) VALUES (?, ?, ?, ?, ?, ?)',
  )
  const insertStroke = db.prepare(
    `INSERT INTO strokes (test_id, ts_ms, prompt, expected_json, pressed_levers_json,
       pressed_slots_mask, correct, latency_ms, attempt_no) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  const updateTest = db.prepare(
    'UPDATE tests SET ended_at = ?, wpm = ?, accuracy = ?, meta_json = ? WHERE id = ?',
  )
  const selectLast = db.prepare(
    `SELECT * FROM tests WHERE mode = ? AND section = ? AND ended_at IS NOT NULL
       AND json_extract(meta_json, '$.abandoned') IS NOT 1
     ORDER BY ended_at DESC, id DESC LIMIT 1`,
  )
  const selectStrokes = db.prepare('SELECT * FROM strokes WHERE test_id = ? ORDER BY id')

  // One row per test that has at least one stroke, with the first and last stroke times.
  const WITH_STROKES = `FROM tests t
     JOIN (SELECT test_id, COUNT(*) AS n, MIN(ts_ms) AS first_ts, MAX(ts_ms) AS last_ts
           FROM strokes GROUP BY test_id) s ON s.test_id = t.id`
  const LOCAL_DAY = "date(s.first_ts / 1000, 'unixepoch', 'localtime')"
  const selectTests = db.prepare(
    `SELECT t.*, s.n AS stroke_count, s.first_ts, s.last_ts
     ${WITH_STROKES}
     WHERE (?1 IS NULL OR t.id < ?1) AND (?2 IS NULL OR ${LOCAL_DAY} = ?2)
     ORDER BY t.id DESC LIMIT ?3`,
  )
  const selectTest = db.prepare('SELECT * FROM tests WHERE id = ?')
  const selectDays = db.prepare(
    `SELECT ${LOCAL_DAY} AS date, COUNT(*) AS tests, SUM(s.n) AS strokes, SUM(s.last_ts - s.first_ts) AS active_ms
     ${WITH_STROKES}
     WHERE ${LOCAL_DAY} BETWEEN ? AND ?
     GROUP BY date ORDER BY date`,
  )

  // Finished, non-abandoned runs with strokes; the gates read these as results.
  const selectRuns = db.prepare(
    `SELECT t.id, t.section, t.accuracy, t.wpm, t.ended_at, json_type(t.meta_json, '$.passed') AS passed
     ${WITH_STROKES}
     WHERE t.mode = ? AND t.section IS NOT NULL AND t.ended_at IS NOT NULL
       AND t.accuracy IS NOT NULL AND t.wpm IS NOT NULL
       AND json_extract(t.meta_json, '$.abandoned') IS NOT 1
     ORDER BY t.section, t.id`,
  )
  const selectMarks = db.prepare('SELECT chapter, kind, at FROM progress_marks ORDER BY chapter')
  const upsertMark = db.prepare(
    `INSERT INTO progress_marks (chapter, kind, at) VALUES (?, ?, ?)
     ON CONFLICT(chapter) DO UPDATE SET kind = excluded.kind, at = excluded.at`,
  )
  const deleteMark = db.prepare('DELETE FROM progress_marks WHERE chapter = ?')

  function toTest(r: Row): TestRow {
    return {
      id: r.id as number,
      sessionId: r.session_id as number,
      startedAt: r.started_at as number,
      endedAt: r.ended_at as number | null,
      mode: r.mode as string,
      chapter: r.chapter as number | null,
      section: r.section as string | null,
      itemCount: r.item_count as number,
      wpm: r.wpm as number | null,
      accuracy: r.accuracy as number | null,
      meta: typeof r.meta_json === 'string' ? JSON.parse(r.meta_json) : null,
    }
  }

  function toStroke(r: Row): StrokeRecord {
    return {
      testId: r.test_id as number,
      tsMs: r.ts_ms as number,
      prompt: r.prompt as string,
      expected: JSON.parse(r.expected_json as string) as string[],
      pressedLevers: JSON.parse(r.pressed_levers_json as string) as Lever[],
      pressedMask: r.pressed_slots_mask as number,
      correct: r.correct === 1,
      latencyMs: r.latency_ms as number,
      attemptNo: r.attempt_no as number,
    }
  }

  return {
    createSession(startedAt) {
      return Number(insertSession.run(timestamp('startedAt', startedAt)).lastInsertRowid)
    },
    startTest(t) {
      timestamp('startedAt', t.startedAt)
      count('itemCount', t.itemCount)
      if (t.chapter !== null) count('chapter', t.chapter)
      return missingOnForeignKey('session', () =>
        Number(insertTest.run(t.sessionId, t.startedAt, t.mode, t.chapter, t.section, t.itemCount).lastInsertRowid),
      )
    },
    addStroke(s) {
      timestamp('tsMs', s.tsMs)
      measure('latencyMs', s.latencyMs)
      count('attemptNo', s.attemptNo, 1)
      count('pressedMask', s.pressedMask)
      missingOnForeignKey('test', () =>
        insertStroke.run(
          s.testId,
          s.tsMs,
          s.prompt,
          JSON.stringify(s.expected),
          JSON.stringify(s.pressedLevers),
          s.pressedMask,
          s.correct ? 1 : 0,
          s.latencyMs,
          s.attemptNo,
        ),
      )
    },
    finishTest(id, r) {
      timestamp('endedAt', r.endedAt)
      measure('wpm', r.wpm)
      measure('accuracy', r.accuracy, 1)
      const res = updateTest.run(r.endedAt, r.wpm, r.accuracy, JSON.stringify(r.meta ?? null), id)
      if (res.changes === 0) throw new MissingRowError(`No test with id ${id}`)
    },
    lastTest(mode, section) {
      const row = selectLast.get(mode, section)
      return row ? toTest(row) : undefined
    },
    listStrokes(testId) {
      return selectStrokes.all(testId).map(toStroke)
    },
    listTests(q) {
      const limit = count('limit', q.limit, 1)
      if (limit > 200) throw new RangeError('limit must be an integer between 1 and 200')
      const beforeId = q.beforeId === undefined ? null : count('beforeId', q.beforeId)
      const date = q.date === undefined ? null : localDate('date', q.date)
      return selectTests.all(beforeId, date, limit).map((r) => ({
        ...toTest(r),
        strokeCount: r.stroke_count as number,
        firstStrokeAt: r.first_ts as number,
        lastStrokeAt: r.last_ts as number,
      }))
    },
    getTest(id) {
      const row = selectTest.get(id)
      return row ? { test: toTest(row), strokes: selectStrokes.all(id).map(toStroke) } : undefined
    },
    dayStats(from, to) {
      return selectDays.all(localDate('from', from), localDate('to', to)).map((r) => ({
        date: r.date as string,
        tests: r.tests as number,
        strokes: r.strokes as number,
        activeMs: r.active_ms as number,
      }))
    },
    sectionResults(mode) {
      const out = new Map<string, { result: SectionResult; bestEndedAt: number }>()
      for (const r of selectRuns.all(mode)) {
        const section = r.section as string
        const accuracy = r.accuracy as number
        const wpm = r.wpm as number
        const endedAt = r.ended_at as number
        const passed = r.passed === 'true' ? true : r.passed === 'false' ? false : null
        let entry = out.get(section)
        if (!entry) {
          entry = { result: { section, runs: 0, passed: false, best: null, last: null }, bestEndedAt: 0 }
          out.set(section, entry)
        }
        const res = entry.result
        res.runs++
        if (passed === true) res.passed = true
        const b = res.best
        if (
          !b ||
          accuracy > b.accuracy ||
          (accuracy === b.accuracy && (wpm > b.wpm || (wpm === b.wpm && endedAt > entry.bestEndedAt)))
        ) {
          res.best = { accuracy, wpm }
          entry.bestEndedAt = endedAt
        }
        // Rows arrive in id order, so >= lets the higher id win an ended_at tie.
        if (!res.last || endedAt >= res.last.endedAt) res.last = { accuracy, wpm, endedAt, passed }
      }
      return [...out.values()].map((e) => e.result)
    },
    listMarks() {
      return selectMarks.all().map((r) => ({
        chapter: r.chapter as number,
        kind: r.kind as 'read' | 'override',
        at: r.at as number,
      }))
    },
    setMark(chapter, kind, at) {
      markChapter(chapter)
      if (kind !== 'read' && kind !== 'override') throw new RangeError("kind must be 'read' or 'override'")
      upsertMark.run(chapter, kind, timestamp('at', at))
    },
    clearMark(chapter) {
      deleteMark.run(markChapter(chapter))
    },
    close() {
      db.close()
    },
  }
}
