// The words a finished run completed (plan ruling R1). Pure: shared by the server and the client.

/**
 * Completed words of a finished run: `round(wpm * elapsedMs / 60000)` when the run's elapsed time is positive and
 * its wpm is a number; else `round(firstTryCorrect / accuracy)` when the accuracy is positive; else 0.
 * `meta` may be anything the archive holds (null, a string, an array): anything that is not an object counts as none.
 */
export function completedWords(wpm: number | null, accuracy: number | null, meta: unknown): number {
  const m: Record<string, unknown> = typeof meta === 'object' && meta !== null ? (meta as Record<string, unknown>) : {}
  const elapsed = m.elapsedMs
  if (typeof elapsed === 'number' && Number.isFinite(elapsed) && elapsed > 0 && wpm !== null && Number.isFinite(wpm)) {
    return Math.round((wpm * elapsed) / 60000)
  }
  const firstTry = m.firstTryCorrect
  if (accuracy !== null && accuracy > 0 && typeof firstTry === 'number' && Number.isFinite(firstTry) && firstTry >= 0) {
    return Math.round(firstTry / accuracy)
  }
  return 0
}
