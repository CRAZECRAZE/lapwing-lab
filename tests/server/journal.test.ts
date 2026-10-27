import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { appendEntry, isJournalDate, listEntries, readEntry, writeEntry } from '../../server/journal.ts'

let root: string
let dir: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'lapwing-journal-'))
  dir = join(root, 'journal')
})
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('isJournalDate', () => {
  it('accepts real calendar dates', () => {
    expect(isJournalDate('2026-10-27')).toBe(true)
    expect(isJournalDate('2028-02-29')).toBe(true)
  })

  it('refuses malformed or impossible dates', () => {
    for (const s of ['2026-02-29', '2026-13-01', '2026-1-1', '20261027', '../2026-10-27', '2026-10-27/x', '']) {
      expect(isJournalDate(s), s).toBe(false)
    }
  })
})

describe('readEntry', () => {
  it('returns an empty string for a missing folder and does not create it', () => {
    expect(readEntry(dir, '2026-10-27')).toBe('')
    expect(existsSync(dir)).toBe(false)
  })

  it('returns an empty string for a missing file in an existing folder', () => {
    writeEntry(dir, '2026-10-26', 'x')
    expect(readEntry(dir, '2026-10-27')).toBe('')
  })
})

describe('writeEntry', () => {
  it('round-trips Unicode and CRLF unchanged, creates the folder and leaves no temp file', () => {
    const text = 'héllo ✋ 日本語\r\nsecond line\r\n'
    writeEntry(dir, '2026-10-27', text)
    expect(readEntry(dir, '2026-10-27')).toBe(text)
    expect(readdirSync(dir)).toEqual(['2026-10-27.md'])
  })

  it('replaces an existing entry', () => {
    writeEntry(dir, '2026-10-27', 'one')
    writeEntry(dir, '2026-10-27', 'two')
    expect(readEntry(dir, '2026-10-27')).toBe('two')
  })
})

describe('appendEntry', () => {
  it('writes just the trimmed block for an empty or missing file', () => {
    expect(appendEntry(dir, '2026-10-27', '  first  \n\n')).toBe('first\n')
    expect(readEntry(dir, '2026-10-27')).toBe('first\n')
    writeEntry(dir, '2026-10-28', '')
    expect(appendEntry(dir, '2026-10-28', 'hi')).toBe('hi\n')
  })

  it('separates a block from existing text with one blank line', () => {
    writeEntry(dir, '2026-10-27', 'first  \n\n\n')
    expect(appendEntry(dir, '2026-10-27', '\n second \n')).toBe('first\n\nsecond\n')
    expect(readEntry(dir, '2026-10-27')).toBe('first\n\nsecond\n')
  })
})

describe('listEntries', () => {
  it('returns [] for a missing folder', () => {
    expect(listEntries(dir)).toEqual([])
    expect(existsSync(dir)).toBe(false)
  })

  it('sorts newest first, skips blank entries and non-matching files', () => {
    writeEntry(dir, '2026-10-25', 'abc')
    writeEntry(dir, '2026-10-27', 'héllo')
    writeEntry(dir, '2026-10-26', ' \n\t\n')
    writeEntry(dir, '2026-10-24', '')
    writeFileSync(join(dir, 'x.bak'), 'nope')
    writeFileSync(join(dir, '2026-10-27.md.tmp'), 'nope')
    writeFileSync(join(dir, '2026-13-01.md'), 'nope')
    expect(listEntries(dir)).toEqual([
      { date: '2026-10-27', chars: 5 },
      { date: '2026-10-25', chars: 3 },
    ])
  })
})

describe('invalid dates', () => {
  it('throws RangeError from every function', () => {
    expect(() => readEntry(dir, '../x')).toThrow(RangeError)
    expect(() => writeEntry(dir, '../x', 'a')).toThrow(RangeError)
    expect(() => appendEntry(dir, '../x', 'a')).toThrow(RangeError)
    expect(() => listEntries(dir)).not.toThrow()
    expect(existsSync(dir)).toBe(false)
  })
})
