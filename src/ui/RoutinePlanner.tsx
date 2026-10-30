import type { JSX } from 'preact'
import { useState } from 'preact/hooks'
import { MAX_ROUTINES } from '../core/routine.ts'
import type { Routine, RoutineDoc } from '../core/routine.ts'
import { ConfirmDialog } from './ConfirmDialog.tsx'

type Props = {
  doc: RoutineDoc
  /** Saves the whole document; resolves to null, or to a calm message when it could not be saved. */
  save(doc: RoutineDoc): Promise<string | null>
  onEdit(routine: Routine | null): void
}

const stepsText = (n: number): string => `${n} ${n === 1 ? 'step' : 'steps'}`

/** The owner's routines: make one active, edit, delete (after a confirmation), or start a new one. */
export function RoutinePlanner({ doc, save, onEdit }: Props): JSX.Element {
  const [notice, setNotice] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<Routine | null>(null)
  const [busy, setBusy] = useState(false)

  const write = async (next: RoutineDoc): Promise<void> => {
    setBusy(true)
    setNotice(null)
    setProblem(await save(next))
    setBusy(false)
    setConfirming(null)
  }
  const makeNew = (): void => {
    if (doc.routines.length >= MAX_ROUTINES) setNotice(`You can keep up to ${MAX_ROUTINES} routines.`)
    else onEdit(null)
  }

  return (
    <section class="practice__box routine__planner" aria-labelledby="routine-planner-heading">
      <h2 id="routine-planner-heading" class="practice__heading">
        Your routines
      </h2>
      {doc.routines.length === 0 ? (
        <p class="page__status">
          No routines yet. A routine is a short list of practice, ticked off as you finish each step.
        </p>
      ) : (
        <ul class="routine__list">
          {doc.routines.map((r) => (
            <li key={r.id} class="routine__row">
              <span class="routine__row-name">{r.name}</span>
              <span class="routine__row-steps">{stepsText(r.steps.length)}</span>
              {r.id === doc.active && <span class="routine__badge">Active</span>}
              <span class="routine__row-actions">
                {r.id !== doc.active && (
                  <button
                    type="button"
                    class="routine__link-button"
                    disabled={busy}
                    aria-label={`Make ${r.name} active`}
                    onClick={() => void write({ ...doc, active: r.id })}
                  >
                    Make active
                  </button>
                )}
                <button
                  type="button"
                  class="routine__link-button"
                  disabled={busy}
                  aria-label={`Edit ${r.name}`}
                  onClick={() => onEdit(r)}
                >
                  Edit
                </button>
                <button
                  type="button"
                  class="routine__link-button"
                  disabled={busy}
                  aria-label={`Delete ${r.name}`}
                  onClick={() => setConfirming(r)}
                >
                  Delete
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <p class="routine__new">
        <button type="button" class="stage0-button" disabled={busy} onClick={makeNew}>
          New routine
        </button>
      </p>
      {notice !== null && (
        <p class="page__status" role="status">
          {notice}
        </p>
      )}
      {problem !== null && (
        <p class="page__status" role="alert">
          {problem}
        </p>
      )}
      {confirming && (
        <ConfirmDialog
          title="Delete routine?"
          message={`Delete "${confirming.name}"? It can't be brought back.`}
          confirmLabel="Delete"
          busy={busy}
          onCancel={() => setConfirming(null)}
          onConfirm={() =>
            void write({
              routines: doc.routines.filter((r) => r.id !== confirming.id),
              active: doc.active === confirming.id ? null : doc.active,
            })
          }
        />
      )}
    </section>
  )
}
