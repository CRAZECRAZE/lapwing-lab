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

describe('settings', () => {
  let dir: string
  function file() {
    dir = mkdtempSync(join(tmpdir(), 'lapwing-settings-'))
    return join(dir, 'settings.json')
  }
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('returns defaults when the file is missing', () => {
    expect(readSettings(file())).toEqual({ boardVisibility: 'always' })
  })

  it('returns defaults for corrupt or wrongly shaped files', () => {
    const f = file()
    writeFileSync(f, '{not json')
    expect(readSettings(f)).toEqual({ boardVisibility: 'always' })
    writeFileSync(f, '{"boardVisibility":"sideways"}')
    expect(readSettings(f)).toEqual({ boardVisibility: 'always' })
    writeFileSync(f, '[]')
    expect(readSettings(f)).toEqual({ boardVisibility: 'always' })
  })

  it('merges, persists and leaves no temp files', () => {
    const f = file()
    expect(writeSettings(f, { boardVisibility: 'hover' })).toEqual({ boardVisibility: 'hover' })
    expect(readSettings(f)).toEqual({ boardVisibility: 'hover' })
    expect(writeSettings(f, {})).toEqual({ boardVisibility: 'hover' })
    expect(readdirSync(dir)).toEqual(['settings.json'])
  })

  it('rejects an invalid boardVisibility and leaves the file alone', () => {
    const f = file()
    writeSettings(f, { boardVisibility: 'hidden' })
    const before = readFileSync(f, 'utf8')
    expect(() => writeSettings(f, { boardVisibility: 'sideways' as never })).toThrow()
    expect(readFileSync(f, 'utf8')).toBe(before)
  })
})
