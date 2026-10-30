import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { runRhythm } from '../../src/core/rhythm.ts'
import { formatStroke, parseStroke, slotMask, SLOTS } from '../../src/core/steno.ts'
import { openArchive } from '../../server/archive.ts'
import type { Archive, StrokeRecord } from '../../server/archive.ts'
import { buildStats, MAX_MIXUPS } from '../../server/stats.ts'
import type { StatsMode } from '../../server/stats.ts'

const open: Archive[] = []
const dirs: string[] = []
function memory(): Archive {
  const a = openArchive(':memory:')
  open.push(a)
  return a
}
afterEach(() => {
  while (open.length) open.pop()?.close()
  while (dirs.length) rmSync(dirs.pop() as string, { recursive: true, force: true })
})

const at = (day: number, h: number, m = 0, sec = 0) => new Date(2026, 9, day, h, m, sec).getTime()
const SAP = slotMask('S-', 'A-', '-P')
const RANGE = { from: '2026-10-01', to: '2026-10-31' }

type Spec = {
  stamps?: number[]
  mode?: string
  wpm?: number
  accuracy?: number
  words?: number // completed words; sets meta.elapsedMs so that words = wpm * elapsed / 60000
  meta?: Record<string, unknown>
  finish?: boolean
  latencyMs?: number
  stroke?: Partial<StrokeRecord>
}

// One run with strokes at the given times. By default a finished free run of 10 wpm and 90 % over 20 words.
function run(a: Archive, spec: Spec = {}): number {
  const stamps = spec.stamps ?? [at(27, 10)]
  const wpm = spec.wpm ?? 10
  const id = a.startTest({
    sessionId: a.createSession(1000),
    startedAt: stamps[0] ?? 1001,
    mode: spec.mode ?? 'free',
    chapter: null,
    section: null,
    itemCount: stamps.length,
  })
  for (const tsMs of stamps) {
    a.addStroke({
      testId: id,
      tsMs,
      prompt: 'sap',
      expected: ['SAP'],
      pressedLevers: ['S1-', 'A-', '-P'],
      pressedMask: SAP,
      correct: true,
      latencyMs: spec.latencyMs ?? 420,
      attemptNo: 1,
      ...spec.stroke,
    })
  }
  if (spec.finish !== false) {
    const words = spec.words ?? 20
    a.finishTest(id, {
      endedAt: stamps[stamps.length - 1] ?? 2000,
      wpm,
      accuracy: spec.accuracy ?? 0.9,
      meta: { elapsedMs: Math.round((words * 60000) / wpm), ...spec.meta },
    })
  }
  return id
}

// Stamps for a run whose strokes follow the given gaps (the first stroke is at `start`).
function gapStamps(start: number, gaps: number[]): number[] {
  const out = [start]
  for (const g of gaps) out.push(out[out.length - 1] + g)
  return out
}

const steady = Array.from({ length: 14 }, () => 600) // steadiness 100
const swingy = Array.from({ length: 14 }, (_, i) => (i % 2 === 0 ? 600 : 1200)) // steadiness about 51
const middling = Array.from({ length: 14 }, (_, i) => (i % 4 === 0 ? 900 : 600)) // somewhere in between

function steadinessOfStamps(stamps: number[], latencyMs = 420): number | null {
  return runRhythm(stamps.map((tsMs) => ({ tsMs, correct: true, latencyMs }))).steadiness
}

