import { describe, expect, it } from 'vitest'
import {
  EMPTY_ROUTINES,
  MAX_ROUTINES,
  MAX_ROUTINE_NAME,
  MAX_STEPS,
  nextUp,
  stepHref,
  stepSection,
  stepsDone,
  validateRoutineDoc,
  type DoneTest,
  type RoutineDoc,
  type RoutineStep,
} from '../../src/core/routine.ts'

const FULL: RoutineDoc = {
  routines: [
    {
      id: 'morning',
      name: 'Morning warm-up',
      steps: [
        { kind: 'list', listId: '3-abc_D-1' },
        { kind: 'free', source: 'common', mode: 'words' },
        { kind: 'fixup', tab: 'patterns' },
        { kind: 'text', id: 'my-text', part: 2 },
      ],
    },
    { id: 'evening', name: 'Evening', steps: [] },
  ],
  active: 'evening',
}

function routineWith(steps: unknown[]): unknown {
  return { routines: [{ id: 'r', name: 'R', steps }], active: null }
}

describe('constants', () => {
  it('has the limits', () => {
    expect(MAX_ROUTINES).toBe(8)
    expect(MAX_STEPS).toBe(12)
    expect(MAX_ROUTINE_NAME).toBe(40)
  })
  it('has an empty doc', () => {
    expect(EMPTY_ROUTINES).toEqual({ routines: [], active: null })
  })
})

