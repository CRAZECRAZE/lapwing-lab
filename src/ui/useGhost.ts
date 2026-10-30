import { useEffect, useState } from 'preact/hooks'
import { getGhosts } from '../api.ts'
import type { ActiveGhost } from '../core/ghost.ts'
import type { GhostChoice } from './GhostPicker.tsx'

/**
 * The run to race for this attempt, or null (off, nothing to race, or the lookup failed). Asked once per attempt,
 * before it starts, so a finished run never becomes its own ghost; the drill never waits for the answer.
 */
export function useGhost(mode: string, section: string | null, choice: GhostChoice, attempt: number): ActiveGhost | null {
  const [ghost, setGhost] = useState<ActiveGhost | null>(null)

  useEffect(() => {
    setGhost(null)
    if (choice === 'off' || section === null) return
    let live = true
    void (async () => {
      try {
        const { best, last } = await getGhosts(mode, section)
        const picked = choice === 'best' ? best : last
        if (live && picked) setGhost({ ...picked, label: choice === 'best' ? 'Best' : 'Last' })
      } catch {
        // no ghost, no error
      }
    })()
    return () => {
      live = false
    }
  }, [mode, section, choice, attempt])

  return ghost
}
