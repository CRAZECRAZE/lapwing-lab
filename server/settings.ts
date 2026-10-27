import { readFileSync, renameSync, writeFileSync } from 'node:fs'

export type Settings = { boardVisibility: 'always' | 'hover' | 'hidden' }

const VISIBILITY = ['always', 'hover', 'hidden']
const DEFAULTS: Settings = { boardVisibility: 'always' }

function isVisibility(v: unknown): v is Settings['boardVisibility'] {
  return typeof v === 'string' && VISIBILITY.includes(v)
}

// A missing, unreadable or invalid file is never fatal: the owner just gets defaults.
export function readSettings(file: string): Settings {
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'))
    if (typeof parsed === 'object' && parsed !== null && isVisibility((parsed as Settings).boardVisibility)) {
      return { boardVisibility: (parsed as Settings).boardVisibility }
    }
  } catch {
    // fall through to defaults
  }
  return { ...DEFAULTS }
}

export function writeSettings(file: string, patch: Partial<Settings>): Settings {
  if (patch.boardVisibility !== undefined && !isVisibility(patch.boardVisibility)) {
    throw new Error(`boardVisibility must be one of ${VISIBILITY.join(', ')}`)
  }
  const next: Settings = { ...readSettings(file) }
  if (patch.boardVisibility !== undefined) next.boardVisibility = patch.boardVisibility
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(next, null, 2) + '\n')
  renameSync(tmp, file)
  return next
}
