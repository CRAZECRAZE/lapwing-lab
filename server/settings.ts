import { readFileSync, renameSync, writeFileSync } from 'node:fs'

export type Settings = {
  boardVisibility: 'always' | 'hover' | 'hidden'
  hints: 'miss' | 'always'
  // A real calendar date YYYY-MM-DD the plateau banner is snoozed until, or null.
  plateauSnoozedUntil: string | null
  // The last monthly report (YYYY-MM) the owner has seen, or null.
  reportSeen: string | null
}

const VISIBILITY = ['always', 'hover', 'hidden']
const HINTS = ['miss', 'always']
const DEFAULTS: Settings = { boardVisibility: 'always', hints: 'miss', plateauSnoozedUntil: null, reportSeen: null }

function isVisibility(v: unknown): v is Settings['boardVisibility'] {
  return typeof v === 'string' && VISIBILITY.includes(v)
}

function isHints(v: unknown): v is Settings['hints'] {
  return typeof v === 'string' && HINTS.includes(v)
}

// A real calendar date: 2026-02-30 and 2026-13-01 are rejected, a leap day is not.
export function isIsoDate(v: unknown): v is string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false
  const d = new Date(`${v}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v
}

export function isYearMonth(v: unknown): v is string {
  return typeof v === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(v)
}

// A missing, unreadable or invalid file is never fatal: the owner just gets defaults,
// and each field falls back on its own (an old file with only boardVisibility is fine).
export function readSettings(file: string): Settings {
  const settings: Settings = { ...DEFAULTS }
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'))
    if (typeof parsed === 'object' && parsed !== null) {
      const { boardVisibility, hints, plateauSnoozedUntil, reportSeen } = parsed as Partial<Record<keyof Settings, unknown>>
      if (isVisibility(boardVisibility)) settings.boardVisibility = boardVisibility
      if (isHints(hints)) settings.hints = hints
      if (isIsoDate(plateauSnoozedUntil)) settings.plateauSnoozedUntil = plateauSnoozedUntil
      if (isYearMonth(reportSeen)) settings.reportSeen = reportSeen
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
  if (patch.plateauSnoozedUntil != null && !isIsoDate(patch.plateauSnoozedUntil)) {
    throw new Error('plateauSnoozedUntil must be a YYYY-MM-DD date or null')
  }
  if (patch.reportSeen != null && !isYearMonth(patch.reportSeen)) {
    throw new Error('reportSeen must be a YYYY-MM month or null')
  }
  const next: Settings = { ...readSettings(file) }
  if (patch.boardVisibility !== undefined) next.boardVisibility = patch.boardVisibility
  if (patch.hints !== undefined) next.hints = patch.hints
  if (patch.plateauSnoozedUntil !== undefined) next.plateauSnoozedUntil = patch.plateauSnoozedUntil
  if (patch.reportSeen !== undefined) next.reportSeen = patch.reportSeen
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(next, null, 2) + '\n')
  renameSync(tmp, file)
  return next
}
