import { useEffect, useState } from 'preact/hooks'
import { getRoutines, listTests, listTexts, putRoutines } from '../api.ts'
import type { SavedTextSummary } from '../api.ts'
import { localDate } from '../core/days.ts'
import { EMPTY_ROUTINES, nextUp, stepsDone, validateRoutineDoc } from '../core/routine.ts'
import type { DoneTest, RoutineDoc, RoutineStep } from '../core/routine.ts'
import { useProgress } from '../state/progress.tsx'
import { stepAvailable } from './routineSteps.ts'
import type { Targets } from './routineSteps.ts'

export type Routines = {
  status: 'loading' | 'error' | 'ready'
  doc: RoutineDoc
  /** Writes the whole document; rejects with a plain message when it is not valid or cannot be saved. */
  save(doc: RoutineDoc): Promise<void>
  reload(): void
}

/** A routine document the validator refused; its message is plain and is the one thing worth showing as it is. */
export class RoutineInvalid extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RoutineInvalid'
  }
}

/** The routines document, loaded once and again on `reload`; `save` replaces it on the server and then here. */
export function useRoutines(): Routines {
  const [state, setState] = useState<{ status: Routines['status']; doc: RoutineDoc }>({
    status: 'loading',
    doc: EMPTY_ROUTINES,
  })
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let live = true
    // a reply that is not a routines document is as good as none
    getRoutines()
      .then(validateRoutineDoc)
      .then(
        (doc) => live && setState({ status: 'ready', doc }),
        () => live && setState({ status: 'error', doc: EMPTY_ROUTINES }),
      )
    return () => {
      live = false
    }
  }, [attempt])
  return {
    ...state,
    async save(doc) {
      // The same check the server makes, so its plain message is what shows.
      let clean: RoutineDoc
      try {
        clean = validateRoutineDoc(doc)
      } catch (err) {
        throw new RoutineInvalid(err instanceof Error ? err.message : 'The routines are not valid')
      }
      await putRoutines(clean)
      setState({ status: 'ready', doc: clean })
    },
    reload() {
      setState({ status: 'loading', doc: EMPTY_ROUTINES })
      setAttempt((n) => n + 1)
    },
  }
}

/** A calm sentence for a failed save: the validator's own message, or else a hint about the server (never raw error text). */
export function saveMessage(err: unknown): string {
  const lead = "Couldn't save the routines."
  if (err instanceof RoutineInvalid && err.message !== '') return `${lead} ${err.message}`
  return `${lead} Check that the Lapwing Lab server is still running, then try again.`
}

const doneTest = (t: { mode: string; section: string | null; endedAt: number | null; meta: unknown }): DoneTest => ({
  mode: t.mode,
  section: t.section,
  endedAt: t.endedAt,
  abandoned: (t.meta as { abandoned?: unknown } | null)?.abandoned === true,
})

export type Today = {
  /** The targets steps point at, as far as they are known. */
  targets: Targets
  /** Both lists are the length of the steps; empty until today's tests have loaded. */
  done: boolean[]
  available: boolean[]
  /** The first step that is neither done nor unavailable, or null. */
  next: number | null
  /** 'loading' until today's tests came back; 'error' when they could not be read. */
  tests: 'loading' | 'ready' | 'error'
}

/**
 * Which of `steps` are done today, read once when the page is shown (today is the local date). A step whose target
 * is gone is never done. The practice index comes from the progress provider; saved texts are fetched only when a
 * step needs one.
 */
export function useRoutineToday(steps: readonly RoutineStep[]): Today {
  const { index, status: progressStatus } = useProgress()
  const waiting = progressStatus === 'loading'
  const [tests, setTests] = useState<DoneTest[] | 'loading' | 'error'>('loading')
  const [texts, setTexts] = useState<SavedTextSummary[] | null | 'loading'>('loading')
  const needsTexts = steps.some((s) => s.kind === 'text')

  useEffect(() => {
    let live = true
    listTests({ date: localDate(Date.now()), limit: 200 }).then(
      (rows) => live && setTests(rows.map(doneTest)),
      () => live && setTests('error'),
    )
    return () => {
      live = false
    }
  }, [])
  useEffect(() => {
    if (!needsTexts) return
    let live = true
    listTexts().then(
      (found) => live && setTexts(found),
      // texts that cannot be listed are unknown, not gone
      () => live && setTexts(null),
    )
    return () => {
      live = false
    }
  }, [needsTexts])

  const targets: Targets = { index, texts: texts === 'loading' ? null : texts }
  const available = steps.map((s) => stepAvailable(s, targets))
  const status: Today['tests'] =
    tests === 'error'
      ? 'error'
      : tests === 'loading' || waiting || (needsTexts && texts === 'loading')
        ? 'loading'
        : 'ready'
  const ticks = status === 'ready' ? stepsDone(steps, tests as DoneTest[]).map((d, i) => d && available[i]) : []
  const next = status === 'ready' ? nextUp(ticks.map((d, i) => d || !available[i])) : null
  return { targets, done: ticks, available, next, tests: status }
}