describe('validateRoutineDoc', () => {
  it('accepts the empty doc', () => {
    expect(validateRoutineDoc(EMPTY_ROUTINES)).toEqual(EMPTY_ROUTINES)
  })

  it('accepts a full doc and returns an equal copy, not the same object', () => {
    const out = validateRoutineDoc(FULL)
    expect(out).toEqual(FULL)
    expect(out).not.toBe(FULL)
    expect(out.routines[0]).not.toBe(FULL.routines[0])
    expect(out.routines[0].steps[0]).not.toBe(FULL.routines[0].steps[0])
  })

  it('accepts a null active and an active that names a routine', () => {
    expect(validateRoutineDoc({ routines: FULL.routines, active: null }).active).toBeNull()
    expect(validateRoutineDoc({ routines: FULL.routines, active: 'morning' }).active).toBe('morning')
  })

  it('rejects an active that names no routine', () => {
    expect(() => validateRoutineDoc({ routines: FULL.routines, active: 'nope' })).toThrow(/active/i)
    expect(() => validateRoutineDoc({ routines: [], active: 'x' })).toThrow(/active/i)
    expect(() => validateRoutineDoc({ routines: [] })).toThrow(/active/i)
    expect(() => validateRoutineDoc({ routines: [], active: 3 })).toThrow(/active/i)
  })

  it('rejects things that are not a doc', () => {
    for (const bad of [null, undefined, 3, 'x', [], { active: null }, { routines: 'x', active: null }]) {
      expect(() => validateRoutineDoc(bad)).toThrow()
    }
  })

  it('rejects more than 8 routines but accepts 8', () => {
    const make = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ id: `r${i}`, name: `R${i}`, steps: [] as unknown[] }))
    expect(validateRoutineDoc({ routines: make(8), active: null }).routines).toHaveLength(8)
    expect(() => validateRoutineDoc({ routines: make(9), active: null })).toThrow(/8 routines/)
  })

  it('rejects more than 12 steps but accepts 12', () => {
    const step = { kind: 'fixup', tab: 'words' }
    expect(validateRoutineDoc(routineWith(Array(12).fill(step))).routines[0].steps).toHaveLength(12)
    expect(() => validateRoutineDoc(routineWith(Array(13).fill(step)))).toThrow(/12 steps/)
  })

  it('rejects duplicate routine ids', () => {
    const doc = {
      routines: [
        { id: 'a', name: 'A', steps: [] },
        { id: 'a', name: 'B', steps: [] },
      ],
      active: null,
    }
    expect(() => validateRoutineDoc(doc)).toThrow(/same id/)
  })

  it('trims the name and rejects a blank or over-long one', () => {
    const named = (name: unknown) => ({ routines: [{ id: 'a', name, steps: [] }], active: null })
    expect(validateRoutineDoc(named('  Hi  ')).routines[0].name).toBe('Hi')
    expect(validateRoutineDoc(named('x'.repeat(40))).routines[0].name).toHaveLength(40)
    expect(() => validateRoutineDoc(named(''))).toThrow('A routine needs a name of 1 to 40 characters')
    expect(() => validateRoutineDoc(named('   '))).toThrow('A routine needs a name of 1 to 40 characters')
    expect(() => validateRoutineDoc(named('x'.repeat(41)))).toThrow('A routine needs a name of 1 to 40 characters')
    expect(() => validateRoutineDoc(named(5))).toThrow('A routine needs a name of 1 to 40 characters')
  })

  it('rejects bad routine ids', () => {
    const withId = (id: unknown) => ({ routines: [{ id, name: 'A', steps: [] }], active: null })
    for (const id of ['../x', '', 'A', 'a--b', '-a', 'a-', 'a b', 'x'.repeat(41), 7, undefined]) {
      expect(() => validateRoutineDoc(withId(id))).toThrow(/id/)
    }
    expect(validateRoutineDoc(withId('x'.repeat(40))).routines[0].id).toHaveLength(40)
  })

  it('rejects a routine that is not an object and steps that are not a list', () => {
    expect(() => validateRoutineDoc({ routines: [null], active: null })).toThrow()
    expect(() => validateRoutineDoc({ routines: [{ id: 'a', name: 'A', steps: 'x' }], active: null })).toThrow(/steps/)
  })

  it('rejects unknown step kinds and non-object steps', () => {
    expect(() => validateRoutineDoc(routineWith([{ kind: 'nope' }]))).toThrow(/step/i)
    expect(() => validateRoutineDoc(routineWith([null]))).toThrow(/step/i)
    expect(() => validateRoutineDoc(routineWith(['list']))).toThrow(/step/i)
  })

  it('checks list steps', () => {
    expect(validateRoutineDoc(routineWith([{ kind: 'list', listId: '12-a_B-c' }])).routines[0].steps).toEqual([
      { kind: 'list', listId: '12-a_B-c' },
    ])
    for (const listId of ['', 'abc', '3-', '-x', '3-a b', '../3-a', '3-a/b', 5, undefined]) {
      expect(() => validateRoutineDoc(routineWith([{ kind: 'list', listId }]))).toThrow(/list/i)
    }
  })

  it('checks free steps', () => {
    expect(validateRoutineDoc(routineWith([{ kind: 'free', source: 'a-b', mode: 'M1' }])).routines[0].steps).toEqual([
      { kind: 'free', source: 'a-b', mode: 'M1' },
    ])
    for (const bad of [
      { source: '', mode: 'x' },
      { source: 'x', mode: '' },
      { source: 'a/b', mode: 'x' },
      { source: 'x', mode: 'a_b' },
      { source: 'x'.repeat(31), mode: 'x' },
      { source: 'x', mode: 'x'.repeat(31) },
      { source: 1, mode: 'x' },
    ]) {
      expect(() => validateRoutineDoc(routineWith([{ kind: 'free', ...bad }]))).toThrow(/free/i)
    }
  })

  it('checks fix-up steps', () => {
    for (const tab of ['words', 'patterns']) {
      expect(validateRoutineDoc(routineWith([{ kind: 'fixup', tab }])).routines[0].steps).toEqual([
        { kind: 'fixup', tab },
      ])
    }
    for (const tab of ['other', '', undefined, 1]) {
      expect(() => validateRoutineDoc(routineWith([{ kind: 'fixup', tab }]))).toThrow(/fix-up/i)
    }
  })

  it('checks text steps', () => {
    expect(validateRoutineDoc(routineWith([{ kind: 'text', id: 'a-b', part: 99 }])).routines[0].steps).toEqual([
      { kind: 'text', id: 'a-b', part: 99 },
    ])
    expect(validateRoutineDoc(routineWith([{ kind: 'text', id: 'a', part: 1 }])).routines[0].steps).toHaveLength(1)
    for (const part of [0, 100, 1.5, -1, '2', undefined, NaN]) {
      expect(() => validateRoutineDoc(routineWith([{ kind: 'text', id: 'a', part }]))).toThrow(/text/i)
    }
    for (const id of ['../x', '', 'A', 7, undefined]) {
      expect(() => validateRoutineDoc(routineWith([{ kind: 'text', id, part: 1 }]))).toThrow(/text/i)
    }
  })

  it('rejects a text step for the unsaved pasted text', () => {
    expect(() => validateRoutineDoc(routineWith([{ kind: 'text', id: 'pasted', part: 1 }]))).toThrow(/saved/i)
    // an id that merely starts with it is fine
    expect(validateRoutineDoc(routineWith([{ kind: 'text', id: 'pasted-2', part: 1 }])).routines[0].steps).toHaveLength(
      1,
    )
  })

  it('drops extra fields at every level', () => {
    const doc = {
      routines: [
        {
          id: 'a',
          name: 'A',
          extra: 1,
          steps: [
            { kind: 'list', listId: '1-a', extra: 1 },
            { kind: 'free', source: 's', mode: 'm', extra: 1 },
            { kind: 'fixup', tab: 'words', extra: 1 },
            { kind: 'text', id: 't', part: 1, extra: 1 },
          ],
        },
      ],
      active: 'a',
      extra: 1,
    }
    expect(validateRoutineDoc(doc)).toEqual({
      routines: [
        {
          id: 'a',
          name: 'A',
          steps: [
            { kind: 'list', listId: '1-a' },
            { kind: 'free', source: 's', mode: 'm' },
            { kind: 'fixup', tab: 'words' },
            { kind: 'text', id: 't', part: 1 },
          ],
        },
      ],
      active: 'a',
    })
  })
})

