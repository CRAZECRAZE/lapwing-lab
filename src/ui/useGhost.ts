import { useEffect, useState } from 'preact/hooks'
import { getGhosts } from '../api.ts'
import type { ActiveGhost } from '../core/ghost.ts'
import type { GhostChoice } from './GhostPicker.tsx'

/**
 * The run to race for this attempt, or null (off, nothing to race, the lookup failed, or the choice is not `ready`
 * yet, which asks nothing). Asked once per attempt, before it starts, so a finished run never becomes its own ghost;
 * the drill never waits for the answer.
 */
export function useGhost(
  mode: string,
  section: string | null,
  choice: GhostChoice,
  attempt: number,
  ready: boolean,
): ActiveGhost | null {
  // Keyed by attempt: a new attempt shows no ghost from its first render, before any effect has run.
  const [found, setFound] = useState<{ attempt: number; ghost: ActiveGhost } | null>(null)

  useEffect(() => {
    setFound(null)
    if (!ready || choice === 'off' || section === null) return
    let live = true
    void (async () => {
      try {
        const { best, last } = await getGhosts(mode, section)
        const picked = choice === 'best' ? best : last
        if (live && picked) setFound({ attempt, ghost: { ...picked, label: choice === 'best' ? 'Best' : 'Last' } })
      } catch {
        // no ghost, no error
      }
    })()
    return () => {
      live = false
    }
  }, [mode, section, choice, attempt, ready])

  return found?.attempt === attempt ? found.ghost : null
}
