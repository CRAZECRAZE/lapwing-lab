import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
