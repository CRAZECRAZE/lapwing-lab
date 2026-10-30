import type { JSX } from 'preact'
import { useState } from 'preact/hooks'
import { putText } from '../api.ts'
import { MAX_TEXT_CHARS, planText, textIdFor } from '../core/realtext.ts'
import type { TextPlan } from '../core/realtext.ts'
import { navigate } from '../router.ts'
import { getPasted, setPasted } from '../state/pastedtext.ts'
import { SavedTexts } from './SavedTexts.tsx'
import { MAX_NAME_CHARS, MAX_SAVED_TEXTS, useSavedTexts } from './useSavedTexts.ts'
import { useTextLookup } from './useTextLookup.ts'
import './practice.css'
import './text.css'

/** How many of the missing words are listed. */
const MISSING_SHOWN = 20
/** The id of the unsaved, in-memory text: no saved text may take it. */
const PASTED_ID = 'pasted'

/** What Check found for the text as it stood then. */
type Checked =
  { kind: 'empty' } | { kind: 'too-long' } | { kind: 'no-words' } | { kind: 'plan'; text: string; plan: TextPlan }

/** Whole percent, never 0 while something can be stroked and never 100 while something cannot. */
function percentOf(plan: TextPlan): number {
  if (plan.covered === plan.words) return 100
  return Math.min(99, Math.max(plan.covered > 0 ? 1 : 0, Math.round((plan.covered / plan.words) * 100)))
}

function Coverage({ plan }: { plan: TextPlan }): JSX.Element {
  const more = plan.missing.length - MISSING_SHOWN
  return (
    <div class="text__coverage">
      <p class="text__line">{`${plan.covered} of ${plan.words} words can be stroked (${percentOf(plan)}%)`}</p>
      <p class="text__muted">{`Numbers and symbols skipped: ${plan.skipped}`}</p>
      {plan.missing.length > 0 && (
        <>
          <p class="text__muted">Words with no entry in the dictionary:</p>
          <ul class="text__missing">
            {plan.missing.slice(0, MISSING_SHOWN).map((m) => (
              <li key={m.word}>{`${m.word} ×${m.count}`}</li>
            ))}
          </ul>
          {more > 0 && <p class="text__muted">{`and ${more} more`}</p>}
        </>
      )}
    </div>
  )
}

function Verdict({ checked }: { checked: Checked }): JSX.Element | null {
  if (checked.kind === 'empty')
    return (
      <p class="page__status" role="status">
        There is no text to check yet.
      </p>
    )
  if (checked.kind === 'no-words')
    return (
      <p class="page__status" role="status">
        There are no words to practise in this text.
      </p>
    )
  if (checked.kind === 'too-long') {
    const limit = MAX_TEXT_CHARS.toLocaleString('en')
    return (
      <p
        class="page__status"
        role="alert"
      >{`That text is longer than ${limit} characters, the most that can be checked or saved.`}</p>
    )
  }
  return <Coverage plan={checked.plan} />
}

