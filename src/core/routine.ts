// Routines: named, ordered lists of practice steps, ticked off by the tests that finish them.
// Pure: no DOM, no fetch, no Node.

/** The most routines that can be saved. */
export const MAX_ROUTINES = 8
/** The most steps in one routine. */
export const MAX_STEPS = 12
/** The longest routine name, in characters. */
export const MAX_ROUTINE_NAME = 40
const ID_MAX = 40

/** One thing to practise: a drill list, a free-practice mode, a fix-up tab, or a part of a saved text. */
export type RoutineStep =
  | { kind: 'list'; listId: string }
  | { kind: 'free'; source: string; mode: string }
  | { kind: 'fixup'; tab: 'words' | 'patterns' }
  | { kind: 'text'; id: string; part: number }
export type Routine = { id: string; name: string; steps: RoutineStep[] }
/** `active` is the routine shown first, or null for none. */
export type RoutineDoc = { routines: Routine[]; active: string | null }

export const EMPTY_ROUTINES: RoutineDoc = { routines: [], active: null }

const ID = /^[a-z0-9]+(-[a-z0-9]+)*$/
const LIST_ID = /^\d+-[A-Za-z0-9_-]+$/
const FREE_PART = /^[A-Za-z0-9-]{1,30}$/
/** The id the page gives text that has not been saved; it can never be ticked off. */
const UNSAVED_TEXT_ID = 'pasted'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isId(value: unknown): value is string {
  return typeof value === 'string' && value.length <= ID_MAX && ID.test(value)
}

/** One step as a fresh object with only its own fields; throws a plain message when it is not valid. */
function validateStep(value: unknown): RoutineStep {
  if (!isRecord(value)) throw new Error('A step must be a list, free, fix-up or text step')
  switch (value.kind) {
    case 'list': {
      const { listId } = value
      if (typeof listId !== 'string' || !LIST_ID.test(listId)) throw new Error('A list step needs a valid list id')
      return { kind: 'list', listId }
    }
    case 'free': {
      const { source, mode } = value
      if (typeof source !== 'string' || !FREE_PART.test(source) || typeof mode !== 'string' || !FREE_PART.test(mode)) {
        throw new Error('A free step needs a source and a mode of letters, digits and hyphens, up to 30 characters')
      }
      return { kind: 'free', source, mode }
    }
    case 'fixup': {
      const { tab } = value
      if (tab !== 'words' && tab !== 'patterns') throw new Error('A fix-up step needs the words or patterns tab')
      return { kind: 'fixup', tab }
    }
    case 'text': {
      const { id, part } = value
      if (!isId(id)) throw new Error('A text step needs a valid text id')
      if (id === UNSAVED_TEXT_ID) throw new Error('A text step needs a saved text; save the text first')
      if (typeof part !== 'number' || !Number.isInteger(part) || part < 1 || part > 99) {
        throw new Error('A text step needs a part from 1 to 99')
      }
      return { kind: 'text', id, part }
    }
    default:
      throw new Error('A step must be a list, free, fix-up or text step')
  }
}

function validateRoutine(value: unknown): Routine {
  if (!isRecord(value)) throw new Error('A routine must be an object')
  const { id, name, steps } = value
  if (!isId(id)) {
    throw new Error('A routine id may only use lowercase letters, digits and single hyphens, up to 40 characters')
  }
  const trimmed = typeof name === 'string' ? name.trim() : ''
  if (trimmed.length < 1 || trimmed.length > MAX_ROUTINE_NAME) {
    throw new Error(`A routine needs a name of 1 to ${MAX_ROUTINE_NAME} characters`)
  }
  if (!Array.isArray(steps)) throw new Error('A routine needs a list of steps')
  if (steps.length > MAX_STEPS) throw new Error(`A routine can have at most ${MAX_STEPS} steps`)
  return { id, name: trimmed, steps: steps.map(validateStep) }
}

/**
 * Check a routine document and return a clean copy of it: every field is copied by hand, so anything extra is dropped.
 * Throws an Error with a plain message naming the problem when it is not valid.
 */
export function validateRoutineDoc(value: unknown): RoutineDoc {
  if (!isRecord(value)) throw new Error('The routines must be an object')
  const { routines, active } = value
  if (!Array.isArray(routines)) throw new Error('The routines need a list of routines')
  if (routines.length > MAX_ROUTINES) throw new Error(`There can be at most ${MAX_ROUTINES} routines`)
  const clean = routines.map(validateRoutine)
  const ids = new Set<string>()
  for (const routine of clean) {
    if (ids.has(routine.id)) throw new Error('Two routines have the same id')
    ids.add(routine.id)
  }
  if (active !== null && (typeof active !== 'string' || !ids.has(active))) {
    throw new Error('The active routine must be one of the routines, or null')
  }
  return { routines: clean, active }
}

/** The test mode and section that finishing this step records. */
export function stepSection(step: RoutineStep): { mode: string; section: string } {
  switch (step.kind) {
    case 'list':
      return { mode: 'section', section: step.listId }
    case 'free':
      return { mode: 'free', section: `${step.source}/${step.mode}` }
    case 'fixup':
      return { mode: 'fixup', section: step.tab }
    case 'text':
      return { mode: 'text', section: `text/${step.id}/${step.part}` }
  }
}

/** The page that runs a step. With `fromRoutine` the list, free and text pages are told they were opened from a routine. */
export function stepHref(step: RoutineStep, opts: { fromRoutine?: boolean } = {}): string {
  const from = opts.fromRoutine ? '?from=routine' : ''
  switch (step.kind) {
    case 'list':
      return `/drill/list/${step.listId}${from}`
    case 'free':
      return `/practice/free/${step.source}/${step.mode}${from}`
    case 'fixup':
      return step.tab === 'words' ? '/practice/fixup' : '/practice/fixup/patterns'
    case 'text':
      return `/practice/text/run/${step.id}/${step.part}${from}`
  }
}

/** The part of a test that decides whether a step is done. */
export type DoneTest = { mode: string; section: string | null; endedAt: number | null; abandoned: boolean }

/** For each step, whether a finished, not abandoned test has its mode and section. Steps with one target are done together. */
export function stepsDone(steps: readonly RoutineStep[], tests: readonly DoneTest[]): boolean[] {
  const finished = new Set<string>()
  for (const test of tests) {
    if (test.endedAt !== null && !test.abandoned && test.section !== null) finished.add(`${test.mode}\n${test.section}`)
  }
  return steps.map((step) => {
    const { mode, section } = stepSection(step)
    return finished.has(`${mode}\n${section}`)
  })
}

/** The index of the first step not done, or null when every step is done or there are none. */
export function nextUp(done: readonly boolean[]): number | null {
  const index = done.indexOf(false)
  return index === -1 ? null : index
}
