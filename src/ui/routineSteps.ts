// How the routine pages name a step and tell whether its target is still there. Pure.
import type { PracticeIndexEntry } from '../../scripts/build-content.ts'
import type { SavedTextSummary } from '../api.ts'
import type { RoutineStep } from '../core/routine.ts'
import { describeFree, parseMode, parseSource } from '../freetype/free.ts'

/** What steps point at. `index` is empty and `texts` is null while unknown: nothing is then called unavailable. */
export type Targets = { index: readonly PracticeIndexEntry[]; texts: readonly SavedTextSummary[] | null }

/** A plain line for a step, using the text's name and the sources' labels where they are known. */
export function stepText(step: RoutineStep, targets: Targets): string {
  switch (step.kind) {
    case 'list':
      return `Section drill ${step.listId}`
    case 'free': {
      const section = `${step.source}/${step.mode}`
      const text = describeFree(section)
      return text === section ? `Free type · ${step.source} · ${step.mode}` : text
    }
    case 'fixup':
      return `Fix-up · ${step.tab}`
    case 'text': {
      const name = targets.texts?.find((t) => t.id === step.id)?.name ?? step.id
      return `Real text · ${name} · part ${step.part}`
    }
  }
}

/** False when the step's list, free-type source or saved text is known to be gone. */
export function stepAvailable(step: RoutineStep, targets: Targets): boolean {
  const { index, texts } = targets
  switch (step.kind) {
    case 'list':
      return index.length === 0 || index.some((e) => e.id === step.listId)
    case 'free':
      return (
        parseMode(step.mode) !== undefined && (index.length === 0 || parseSource(step.source, [...index]) !== undefined)
      )
    case 'fixup':
      return true
    case 'text':
      return texts === null || texts.some((t) => t.id === step.id)
  }
}
