import type { JSX } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import type { Settings } from '../../server/settings.ts'
import { getSettings, putSettings } from '../api.ts'

export type GhostChoice = Settings['ghost']
const CHOICES: GhostChoice[] = ['best', 'last', 'off']

/** The ghost setting: starts at `best`, takes the stored value, and saves a pick. */
export function useGhostChoice(): [GhostChoice, (next: GhostChoice) => void] {
  const [choice, setChoice] = useState<GhostChoice>('best')
  const chosen = useRef(false) // the owner picked a value before the stored one arrived

  useEffect(() => {
    let live = true
    void getSettings()
      .then((s) => live && !chosen.current && setChoice(s.ghost))
      .catch(() => {}) // keeps the default
    return () => {
      live = false
    }
  }, [])

  const pick = (next: GhostChoice): void => {
    chosen.current = true
    setChoice(next)
    putSettings({ ghost: next }).catch(() => {}) // still applies for this session
  }
  return [choice, pick]
}

/** The Ghost best/last/off button group shown above a drill. */
export function GhostPicker({ value, onPick }: { value: GhostChoice; onPick(next: GhostChoice): void }): JSX.Element {
  return (
    <div class="stage0-visibility" role="group" aria-label="Ghost">
      <span class="stage0-visibility__label">Ghost</span>
      {CHOICES.map((c) => (
        <button
          key={c}
          type="button"
          class="stage0-visibility__option"
          aria-pressed={value === c}
          onClick={() => onPick(c)}
        >
          {c}
        </button>
      ))}
    </div>
  )
}