/** The real-text page: paste a text, see how much of it the dictionary covers, then practise it or save it. */
export function Text(): JSX.Element {
  const { lookup, retry: retryLookup } = useTextLookup()
  const { saved, retry: retryList, add, remove } = useSavedTexts()
  const [text, setText] = useState(getPasted)
  const [name, setName] = useState('')
  const [checked, setChecked] = useState<Checked | null>(null)
  const [saving, setSaving] = useState(false)
  const [note, setNote] = useState<'saved' | 'failed' | null>(null)

  const check = (): void => {
    if (lookup.status !== 'ready') return
    setNote(null)
    if (text.length > MAX_TEXT_CHARS) return setChecked({ kind: 'too-long' })
    // What was checked is kept for the run and for coming back to this page.
    setPasted(text)
    if (text.trim() === '') return setChecked({ kind: 'empty' })
    const plan = planText(text, lookup.lookup)
    setChecked(plan.words === 0 ? { kind: 'no-words' } : { kind: 'plan', text, plan })
  }

  const trimmed = name.trim()
  const full = saved.status === 'ready' && saved.texts.length >= MAX_SAVED_TEXTS
  const canSave =
    trimmed.length >= 1 && trimmed.length <= MAX_NAME_CHARS && saved.status === 'ready' && !full && !saving

  /** Why Save is disabled, when it is the owner's to know (the 50-text limit has its own note). */
  const whyNot =
    full || saving || canSave
      ? null
      : trimmed.length === 0
        ? 'Add a name to save it.'
        : trimmed.length > MAX_NAME_CHARS
          ? `Names can be up to ${MAX_NAME_CHARS} characters.`
          : saved.status === 'loading'
            ? 'Waiting for your saved texts to load.'
            : "Saving isn't available while your saved texts can't be loaded."

  const save = async (planned: { text: string }): Promise<void> => {
    if (!canSave || saved.status !== 'ready') return
    const id = textIdFor(trimmed, [...saved.texts.map((t) => t.id), PASTED_ID])
    setSaving(true)
    setNote(null)
    try {
      await putText(id, { name: trimmed, text: planned.text })
      add({ id, name: trimmed, chars: planned.text.length })
      setName('')
      setNote('saved')
    } catch {
      setNote('failed')
    }
    setSaving(false)
  }

  return (
    <div class="text">
      <h1 class="practice__title">Real text</h1>
      <section class="practice__box text__box" aria-labelledby="text-check-heading">
        <h2 id="text-check-heading" class="practice__heading">
          Practise a text
        </h2>
        {lookup.status === 'loading' && <p class="page__status">Loading the dictionary…</p>}
        {lookup.status === 'error' && (
          <p class="page__status" role="alert">
            Couldn't load the dictionary. Check that the Lapwing Lab server is still running, then try again.{' '}
            <button type="button" class="text__link-button" onClick={retryLookup}>
              Try again
            </button>
          </p>
        )}
        <label class="text__field">
          <span class="text__label">Text</span>
          <textarea
            class="text__input"
            rows={8}
            value={text}
            onInput={(e) => {
              setText((e.currentTarget as HTMLTextAreaElement).value)
              setChecked(null)
              setNote(null)
            }}
          />
        </label>
        <label class="text__field">
          <span class="text__label">Name</span>
          <input
            type="text"
            class="text__name"
            value={name}
            onInput={(e) => setName((e.currentTarget as HTMLInputElement).value)}
          />
        </label>
        <div class="text__actions">
          <button type="button" class="stage0-button" disabled={lookup.status !== 'ready'} onClick={check}>
            Check
          </button>
        </div>
        {checked && <Verdict checked={checked} />}
        {checked?.kind === 'plan' && checked.plan.covered > 0 && (
          <div class="text__actions">
            <button
              type="button"
              class="stage0-button"
              onClick={() => {
                setPasted(checked.text)
                navigate('/practice/text/run/pasted/1')
              }}
            >
              Start
            </button>
            <button type="button" class="stage0-button" disabled={!canSave} onClick={() => void save(checked)}>
              Save
            </button>
          </div>
        )}
        {whyNot && checked?.kind === 'plan' && checked.plan.covered > 0 && <p class="text__muted">{whyNot}</p>}
        {full && (
          <p class="text__muted">{`${MAX_SAVED_TEXTS} saved texts is the most that can be kept. Delete one to save another.`}</p>
        )}
        {note === 'saved' && (
          <p class="page__status" role="status">
            Saved.
          </p>
        )}
        {note === 'failed' && (
          <p class="page__status" role="alert">
            Couldn't save the text. Check that the Lapwing Lab server is still running, then try again.
          </p>
        )}
      </section>
      <SavedTexts saved={saved} retry={retryList} onDeleted={remove} />
    </div>
  )
}
