import type { JSX } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import type { Settings } from '../../server/settings.ts'
import { getSettings, putSettings } from '../api.ts'

export type Hints = Settings['hints']
const HINTS: { value: Hints; label: string }[] = [
  { value: 'miss', label: 'on miss' },
  { value: 'always', label: 'always' },
]

/** The word-drill hint setting: starts at `miss`, takes the stored value, and saves a pick. */
export function useHints(): [Hints, (next: Hints) => void] {
  const [hints, setHints] = useState<Hints>('miss')
  const chosen = useRef(false) // the owner picked a value before the stored one arrived

  useEffect(() => {
    let live = true
    void getSettings().then((s) => live && !chosen.current && setHints(s.hints))
    return () => {
      live = false
    }
  }, [])

  const pick = (next: Hints): void => {
    chosen.current = true
    setHints(next)
    putSettings({ hints: next }).catch(() => {}) // still applies for this session
  }
  return [hints, pick]
}

/** The Hint on-miss/always button group shown above a word drill. */
export function HintPicker({ value, onPick }: { value: Hints; onPick(next: Hints): void }): JSX.Element {
  return (
    <div class="stage0-visibility" role="group" aria-label="Hint">
      <span class="stage0-visibility__label">Hint</span>
      {HINTS.map((h) => (
        <button
          key={h.value}
          type="button"
          class="stage0-visibility__option"
          aria-pressed={value === h.value}
          onClick={() => onPick(h.value)}
        >
          {h.label}
        </button>
      ))}
    </div>
  )
}
