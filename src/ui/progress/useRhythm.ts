import { useEffect, useRef, useState } from 'preact/hooks'
import type { StrokeRecord, TestRow, TestSummary } from '../../../server/archive.ts'
import type { StatsMode } from '../../../server/stats.ts'
import { getTest, listTests } from '../../api.ts'
import { wasAbandoned } from '../TestList.tsx'

/** How many runs the picker offers. */
export const PICKER_RUNS = 20
/** Tests are asked for in pages of this size (the server's maximum) ... */
const PAGE = 200
/** ... until this many tests have been looked through. */
export const SCAN_LIMIT = 600
const DRILL_MODES: readonly string[] = ['stage0', 'section', 'chapter-test']

type ModeList = { status: 'error' } | { status: 'ready'; runs: TestSummary[]; capped: boolean }
type RunLoad = { key: string } & ({ status: 'error' } | { status: 'ready'; test: TestRow; strokes: StrokeRecord[] })

export type RhythmState = {
  list: { status: 'loading' } | ModeList
  /** The run shown: the picked one, else the newest of the list; null with no list or no run. */
  id: number | null
  select: (id: number) => void
  /** The loaded run; null while it loads. */
  run: { status: 'error' } | { status: 'ready'; test: TestRow; strokes: StrokeRecord[] } | null
  retryList: () => void
  retryRun: () => void
}

/** Finished runs of the mode that were not left early and have strokes, in the order given. */
export function pickable(tests: readonly TestSummary[], mode: StatsMode): TestSummary[] {
  return tests.filter(
    (t) =>
      t.endedAt !== null &&
      !wasAbandoned(t.meta) &&
      t.strokeCount > 0 &&
      (mode === 'all' || (mode === 'free' ? t.mode === 'free' : DRILL_MODES.includes(t.mode))),
  )
}

/**
 * Looks back through the archive, a page at a time, for the latest runs of the mode: until PICKER_RUNS are found,
 * the history runs out, or SCAN_LIMIT tests have been looked through. `current` says the answer is still wanted.
 * Resolves to null when it is not.
 */
async function scan(mode: StatsMode, current: () => boolean): Promise<{ runs: TestSummary[]; capped: boolean } | null> {
  const found: TestSummary[] = []
  let scanned = 0
  let beforeId: number | undefined
  for (;;) {
    const page = await listTests(beforeId === undefined ? { limit: PAGE } : { limit: PAGE, beforeId })
    if (!current()) return null
    scanned += page.length
    found.push(...pickable(page, mode))
    if (page.length < PAGE) return { runs: found.sort((a, b) => b.id - a.id).slice(0, PICKER_RUNS), capped: false }
    if (found.length >= PICKER_RUNS) return { runs: found.sort((a, b) => b.id - a.id).slice(0, PICKER_RUNS), capped: false }
    if (scanned >= SCAN_LIMIT) return { runs: found.sort((a, b) => b.id - a.id), capped: true }
    beforeId = Math.min(...page.map((t) => t.id))
  }
}

/**
 * The state of the Rhythm panel, kept above the panel (in the page) so that switching the range, which unmounts the
 * panels while the numbers reload, keeps the picked run and does not ask for anything again.
 * - The runs of each mode are looked up once and kept; `retryList` forgets the current mode's and asks again.
 * - A pick belongs to the mode it was made in: any change of mode goes back to the newest run of that mode (also when
 *   coming back to an earlier mode, whose list is then taken from the keep).
 * - The strokes of the shown run are kept as long as the run is the same.
 */
export function useRhythm(mode: StatsMode): RhythmState {
  const [lists, setLists] = useState<Partial<Record<StatsMode, ModeList>>>({})
  const [attempt, setAttempt] = useState(0)
  const [pick, setPick] = useState<{ epoch: number; id: number } | null>(null)
  const [strokesAttempt, setStrokesAttempt] = useState(0)
  const [run, setRun] = useState<RunLoad | null>(null)
  const latestList = useRef(0)
  const latestRun = useRef(0)

  // every change of mode starts a new epoch, which the picks of earlier modes do not belong to
  const seen = useRef(mode)
  const epoch = useRef(0)
  if (seen.current !== mode) {
    seen.current = mode
    epoch.current++
  }

  const mine = lists[mode]
  useEffect(() => {
    if (mine !== undefined) return
    let live = true
    const token = ++latestList.current
    const current = (): boolean => live && latestList.current === token
    scan(mode, current).then(
      (found) => found !== null && current() && setLists((l) => ({ ...l, [mode]: { status: 'ready', ...found } })),
      () => current() && setLists((l) => ({ ...l, [mode]: { status: 'error' } })),
    )
    return () => {
      live = false
      latestList.current++ // an answer for another mode, or after unmount, is dropped
    }
  }, [mode, attempt, mine === undefined])

  const runs = mine?.status === 'ready' ? mine.runs : null
  const chosen = pick !== null && pick.epoch === epoch.current && runs?.some((r) => r.id === pick.id) ? pick.id : null
  const id = chosen ?? runs?.[0]?.id ?? null

  const runKey = `${id}|${strokesAttempt}`
  useEffect(() => {
    if (id === null || run?.key === runKey) return
    let live = true
    const token = ++latestRun.current
    const current = (): boolean => live && latestRun.current === token
    getTest(id).then(
      (found) =>
        current() &&
        setRun(found === null ? { key: runKey, status: 'error' } : { key: runKey, status: 'ready', test: found.test, strokes: found.strokes }),
      () => current() && setRun({ key: runKey, status: 'error' }),
    )
    return () => {
      live = false
      latestRun.current++
    }
  }, [runKey])

  const shown = run !== null && run.key === runKey ? run : null
  return {
    list: mine === undefined ? { status: 'loading' } : mine,
    id,
    select: (next) => setPick({ epoch: epoch.current, id: next }),
    run: shown === null ? null : shown.status === 'error' ? { status: 'error' } : { status: 'ready', test: shown.test, strokes: shown.strokes },
    retryList: () => {
      setLists((l) => {
        const rest = { ...l }
        delete rest[mode]
        return rest
      })
      setAttempt((n) => n + 1)
    },
    retryRun: () => setStrokesAttempt((n) => n + 1),
  }
}
