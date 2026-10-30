import type { JSX } from 'preact'
import { useState } from 'preact/hooks'
import type { RoutineStep } from '../core/routine.ts'
import { FREE_MODES, sourcesFor } from '../freetype/free.ts'
import type { Targets } from './routineSteps.ts'
import type { SavedTexts } from './useSavedTexts.ts'
import './routine.css'

type Kind = RoutineStep['kind']
const KINDS: { id: Kind; label: string }[] = [
  { id: 'list', label: 'Section drill' },
  { id: 'free', label: 'Free type' },
  { id: 'fixup', label: 'Fix-up' },
  { id: 'text', label: 'Real text' },
]

function Field({ label, children }: { label: string; children: JSX.Element }): JSX.Element {
  return (
    <label class="routine-editor__field">
      <span class="routine-editor__label">{label}</span>
      {children}
    </label>
  )
}

type Option = { value: string; label: string }

function Select(props: {
  label: string
  value: string
  options: readonly Option[]
  onPick(value: string): void
}): JSX.Element {
  return (
    <Field label={props.label}>
      <select value={props.value} onChange={(e) => props.onPick((e.currentTarget as HTMLSelectElement).value)}>
        {props.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  )
}

const PART = /^\d+$/
const partNumber = (text: string): number => (PART.test(text.trim()) ? Number(text.trim()) : NaN)
const partOk = (n: number): boolean => n >= 1 && n <= 99

/** The "Add a step" form: a kind, then that kind's choices. `add` gets the step when the choices make a valid one. */
export function AddStep({
  targets,
  taught,
  saved,
  onAdd,
}: {
  targets: Targets
  taught: number
  /** The saved texts, as the editor loaded them. */
  saved: SavedTexts
  onAdd(step: RoutineStep): void
}): JSX.Element {
  const [kind, setKind] = useState<Kind>('list')
  const [listId, setListId] = useState('')
  const [source, setSource] = useState('')
  const [mode, setMode] = useState(FREE_MODES[0].id)
  const [tab, setTab] = useState<'words' | 'patterns'>('words')
  const [textId, setTextId] = useState('')
  const [part, setPart] = useState('1')

  const lists = targets.index.filter((e) => e.chapter <= taught).map((e) => ({ value: e.id, label: e.id }))
  const sources = sourcesFor([...targets.index]).map((s) => ({ value: s.id, label: s.label }))
  const texts = saved.status === 'ready' ? saved.texts : []
  const pick = (options: readonly Option[], current: string): string =>
    options.some((o) => o.value === current) ? current : (options[0]?.value ?? '')
  const partValue = partNumber(part)

  let step: RoutineStep | null = null
  let choices: JSX.Element
  if (kind === 'list') {
    const value = pick(lists, listId)
    if (value !== '') step = { kind, listId: value }
    choices =
      lists.length === 0 ? (
        <p class="routine-editor__hint">There are no section lists to choose from yet.</p>
      ) : (
        <Select label="List" value={value} options={lists} onPick={setListId} />
      )
  } else if (kind === 'free') {
    const value = pick(sources, source)
    step = { kind, source: value, mode }
    choices = (
      <>
        <Select label="Words from" value={value} options={sources} onPick={setSource} />
        <Select
          label="Mode"
          value={mode}
          options={FREE_MODES.map((m) => ({ value: m.id, label: m.label }))}
          onPick={setMode}
        />
      </>
    )
  } else if (kind === 'fixup') {
    step = { kind, tab }
    choices = (
      <Select
        label="Fix-up list"
        value={tab}
        options={[
          { value: 'words', label: 'Words' },
          { value: 'patterns', label: 'Patterns' },
        ]}
        onPick={(v) => setTab(v === 'patterns' ? 'patterns' : 'words')}
      />
    )
  } else {
    const options = texts.map((t) => ({ value: t.id, label: t.name }))
    const value = pick(options, textId)
    if (value !== '' && partOk(partValue)) step = { kind, id: value, part: partValue }
    choices =
      saved.status === 'loading' ? (
        <p class="routine-editor__hint">Loading…</p>
      ) : saved.status === 'error' ? (
        <p class="routine-editor__hint">Couldn't load the saved texts.</p>
      ) : options.length === 0 ? (
        <p class="routine-editor__hint">No saved texts yet. Save one on the Real text page to use it here.</p>
      ) : (
        <>
          <Select label="Saved text" value={value} options={options} onPick={setTextId} />
          <Field label="Part">
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={99}
              step={1}
              value={part}
              aria-invalid={partOk(partValue) ? undefined : 'true'}
              onInput={(e) => setPart((e.currentTarget as HTMLInputElement).value)}
            />
          </Field>
        </>
      )
  }

  return (
    <fieldset class="routine-editor__add">
      <legend class="practice__heading">Add a step</legend>
      <Select
        label="Kind"
        value={kind}
        options={KINDS.map((k) => ({ value: k.id, label: k.label }))}
        onPick={(v) => setKind(v as Kind)}
      />
      {choices}
      <button type="button" class="stage0-button" disabled={step === null} onClick={() => step && onAdd(step)}>
        Add step
      </button>
    </fieldset>
  )
}