describe('stepSection', () => {
  it('names the test mode and section a step is done by', () => {
    expect(stepSection({ kind: 'list', listId: '3-abc' })).toEqual({ mode: 'section', section: '3-abc' })
    expect(stepSection({ kind: 'free', source: 'common', mode: 'words' })).toEqual({
      mode: 'free',
      section: 'common/words',
    })
    expect(stepSection({ kind: 'fixup', tab: 'patterns' })).toEqual({ mode: 'fixup', section: 'patterns' })
    expect(stepSection({ kind: 'text', id: 'my-text', part: 2 })).toEqual({ mode: 'text', section: 'text/my-text/2' })
  })
})

describe('stepHref', () => {
  const steps: RoutineStep[] = [
    { kind: 'list', listId: '3-abc' },
    { kind: 'free', source: 'common', mode: 'words' },
    { kind: 'fixup', tab: 'words' },
    { kind: 'fixup', tab: 'patterns' },
    { kind: 'text', id: 'my-text', part: 2 },
  ]

  it('gives the page of each step', () => {
    expect(steps.map((s) => stepHref(s))).toEqual([
      '/drill/list/3-abc',
      '/practice/free/common/words',
      '/practice/fixup',
      '/practice/fixup/patterns',
      '/practice/text/run/my-text/2',
    ])
  })

  it('adds ?from=routine except on fix-up pages', () => {
    expect(steps.map((s) => stepHref(s, { fromRoutine: true }))).toEqual([
      '/drill/list/3-abc?from=routine',
      '/practice/free/common/words?from=routine',
      '/practice/fixup',
      '/practice/fixup/patterns',
      '/practice/text/run/my-text/2?from=routine',
    ])
  })

  it('leaves the link plain when fromRoutine is false', () => {
    expect(stepHref(steps[0], { fromRoutine: false })).toBe('/drill/list/3-abc')
  })
})

describe('stepsDone', () => {
  const list: RoutineStep = { kind: 'list', listId: '3-abc' }
  const fixup: RoutineStep = { kind: 'fixup', tab: 'words' }
  const test = (over: Partial<DoneTest>): DoneTest => ({
    mode: 'section',
    section: '3-abc',
    endedAt: 100,
    abandoned: false,
    ...over,
  })

  it('is all false with no tests', () => {
    expect(stepsDone([list, fixup], [])).toEqual([false, false])
  })

  it('is empty with no steps', () => {
    expect(stepsDone([], [test({})])).toEqual([])
  })

  it('counts a finished test with the same mode and section', () => {
    expect(stepsDone([list, fixup], [test({})])).toEqual([true, false])
  })

  it('does not count unfinished, abandoned or other-target tests', () => {
    expect(stepsDone([list], [test({ endedAt: null })])).toEqual([false])
    expect(stepsDone([list], [test({ abandoned: true })])).toEqual([false])
    expect(stepsDone([list], [test({ section: '4-xyz' })])).toEqual([false])
    expect(stepsDone([list], [test({ mode: 'free' })])).toEqual([false])
    expect(stepsDone([list], [test({ section: null })])).toEqual([false])
  })

  it('counts one good test among bad ones', () => {
    expect(stepsDone([list], [test({ abandoned: true }), test({ endedAt: null }), test({})])).toEqual([true])
  })

  it('marks steps with the same target done together', () => {
    expect(stepsDone([list, fixup, list], [test({})])).toEqual([true, false, true])
  })
})

describe('nextUp', () => {
  it('is the index of the first step not done', () => {
    expect(nextUp([true, false, false])).toBe(1)
    expect(nextUp([false, true])).toBe(0)
  })
  it('is null when all are done or there are no steps', () => {
    expect(nextUp([true, true])).toBeNull()
    expect(nextUp([])).toBeNull()
  })
})
