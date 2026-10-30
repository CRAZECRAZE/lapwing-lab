import { readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { validateRoutineDoc } from '../src/core/routine.ts'
import type { RoutineDoc } from '../src/core/routine.ts'
import { writeFileAtomic } from './atomic.ts'

// A missing, unreadable or invalid file is never fatal: the owner just has no routines.
// Reads never create anything.
export function readRoutines(file: string): RoutineDoc {
  try {
    return validateRoutineDoc(JSON.parse(readFileSync(file, 'utf8')))
  } catch {
    return { routines: [], active: null }
  }
}

// The caller validates; this writes the doc whole or not at all, creating the folder on first save.
export function writeRoutines(file: string, doc: RoutineDoc): void {
  writeFileAtomic(dirname(file), file, JSON.stringify(doc, null, 2) + '\n')
}
