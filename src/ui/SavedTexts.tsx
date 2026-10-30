import type { JSX } from 'preact'
import { useState } from 'preact/hooks'
import { deleteText } from '../api.ts'
import type { SavedTextSummary } from '../api.ts'
import { AppLink } from './AppLink.tsx'
import { ConfirmDialog } from './ConfirmDialog.tsx'
import type { SavedTexts as Saved } from './useSavedTexts.ts'
import './text.css'

const chars = (n: number): string => `${n.toLocaleString('en')} characters`

/** The saved texts: each opens at part 1 and can be deleted, after a confirmation. */
export function SavedTexts({
  saved,
  retry,
  onDeleted,
}: {
  saved: Saved
  retry(): void
  onDeleted(id: string): void
}): JSX.Element {
  const [asking, setAsking] = useState<SavedTextSummary | null>(null)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  const confirm = async (text: SavedTextSummary): Promise<void> => {
    setBusy(true)
    try {
      await deleteText(text.id)
      onDeleted(text.id)
      setFailed(false)
    } catch {
      setFailed(true)
    }
    setBusy(false)
    setAsking(null)
  }

  let body: JSX.Element
  if (saved.status === 'loading') body = <p class="page__status">Loading…</p>
  else if (saved.status === 'error') {
    body = (
      <p class="page__status" role="alert">
        Couldn't load your saved texts. Check that the Lapwing Lab server is still running, then try again.{' '}
        <button type="button" class="text__link-button" onClick={retry}>
          Try again
        </button>
      </p>
    )
  } else if (saved.texts.length === 0) body = <p class="page__status">No saved texts yet.</p>
  else {
    body = (
      <ul class="text__saved" aria-label="Saved texts">
        {saved.texts.map((t) => (
          <li key={t.id} class="text__saved-row">
            <AppLink href={`/practice/text/run/${t.id}/1`}>{t.name}</AppLink>
            <span class="text__muted">{chars(t.chars)}</span>
            <button
              type="button"
              class="text__link-button"
              aria-label={`Delete ${t.name}`}
              onClick={() => setAsking(t)}
            >
              Delete
            </button>
          </li>
        ))}
      </ul>
    )
  }

  return (
    <section class="practice__box text__box" aria-labelledby="text-saved-heading">
      <h2 id="text-saved-heading" class="practice__heading">
        Saved texts
      </h2>
      {failed && (
        <p class="page__status" role="alert">
          Couldn't delete that text. It is still saved.
        </p>
      )}
      {body}
      {asking && (
        <ConfirmDialog
          title="Delete this text?"
          message={`${asking.name} will be removed from your saved texts. Your practice history stays.`}
          confirmLabel="Delete"
          busy={busy}
          onConfirm={() => void confirm(asking)}
          onCancel={() => setAsking(null)}
        />
      )}
    </section>
  )
}
