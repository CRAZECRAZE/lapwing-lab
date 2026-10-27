import { describe, expect, it } from 'vitest'
import { formatAccuracy, formatWpm } from '../../src/core/format.ts'

describe('formatAccuracy', () => {
  it('rounds to a whole percent with no mark', () => {
    expect(formatAccuracy(0.92)).toBe('92%')
    expect(formatAccuracy(0.896)).toBe('90%')
    expect(formatAccuracy(0.924)).toBe('92%')
    expect(formatAccuracy(0.29)).toBe('29%')
    expect(formatAccuracy(0)).toBe('0%')
    expect(formatAccuracy(1)).toBe('100%')
  })

  it('shows one decimal when it rounds up to the mark but is below it', () => {
    expect(formatAccuracy(121 / 135, 0.9)).toBe('89.6%')
    expect(formatAccuracy(0.896, 0.9)).toBe('89.6%')
    expect(formatAccuracy(0.895, 0.9)).toBe('89.5%')
    expect(formatAccuracy(0.8999, 0.9)).toBe('89.9%')
  })

  it('floors rather than rounds the decimal', () => {
    expect(formatAccuracy(0.8999, 0.9)).toBe('89.9%')
    expect(formatAccuracy(0.8991, 0.9)).toBe('89.9%')
  })

  it('shows the plain number at or above the mark', () => {
    expect(formatAccuracy(0.9, 0.9)).toBe('90%')
    expect(formatAccuracy(0.9004, 0.9)).toBe('90%')
    expect(formatAccuracy(0.92, 0.9)).toBe('92%')
    expect(formatAccuracy(1, 0.9)).toBe('100%')
  })

  it('never turns an exact 0.9 into 89.9, even with float noise', () => {
    expect(formatAccuracy(0.9)).toBe('90%')
    expect(formatAccuracy(0.9, 0.9)).toBe('90%')
    expect(formatAccuracy(9 / 10, 0.9)).toBe('90%')
    expect(formatAccuracy(0.9, 0.91)).toBe('90%')
  })

  it('never prints a decimal that reaches the mark while the real value does not', () => {
    expect(formatAccuracy(0.8999999999, 0.9)).toBe('89.9%')
  })

  it('stays plain when the rounded value is still below the mark', () => {
    expect(formatAccuracy(0.85, 0.9)).toBe('85%')
    expect(formatAccuracy(0.894, 0.9)).toBe('89%')
    expect(formatAccuracy(0, 0.9)).toBe('0%')
  })

  it('handles float noise in the value (0.29, 0.896)', () => {
    expect(formatAccuracy(0.29, 0.29)).toBe('29%')
    expect(formatAccuracy(0.2899, 0.29)).toBe('28.9%')
    expect(formatAccuracy(0.57, 0.57)).toBe('57%')
    expect(formatAccuracy(0.5699, 0.57)).toBe('56.9%')
    expect(formatAccuracy(0.896, 0.9)).toBe('89.6%')
  })
})

describe('formatWpm', () => {
  it('rounds to a whole number with no mark', () => {
    expect(formatWpm(31.4)).toBe('31 wpm')
    expect(formatWpm(9.6)).toBe('10 wpm')
    expect(formatWpm(0)).toBe('0 wpm')
    expect(formatWpm(142.5)).toBe('143 wpm')
  })

  it('shows one decimal when it rounds up to the mark but is below it', () => {
    expect(formatWpm(9.6, 10)).toBe('9.6 wpm')
    expect(formatWpm(9.5, 10)).toBe('9.5 wpm')
    expect(formatWpm(9.99, 10)).toBe('9.9 wpm')
    expect(formatWpm(9.9999999999, 10)).toBe('9.9 wpm')
  })

  it('shows the plain number at or above the mark', () => {
    expect(formatWpm(10, 10)).toBe('10 wpm')
    expect(formatWpm(10.2, 10)).toBe('10 wpm')
    expect(formatWpm(31.4, 10)).toBe('31 wpm')
  })

  it('stays plain when the rounded value is still below the mark', () => {
    expect(formatWpm(9.4, 10)).toBe('9 wpm')
    expect(formatWpm(0, 10)).toBe('0 wpm')
  })
})
