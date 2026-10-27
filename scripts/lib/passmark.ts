export type PassMark = { accuracy: number; minWpm?: number; maxWpm?: number; maxMinutes?: number }

const RANGE = /Aim for\s+(\d+)\s*[–-]\s*(\d+)\s*WPM\s+with\s+(\d+)%\s+accuracy/i
const TIME_LIMIT = /in\s+(\d+)\s+minutes?\s+or\s+less\s+with\s+an\s+accuracy\s+of\s+at\s+least\s+(\d+)%/i

export function parsePassMark(markdown: string): PassMark | undefined {
  const range = RANGE.exec(markdown)
  if (range) return { accuracy: Number(range[3]) / 100, minWpm: Number(range[1]), maxWpm: Number(range[2]) }
  const limit = TIME_LIMIT.exec(markdown)
  if (limit) return { accuracy: Number(limit[2]) / 100, maxMinutes: Number(limit[1]) }
  return undefined
}
