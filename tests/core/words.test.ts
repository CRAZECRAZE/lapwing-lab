import { describe, expect, it } from 'vitest'
import { completedWords } from '../../src/core/words.ts'

describe('completedWords', () => {
  it('uses wpm and elapsed time when the run has elapsed time', () => {
    expect(completedWords(15, 0.9, { elapsedMs: 120_000, firstTryCorrect: 999 })).toBe(30)
    expect(completedWords(10.4, 0.9, { elapsedMs: 60_000 })).toBe(10)
    expect(completedWords(10.5, null, { elapsedMs: 60_000 })).toBe(11)
  })

  it('falls back to first-try correct over accuracy when there is no usable elapsed time', () => {
    expect(completedWords(15, 0.8, { firstTryCorrect: 40 })).toBe(50)
    expect(completedWords(15, 0.8, { elapsedMs: 0, firstTryCorrect: 40 })).toBe(50)
    expect(completedWords(15, 0.8, { elapsedMs: -5, firstTryCorrect: 40 })).toBe(50)
    expect(completedWords(15, 0.8, { elapsedMs: Number.NaN, firstTryCorrect: 40 })).toBe(50)
    expect(completedWords(15, 0.8, { elapsedMs: '60000', firstTryCorrect: 40 })).toBe(50)
    expect(completedWords(null, 0.8, { elapsedMs: 60_000, firstTryCorrect: 40 })).toBe(50)
    expect(completedWords(Number.POSITIVE_INFINITY, 0.8, { elapsedMs: 60_000, firstTryCorrect: 40 })).toBe(50)
  })

  it('is 0 when neither source is usable', () => {
    expect(completedWords(15, 0.9, {})).toBe(0)
    expect(completedWords(15, 0, { firstTryCorrect: 40 })).toBe(0)
    expect(completedWords(15, null, { firstTryCorrect: 40 })).toBe(0)
    expect(completedWords(15, 0.8, { firstTryCorrect: -1 })).toBe(0)
    expect(completedWords(15, 0.8, { firstTryCorrect: Number.NaN })).toBe(0)
    expect(completedWords(null, null, { elapsedMs: 60_000 })).toBe(0)
  })

  it('treats a meta that is not an object as no meta, without throwing', () => {
    for (const meta of [null, undefined, 'text', 42, true, [], [1, 2]]) {
      expect(completedWords(15, 0.8, meta), String(meta)).toBe(0)
    }
  })
})
