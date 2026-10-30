import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { isReportMonth, listReports, readReport, writeReport } from '../../server/reports.ts'

let root: string
let dir: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'lapwing-reports-'))
  dir = join(root, 'reports')
})
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

const BAD = ['2026-13', '2026-00', '2026-1', '../x', '2026-10/../..', '', '2026-10-01', '26-10', ' 2026-10']

describe('isReportMonth', () => {
  it('accepts YYYY-MM with the month 01-12', () => {
    for (const m of ['2026-01', '2026-10', '2026-12', '1999-07']) expect(isReportMonth(m), m).toBe(true)
  })

  it('refuses everything else', () => {
    for (const m of BAD) expect(isReportMonth(m), m).toBe(false)
  })
})

describe('invalid months', () => {
  it('throw RangeError from readReport and writeReport before touching the filesystem', () => {
    for (const m of BAD) {
      expect(() => readReport(dir, m), m).toThrow(RangeError)
      expect(() => writeReport(dir, m, 'a'), m).toThrow(RangeError)
    }
    expect(existsSync(dir)).toBe(false)
    expect(readdirSync(root)).toEqual([])
  })
})

describe('readReport', () => {
  it('returns an empty string for a missing folder and does not create it', () => {
    expect(readReport(dir, '2026-10')).toBe('')
    expect(existsSync(dir)).toBe(false)
  })

  it('returns an empty string for a missing file in an existing folder', () => {
    writeReport(dir, '2026-09', 'x')
    expect(readReport(dir, '2026-10')).toBe('')
  })
})

describe('writeReport', () => {
  it('round-trips Unicode and CRLF unchanged, creates the folder and leaves no temp file', () => {
    const text = 'héllo ✋ 日本語\r\nsecond line\r\n'
    writeReport(dir, '2026-10', text)
    expect(readReport(dir, '2026-10')).toBe(text)
    expect(readdirSync(dir)).toEqual(['2026-10.md'])
  })

  it('names the file YYYY-MM.md', () => {
    writeReport(dir, '2026-12', 'a')
    writeReport(dir, '2026-01', 'b')
    expect(readdirSync(dir).sort()).toEqual(['2026-01.md', '2026-12.md'])
  })

  it('replaces an existing report', () => {
    writeReport(dir, '2026-10', 'one')
    writeReport(dir, '2026-10', 'two')
    expect(readReport(dir, '2026-10')).toBe('two')
  })

  it('removes its temp file and throws when the rename fails', () => {
    mkdirSync(join(dir, '2026-10.md'), { recursive: true })
    expect(() => writeReport(dir, '2026-10', 'x')).toThrow()
    expect(readdirSync(dir)).toEqual(['2026-10.md'])
  })
})

describe('listReports', () => {
  it('returns [] for a missing folder', () => {
    expect(listReports(dir)).toEqual([])
    expect(existsSync(dir)).toBe(false)
  })

  it('sorts by month ascending, skips blank notes and non-matching names', () => {
    writeReport(dir, '2026-12', 'héllo')
    writeReport(dir, '2025-02', 'abc')
    writeReport(dir, '2026-03', 'z')
    writeReport(dir, '2026-04', ' \n\t\n')
    writeReport(dir, '2026-05', '')
    writeFileSync(join(dir, '2026-6.md'), 'nope')
    writeFileSync(join(dir, '2026-06.md.tmp'), 'nope')
    writeFileSync(join(dir, '2026-13.md'), 'nope')
    writeFileSync(join(dir, '2026-00.md'), 'nope')
    writeFileSync(join(dir, 'notes.md'), 'nope')
    expect(listReports(dir)).toEqual([
      { month: '2025-02', chars: 3 },
      { month: '2026-03', chars: 1 },
      { month: '2026-12', chars: 5 },
    ])
  })

  it('does not crash on a directory named like a report, and does not list it', () => {
    writeReport(dir, '2026-09', 'a')
    mkdirSync(join(dir, '2026-10.md'))
    expect(listReports(dir)).toEqual([{ month: '2026-09', chars: 1 }])
  })
})