describe('buildStats', () => {
  it('is empty for an empty database and echoes the query', () => {
    expect(buildStats(memory(), { ...RANGE, mode: 'all' })).toEqual({
      ...RANGE,
      mode: 'all',
      days: [],
      keys: [],
      mixups: [],
      allTimeStrokes: 0,
    })
  })

  it('free mode leaves section runs out of days but keys still count them', () => {
    const a = memory()
    run(a, { mode: 'free', stamps: [at(27, 10), at(27, 10, 0, 1)] })
    run(a, { mode: 'section', stamps: [at(27, 11), at(27, 11, 0, 1), at(27, 11, 0, 2)] })
    const free = buildStats(a, { ...RANGE, mode: 'free' })
    expect(free.days).toEqual([expect.objectContaining({ date: '2026-10-27', runs: 1 })])
    // all five strokes need S, A and -P, whatever the mode
    expect(free.keys).toEqual([
      { slot: 'S-', required: 5, missed: 0 },
      { slot: 'A-', required: 5, missed: 0 },
      { slot: '-P', required: 5, missed: 0 },
    ])
    expect(buildStats(a, { ...RANGE, mode: 'drills' }).keys).toEqual(free.keys)
  })

  it('drills include stage0, section and chapter-test; all includes every mode', () => {
    const a = memory()
    run(a, { mode: 'free', stamps: [at(20, 10)] })
    run(a, { mode: 'stage0', stamps: [at(21, 10)] })
    run(a, { mode: 'section', stamps: [at(22, 10)] })
    run(a, { mode: 'chapter-test', stamps: [at(23, 10)] })
    run(a, { mode: 'stage0-test', stamps: [at(24, 10)] })
    const dates = (mode: StatsMode) => buildStats(a, { ...RANGE, mode }).days.map((d) => d.date)
    expect(dates('free')).toEqual(['2026-10-20'])
    expect(dates('drills')).toEqual(['2026-10-21', '2026-10-22', '2026-10-23'])
    expect(dates('all')).toEqual(['2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24'])
  })

  it('never lists left-early or unfinished runs in days', () => {
    const a = memory()
    run(a, { stamps: [at(26, 10)], meta: { abandoned: true } })
    run(a, { stamps: [at(27, 10)], finish: false })
    run(a, { stamps: [at(28, 10)] })
    for (const mode of ['free', 'all'] as const) {
      expect(buildStats(a, { ...RANGE, mode }).days.map((d) => d.date)).toEqual(['2026-10-28'])
    }
  })

  it('keeps a timed-out run', () => {
    const a = memory()
    run(a, { stamps: [at(27, 10)], meta: { timedOut: true } })
    expect(buildStats(a, { ...RANGE, mode: 'free' }).days).toEqual([expect.objectContaining({ runs: 1 })])
  })

  it('weights wpm and accuracy by words (10 wpm over 20 words and 20 wpm over 60 words give 17.5)', () => {
    const a = memory()
    run(a, { stamps: [at(27, 10)], wpm: 10, words: 20, accuracy: 0.8 })
    run(a, { stamps: [at(27, 11)], wpm: 20, words: 60, accuracy: 0.96 })
    const [day] = buildStats(a, { ...RANGE, mode: 'free' }).days
    expect(day).toMatchObject({ date: '2026-10-27', runs: 2, words: 80 })
    expect(day?.wpm).toBeCloseTo(17.5, 10)
    expect(day?.accuracy).toBeCloseTo((0.8 * 20 + 0.96 * 60) / 80, 10)
  })

  it('a zero-word run counts as a run but carries no weight', () => {
    const a = memory()
    run(a, { stamps: [at(27, 10)], wpm: 10, words: 20, accuracy: 0.8 })
    run(a, { stamps: [at(27, 11)], wpm: 50, words: 0, accuracy: 0.1, meta: { elapsedMs: 0 } })
    const [day] = buildStats(a, { ...RANGE, mode: 'free' }).days
    expect(day).toMatchObject({ runs: 2, words: 20, wpm: 10, accuracy: 0.8 })
  })

  it('a day whose only run has 0 words has null wpm and accuracy', () => {
    const a = memory()
    run(a, { stamps: [at(27, 10)], wpm: 10, accuracy: 0.8, meta: { elapsedMs: 0 } })
    expect(buildStats(a, { ...RANGE, mode: 'free' }).days).toEqual([
      { date: '2026-10-27', runs: 1, words: 0, wpm: null, accuracy: null, steadiness: null },
    ])
  })

  it('sorts days ascending and groups runs by the local date of the first stroke', () => {
    const a = memory()
    run(a, { stamps: [at(29, 10)] })
    run(a, { stamps: [at(27, 23, 59), at(28, 0, 1)] })
    run(a, { stamps: [at(27, 9)] })
    const days = buildStats(a, { ...RANGE, mode: 'free' }).days
    expect(days.map((d) => [d.date, d.runs])).toEqual([
      ['2026-10-27', 2],
      ['2026-10-29', 1],
    ])
  })

  it('respects the range for days but not for allTimeStrokes', () => {
    const a = memory()
    run(a, { stamps: [at(27, 10), at(27, 10, 0, 1)] })
    run(a, { stamps: [at(28, 10), at(28, 10, 0, 1), at(28, 10, 0, 2)] })
    const out = buildStats(a, { from: '2026-10-28', to: '2026-10-28', mode: 'all' })
    expect(out.days.map((d) => d.date)).toEqual(['2026-10-28'])
    expect(out.allTimeStrokes).toBe(5)
  })

  describe('steadiness', () => {
    const start = at(27, 10)
    it('is null when the day has no run with enough strokes', () => {
      const a = memory()
      run(a, { stamps: [start, start + 600] })
      expect(buildStats(a, { ...RANGE, mode: 'free' }).days[0]?.steadiness).toBeNull()
    })

    it('is the steadiness of a single run', () => {
      const a = memory()
      const stamps = gapStamps(start, swingy)
      run(a, { stamps })
      const expected = steadinessOfStamps(stamps)
      expect(expected).not.toBeNull()
      expect(expected).toBeLessThan(80)
      expect(buildStats(a, { ...RANGE, mode: 'free' }).days[0]?.steadiness).toBe(expected)
    })

    it('is the median over the day runs (odd count)', () => {
      const a = memory()
      // runs are stored out of order so a first/last/mean shortcut would not equal the median
      const stampsA = gapStamps(at(27, 8), steady)
      const stampsB = gapStamps(at(27, 9), swingy)
      const stampsC = gapStamps(at(27, 10), middling)
      run(a, { stamps: stampsA })
      run(a, { stamps: stampsB })
      run(a, { stamps: stampsC })
      const values = [stampsA, stampsB, stampsC].map((s) => steadinessOfStamps(s) as number)
      expect(new Set(values).size).toBe(3)
      const median = [...values].sort((x, y) => x - y)[1]
      expect(buildStats(a, { ...RANGE, mode: 'free' }).days[0]?.steadiness).toBe(median)
    })

    it('is the mean of the two middle values for an even count, rounded', () => {
      const a = memory()
      const sets = [steady, swingy, middling, steady].map((g, i) => gapStamps(at(27, 8 + i), g))
      sets.forEach((stamps) => run(a, { stamps }))
      const values = sets.map((s) => steadinessOfStamps(s) as number).sort((x, y) => x - y)
      const expected = Math.round((values[1] + values[2]) / 2)
      expect(buildStats(a, { ...RANGE, mode: 'free' }).days[0]?.steadiness).toBe(expected)
      // and a pair
      const b = memory()
      const s1 = gapStamps(at(27, 8), steady)
      const s2 = gapStamps(at(27, 9), swingy)
      run(b, { stamps: s1 })
      run(b, { stamps: s2 })
      const pair = Math.round(((steadinessOfStamps(s1) as number) + (steadinessOfStamps(s2) as number)) / 2)
      expect(buildStats(b, { ...RANGE, mode: 'free' }).days[0]?.steadiness).toBe(pair)
    })

    it('ignores a run whose steadiness is null', () => {
      const a = memory()
      const good = gapStamps(at(27, 8), swingy)
      run(a, { stamps: good })
      run(a, { stamps: [at(27, 9), at(27, 9, 0, 1)] }) // too short: null
      expect(buildStats(a, { ...RANGE, mode: 'free' }).days[0]).toMatchObject({
        runs: 2,
        steadiness: steadinessOfStamps(good),
      })
    })

    it('ignores the first (start) gap of a free run', () => {
      const a = memory()
      const stamps = gapStamps(start, steady)
      run(a, { stamps, latencyMs: 9000 }) // a very slow first stroke would wreck the score if it were counted
      expect(buildStats(a, { ...RANGE, mode: 'free' }).days[0]?.steadiness).toBe(100)
    })

    describe('chapter tests', () => {
      // 6 words x 3 showings = 18 strokes: 6 first showings (the first is the start), 12 scored repeats.
      const WORDS = ['SAP', 'KAT', 'TPH', 'RAOE', 'PWAEU', 'HR-F']
      function wordRun(a: Archive, mode: string): number {
        const id = a.startTest({
          sessionId: a.createSession(1000),
          startedAt: start,
          mode,
          chapter: null,
          section: null,
          itemCount: WORDS.length * 3,
        })
        let ts = start
        WORDS.forEach((w) => {
          for (let rep = 0; rep < 3; rep++) {
            const first = rep === 0
            ts += first ? 1500 : 400
            a.addStroke({
              testId: id,
              tsMs: ts,
              prompt: w.toLowerCase(),
              expected: [w],
              pressedLevers: [],
              pressedMask: parseStroke(w),
              correct: true,
              latencyMs: first ? 1500 : 400,
              attemptNo: 1,
            })
          }
        })
        a.finishTest(id, { endedAt: ts, wpm: 10, accuracy: 0.9, meta: { elapsedMs: 120000 } })
        return id
      }

      it('scores a chapter test on its repeats only: slow first showings do not count', () => {
        const a = memory()
        wordRun(a, 'chapter-test')
        expect(buildStats(a, { ...RANGE, mode: 'drills' }).days[0]?.steadiness).toBe(100)
      })

      it('scores the same strokes in a free run low, as nothing marks the first showings', () => {
        const a = memory()
        wordRun(a, 'free')
        const free = buildStats(a, { ...RANGE, mode: 'free' }).days[0]?.steadiness
        expect(free).not.toBeNull()
        expect(free).toBeLessThan(60)
      })
    })

    describe('a chapter test with an undo', () => {
      // 6 two-stroke words x 3 showings; the undo is on the second showing of the first word. It is never logged:
      // the owner pressed the first stroke, `*`, then the first stroke again, so the log holds that stroke twice.
      const WORDS = ['SAP/KAT', 'TPH/RAOE', 'PWAEU/HR-F', 'TKOG/SAP', 'KAT/TPH', 'RAOE/PWAEU']
      function twoStrokeRun(a: Archive, undoOn: number | null): number {
        const id = a.startTest({
          sessionId: a.createSession(1000),
          startedAt: start,
          mode: 'chapter-test',
          chapter: null,
          section: null,
          itemCount: WORDS.length * 3,
        })
        let ts = start
        WORDS.forEach((w, wi) => {
          for (let rep = 0; rep < 3; rep++) {
            const strokes = w.split('/')
            if (undoOn === wi && rep === 1) strokes.splice(1, 0, strokes[0])
            strokes.forEach((s) => {
              ts += rep === 0 ? 2000 : 500
              a.addStroke({
                testId: id,
                tsMs: ts,
                prompt: w.toLowerCase(),
                expected: [w],
                pressedLevers: [],
                pressedMask: parseStroke(s),
                correct: true,
                latencyMs: 400,
                attemptNo: 1,
              })
            })
          }
        })
        a.finishTest(id, { endedAt: ts, wpm: 10, accuracy: 0.9, meta: { elapsedMs: 120000 } })
        return id
      }

      it('has the same per-day steadiness as the run without the undo', () => {
        const without = memory()
        twoStrokeRun(without, null)
        const withUndo = memory()
        twoStrokeRun(withUndo, 0)
        const expected = buildStats(without, { ...RANGE, mode: 'drills' }).days[0]?.steadiness
        expect(expected).toBe(100) // the slow first showings are left out; the repeats are even
        expect(buildStats(withUndo, { ...RANGE, mode: 'drills' }).days[0]?.steadiness).toBe(expected)
      })
    })

    it('uses only the runs of the chosen mode and skips left-early runs', () => {
      const a = memory()
      const mine = gapStamps(at(27, 8), swingy)
      run(a, { stamps: mine })
      run(a, { stamps: gapStamps(at(27, 9), steady), mode: 'section' })
      run(a, { stamps: gapStamps(at(27, 10), steady), meta: { abandoned: true } })
      expect(buildStats(a, { ...RANGE, mode: 'free' }).days[0]?.steadiness).toBe(steadinessOfStamps(mine))
    })
  })

  describe('keys and mixups', () => {
    it('cover every mode whatever the chosen one, with no thresholds applied', () => {
      const a = memory()
      // a section run with two wrong strokes: S A -T pressed where S A -P was needed
      run(a, {
        mode: 'section',
        stamps: [at(27, 10), at(27, 10, 0, 1)],
        stroke: { correct: false, pressedMask: slotMask('S-', 'A-', '-T') },
      })
      for (const mode of ['free', 'drills', 'all'] as const) {
        const out = buildStats(a, { ...RANGE, mode })
        expect(out.keys.find((k) => k.slot === '-P')).toEqual({ slot: '-P', required: 2, missed: 2 })
        expect(out.mixups).toEqual([{ pressed: '-T', needed: '-P', count: 2 }])
      }
      // below the page's 30-press and 3-occurrence thresholds yet still present
    })

    it('caps the mix-ups at the most frequent MAX_MIXUPS', () => {
      const a = memory()
      expect(MAX_MIXUPS).toBe(50)
      const slots = SLOTS.filter((s) => s !== '#')
      const id = a.startTest({ sessionId: a.createSession(1), startedAt: 1, mode: 'free', chapter: null, section: null, itemCount: 1 })
      let k = 0
      const miss = (needed: (typeof SLOTS)[number], pressed: (typeof SLOTS)[number], times: number) => {
        for (let r = 0; r < times; r++) {
          a.addStroke({
            testId: id,
            tsMs: at(27, 10) + k++,
            prompt: 'x',
            expected: [formatStroke(slotMask(needed))],
            pressedLevers: [],
            pressedMask: slotMask(pressed),
            correct: false,
            latencyMs: 1,
            attemptNo: 1,
          })
        }
      }
      // 20 x 21 distinct substitutions seen once, then three more frequent ones inserted last
      for (const needed of slots) for (const pressed of slots) if (needed !== pressed) miss(needed, pressed, 1)
      miss('S-', 'T-', 9)
      miss('K-', 'P-', 8)
      miss('-F', '-R', 7)
      a.finishTest(id, { endedAt: at(27, 11), wpm: 10, accuracy: 0.9, meta: { elapsedMs: 120000 } })
      const { mixups } = buildStats(a, { ...RANGE, mode: 'all' })
      expect(mixups).toHaveLength(MAX_MIXUPS)
      expect(mixups.slice(0, 3)).toEqual([
        { pressed: 'T-', needed: 'S-', count: 10 },
        { pressed: 'P-', needed: 'K-', count: 9 },
        { pressed: '-R', needed: '-F', count: 8 },
      ])
      for (let i = 1; i < mixups.length; i++) expect(mixups[i].count).toBeLessThanOrEqual(mixups[i - 1].count)
    })
  })
})

