import type { JSX } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import type { Settings } from '../../server/settings.ts'
import { getSettings, putSettings } from '../api.ts'

export type Visibility = Settings['boardVisibility']
const VISIBILITY: Visibility[] = ['always', 'hover', 'hidden']

/** The drill's board-visibility setting: starts at `always`, takes the stored value, and saves a pick. */
export function useBoardVisibility(): [Visibility, (next: Visibility) => void] {
  const [visibility, setVisibility] = useState<Visibility>('always')
  const chosen = useRef(false) // the owner picked a value before the stored one arrived

  useEffect(() => {
    let live = true
    void getSettings().then((s) => live && !chosen.current && setVisibility(s.boardVisibility))
    return () => {
      live = false
    }
  }, [])

  const pick = (next: Visibility): void => {
    chosen.current = true
    setVisibility(next)
    putSettings({ boardVisibility: next }).catch(() => {}) // still applies for this session
  }
  return [visibility, pick]
}

/** The Board always/hover/hidden button group shown above a drill. */
export function VisibilityPicker({ value, onPick }: { value: Visibility; onPick(next: Visibility): void }): JSX.Element {
  return (
    <div class="stage0-visibility" role="group" aria-label="Board visibility">
      <span class="stage0-visibility__label">Board</span>
      {VISIBILITY.map((v) => (
        <button
          key={v}
          type="button"
          class="stage0-visibility__option"
          aria-pressed={value === v}
          onClick={() => onPick(v)}
        >
          {v}
        </button>
      ))}
    </div>
  )
}
