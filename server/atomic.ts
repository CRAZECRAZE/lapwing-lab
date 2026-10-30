import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'

// Writes the file whole or not at all: the text goes to a temp file next to it, then is renamed over it.
// The folder is created on first save; a failed write leaves no temp file behind.
export function writeFileAtomic(dir: string, file: string, text: string): void {
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
