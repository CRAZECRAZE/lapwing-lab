// Formatting for entries added to the daily journal. Pure: no DOM, no Node.

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** One journal entry: a `### HH:MM — title · A% · W wpm` heading (local time), a blank line, then the note. */
export function formatNoteBlock(
  now: Date,
  title: string,
  stats: { accuracy: number; wpm: number } | null,
  text: string,
): string {
  const suffix = stats ? ` · ${Math.round(stats.accuracy * 100)}% · ${Math.round(stats.wpm)} wpm` : ''
  return `### ${pad(now.getHours())}:${pad(now.getMinutes())} — ${title}${suffix}\n\n${text.trim()}`
}
