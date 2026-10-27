import type { JSX } from 'preact'
import { useLayoutEffect, useRef, useState } from 'preact/hooks'
import { requirementText } from '../core/progress.ts'
import { useProgress } from '../state/progress.tsx'
import { AppLink } from './AppLink.tsx'

/** Shown instead of a drill whose chapter is locked: what the blocking chapter asks for, and a way past it. */
export function LockedNotice({ chapter, blockedBy }: { chapter: number; blockedBy: number }): JSX.Element {
  const progress = useProgress()
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(false)
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

  const openAnyway = (): void => {
    if (saving) return
    setSaving(true)
    setFailed(false)
    progress.setMark(blockedBy, 'override').then(
      () => live.current && setSaving(false),
      () => {
        if (!live.current) return
        setSaving(false)
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
        <button type="button" class="stage0-button" disabled={saving} onClick={openAnyway}>
          Open anyway
        </button>
      </div>
      {failed && (
        <p class="locked__error" role="alert">
          Couldn't save that. Check that the Lapwing Lab server is still running, then try again.
        </p>
      )}
    </section>
  )
}
