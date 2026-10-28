import type { StrokeRecord, TestRow, TestSummary } from '../../../server/archive.ts'

export const T0 = new Date(2026, 9, 28, 14, 5, 0).getTime()

/** A run whose i-th gap is gaps[i]: the first is the first stroke's latency, the rest are timestamp differences. */
export function strokesOf(gaps: number[], over: { testId?: number; correct?: (i: number) => boolean; start?: number } = {}): StrokeRecord[] {
  let ts = over.start ?? T0
  return gaps.map((gap, i) => {
    if (i > 0) ts += gap
    return {
      testId: over.testId ?? 1,
      tsMs: ts,
      prompt: `w${i}`,
      expected: ['SAP'],
      pressedLevers: [],
      pressedMask: 0,
      correct: over.correct ? over.correct(i) : true,
      latencyMs: gap,
      attemptNo: 1,
    } as StrokeRecord
  })
}

export const even = (n: number, ms = 600): number[] => Array.from({ length: n }, () => ms)

export function testRow(over: Partial<TestRow> = {}): TestRow {
  return {
    id: 1,
    sessionId: 1,
    startedAt: T0,
    endedAt: T0 + 60_000,
    mode: 'free',
    chapter: null,
    section: null,
    itemCount: 60,
    wpm: 20,
    accuracy: 0.9,
    meta: { elapsedMs: 36_000, firstTryCorrect: 54 },
    ...over,
  }
}

export function summary(id: number, over: Partial<TestSummary> = {}): TestSummary {
  const first = T0 - (100 - id) * 3_600_000
  return {
    ...testRow({ id, startedAt: first, endedAt: first + 60_000 }),
    strokeCount: 40,
    firstStrokeAt: first,
    lastStrokeAt: first + 60_000,
    ...over,
  }
}
