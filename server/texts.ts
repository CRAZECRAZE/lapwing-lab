import { readFileSync, readdirSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { writeFileAtomic } from './atomic.ts'

export const MAX_TEXTS = 50
export const MAX_NAME_CHARS = 60
const ID_MAX = 40
const ID = /^[a-z0-9]+(-[a-z0-9]+)*$/
const FILE = /^(.+)\.json$/

// The id becomes part of a file name, so it is checked before any filesystem access.
export function isTextId(id: string): boolean {
  return typeof id === 'string' && id.length <= ID_MAX && ID.test(id)
}

function textFile(dir: string, id: string): string {
  if (!isTextId(id)) throw new RangeError(`not a text id: ${String(id)}`)
  return join(dir, `${id}.json`)
}

// A file that is missing, unreadable, not JSON or not shaped {name, text} is no text at all.
function readFields(file: string): { name: string; text: string } | null {
  try {
    const v: unknown = JSON.parse(readFileSync(file, 'utf8'))
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return null
    const { name, text } = v as { name?: unknown; text?: unknown }
    return typeof name === 'string' && typeof text === 'string' ? { name, text } : null
  } catch {
    return null
  }
}

// Reads never create anything; a missing folder lists nothing and a bad file is skipped.
export function listTexts(dir: string): { id: string; name: string; chars: number }[] {
  let names: string[]
  try {
    names = readdirSync(dir)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
  const out: { id: string; name: string; chars: number }[] = []
  for (const file of names) {
    const id = FILE.exec(file)?.[1]
    if (id === undefined || !isTextId(id)) continue
    const fields = readFields(join(dir, file))
    if (fields) out.push({ id, name: fields.name, chars: fields.text.length })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, 'en') || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

export function readSavedText(dir: string, id: string): { id: string; name: string; text: string } | null {
  const fields = readFields(textFile(dir, id))
  return fields ? { id, ...fields } : null
}

export function writeSavedText(dir: string, id: string, v: { name: string; text: string }): void {
  const file = textFile(dir, id)
  writeFileAtomic(dir, file, JSON.stringify({ name: v.name, text: v.text }))
}

// False when there was nothing to delete.
export function deleteSavedText(dir: string, id: string): boolean {
  try {
    unlinkSync(textFile(dir, id))
    return true
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw err
  }
}
