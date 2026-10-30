import { join } from 'node:path'
import { writeFileAtomic } from './atomic.ts'
import { listTextFiles, readTextOrEmpty } from './files.ts'

const FILE = /^ch(\d\d)\.md$/

// The chapter becomes part of a file name, so it is checked before any filesystem access.
export function isNoteChapter(n: number): boolean {
  return Number.isInteger(n) && n >= 1 && n <= 26
}

function noteFile(dir: string, chapter: number): string {
  if (!isNoteChapter(chapter)) throw new RangeError(`not a note chapter: ${String(chapter)}`)
  return join(dir, `ch${String(chapter).padStart(2, '0')}.md`)
}

// A missing file or folder is an empty note; reads never create anything.
export function readNote(dir: string, chapter: number): string {
  return readTextOrEmpty(noteFile(dir, chapter))
}

export function writeNote(dir: string, chapter: number, text: string): void {
  const file = noteFile(dir, chapter)
  writeFileAtomic(dir, file, text)
}

export function listNotes(dir: string): { chapter: number; chars: number }[] {
  const files = listTextFiles(dir, (name) => {
    const digits = FILE.exec(name)?.[1]
    return digits !== undefined && isNoteChapter(Number(digits))
  })
  return files
    .map(({ name, chars }) => ({ chapter: Number(FILE.exec(name)?.[1]), chars }))
    .sort((a, b) => a.chapter - b.chapter)
}
