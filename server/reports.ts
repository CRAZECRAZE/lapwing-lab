import { join } from 'node:path'
import { isYearMonth } from '../src/core/dates.ts'
import { writeFileAtomic } from './atomic.ts'
import { listTextFiles, readTextOrEmpty } from './files.ts'

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
  return readTextOrEmpty(reportFile(dir, month))
}

export function writeReport(dir: string, month: string, text: string): void {
  writeFileAtomic(dir, reportFile(dir, month), text)
}

export function listReports(dir: string): { month: string; chars: number }[] {
  const files = listTextFiles(dir, (name) => {
    const month = FILE.exec(name)?.[1]
    return month !== undefined && isReportMonth(month)
  })
  return files
    .map(({ name, chars }) => ({ month: name.slice(0, -'.md'.length), chars }))
    .sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : 0))
}
