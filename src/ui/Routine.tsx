import type { JSX } from 'preact'
import { useState } from 'preact/hooks'
import type { Routine, RoutineDoc } from '../core/routine.ts'
import { stepHref } from '../core/routine.ts'
import { isPlainClick, navigate } from '../router.ts'
import { RoutineEditor } from './RoutineEditor.tsx'
import { RoutinePlanner } from './RoutinePlanner.tsx'
import { stepText } from './routineSteps.ts'
import { saveMessage, useRoutineToday, useRoutines } from './useRoutines.ts'
import './practice.css'
import './routine.css'

function Start({ href, label }: { href: string; label: string }): JSX.Element {
  return (
    <a
      class="routine__start"
      href={href}
      aria-label={`Start ${label}`}
      onClick={(e) => {
        if (!isPlainClick(e)) return
        e.preventDefault()
        navigate(href)
      }}
    >
      Start
    </a>
  )
}

/** The active routine as a checklist. A tick is always a word as well as a mark: Done, Next up, To do. */
function Checklist({ routine }: { routine: Routine }): JSX.Element {
  const today = useRoutineToday(routine.steps)
  const count = routine.steps.length
  let body: JSX.Element
  if (count === 0) body = <p class="page__status">This routine has no steps yet.</p>
  else if (today.tests === 'loading') body = <p class="page__status">Loading…</p>
  else {
    const ticked = today.done.filter(Boolean).length
    body = (
      <>
        {today.tests === 'error' ? (
          <p class="page__status" role="status">
            Couldn't check today's tests, so nothing is ticked.
          </p>
        ) : (
          <p class="routine__count">{`${ticked} of ${count} done today`}</p>
        )}
        <ul class="routine__steps" aria-label={`Steps of ${routine.name}`}>
          {routine.steps.map((step, i) => {
            const text = stepText(step, today.targets)
            const available = today.available[i]
            const done = today.done[i] === true
            const state = !available ? 'Unavailable' : done ? 'Done' : today.next === i ? 'Next up' : 'To do'
            return (
              <li key={i} class={`routine__step routine__step--${state.toLowerCase().replace(' ', '-')}`}>
                <span class="routine__mark" aria-hidden="true">
                  {done ? '✓' : today.next === i ? '→' : '·'}
                </span>
                <span class="routine__text">{text}</span>
                <span class="routine__state">{today.tests === 'error' && available ? '' : state}</span>
                {available && !done && <Start href={stepHref(step, { fromRoutine: true })} label={text} />}
              </li>
            )
          })}
        </ul>
      </>
    )
  }
  return (
    <section class="practice__box routine__active" aria-labelledby="routine-active-heading">
      <h2 id="routine-active-heading" class="routine__name">
        {routine.name}
      </h2>
      {body}
    </section>
  )
}

type Mode = { kind: 'view' } | { kind: 'edit'; routine: Routine | null }

/** The doc with `routine` replacing the one of the same id, or added at the end (and active when none was). */
function withRoutine(doc: RoutineDoc, routine: Routine): RoutineDoc {
  if (doc.routines.some((r) => r.id === routine.id)) {
    return { ...doc, routines: doc.routines.map((r) => (r.id === routine.id ? routine : r)) }
  }
  return { routines: [...doc.routines, routine], active: doc.active ?? routine.id }
}

/** The `/practice/routine` page: today's checklist for the active routine, and the planner below it. */
export function RoutinePage(): JSX.Element {
  const routines = useRoutines()
  const [mode, setMode] = useState<Mode>({ kind: 'view' })
  const { status, doc } = routines

  if (status === 'loading') return <p class="page__status">Loading…</p>
  if (status === 'error') {
    return (
      <div class="routine">
        <h1 class="routine__title">Routine</h1>
        <p class="page__status" role="alert">
          Couldn't load your routines. Check that the Lapwing Lab server is still running, then try again.{' '}
          <button type="button" class="routine__link-button" onClick={routines.reload}>
            Try again
          </button>
        </p>
      </div>
    )
  }
  if (mode.kind === 'edit') {
    return (
      <div class="routine">
        <h1 class="routine__title">Routine</h1>
        <RoutineEditor
          routine={mode.routine}
          routines={doc.routines}
          onSave={async (routine) => {
            await routines.save(withRoutine(doc, routine))
            setMode({ kind: 'view' })
          }}
          onCancel={() => setMode({ kind: 'view' })}
        />
      </div>
    )
  }
  const active = doc.routines.find((r) => r.id === doc.active)
  return (
    <div class="routine">
      <h1 class="routine__title">Routine</h1>
      {active ? (
        <Checklist key={active.id} routine={active} />
      ) : doc.routines.length > 0 ? (
        <p class="page__status">No routine is active.</p>
      ) : null}
      <RoutinePlanner
        doc={doc}
        save={async (next) => {
          try {
            await routines.save(next)
            return null
          } catch (err) {
            return saveMessage(err)
          }
        }}
        onEdit={(routine) => setMode({ kind: 'edit', routine })}
      />
    </div>
  )
}
