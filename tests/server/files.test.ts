import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { listTextFiles, readTextOrEmpty } from '../../server/files.ts'

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'lapwing-files-'))
})
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

const md = (name: string): boolean => name.endsWith('.md')

describe('readTextOrEmpty', () => {
  it('reads a file as UTF-8', () => {
    writeFileSync(join(root, 'a.md'), 'héllo ✋')
    expect(readTextOrEmpty(join(root, 'a.md'))).toBe('héllo ✋')
  })

  it('returns an empty string for a missing file or folder and creates nothing', () => {
    expect(readTextOrEmpty(join(root, 'nope.md'))).toBe('')
    expect(readTextOrEmpty(join(root, 'nodir', 'a.md'))).toBe('')
    expect(existsSync(join(root, 'nodir'))).toBe(false)
  })

  it('rethrows any other error', () => {
    mkdirSync(join(root, 'dir.md'))
    expect(() => readTextOrEmpty(join(root, 'dir.md'))).toThrow(/EISDIR/)
    // ENOTDIR: a path component is a file, not a folder.
    writeFileSync(join(root, 'file'), 'x')
    expect(() => readTextOrEmpty(join(root, 'file', 'a.md'))).toThrow(/ENOTDIR/)
  })
})

describe('listTextFiles', () => {
  it('returns [] for a missing folder and creates nothing', () => {
    expect(listTextFiles(join(root, 'nodir'), md)).toEqual([])
    expect(existsSync(join(root, 'nodir'))).toBe(false)
  })

  it('lists accepted files with their lengths', () => {
    writeFileSync(join(root, 'a.md'), 'héllo')
    writeFileSync(join(root, 'b.md'), 'z')
    expect(listTextFiles(root, md).sort((x, y) => x.name.localeCompare(y.name))).toEqual([
      { name: 'a.md', chars: 5 },
      { name: 'b.md', chars: 1 },
    ])
  })

  it('skips names the filter refuses', () => {
    writeFileSync(join(root, 'a.md'), 'x')
    writeFileSync(join(root, 'a.md.tmp'), 'x')
    writeFileSync(join(root, 'other.txt'), 'x')
    expect(listTextFiles(root, md)).toEqual([{ name: 'a.md', chars: 1 }])
  })

  it('skips empty and whitespace-only files', () => {
    writeFileSync(join(root, 'empty.md'), '')
    writeFileSync(join(root, 'blank.md'), ' \n\t\r\n')
    writeFileSync(join(root, 'real.md'), ' x ')
    expect(listTextFiles(root, md)).toEqual([{ name: 'real.md', chars: 3 }])
  })

  it('skips a directory with a matching name', () => {
    mkdirSync(join(root, 'dir.md'))
    writeFileSync(join(root, 'a.md'), 'x')
    expect(listTextFiles(root, md)).toEqual([{ name: 'a.md', chars: 1 }])
  })

  it('rethrows an error that is not a missing folder', () => {
    writeFileSync(join(root, 'file'), 'x')
    expect(() => listTextFiles(join(root, 'file'), md)).toThrow(/ENOTDIR/)
  })

  it('rethrows when a matching file cannot be read', () => {
    const f = join(root, 'secret.md')
    writeFileSync(f, 'x')
    chmodSync(f, 0o000)
    try {
      // Running as root can read anything; the check only means something for a normal user.
      if (process.getuid?.() !== 0) expect(() => listTextFiles(root, md)).toThrow(/EACCES/)
    } finally {
      chmodSync(f, 0o600)
    }
  })
})
