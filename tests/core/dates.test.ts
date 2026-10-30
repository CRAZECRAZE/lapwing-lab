import { describe, expect, it } from 'vitest'
import { isIsoDate, isYearMonth } from '../../src/core/dates.ts'

describe('isIsoDate', () => {
  it('accepts real calendar dates including leap days', () => {
    for (const v of ['2026-11-13', '2024-02-29', '2000-02-29', '2026-12-31', '2026-01-01']) {
      expect(isIsoDate(v), v).toBe(true)
    }
  })

  it('rejects impossible days, months and wrong shapes', () => {
    for (const v of ['2026-02-30', '2027-02-29', '1900-02-29', '2026-13-01', '2026-00-10', '2026-11-00', '2026-04-31', 'tomorrow', '2026-11', '2026-1-5', '2026-11-13T00:00', ' 2026-11-13', '']) {
      expect(isIsoDate(v), v).toBe(false)
    }
  })

  it('rejects non-strings', () => {
    for (const v of [null, undefined, 20261113, {}, [], true]) expect(isIsoDate(v)).toBe(false)
  })
})

describe('isYearMonth', () => {
  it('accepts months 01-12', () => {
    for (const v of ['2026-01', '2026-10', '2026-12']) expect(isYearMonth(v), v).toBe(true)
  })

  it('rejects out-of-range months and wrong shapes', () => {
    for (const v of ['2026-13', '2026-00', '2026-1', '2026-10-01', '202610', 'october', '']) {
      expect(isYearMonth(v), v).toBe(false)
    }
  })

  it('rejects non-strings', () => {
    for (const v of [null, undefined, 202610, {}, [], true]) expect(isYearMonth(v)).toBe(false)
  })
})
