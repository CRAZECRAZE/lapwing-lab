// Pure date-string validators shared by the server (settings) and the client (api).

// A real calendar date YYYY-MM-DD: 2026-02-30 and 2026-13-01 are rejected, a leap day is not.
export function isIsoDate(v: unknown): v is string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false
  const d = new Date(`${v}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v
}

// A calendar month YYYY-MM with the month 01-12.
export function isYearMonth(v: unknown): v is string {
  return typeof v === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(v)
}
