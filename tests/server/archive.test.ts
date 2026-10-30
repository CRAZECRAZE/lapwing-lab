import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { openArchive } from '../../server/archive.ts'
import type { Archive, StrokeRecord } from '../../server/archive.ts'
import { readSettings, writeSettings } from '../../server/settings.ts'

const open: Archive[] = []
function memory(): Archive {
  const a = openArchive(':memory:')
  open.push(a)
  return a
}
afterEach(() => {
  while (open.length) open.pop()?.close()
})

function stroke(testId: number, over: Partial<StrokeRecord> = {}): StrokeRecord {
  return {
    testId,
    tsMs: 100,
    prompt: 'sap',
    expected: ['SAP'],
    pressedLevers: ['S1-', 'A-', 'P-'],
    pressedMask: 7,
    correct: true,
    latencyMs: 420,
    attemptNo: 1,
    ...over,
  }
}

function newTest(a: Archive, over: { mode?: string; section?: string | null } = {}) {
  const sessionId = a.createSession(1000)
  return a.startTest({
    sessionId,
    startedAt: 1001,
    mode: over.mode ?? 'stage0-test',
    chapter: 4,
    section: over.section === undefined ? 'pseudo' : over.section,
    itemCount: 2,
  })
}

describe('archive', () => {
  it('round-trips strokes with levers and correctness intact', () => {
    const a = memory()
    const testId = newTest(a)
    const right = stroke(testId)
    const wrong = stroke(testId, {
      tsMs: 900,
      pressedLevers: ['S1-', 'A-', 'T-'],
      pressedMask: 11,
      correct: false,
      attemptNo: 2,
    })
    a.addStroke(right)
    a.addStroke(wrong)
    expect(a.listStrokes(testId)).toEqual([right, wrong])
    expect(a.listStrokes(testId)[1]?.correct).toBe(false)
  })

  it('lists strokes in insertion order, not timestamp order', () => {
    const a = memory()
    const testId = newTest(a)
    a.addStroke(stroke(testId, { tsMs: 500, prompt: 'first' }))
    a.addStroke(stroke(testId, { tsMs: 100, prompt: 'second' }))
    expect(a.listStrokes(testId).map((s) => s.prompt)).toEqual(['first', 'second'])
  })

  it('finishes a test and finds it with parsed meta', () => {
    const a = memory()
    const testId = newTest(a)
    expect(a.lastTest('stage0-test', 'pseudo')).toBeUndefined()
    a.finishTest(testId, { endedAt: 2000, wpm: 12.5, accuracy: 0.93, meta: { missed: ['SAP'], n: 2 } })
    const row = a.lastTest('stage0-test', 'pseudo')
    expect(row).toMatchObject({
      id: testId,
      endedAt: 2000,
      mode: 'stage0-test',
      chapter: 4,
      section: 'pseudo',
      itemCount: 2,
      wpm: 12.5,
      accuracy: 0.93,
      meta: { missed: ['SAP'], n: 2 },
    })
  })

  it('lastTest returns the most recent finished test for that mode and section', () => {
    const a = memory()
    const older = newTest(a)
    a.finishTest(older, { endedAt: 2000, wpm: 10, accuracy: 0.5, meta: null })
    const newer = newTest(a)
    a.finishTest(newer, { endedAt: 3000, wpm: 11, accuracy: 0.95, meta: null })
    newTest(a) // unfinished, newest id: must be ignored
    const otherSection = newTest(a, { section: 'real' })
    a.finishTest(otherSection, { endedAt: 4000, wpm: 1, accuracy: 0.1, meta: null })
    const otherMode = newTest(a, { mode: 'drill' })
    a.finishTest(otherMode, { endedAt: 5000, wpm: 1, accuracy: 0.1, meta: null })
    expect(a.lastTest('stage0-test', 'pseudo')?.id).toBe(newer)
    expect(a.lastTest('stage0-test', 'real')?.id).toBe(otherSection)
    expect(a.lastTest('stage0-test', 'nope')).toBeUndefined()
  })

  it('lastTest skips abandoned tests', () => {
    const a = memory()
    const done = newTest(a)
    a.finishTest(done, { endedAt: 2000, wpm: 10, accuracy: 0.9, meta: { passed: true } })
    const left = newTest(a)
    a.finishTest(left, { endedAt: 3000, wpm: 55, accuracy: 1, meta: { abandoned: true } })
    expect(a.lastTest('stage0-test', 'pseudo')?.id).toBe(done)
    const onlyLeft = newTest(a, { section: 'real' })
    a.finishTest(onlyLeft, { endedAt: 4000, wpm: 55, accuracy: 1, meta: { kind: 'word', abandoned: true } })
    expect(a.lastTest('stage0-test', 'real')).toBeUndefined()
    expect(a.getTest(onlyLeft)?.test.meta).toEqual({ kind: 'word', abandoned: true }) // still stored and listed
  })

  it('lastTest still counts tests with null metadata, no abandoned key, or abandoned that is not true', () => {
    const a = memory()
    const cases: [string, unknown][] = [
      ['nullmeta', null],
      ['nokey', { missed: [] }],
      ['falseflag', { abandoned: false }],
      ['stringflag', { abandoned: 'true' }],
    ]
    for (const [section, meta] of cases) {
      const id = newTest(a, { section })
      a.finishTest(id, { endedAt: 2000, wpm: 1, accuracy: 1, meta })
      expect(a.lastTest('stage0-test', section)?.id).toBe(id)
    }
  })

  it('stores null chapter and section', () => {
    const a = memory()
    const sessionId = a.createSession(1)
    const id = a.startTest({ sessionId, startedAt: 2, mode: 'free', chapter: null, section: null, itemCount: 0 })
    a.finishTest(id, { endedAt: 3, wpm: 0, accuracy: 0, meta: null })
    expect(a.lastTest('free', 'x')).toBeUndefined()
  })

  it('rejects unknown foreign keys', () => {
    const a = memory()
    expect(() => a.addStroke(stroke(999))).toThrow()
    expect(() =>
      a.startTest({ sessionId: 999, startedAt: 1, mode: 'm', chapter: null, section: null, itemCount: 1 }),
    ).toThrow()
    expect(() => a.finishTest(999, { endedAt: 1, wpm: 1, accuracy: 1, meta: null })).toThrow()
  })

  it('persists to a file and reopens', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lapwing-archive-'))
    try {
      const file = join(dir, 'steno.db')
      const a = openArchive(file)
      const testId = newTest(a)
      a.addStroke(stroke(testId))
      a.close()
      const b = openArchive(file)
      expect(b.listStrokes(testId)).toHaveLength(1)
      b.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('archive write validation', () => {
  const finish = { endedAt: 2000, wpm: 10, accuracy: 0.9, meta: null }

  it('rejects timestamps SQLite could not read back, and the store stays readable', () => {
    const a = memory()
    const testId = newTest(a)
    a.addStroke(stroke(testId))
    a.finishTest(testId, finish)
    const sessionId = a.createSession(1)
    for (const bad of [1e18, 2 ** 53, 1.5, -1, Number.NaN]) {
      expect(() => a.createSession(bad), `createSession ${bad}`).toThrow(RangeError)
      expect(
        () => a.startTest({ sessionId, startedAt: bad, mode: 'm', chapter: null, section: null, itemCount: 1 }),
        `startTest ${bad}`,
      ).toThrow(RangeError)
      expect(() => a.addStroke(stroke(testId, { tsMs: bad })), `addStroke ${bad}`).toThrow(RangeError)
      expect(() => a.finishTest(testId, { ...finish, endedAt: bad }), `finishTest ${bad}`).toThrow(RangeError)
    }
    expect(a.listStrokes(testId)).toHaveLength(1)
    expect(a.lastTest('stage0-test', 'pseudo')?.endedAt).toBe(2000)
  })

  it('accepts the largest safe integer timestamp and reads it back', () => {
    const a = memory()
    const testId = newTest(a)
    a.addStroke(stroke(testId, { tsMs: Number.MAX_SAFE_INTEGER }))
    a.finishTest(testId, { ...finish, endedAt: Number.MAX_SAFE_INTEGER })
    expect(a.listStrokes(testId)[0]?.tsMs).toBe(Number.MAX_SAFE_INTEGER)
    expect(a.lastTest('stage0-test', 'pseudo')?.endedAt).toBe(Number.MAX_SAFE_INTEGER)
  })

  it('rejects bad durations, attempt numbers, rates and counts', () => {
    const a = memory()
    const testId = newTest(a)
    for (const latencyMs of [-1, Number.POSITIVE_INFINITY, Number.NaN, 2 ** 60]) {
      expect(() => a.addStroke(stroke(testId, { latencyMs })), `latency ${latencyMs}`).toThrow(RangeError)
    }
    for (const attemptNo of [0, -1, 1.5, 2 ** 53]) {
      expect(() => a.addStroke(stroke(testId, { attemptNo })), `attempt ${attemptNo}`).toThrow(RangeError)
    }
    for (const wpm of [-1, Number.POSITIVE_INFINITY, Number.NaN]) {
      expect(() => a.finishTest(testId, { ...finish, wpm }), `wpm ${wpm}`).toThrow(RangeError)
    }
    for (const accuracy of [-0.1, 1.01, Number.NaN]) {
      expect(() => a.finishTest(testId, { ...finish, accuracy }), `accuracy ${accuracy}`).toThrow(RangeError)
    }
    const sessionId = a.createSession(1)
    for (const itemCount of [-1, 1.5, 2 ** 53]) {
      expect(
        () => a.startTest({ sessionId, startedAt: 1, mode: 'm', chapter: null, section: null, itemCount }),
        `itemCount ${itemCount}`,
      ).toThrow(RangeError)
    }
    expect(a.listStrokes(testId)).toEqual([])
    a.addStroke(stroke(testId, { latencyMs: 12.5 }))
    expect(a.listStrokes(testId)[0]?.latencyMs).toBe(12.5)
  })
})

describe('archive reads', () => {
  const at = (day: number, h: number, m = 0) => new Date(2026, 9, day, h, m).getTime()

  function testWith(a: Archive, stamps: number[], over: { startedAt?: number } = {}) {
    const sessionId = a.createSession(1000)
    const id = a.startTest({
      sessionId,
      startedAt: over.startedAt ?? stamps[0] ?? 1001,
      mode: 'drill',
      chapter: null,
      section: null,
      itemCount: stamps.length,
    })
    for (const tsMs of stamps) a.addStroke(stroke(id, { tsMs }))
    return id
  }

  it('listTests hides tests that have no strokes', () => {
    const a = memory()
    newTest(a)
    const withStroke = testWith(a, [at(27, 10)])
    expect(a.listTests({ limit: 10 }).map((t) => t.id)).toEqual([withStroke])
  })

  it('listTests is newest first and pages with beforeId', () => {
    const a = memory()
    const ids = [1, 2, 3, 4].map((n) => testWith(a, [at(27, 10, n)]))
    expect(a.listTests({ limit: 2 }).map((t) => t.id)).toEqual([ids[3], ids[2]])
    expect(a.listTests({ limit: 2, beforeId: ids[2] }).map((t) => t.id)).toEqual([ids[1], ids[0]])
    expect(a.listTests({ limit: 2, beforeId: ids[0] })).toEqual([])
  })

  it('listTests includes an unfinished test with its stroke count and null wpm', () => {
    const a = memory()
    const id = testWith(a, [at(27, 10, 0), at(27, 10, 1), at(27, 10, 5)])
    const [row] = a.listTests({ limit: 5 })
    expect(row).toMatchObject({
      id,
      endedAt: null,
      wpm: null,
      accuracy: null,
      strokeCount: 3,
      firstStrokeAt: at(27, 10, 0),
      lastStrokeAt: at(27, 10, 5),
    })
  })

  it('listTests date filter uses the local day of the first stroke', () => {
    const a = memory()
    const id = testWith(a, [at(27, 0, 2), at(27, 0, 3)], { startedAt: at(26, 23, 58) })
    expect(a.listTests({ limit: 10, date: '2026-10-27' }).map((t) => t.id)).toEqual([id])
    expect(a.listTests({ limit: 10, date: '2026-10-26' })).toEqual([])
  })

  it('listTests rejects a limit of 0 and 201', () => {
    const a = memory()
    for (const limit of [0, 201, 1.5, -1, Number.NaN]) {
      expect(() => a.listTests({ limit }), `limit ${limit}`).toThrow(RangeError)
    }
    expect(a.listTests({ limit: 1 })).toEqual([])
    expect(a.listTests({ limit: 200 })).toEqual([])
  })

  it('getTest returns strokes in insertion order, and undefined for an unknown id', () => {
    const a = memory()
    const id = newTest(a)
    a.addStroke(stroke(id, { tsMs: 500, prompt: 'first' }))
    a.addStroke(stroke(id, { tsMs: 100, prompt: 'second' }))
    const found = a.getTest(id)
    expect(found?.test).toMatchObject({ id, mode: 'stage0-test', section: 'pseudo' })
    expect(found?.strokes.map((s) => s.prompt)).toEqual(['first', 'second'])
    expect(a.getTest(999)).toBeUndefined()
  })

  it('dayStats groups by local day, sums, omits empty days, and includes both ends', () => {
    const a = memory()
    testWith(a, [at(25, 9, 0), at(25, 9, 1)])
    testWith(a, [at(26, 9, 0), at(26, 9, 2)])
    testWith(a, [at(26, 18, 0), at(26, 18, 1), at(26, 18, 4)])
    testWith(a, [at(28, 9, 0)])
    testWith(a, [at(29, 9, 0)])
    newTest(a) // no strokes: never counted
    expect(a.dayStats('2026-10-26', '2026-10-28')).toEqual([
      { date: '2026-10-26', tests: 2, strokes: 5, activeMs: 2 * 60000 + 4 * 60000 },
      { date: '2026-10-28', tests: 1, strokes: 1, activeMs: 0 },
    ])
  })

  it('dayStats activeMs is last minus first stroke; a one-stroke test counts as a test with 0 ms', () => {
    const a = memory()
    testWith(a, [at(27, 10, 0), at(27, 10, 0) + 1500, at(27, 10, 0) + 4000])
    testWith(a, [at(27, 11, 0)])
    expect(a.dayStats('2026-10-27', '2026-10-27')).toEqual([
      { date: '2026-10-27', tests: 2, strokes: 4, activeMs: 4000 },
    ])
  })

  it('dayStats puts a test on the local day of its first stroke', () => {
    const a = memory()
    testWith(a, [at(26, 23, 59), at(27, 0, 1)])
    expect(a.dayStats('2026-10-26', '2026-10-27')).toEqual([
      { date: '2026-10-26', tests: 1, strokes: 2, activeMs: 2 * 60000 },
    ])
  })

  it('rejects malformed dates', () => {
    const a = memory()
    expect(() => a.listTests({ limit: 1, date: '27/10/2026' })).toThrow(RangeError)
    expect(() => a.dayStats('2026-10-27', 'tomorrow')).toThrow(RangeError)
  })
})

describe('archive stats reads', () => {
  const at = (day: number, h: number, m = 0, sec = 0) => new Date(2026, 9, day, h, m, sec).getTime()

  type Spec = {
    stamps?: number[]
    mode?: string
    chapter?: number | null
    finish?: { wpm: number; accuracy: number; meta: unknown } | null
    endedAt?: number
    stroke?: Partial<StrokeRecord>
  }

  // One run: strokes at the given times; finish null leaves it unfinished.
  function run(a: Archive, spec: Spec = {}): number {
    const stamps = spec.stamps ?? [at(27, 10)]
    const sessionId = a.createSession(1000)
    const id = a.startTest({
      sessionId,
      startedAt: stamps[0] ?? 1001,
      mode: spec.mode ?? 'free',
      chapter: spec.chapter === undefined ? null : spec.chapter,
      section: null,
      itemCount: stamps.length,
    })
    for (const tsMs of stamps) a.addStroke(stroke(id, { tsMs, ...spec.stroke }))
    const fin = spec.finish === undefined ? { wpm: 10, accuracy: 0.9, meta: null } : spec.finish
    if (fin) a.finishTest(id, { endedAt: spec.endedAt ?? stamps[stamps.length - 1] ?? 2000, ...fin })
    return id
  }

  describe('runsInRange', () => {
    it('is empty for an empty database', () => {
      expect(memory().runsInRange('2026-10-01', '2026-10-31')).toEqual([])
    })

    it('returns the exact row shape for a finished run', () => {
      const a = memory()
      const id = run(a, {
        stamps: [at(27, 10, 0), at(27, 10, 0, 3), at(27, 10, 1)],
        mode: 'section',
        chapter: 5,
        endedAt: at(27, 10, 2),
        finish: { wpm: 30, accuracy: 0.8, meta: { elapsedMs: 120000, firstTryCorrect: 48 } },
      })
      expect(a.runsInRange('2026-10-27', '2026-10-27')).toEqual([
        {
          id,
          date: '2026-10-27',
          mode: 'section',
          chapter: 5,
          endedAt: at(27, 10, 2),
          accuracy: 0.8,
          wpm: 30,
          words: 60,
          abandoned: false,
          timedOut: false,
          strokes: 3,
          activeMs: 60000,
        },
      ])
    })

    it('includes runs inside the range, excludes those outside, both edges inclusive, ordered by id', () => {
      const a = memory()
      const before = run(a, { stamps: [at(24, 23, 59, 59)] })
      const first = run(a, { stamps: [at(25, 0, 0, 0)] })
      const mid = run(a, { stamps: [at(26, 12)] })
      const last = run(a, { stamps: [at(28, 23, 59, 59)] })
      const after = run(a, { stamps: [at(29, 0, 0, 0)] })
      const ids = a.runsInRange('2026-10-25', '2026-10-28').map((r) => r.id)
      expect(ids).toEqual([first, mid, last])
      expect(ids).not.toContain(before)
      expect(ids).not.toContain(after)
      expect(a.runsInRange('2026-10-26', '2026-10-26').map((r) => r.id)).toEqual([mid])
    })

    it('orders by test id even when later runs have earlier strokes', () => {
      const a = memory()
      const x = run(a, { stamps: [at(27, 12)] })
      const y = run(a, { stamps: [at(26, 12)] })
      expect(a.runsInRange('2026-10-26', '2026-10-27').map((r) => r.id)).toEqual([x, y])
    })

    it('puts a run that crosses midnight on the local date of its first stroke', () => {
      const a = memory()
      const id = run(a, { stamps: [at(26, 23, 59), at(27, 0, 1)] })
      expect(a.runsInRange('2026-10-27', '2026-10-27')).toEqual([])
      const [r] = a.runsInRange('2026-10-26', '2026-10-26')
      expect(r).toMatchObject({ id, date: '2026-10-26', strokes: 2, activeMs: 120000 })
    })

    it('includes an unfinished run with null endedAt, wpm and accuracy and 0 words', () => {
      const a = memory()
      const id = run(a, { stamps: [at(27, 10, 0), at(27, 10, 1)], finish: null })
      expect(a.runsInRange('2026-10-27', '2026-10-27')).toEqual([
        {
          id,
          date: '2026-10-27',
          mode: 'free',
          chapter: null,
          endedAt: null,
          accuracy: null,
          wpm: null,
          words: 0,
          abandoned: false,
          timedOut: false,
          strokes: 2,
          activeMs: 60000,
        },
      ])
    })

    it('reports null wpm and accuracy and 0 words for a never-finished run even with stray stored values', () => {
      const dir = mkdtempSync(join(tmpdir(), 'lapwing-stats-'))
      try {
        const file = join(dir, 'steno.db')
        const a = openArchive(file)
        open.push(a)
        const id = run(a, { finish: null })
        const raw = new DatabaseSync(file)
        raw
          .prepare('UPDATE tests SET wpm = 30, accuracy = 0.8, meta_json = ? WHERE id = ?')
          .run('{"elapsedMs":120000,"firstTryCorrect":40}', id)
        raw.close()
        expect(a.runsInRange('2026-10-27', '2026-10-27')[0]).toMatchObject({
          endedAt: null,
          wpm: null,
          accuracy: null,
          words: 0,
        })
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })

    it('leaves out a run with no strokes', () => {
      const a = memory()
      newTest(a)
      expect(a.runsInRange('2000-01-01', '2100-01-01')).toEqual([])
    })

    it('flags a left-early run and a timed-out run, and only for a true flag', () => {
      const a = memory()
      const left = run(a, { finish: { wpm: 5, accuracy: 1, meta: { abandoned: true } } })
      const out = run(a, { finish: { wpm: 20, accuracy: 0.9, meta: { timedOut: true } } })
      const odd = run(a, { finish: { wpm: 5, accuracy: 1, meta: { abandoned: 'true', timedOut: 1 } } })
      const by = Object.fromEntries(a.runsInRange('2026-10-27', '2026-10-27').map((r) => [r.id, r]))
      expect(by[left]).toMatchObject({ abandoned: true, timedOut: false })
      expect(by[out]).toMatchObject({ abandoned: false, timedOut: true })
      expect(by[odd]).toMatchObject({ abandoned: false, timedOut: false })
    })

    it('words from wpm and elapsedMs, rounded', () => {
      const a = memory()
      run(a, { finish: { wpm: 30, accuracy: 0.5, meta: { elapsedMs: 120000, firstTryCorrect: 1 } } })
      run(a, { finish: { wpm: 25, accuracy: 1, meta: { elapsedMs: 70000 } } }) // 29.17
      const words = a.runsInRange('2026-10-27', '2026-10-27').map((r) => r.words)
      expect(words).toEqual([60, 29])
    })

    it('falls back to firstTryCorrect / accuracy without a usable elapsedMs', () => {
      const a = memory()
      run(a, { finish: { wpm: 30, accuracy: 0.8, meta: { firstTryCorrect: 40 } } }) // 50
      run(a, { finish: { wpm: 30, accuracy: 0.8, meta: { elapsedMs: 0, firstTryCorrect: 40 } } })
      run(a, { finish: { wpm: 30, accuracy: 0.8, meta: { elapsedMs: -5, firstTryCorrect: 40 } } })
      run(a, { finish: { wpm: 30, accuracy: 0.8, meta: { elapsedMs: 'soon', firstTryCorrect: 40 } } })
      run(a, { finish: { wpm: 30, accuracy: 0.6, meta: { firstTryCorrect: 10 } } }) // 16.67 -> 17
      expect(a.runsInRange('2026-10-27', '2026-10-27').map((r) => r.words)).toEqual([50, 50, 50, 50, 17])
    })

    it('has 0 words when neither source is usable', () => {
      const a = memory()
      run(a, { finish: { wpm: 30, accuracy: 0.9, meta: null } })
      run(a, { finish: { wpm: 30, accuracy: 0.9, meta: { kind: 'word' } } })
      run(a, { finish: { wpm: 30, accuracy: 0, meta: { firstTryCorrect: 10 } } })
      run(a, { finish: { wpm: 30, accuracy: 0.9, meta: { firstTryCorrect: 'ten' } } })
      run(a, { finish: { wpm: 30, accuracy: 0.9, meta: { firstTryCorrect: -4 } } })
      run(a, { finish: { wpm: 30, accuracy: 0.9, meta: [1, 2] } })
      run(a, { finish: { wpm: 30, accuracy: 0.9, meta: 'text' } })
      expect(a.runsInRange('2026-10-27', '2026-10-27').map((r) => r.words)).toEqual([0, 0, 0, 0, 0, 0, 0])
    })

    it('has 0 words with zero wpm even when elapsedMs is set, and never returns NaN', () => {
      const a = memory()
      run(a, { finish: { wpm: 0, accuracy: 0, meta: { elapsedMs: 60000, firstTryCorrect: 3 } } })
      const [r] = a.runsInRange('2026-10-27', '2026-10-27')
      expect(r?.words).toBe(0)
      expect(r?.wpm).toBe(0)
    })

    it('keeps words for a left-early run, from its own meta', () => {
      const a = memory()
      run(a, { finish: { wpm: 12, accuracy: 1, meta: { abandoned: true, elapsedMs: 300000 } } })
      expect(a.runsInRange('2026-10-27', '2026-10-27')[0]?.words).toBe(60)
    })

    it('treats malformed meta_json as no meta and does not throw', () => {
      const dir = mkdtempSync(join(tmpdir(), 'lapwing-stats-'))
      try {
        const file = join(dir, 'steno.db')
        const a = openArchive(file)
        open.push(a)
        const bad = run(a, { finish: { wpm: 30, accuracy: 0.8, meta: { elapsedMs: 60000 } } })
        const good = run(a, { finish: { wpm: 30, accuracy: 0.8, meta: { elapsedMs: 60000 } } })
        const raw = new DatabaseSync(file)
        raw.prepare('UPDATE tests SET meta_json = ? WHERE id = ?').run('{nope', bad)
        raw.close()
        const rows = a.runsInRange('2026-10-27', '2026-10-27')
        expect(rows.map((r) => [r.id, r.words, r.abandoned, r.timedOut])).toEqual([
          [bad, 0, false, false],
          [good, 30, false, false],
        ])
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })

    it('activeMs is last minus first stroke by time, 0 for one stroke', () => {
      const a = memory()
      run(a, { stamps: [at(27, 10, 0), at(27, 10, 0, 1), at(27, 10, 0, 4)] })
      run(a, { stamps: [at(27, 11)] })
      expect(a.runsInRange('2026-10-27', '2026-10-27').map((r) => [r.strokes, r.activeMs])).toEqual([
        [3, 4000],
        [1, 0],
      ])
    })
  })

  describe('timingsInRange', () => {
    it('is empty for an empty database', () => {
      expect(memory().timingsInRange('2026-10-01', '2026-10-31')).toEqual([])
    })

    it('returns only the four timing fields, ordered by test then stroke', () => {
      const a = memory()
      const x = run(a, {
        stamps: [at(27, 10, 0, 5), at(27, 10, 0, 1), at(27, 10, 0, 9)],
        finish: { wpm: 10, accuracy: 0.9, meta: null },
      })
      const y = run(a, { stamps: [at(26, 9)], stroke: { correct: false, latencyMs: 77 } })
      const rows = a.timingsInRange('2026-10-26', '2026-10-27')
      expect(rows).toEqual([
        { testId: x, tsMs: at(27, 10, 0, 5), correct: true, latencyMs: 420 },
        { testId: x, tsMs: at(27, 10, 0, 1), correct: true, latencyMs: 420 },
        { testId: x, tsMs: at(27, 10, 0, 9), correct: true, latencyMs: 420 },
        { testId: y, tsMs: at(26, 9), correct: false, latencyMs: 77 },
      ])
      expect(Object.keys(rows[0] ?? {}).sort()).toEqual(['correct', 'latencyMs', 'testId', 'tsMs'])
    })

    it('adds expected and pressedMask only to rows of chapter-test runs', () => {
      const a = memory()
      const free = run(a, { stamps: [at(27, 10)], stroke: { expected: ['TKOG'], pressedMask: 5 } })
      const test = run(a, {
        stamps: [at(27, 11), at(27, 11, 0, 1)],
        mode: 'chapter-test',
        stroke: { expected: ['TKOG', 'SAP'], pressedMask: 9 },
      })
      const rows = a.timingsInRange('2026-10-27', '2026-10-27')
      expect(rows.map((r) => r.testId)).toEqual([free, test, test])
      expect(rows[0]).not.toHaveProperty('expected')
      expect(rows[0]?.expected).toBeUndefined()
      expect(rows[0]?.pressedMask).toBeUndefined()
      expect(rows[1]?.expected).toEqual(['TKOG', 'SAP'])
      expect(rows[1]?.pressedMask).toBe(9)
      expect(rows[2]?.expected).toEqual(['TKOG', 'SAP'])
    })

    it('leaves expected out of a chapter-test row whose expected_json is malformed', () => {
      const dir = mkdtempSync(join(tmpdir(), 'lapwing-stats-'))
      try {
        const file = join(dir, 'steno.db')
        const a = openArchive(file)
        open.push(a)
        const t = run(a, { mode: 'chapter-test' })
        const raw = new DatabaseSync(file)
        raw.prepare('UPDATE strokes SET expected_json = ? WHERE test_id = ?').run('{nope', t)
        raw.close()
        const rows = a.timingsInRange('2026-10-27', '2026-10-27')
        expect(rows.map((r) => r.testId)).toEqual([t])
        expect(rows[0]?.expected).toBeUndefined()
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })

    it('leaves out unfinished and left-early runs but keeps timed-out and no-meta runs', () => {
      const a = memory()
      run(a, { finish: null })
      run(a, { finish: { wpm: 5, accuracy: 1, meta: { abandoned: true } } })
      const out = run(a, { finish: { wpm: 20, accuracy: 0.9, meta: { timedOut: true } } })
      const plain = run(a, { finish: { wpm: 20, accuracy: 0.9, meta: null } })
      const odd = run(a, { finish: { wpm: 20, accuracy: 0.9, meta: { abandoned: false } } })
      const str = run(a, { finish: { wpm: 20, accuracy: 0.9, meta: { abandoned: 'true' } } })
      expect(a.timingsInRange('2026-10-27', '2026-10-27').map((r) => r.testId)).toEqual([out, plain, odd, str])
    })

    it('respects the date range by first-stroke date, both edges inclusive', () => {
      const a = memory()
      run(a, { stamps: [at(24, 23, 59, 59)] })
      const first = run(a, { stamps: [at(25, 0, 0, 0)] })
      const crossing = run(a, { stamps: [at(28, 23, 59), at(29, 0, 1)] })
      run(a, { stamps: [at(29, 0, 0, 0)] })
      const rows = a.timingsInRange('2026-10-25', '2026-10-28')
      expect(rows.map((r) => r.testId)).toEqual([first, crossing, crossing])
    })

    it('does not throw on a malformed meta_json and treats it as not abandoned', () => {
      const dir = mkdtempSync(join(tmpdir(), 'lapwing-stats-'))
      try {
        const file = join(dir, 'steno.db')
        const a = openArchive(file)
        open.push(a)
        const bad = run(a)
        const raw = new DatabaseSync(file)
        raw.prepare('UPDATE tests SET meta_json = ? WHERE id = ?').run('{nope', bad)
        raw.close()
        expect(a.timingsInRange('2026-10-27', '2026-10-27').map((r) => r.testId)).toEqual([bad])
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })
  })

  describe('keyRowsInRange', () => {
    it('is empty for an empty database', () => {
      expect(memory().keyRowsInRange('2026-10-01', '2026-10-31')).toEqual([])
    })

    it('groups identical strokes: three identical misses give one row with n 3', () => {
      const a = memory()
      const miss = { correct: false, pressedMask: 11, expected: ['SAP'] }
      run(a, { stamps: [at(27, 10, 0), at(27, 10, 1)], stroke: miss })
      run(a, { stamps: [at(27, 11, 0)], stroke: miss })
      run(a, { stamps: [at(27, 12, 0)] }) // a right stroke with the same expected: a separate row
      expect(a.keyRowsInRange('2026-10-27', '2026-10-27')).toEqual([
        { expected: ['SAP'], pressedMask: 7, correct: true, n: 1 },
        { expected: ['SAP'], pressedMask: 11, correct: false, n: 3 },
      ])
    })

    it('separates by expected, pressed mask and correctness, ordered deterministically', () => {
      const a = memory()
      const id = run(a, { stamps: [at(27, 10)], stroke: { expected: ['TAP'], pressedMask: 5, correct: true } })
      const add = (over: Partial<StrokeRecord>) => a.addStroke(stroke(id, { tsMs: at(27, 10, 1), ...over }))
      add({ expected: ['TAP'], pressedMask: 5, correct: false })
      add({ expected: ['TAP'], pressedMask: 3, correct: true })
      add({ expected: ['SAP', 'SAPS'], pressedMask: 5, correct: true })
      add({ expected: ['SAP', 'SAPS'], pressedMask: 5, correct: true })
      const rows = a.keyRowsInRange('2026-10-27', '2026-10-27')
      expect(rows).toEqual([
        { expected: ['SAP', 'SAPS'], pressedMask: 5, correct: true, n: 2 },
        { expected: ['TAP'], pressedMask: 3, correct: true, n: 1 },
        { expected: ['TAP'], pressedMask: 5, correct: false, n: 1 },
        { expected: ['TAP'], pressedMask: 5, correct: true, n: 1 },
      ])
    })

    it('includes every mode, left-early and unfinished runs, and excludes strokes out of range', () => {
      const a = memory()
      run(a, { mode: 'section', finish: { wpm: 1, accuracy: 1, meta: { abandoned: true } } })
      run(a, { mode: 'stage0', finish: null })
      run(a, { mode: 'chapter-test' })
      run(a, { mode: 'free', finish: { wpm: 1, accuracy: 1, meta: { timedOut: true } } })
      run(a, { stamps: [at(26, 23, 59, 59)] })
      run(a, { stamps: [at(28, 0, 0, 0)] })
      expect(a.keyRowsInRange('2026-10-27', '2026-10-27')).toEqual([
        { expected: ['SAP'], pressedMask: 7, correct: true, n: 4 },
      ])
    })

    it('puts every stroke of a run on the run first-stroke date', () => {
      const a = memory()
      run(a, { stamps: [at(26, 23, 59), at(27, 0, 1)] })
      expect(a.keyRowsInRange('2026-10-27', '2026-10-27')).toEqual([])
      expect(a.keyRowsInRange('2026-10-26', '2026-10-26')).toEqual([
        { expected: ['SAP'], pressedMask: 7, correct: true, n: 2 },
      ])
    })

    it('skips a row whose expected_json is malformed or not a list, and does not throw', () => {
      const dir = mkdtempSync(join(tmpdir(), 'lapwing-stats-'))
      try {
        const file = join(dir, 'steno.db')
        const a = openArchive(file)
        open.push(a)
        run(a, { stamps: [at(27, 10), at(27, 10, 1), at(27, 10, 2)] })
        const raw = new DatabaseSync(file)
        raw.prepare('UPDATE strokes SET expected_json = ? WHERE id = 1').run('[oops')
        raw.prepare('UPDATE strokes SET expected_json = ? WHERE id = 2').run('{"a":1}')
        raw.close()
        expect(a.keyRowsInRange('2026-10-27', '2026-10-27')).toEqual([
          { expected: ['SAP'], pressedMask: 7, correct: true, n: 1 },
        ])
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })
  })

  describe('allTimeStrokes', () => {
    it('is 0 for an empty database', () => {
      expect(memory().allTimeStrokes()).toBe(0)
    })

    it('counts every stroke of every run, whatever its state or date', () => {
      const a = memory()
      run(a, { stamps: [at(27, 10), at(27, 10, 1)] })
      run(a, { stamps: [at(1, 10)], finish: null })
      run(a, { stamps: [at(2, 10), at(2, 10, 1), at(2, 10, 2)], finish: { wpm: 1, accuracy: 1, meta: { abandoned: true } } })
      expect(a.allTimeStrokes()).toBe(6)
    })
  })

  describe('range validation', () => {
    it('throws RangeError for malformed dates in every ranged method', () => {
      const a = memory()
      const calls = [
        (f: string, t: string) => a.runsInRange(f, t),
        (f: string, t: string) => a.timingsInRange(f, t),
        (f: string, t: string) => a.keyRowsInRange(f, t),
      ]
      for (const call of calls) {
        expect(() => call('27/10/2026', '2026-10-28')).toThrow(RangeError)
        expect(() => call('2026-10-27', 'tomorrow')).toThrow(RangeError)
        expect(() => call('2026-10-27', '2026-10-27 ')).toThrow(RangeError)
        expect(() => call('', '')).toThrow(RangeError)
      }
    })

    it('throws RangeError when from is after to, and accepts from equal to to', () => {
      const a = memory()
      expect(() => a.runsInRange('2026-10-28', '2026-10-27')).toThrow(RangeError)
      expect(() => a.timingsInRange('2026-10-28', '2026-10-27')).toThrow(RangeError)
      expect(() => a.keyRowsInRange('2026-10-28', '2026-10-27')).toThrow(RangeError)
      expect(a.runsInRange('2026-10-27', '2026-10-27')).toEqual([])
    })

    it('reads create no rows', () => {
      const a = memory()
      a.runsInRange('2026-10-01', '2026-10-31')
      a.timingsInRange('2026-10-01', '2026-10-31')
      a.keyRowsInRange('2026-10-01', '2026-10-31')
      a.allTimeStrokes()
      expect(a.listTests({ limit: 10 })).toEqual([])
      expect(a.allTimeStrokes()).toBe(0)
    })
  })
})

describe('archive section results', () => {
  type Run = {
    mode?: string
    section?: string | null
    accuracy?: number
    wpm?: number
    endedAt?: number | null
    meta?: unknown
    strokes?: number
  }

  // Records one test; endedAt null leaves it unfinished, strokes 0 leaves it without strokes.
  function run(a: Archive, r: Run = {}): number {
    const id = newTest(a, { mode: r.mode ?? 'drill', section: r.section })
    for (let i = 0; i < (r.strokes ?? 1); i++) a.addStroke(stroke(id, { tsMs: 100 + i }))
    if (r.endedAt !== null) {
      a.finishTest(id, {
        endedAt: r.endedAt ?? 2000,
        wpm: r.wpm ?? 10,
        accuracy: r.accuracy ?? 0.9,
        meta: r.meta ?? null,
      })
    }
    return id
  }

  it('is empty for a mode with no runs', () => {
    expect(memory().sectionResults('drill')).toEqual([])
  })

  it('ignores abandoned, unfinished, stroke-less, null-section and other-mode runs', () => {
    const a = memory()
    run(a, { section: 'a', meta: { abandoned: true, passed: true } })
    run(a, { section: 'b', endedAt: null })
    run(a, { section: 'c', strokes: 0 })
    run(a, { section: null })
    run(a, { section: 'd', mode: 'other' })
    run(a, { section: 'e' })
    expect(a.sectionResults('drill').map((r) => r.section)).toEqual(['e'])
    expect(a.sectionResults('other').map((r) => r.section)).toEqual(['d'])
  })

  it('does not let an abandoned run affect counts, best, last or passed', () => {
    const a = memory()
    run(a, { section: 'a', accuracy: 0.8, wpm: 20, endedAt: 2000 })
    run(a, { section: 'a', accuracy: 1, wpm: 99, endedAt: 3000, meta: { abandoned: true, passed: true } })
    expect(a.sectionResults('drill')).toEqual([
      {
        section: 'a',
        runs: 1,
        passed: false,
        best: { accuracy: 0.8, wpm: 20 },
        last: { accuracy: 0.8, wpm: 20, endedAt: 2000, passed: null },
      },
    ])
  })

  it('passed needs a run with meta.passed true and survives a later failure', () => {
    const a = memory()
    run(a, { section: 'none' })
    run(a, { section: 'nullmeta', meta: { passed: null } })
    run(a, { section: 'string', meta: { passed: 'yes' } })
    run(a, { section: 'failed', meta: { passed: false } })
    run(a, { section: 'kept', endedAt: 2000, meta: { passed: true } })
    run(a, { section: 'kept', endedAt: 3000, meta: { passed: false } })
    const by = Object.fromEntries(a.sectionResults('drill').map((r) => [r.section, r]))
    expect(by.none?.passed).toBe(false)
    expect(by.nullmeta?.passed).toBe(false)
    expect(by.string?.passed).toBe(false)
    expect(by.failed?.passed).toBe(false)
    expect(by.kept?.passed).toBe(true)
    expect(by.kept?.runs).toBe(2)
    expect(by.none?.last?.passed).toBeNull()
    expect(by.nullmeta?.last?.passed).toBeNull()
    expect(by.string?.last?.passed).toBeNull()
    expect(by.failed?.last?.passed).toBe(false)
    expect(by.kept?.last?.passed).toBe(false)
  })

  it('picks best by accuracy then wpm and last by newest end, inserted out of order', () => {
    const a = memory()
    run(a, { section: 'a', accuracy: 0.9, wpm: 30, endedAt: 3000, meta: { passed: true } })
    run(a, { section: 'a', accuracy: 0.95, wpm: 10, endedAt: 1000 })
    run(a, { section: 'a', accuracy: 0.95, wpm: 25, endedAt: 2000 })
    run(a, { section: 'a', accuracy: 0.95, wpm: 25, endedAt: 500 })
    const [r] = a.sectionResults('drill')
    expect(r).toEqual({
      section: 'a',
      runs: 4,
      passed: true,
      best: { accuracy: 0.95, wpm: 25 },
      last: { accuracy: 0.9, wpm: 30, endedAt: 3000, passed: true },
    })
  })

  it('breaks last ties by id and sorts by section', () => {
    const a = memory()
    run(a, { section: 'b', wpm: 11, endedAt: 2000 })
    run(a, { section: 'a', wpm: 12, endedAt: 2000 })
    run(a, { section: 'a', wpm: 13, endedAt: 2000 })
    const res = a.sectionResults('drill')
    expect(res.map((r) => r.section)).toEqual(['a', 'b'])
    expect(res[0]?.last?.wpm).toBe(13)
  })
})

describe('archive progress marks', () => {
  it('starts empty and lists marks ascending by chapter', () => {
    const a = memory()
    expect(a.listMarks()).toEqual([])
    a.setMark(7, 'override', 300)
    a.setMark(2, 'read', 100)
    a.setMark(99, 'read', 200)
    expect(a.listMarks()).toEqual([
      { chapter: 2, kind: 'read', at: 100 },
      { chapter: 7, kind: 'override', at: 300 },
      { chapter: 99, kind: 'read', at: 200 },
    ])
  })

  it('replaces an existing mark and clears one', () => {
    const a = memory()
    a.setMark(3, 'read', 100)
    a.setMark(3, 'override', 200)
    expect(a.listMarks()).toEqual([{ chapter: 3, kind: 'override', at: 200 }])
    a.clearMark(3)
    expect(a.listMarks()).toEqual([])
  })

  it('treats clearing a missing chapter as a no-op', () => {
    const a = memory()
    a.setMark(3, 'read', 100)
    a.clearMark(4)
    expect(a.listMarks()).toEqual([{ chapter: 3, kind: 'read', at: 100 }])
  })

  it('rejects bad chapters, kinds and timestamps and stores nothing', () => {
    const a = memory()
    for (const bad of [0, 100, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => a.setMark(bad, 'read', 1), `setMark ${bad}`).toThrow(RangeError)
      expect(() => a.clearMark(bad), `clearMark ${bad}`).toThrow(RangeError)
    }
    for (const kind of ['', 'Read', 'skip']) {
      expect(() => a.setMark(1, kind as 'read', 1), `kind ${kind}`).toThrow(RangeError)
    }
    for (const at of [-1, 1.5, 2 ** 53, Number.NaN]) {
      expect(() => a.setMark(1, 'read', at), `at ${at}`).toThrow(RangeError)
    }
    expect(a.listMarks()).toEqual([])
  })
})

describe('archive upgrade', () => {
  let dir: string
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('opens a pre-M3 database, keeps its rows and gains the marks table', () => {
    dir = mkdtempSync(join(tmpdir(), 'lapwing-upgrade-'))
    const path = join(dir, 'archive.sqlite')
    const old = new DatabaseSync(path)
    old.exec(`
CREATE TABLE sessions (
  id INTEGER PRIMARY KEY,
  started_at INTEGER NOT NULL,
  ended_at INTEGER
);
CREATE TABLE tests (
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
CREATE TABLE strokes (
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
CREATE INDEX strokes_test ON strokes(test_id, id);
CREATE INDEX tests_lookup ON tests(mode, section, ended_at);
`)
    old.prepare('INSERT INTO sessions (started_at) VALUES (1000)').run()
    old
      .prepare(
        `INSERT INTO tests (session_id, started_at, ended_at, mode, chapter, section, item_count, wpm, accuracy, meta_json)
         VALUES (1, 1001, 2000, 'drill', 4, 'pseudo', 1, 12.5, 1, '{"passed":true}')`,
      )
      .run()
    old
      .prepare(
        `INSERT INTO strokes (test_id, ts_ms, prompt, expected_json, pressed_levers_json,
           pressed_slots_mask, correct, latency_ms, attempt_no) VALUES (1, 1500, 'sap', '["SAP"]', '["S1-","A-","P-"]', 7, 1, 420, 1)`,
      )
      .run()
    old.close()

    const a = openArchive(path)
    open.push(a)
    expect(a.getTest(1)?.test.section).toBe('pseudo')
    expect(a.listStrokes(1)).toHaveLength(1)
    expect(a.sectionResults('drill')).toEqual([
      {
        section: 'pseudo',
        runs: 1,
        passed: true,
        best: { accuracy: 1, wpm: 12.5 },
        last: { accuracy: 1, wpm: 12.5, endedAt: 2000, passed: true },
      },
    ])
    expect(a.listMarks()).toEqual([])
    a.setMark(4, 'read', 3000)
    expect(a.listMarks()).toEqual([{ chapter: 4, kind: 'read', at: 3000 }])
  })
})

describe('settings', () => {
  let dir: string
  function file() {
    dir = mkdtempSync(join(tmpdir(), 'lapwing-settings-'))
    return join(dir, 'settings.json')
  }
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  const DEFAULTS = { boardVisibility: 'always', hints: 'miss' }

  it('returns defaults when the file is missing', () => {
    expect(readSettings(file())).toEqual(DEFAULTS)
  })

  it('returns defaults for corrupt or wrongly shaped files', () => {
    const f = file()
    writeFileSync(f, '{not json')
    expect(readSettings(f)).toEqual(DEFAULTS)
    writeFileSync(f, '{"boardVisibility":"sideways","hints":"sometimes"}')
    expect(readSettings(f)).toEqual(DEFAULTS)
    writeFileSync(f, '[]')
    expect(readSettings(f)).toEqual(DEFAULTS)
  })

  it('reads an old file with only boardVisibility as hints miss', () => {
    const f = file()
    writeFileSync(f, '{"boardVisibility":"hover"}')
    expect(readSettings(f)).toEqual({ boardVisibility: 'hover', hints: 'miss' })
  })

  it('validates each field on its own and falls back per field', () => {
    const f = file()
    writeFileSync(f, '{"boardVisibility":"hover","hints":"nope"}')
    expect(readSettings(f)).toEqual({ boardVisibility: 'hover', hints: 'miss' })
    writeFileSync(f, '{"boardVisibility":"nope","hints":"always"}')
    expect(readSettings(f)).toEqual({ boardVisibility: 'always', hints: 'always' })
    writeFileSync(f, '{"hints":"always"}')
    expect(readSettings(f)).toEqual({ boardVisibility: 'always', hints: 'always' })
  })

  it('merges, persists and leaves no temp files', () => {
    const f = file()
    expect(writeSettings(f, { boardVisibility: 'hover' })).toEqual({ boardVisibility: 'hover', hints: 'miss' })
    expect(readSettings(f)).toEqual({ boardVisibility: 'hover', hints: 'miss' })
    expect(writeSettings(f, {})).toEqual({ boardVisibility: 'hover', hints: 'miss' })
    expect(readdirSync(dir)).toEqual(['settings.json'])
  })

  it('a patch with only hints keeps boardVisibility, and a patch with both sets both', () => {
    const f = file()
    writeSettings(f, { boardVisibility: 'hidden' })
    expect(writeSettings(f, { hints: 'always' })).toEqual({ boardVisibility: 'hidden', hints: 'always' })
    expect(readSettings(f)).toEqual({ boardVisibility: 'hidden', hints: 'always' })
    expect(writeSettings(f, { boardVisibility: 'hover' })).toEqual({ boardVisibility: 'hover', hints: 'always' })
    expect(writeSettings(f, { boardVisibility: 'always', hints: 'miss' })).toEqual(DEFAULTS)
  })

  it('rejects an invalid boardVisibility or hints and leaves the file alone', () => {
    const f = file()
    writeSettings(f, { boardVisibility: 'hidden', hints: 'always' })
    const before = readFileSync(f, 'utf8')
    expect(() => writeSettings(f, { boardVisibility: 'sideways' as never })).toThrow()
    expect(() => writeSettings(f, { hints: 'nope' as never })).toThrow()
    expect(() => writeSettings(f, { boardVisibility: 'hover', hints: 'nope' as never })).toThrow()
    expect(readFileSync(f, 'utf8')).toBe(before)
  })
})
