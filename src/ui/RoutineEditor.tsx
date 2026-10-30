import type { JSX } from 'preact'
import { useState } from 'preact/hooks'
import { textIdFor } from '../core/realtext.ts'
import { MAX_ROUTINE_NAME, MAX_STEPS } from '../core/routine.ts'
import type { Routine, RoutineStep } from '../core/routine.ts'
import { taughtChapter } from '../core/progress.ts'
import { useProgress } from '../state/progress.tsx'
import { AddStep } from './RoutineAddStep.tsx'
import { stepAvailable, stepText } from './routineSteps.ts'
import type { Targets } from './routineSteps.ts'
import { saveMessage } from './useRoutines.ts'
import { useSavedTexts } from './useSavedTexts.ts'
import './practice.css'
import './routine.css'

type Props = {
  /** The routine being edited, or null for a new one. */
  routine: Routine | null
  /** Every routine now saved: a new routine's id is made not to clash with them. */
  routines: readonly Routine[]
  onSave(routine: Routine): Promise<void>
  onCancel(): void
}

/** The editor for one routine: a name, its steps (move, remove), and the form that adds one. Nothing is saved until Save. */
export function RoutineEditor({ routine, routines, onSave, onCancel }: Props): JSX.Element {
  const progress = useProgress()
  const saved = useSavedTexts()
  const [name, setName] = useState(routine?.name ?? '')
  const [steps, setSteps] = useState<RoutineStep[]>(routine?.steps ?? [])
  const [notice, setNotice] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const targets: Targets = {
    index: progress.index,
    texts: saved.saved.status === 'ready' ? saved.saved.texts : null,
  }
  const taught = taughtChapter(progress.chapters, progress.states)
  const trimmed = name.trim()
  const nameOk = trimmed.length >= 1 && trimmed.length <= MAX_ROUTINE_NAME

  const change = (next: RoutineStep[]): void => {
    setSteps(next)
    setNotice(null)
  }
  const move = (at: number, by: -1 | 1): void => {
    const next = [...steps]
    ;[next[at], next[at + by]] = [next[at + by], next[at]]
    change(next)
  }
  const add = (step: RoutineStep): void => {
    if (steps.length >= MAX_STEPS) setNotice(`A routine can have up to ${MAX_STEPS} steps.`)
    else change([...steps, step])
  }
  const save = async (): Promise<void> => {
    setBusy(true)
    setProblem(null)
    const id =
      routine?.id ??
      textIdFor(
        trimmed,
        routines.map((r) => r.id),
      )
    try {
      await onSave({ id, name: trimmed, steps })
    } catch (err) {
      setProblem(saveMessage(err))
    }
    setBusy(false)
  }

  return (
    <section class="practice__box routine-editor" aria-labelledby="routine-editor-heading">
      <h2 id="routine-editor-heading" class="practice__heading">
        {routine ? 'Edit routine' : 'New routine'}
      </h2>
      <label class="routine-editor__field">
        <span class="routine-editor__label">Name</span>
        <input
          type="text"
          value={name}
          aria-describedby="routine-editor-name-hint"
          aria-invalid={nameOk || name === '' ? undefined : 'true'}
          onInput={(e) => setName((e.currentTarget as HTMLInputElement).value)}
        />
      </label>
      <p
        id="routine-editor-name-hint"
        class="routine-editor__hint"
      >{`A name of 1 to ${MAX_ROUTINE_NAME} characters.`}</p>
      {steps.length === 0 ? (
        <p class="routine-editor__hint">No steps yet.</p>
      ) : (
        <ol class="routine-editor__steps" aria-label="Steps">
          {steps.map((step, i) => {
            const text = stepText(step, targets)
            return (
              <li key={i} class="routine-editor__step">
                <span class="routine-editor__step-text">{text}</span>
                {!stepAvailable(step, targets) && <span class="routine-editor__note">Unavailable</span>}
                <span class="routine-editor__step-actions">
                  <button
                    type="button"
                    class="routine__link-button"
                    disabled={i === 0}
                    aria-label={`Move up ${text}`}
                    onClick={() => move(i, -1)}
                  >
                    Move up
                  </button>
                  <button
                    type="button"
                    class="routine__link-button"
                    disabled={i === steps.length - 1}
                    aria-label={`Move down ${text}`}
                    onClick={() => move(i, 1)}
                  >
                    Move down
                  </button>
                  <button
                    type="button"
                    class="routine__link-button"
                    aria-label={`Remove ${text}`}
                    onClick={() => change(steps.filter((_, j) => j !== i))}
                  >
                    Remove
                  </button>
                </span>
              </li>
            )
          })}
        </ol>
      )}
      <AddStep targets={targets} taught={taught} saved={saved.saved} onAdd={add} />
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
      <div class="routine-editor__actions">
        <button type="button" class="stage0-button" disabled={!nameOk || busy} onClick={() => void save()}>
          Save
        </button>
        <button type="button" class="stage0-button" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </section>
  )
}