describe('buildStats at scale', () => {
  it('answers over about 200,000 strokes and 600 days within 1.5 s, in under 200 KB of JSON', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lapwing-stats-perf-'))
    dirs.push(dir)
    const file = join(dir, 'steno.db')
    openArchive(file).close() // creates the schema

    // a small seeded generator keeps the fixture the same on every run
    let seed = 12345
    const rand = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      return seed / 2 ** 32
    }
    const outlines = Array.from({ length: 400 }, () => {
      const n = 2 + Math.floor(rand() * 4)
      const slots = Array.from({ length: n }, () => SLOTS[1 + Math.floor(rand() * (SLOTS.length - 1))])
      return { json: JSON.stringify([formatStroke(slotMask(...slots))]), mask: slotMask(...slots) }
    })
    const modes = ['free', 'free', 'section', 'stage0', 'chapter-test', 'stage0-test']

    const raw = new DatabaseSync(file)
    raw.exec('PRAGMA foreign_keys = ON')
    const insertSession = raw.prepare('INSERT INTO sessions (started_at) VALUES (?)')
    const insertTest = raw.prepare(
      'INSERT INTO tests (session_id, started_at, ended_at, mode, chapter, section, item_count, wpm, accuracy, meta_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
    const insertStroke = raw.prepare(
      `INSERT INTO strokes (test_id, ts_ms, prompt, expected_json, pressed_levers_json,
         pressed_slots_mask, correct, latency_ms, attempt_no) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    const DAYS = 600
    const RUNS_PER_DAY = 3
    const STROKES_PER_RUN = 118
    let strokes = 0
    raw.exec('BEGIN')
    const day0 = new Date(2025, 2, 1, 9).getTime()
    for (let d = 0; d < DAYS; d++) {
      const sessionId = Number(insertSession.run(day0).lastInsertRowid)
      for (let r = 0; r < RUNS_PER_DAY; r++) {
        let ts = new Date(2025, 2, 1 + d, 9 + r * 3).getTime()
        const n = r === 2 && d % 7 === 0 ? 9 : STROKES_PER_RUN
        const kind = (d + r) % 11
        const meta = kind === 0 ? '{"abandoned":true}' : '{"elapsedMs":180000}'
        const ended = kind === 1 ? null : ts + n * 700
        const mode = modes[(d * RUNS_PER_DAY + r) % modes.length]
        const testId = Number(
          insertTest.run(sessionId, ts, ended, mode, null, null, n, ended === null ? null : 10 + rand() * 40, ended === null ? null : 0.8 + rand() * 0.2, ended === null ? null : meta).lastInsertRowid,
        )
        for (let i = 0; i < n; i++) {
          const o = outlines[Math.floor(rand() * outlines.length)]
          const correct = rand() < 0.9
          // a wrong stroke swaps one pressed key for an unpressed one (a mix-up), or drops a key
          let mask = o.mask
          if (!correct) {
            const have = SLOTS.map((_, b) => b).filter((b) => b > 0 && (mask & (1 << b)) !== 0)
            const lack = SLOTS.map((_, b) => b).filter((b) => b > 0 && (mask & (1 << b)) === 0)
            const out = have[Math.floor(rand() * have.length)]
            mask &= ~(1 << out)
            if (rand() < 0.8) mask |= 1 << lack[Math.floor(rand() * lack.length)]
          }
          const gap = rand() < 0.03 ? 2500 : 400 + Math.floor(rand() * 500)
          ts += gap
          insertStroke.run(testId, ts, 'word', o.json, '[]', mask, correct ? 1 : 0, gap, 1)
          strokes++
        }
      }
    }
    raw.exec('COMMIT')
    raw.close()
    expect(strokes).toBeGreaterThan(190_000)

    const archive = openArchive(file)
    open.push(archive)
    const q = { from: '2025-01-01', to: '2026-12-31', mode: 'all' } as const
    const warm = buildStats(archive, q)
    expect(warm.days.length).toBeGreaterThan(500)
    expect(warm.allTimeStrokes).toBe(strokes)

    const started = performance.now()
    const out = buildStats(archive, q)
    const ms = performance.now() - started
    expect(ms).toBeLessThan(1500)
    expect(JSON.stringify(out).length).toBeLessThan(200_000)
    expect(out.keys.length).toBeLessThanOrEqual(23)
    expect(out.mixups.length).toBeGreaterThan(0)
    expect(out.mixups.length).toBeLessThanOrEqual(MAX_MIXUPS)
  }, 60_000)
})
