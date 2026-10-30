import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { isYearMonth } from '../src/core/dates.ts'
import { writeFileAtomic } from './atomic.ts'

const FILE = /^(\d{4}-\d{2})\.md$/

// The month becomes part of a file name, so it is checked before any filesystem access.
export function isReportMonth(month: string): boolean {
  return isYearMonth(month)
}

function reportFile(dir: string, month: string): string {
  if (!isReportMonth(month)) throw new RangeError(`not a report month: ${String(month)}`)
  return join(dir, `${month}.md`)
}

// A missing file or folder is an empty report note; reads never create anything.
export function readReport(dir: string, month: string): string {
  const file = reportFile(dir, month)
  try {
    return readFileSync(file, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return ''
    throw err
  }
}

export function writeReport(dir: string, month: string, text: string): void {
  writeFileAtomic(dir, reportFile(dir, month), text)
}

export function listReports(dir: string): { month: string; chars: number }[] {
  let names: string[]
  try {
    names = readdirSync(dir)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
  const out: { month: string; chars: number }[] = []
  for (const name of names) {
    const month = FILE.exec(name)?.[1]
    if (month === undefined || !isReportMonth(month)) continue
    // A directory that happens to be named like a report is not a report.
    if (!statSync(join(dir, name)).isFile()) continue
    const text = readReport(dir, month)
    if (text.trim() !== '') out.push({ month, chars: text.length })
  }
  return out.sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : 0))
}
