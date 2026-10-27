import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { isNoteChapter, listNotes, readNote, writeNote } from '../../server/notes.ts'

let root: string
let dir: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'lapwing-notes-'))
  dir = join(root, 'notes')
})
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('isNoteChapter', () => {
  it('accepts integers 1 to 26', () => {
    expect(isNoteChapter(1)).toBe(true)
    expect(isNoteChapter(5)).toBe(true)
    expect(isNoteChapter(26)).toBe(true)
  })

  it('refuses everything else', () => {
    for (const n of [0, 27, -1, 1.5, NaN, Infinity, -Infinity]) expect(isNoteChapter(n), String(n)).toBe(false)
  })
})

describe('invalid chapters', () => {
  it('throw RangeError from readNote and writeNote before touching the filesystem', () => {
    for (const n of [0, 27, -1, 1.5, NaN, Infinity]) {
      expect(() => readNote(dir, n), String(n)).toThrow(RangeError)
      expect(() => writeNote(dir, n, 'a'), String(n)).toThrow(RangeError)
    }
    expect(existsSync(dir)).toBe(false)
  })
})

describe('readNote', () => {
  it('returns an empty string for a missing folder and does not create it', () => {
    expect(readNote(dir, 5)).toBe('')
    expect(existsSync(dir)).toBe(false)
  })

  it('returns an empty string for a missing file in an existing folder', () => {
    writeNote(dir, 4, 'x')
    expect(readNote(dir, 5)).toBe('')
  })
})

describe('writeNote', () => {
  it('round-trips Unicode and CRLF unchanged, creates the folder and leaves no temp file', () => {
    const text = 'héllo ✋ 日本語\r\nsecond line\r\n'
    writeNote(dir, 5, text)
    expect(readNote(dir, 5)).toBe(text)
    expect(readdirSync(dir)).toEqual(['ch05.md'])
  })

  it('names two-digit chapters chNN.md', () => {
    writeNote(dir, 26, 'a')
    writeNote(dir, 10, 'b')
    expect(readdirSync(dir).sort()).toEqual(['ch10.md', 'ch26.md'])
  })

  it('replaces an existing note', () => {
    writeNote(dir, 5, 'one')
    writeNote(dir, 5, 'two')
    expect(readNote(dir, 5)).toBe('two')
  })

  it('removes its temp file and throws when the rename fails', () => {
    mkdirSync(join(dir, 'ch05.md'), { recursive: true })
    expect(() => writeNote(dir, 5, 'x')).toThrow()
    expect(readdirSync(dir)).toEqual(['ch05.md'])
  })
})

describe('listNotes', () => {
  it('returns [] for a missing folder', () => {
    expect(listNotes(dir)).toEqual([])
    expect(existsSync(dir)).toBe(false)
  })

  it('sorts by chapter ascending, skips blank notes and non-matching names', () => {
    writeNote(dir, 12, 'héllo')
    writeNote(dir, 2, 'abc')
    writeNote(dir, 26, 'z')
    writeNote(dir, 3, ' \n\t\n')
    writeNote(dir, 4, '')
    writeFileSync(join(dir, 'ch5.md'), 'nope')
    writeFileSync(join(dir, 'ch05.md.tmp'), 'nope')
    writeFileSync(join(dir, 'ch99.md'), 'nope')
    writeFileSync(join(dir, 'ch00.md'), 'nope')
    writeFileSync(join(dir, 'ch27.md'), 'nope')
    writeFileSync(join(dir, 'notes.md'), 'nope')
    expect(listNotes(dir)).toEqual([
      { chapter: 2, chars: 3 },
      { chapter: 12, chars: 5 },
      { chapter: 26, chars: 1 },
    ])
  })

  it('does not crash on a directory named like a note, and does not list it', () => {
    writeNote(dir, 1, 'a')
    mkdirSync(join(dir, 'ch07.md'))
    expect(listNotes(dir)).toEqual([{ chapter: 1, chars: 1 }])
  })
})
