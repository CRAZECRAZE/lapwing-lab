import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const SHAPE = /^\d{4}-\d{2}-\d{2}$/
const FILE = /^(\d{4}-\d{2}-\d{2})\.md$/

// The date becomes part of a file path, so it is checked before any filesystem access:
// exactly YYYY-MM-DD and a real calendar day (a UTC date built from it must read back the same).
export function isJournalDate(s: string): boolean {
  if (typeof s !== 'string' || !SHAPE.test(s)) return false
  const [y, m, d] = s.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  // Date.UTC maps years 0-99 to 1900-1999, so pin the year explicitly.
  date.setUTCFullYear(y)
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
}

function entryFile(dir: string, date: string): string {
  if (!isJournalDate(date)) throw new RangeError(`not a journal date: ${JSON.stringify(date)}`)
  return join(dir, `${date}.md`)
}

// A missing file or folder is an empty entry; reads never create anything.
export function readEntry(dir: string, date: string): string {
  const file = entryFile(dir, date)
  try {
    return readFileSync(file, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return ''
    throw err
  }
}

export function writeEntry(dir: string, date: string, text: string): void {
  const file = entryFile(dir, date)
  mkdirSync(dir, { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  try {
    writeFileSync(tmp, text)
    renameSync(tmp, file)
  } catch (err) {
    rmSync(tmp, { force: true })
    throw err
  }
}

export function appendEntry(dir: string, date: string, block: string): string {
  const existing = readEntry(dir, date).trimEnd()
  const next = (existing === '' ? '' : `${existing}\n\n`) + `${block.trim()}\n`
  writeEntry(dir, date, next)
  return next
}

export function listEntries(dir: string): { date: string; chars: number }[] {
  let names: string[]
  try {
    names = readdirSync(dir)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
  const out: { date: string; chars: number }[] = []
  for (const name of names) {
    const date = FILE.exec(name)?.[1]
    if (date === undefined || !isJournalDate(date)) continue
    const text = readEntry(dir, date)
    if (text.trim() !== '') out.push({ date, chars: text.length })
  }
  return out.sort((a, b) => (a.date < b.date ? 1 : -1))
}
