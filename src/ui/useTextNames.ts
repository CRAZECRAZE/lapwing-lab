import { useEffect, useState } from 'preact/hooks'
import { listTexts } from '../api.ts'

const NONE: ReadonlyMap<string, string> = new Map()

/**
 * The saved texts' names by id, for labelling real-text runs. Asked once, and only when `needed`; until it arrives,
 * and when it fails or a text has since been deleted, a run is labelled with its id.
 */
export function useTextNames(needed: boolean): ReadonlyMap<string, string> {
  const [names, setNames] = useState(NONE)
  useEffect(() => {
    if (!needed) return
    let live = true
    void (async () => {
      try {
        const texts = await listTexts()
        if (live) setNames(new Map(texts.map((t) => [t.id, t.name])))
      } catch {
        // labelled by id
      }
    })()
    return () => {
      live = false
    }
  }, [needed])
  return names
}
