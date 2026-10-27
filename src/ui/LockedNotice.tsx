import type { JSX } from 'preact'
import { useLayoutEffect, useRef, useState } from 'preact/hooks'
import { blockingChapters, chapterList, requirementText } from '../core/progress.ts'
import { useProgress } from '../state/progress.tsx'
import { AppLink } from './AppLink.tsx'
import { ConfirmDialog } from './ConfirmDialog.tsx'

/**
 * Shown instead of a drill whose chapter is locked: what the blocking chapter asks for, and a way past it.
 * `Open anyway` asks first, then moves on from every chapter that keeps this one locked.
 */
export function LockedNotice({ chapter, blockedBy }: { chapter: number; blockedBy: number }): JSX.Element {
  const progress = useProgress()
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(false)
  /** The chapters the open dialog will move on from, fixed when it opens; null while no dialog is open. */
  const [asking, setAsking] = useState<number[] | null>(null)
  const live = useRef(true)

  // Once the override lands the notice is replaced by the drill: no state update after that.
  useLayoutEffect(() => {
    live.current = true
    return () => {
      live.current = false
    }
  }, [])

  const blocker = progress.chapters.find((c) => c.chapter === blockedBy)
  const requirement = blocker ? requirementText(blocker) : `Clear Chapter ${blockedBy}`

  const ask = (): void => {
    const blocking = blockingChapters(progress.states, chapter)
    setAsking(blocking.length > 0 ? blocking : [blockedBy])
  }

  const openAnyway = (chapters: number[]): void => {
    if (saving) return
    setSaving(true)
    setFailed(false)
    progress.setMarks(chapters, 'override').then(
      () => {
        if (!live.current) return
        setSaving(false)
        setAsking(null)
      },
      () => {
        if (!live.current) return
        setSaving(false)
        setAsking(null)
        setFailed(true)
      },
    )
  }

  return (
    <section class="stage0-run locked" aria-label="Locked">
      <h2 class="locked__title">Chapter {chapter} opens after Chapter {blockedBy}</h2>
      <p class="locked__requirement">Chapter {blockedBy}: {requirement}.</p>
      <div class="locked__actions">
        <AppLink href={blocker ? `/page/${blocker.pageId}` : '/'}>{`Go to Chapter ${blockedBy}`}</AppLink>
        <button type="button" class="stage0-button" disabled={saving} onClick={ask}>
          Open anyway
        </button>
      </div>
      {failed && (
        <p class="locked__error" role="alert">
          Couldn't save that. Check that the Lapwing Lab server is still running, then try again.
        </p>
      )}
      {asking && (
        <ConfirmDialog
          title={`Open Chapter ${chapter} anyway?`}
          message={`${chapterList(asking)} will be marked as moved on anyway so Chapter ${chapter} opens. You can undo each one later.`}
          confirmLabel="Open anyway"
          busy={saving}
          onConfirm={() => openAnyway(asking)}
          onCancel={() => setAsking(null)}
        />
      )}
    </section>
  )
}
