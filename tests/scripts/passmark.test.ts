import { describe, expect, it } from 'vitest'
import { parsePassMark } from '../../scripts/lib/passmark.ts'

describe('parsePassMark', () => {
  it('reads a WPM range with an en dash', () => {
    expect(parsePassMark('**Aim for 10–20 WPM with 90% accuracy.**')).toEqual({ accuracy: 0.9, minWpm: 10, maxWpm: 20 })
  })

  it('reads a WPM range with an ASCII hyphen', () => {
    expect(parsePassMark('**Aim for 5-20 WPM with 90% accuracy.**')).toEqual({ accuracy: 0.9, minWpm: 5, maxWpm: 20 })
  })

  it('reads the Chapter 4 time limit', () => {
    const text = '**You should be able to complete this test in 10 minutes or less with an accuracy of at least 90%.**'
    expect(parsePassMark(text)).toEqual({ accuracy: 0.9, maxMinutes: 10 })
  })

  it('returns undefined when there is no pass mark', () => {
    expect(parsePassMark('Nothing to see here, 90% of the time.')).toBeUndefined()
  })
})
