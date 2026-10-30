import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { writeFileAtomic } from './atomic.ts'

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
  const file = noteFile(dir, chapter)
  try {
    return readFileSync(file, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return ''
    throw err
  }
}

export function writeNote(dir: string, chapter: number, text: string): void {
  const file = noteFile(dir, chapter)
  writeFileAtomic(dir, file, text)
}

export function listNotes(dir: string): { chapter: number; chars: number }[] {
  let names: string[]
  try {
    names = readdirSync(dir)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
  const out: { chapter: number; chars: number }[] = []
  for (const name of names) {
    const digits = FILE.exec(name)?.[1]
    if (digits === undefined) continue
    const chapter = Number(digits)
    if (!isNoteChapter(chapter)) continue
    // A directory that happens to be named like a note is not a note.
    if (!statSync(join(dir, name)).isFile()) continue
    const text = readNote(dir, chapter)
    if (text.trim() !== '') out.push({ chapter, chars: text.length })
  }
  return out.sort((a, b) => a.chapter - b.chapter)
}
