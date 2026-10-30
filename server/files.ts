import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

// A missing file (or folder) is empty text; any other failure is real. Reads never create anything.
export function readTextOrEmpty(file: string): string {
  try {
    return readFileSync(file, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return ''
    throw err
  }
}

// The regular files in dir whose name the filter accepts and whose text is not blank, with their length.
// A missing folder lists nothing; a directory that happens to have a matching name is skipped.
export function listTextFiles(dir: string, nameFilter: (name: string) => boolean): { name: string; chars: number }[] {
  let names: string[]
  try {
    names = readdirSync(dir)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
  const out: { name: string; chars: number }[] = []
  for (const name of names) {
    if (!nameFilter(name)) continue
    const file = join(dir, name)
    if (!statSync(file).isFile()) continue
    const text = readTextOrEmpty(file)
    if (text.trim() !== '') out.push({ name, chars: text.length })
  }
  return out
}
