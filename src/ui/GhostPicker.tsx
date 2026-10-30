import type { JSX } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import type { Settings } from '../../server/settings.ts'
import { getSettings, putSettings } from '../api.ts'

export type GhostChoice = Settings['ghost']
const CHOICES: GhostChoice[] = ['best', 'last', 'off']

/**
 * The ghost setting: starts at `best`, takes the stored value, and saves a pick. `ready` turns true once the choice is
 * known (the stored value arrived, the read failed, or the owner picked), so nothing acts on the default too early.
 */
export function useGhostChoice(): [GhostChoice, (next: GhostChoice) => void, boolean] {
  const [choice, setChoice] = useState<GhostChoice>('best')
  const [ready, setReady] = useState(false)
  const chosen = useRef(false) // the owner picked a value before the stored one arrived

  useEffect(() => {
    let live = true
    const settle = (stored: GhostChoice | null): void => {
      if (!live) return
      if (stored !== null && !chosen.current) setChoice(stored)
      setReady(true)
    }
    void getSettings().then(
      (s) => settle(s.ghost),
      () => settle(null), // keeps the default
    )
    return () => {
      live = false
    }
  }, [])

  const pick = (next: GhostChoice): void => {
    chosen.current = true
    setChoice(next)
    setReady(true)
    putSettings({ ghost: next }).catch(() => {}) // still applies for this session
  }
  return [choice, pick, ready]
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
