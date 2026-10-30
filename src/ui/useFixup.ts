import { useEffect, useState } from 'preact/hooks'
import { getFixup } from '../api.ts'
import { addDays, localDate } from '../core/days.ts'
import { FIXUP_WINDOW_DAYS } from '../core/fixup.ts'
import type { FixupLists } from '../core/fixup.ts'

export type Fixup = { status: 'loading' | 'ready' | 'error'; lists: FixupLists | null }

/** The two fix-up lists for the last `FIXUP_WINDOW_DAYS` local days, fetched once. */
export function useFixup(): Fixup {
  const [state, setState] = useState<Fixup>({ status: 'loading', lists: null })
  useEffect(() => {
    let live = true
    const to = localDate(Date.now())
    const from = addDays(to, -(FIXUP_WINDOW_DAYS - 1))
    getFixup(from, to).then(
      (lists) => live && setState({ status: 'ready', lists }),
      () => live && setState({ status: 'error', lists: null }),
    )
    return () => {
      live = false
    }
  }, [])
  return state
}
