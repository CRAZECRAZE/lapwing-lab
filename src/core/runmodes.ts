/** The mode string of a fix-up drill run. It stores wpm 0 (never shown); its time and strokes count, its speed does not. */
export const FIXUP_MODE = 'fixup'

/** The mode string of a real-text run; its section is `text/<id>/<part>`, and its wpm counts like any other run's. */
export const TEXT_MODE = 'text'

/**
 * The one rule for the wpm/accuracy aggregates of the `all` view (server stats and the rhythm picker): every mode
 * counts except the fix-up drill. `free` and `drills` already leave it out by listing the modes they take.
 */
export function countedInAll(runMode: string): boolean {
  return runMode !== FIXUP_MODE
}
