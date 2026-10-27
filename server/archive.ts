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
     ORDER BY ended_at DESC, id DESC LIMIT 1`,
  )
  const selectStrokes = db.prepare('SELECT * FROM strokes WHERE test_id = ? ORDER BY id')

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
      return Number(insertSession.run(startedAt).lastInsertRowid)
    },
    startTest(t) {
      return missingOnForeignKey('session', () =>
        Number(insertTest.run(t.sessionId, t.startedAt, t.mode, t.chapter, t.section, t.itemCount).lastInsertRowid),
      )
    },
    addStroke(s) {
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
    close() {
      db.close()
    },
  }
}
