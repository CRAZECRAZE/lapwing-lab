import { readFileSync, renameSync, writeFileSync } from 'node:fs'

export type Settings = { boardVisibility: 'always' | 'hover' | 'hidden'; hints: 'miss' | 'always' }

const VISIBILITY = ['always', 'hover', 'hidden']
const HINTS = ['miss', 'always']
const DEFAULTS: Settings = { boardVisibility: 'always', hints: 'miss' }

function isVisibility(v: unknown): v is Settings['boardVisibility'] {
  return typeof v === 'string' && VISIBILITY.includes(v)
}

function isHints(v: unknown): v is Settings['hints'] {
  return typeof v === 'string' && HINTS.includes(v)
}

// A missing, unreadable or invalid file is never fatal: the owner just gets defaults,
// and each field falls back on its own (an old file with only boardVisibility is fine).
export function readSettings(file: string): Settings {
  const settings: Settings = { ...DEFAULTS }
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'))
    if (typeof parsed === 'object' && parsed !== null) {
      const { boardVisibility, hints } = parsed as Partial<Record<keyof Settings, unknown>>
      if (isVisibility(boardVisibility)) settings.boardVisibility = boardVisibility
      if (isHints(hints)) settings.hints = hints
    }
  } catch {
    // fall through to defaults
  }
  return settings
}

export function writeSettings(file: string, patch: Partial<Settings>): Settings {
  if (patch.boardVisibility !== undefined && !isVisibility(patch.boardVisibility)) {
    throw new Error(`boardVisibility must be one of ${VISIBILITY.join(', ')}`)
  }
  if (patch.hints !== undefined && !isHints(patch.hints)) {
    throw new Error(`hints must be one of ${HINTS.join(', ')}`)
  }
  const next: Settings = { ...readSettings(file) }
  if (patch.boardVisibility !== undefined) next.boardVisibility = patch.boardVisibility
  if (patch.hints !== undefined) next.hints = patch.hints
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(next, null, 2) + '\n')
  renameSync(tmp, file)
  return next
}
