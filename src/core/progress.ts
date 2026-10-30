// Chapter gates: which chapters are cleared, which are locked, and what a chapter asks for.
// Pure: no DOM, no fetch, no Node.
import type { ChapterInfo } from '../../scripts/build-content.ts'
import type { ProgressMark, SectionResult } from '../../server/archive.ts'

export type ResultsByMode = Record<'stage0' | 'section' | 'chapter-test', SectionResult[]>

export type ChapterState = {
  chapter: number
  cleared: boolean
  how?: 'passed' | 'drills' | 'read' | 'override'
  locked: boolean
  blockedBy?: number
}

/** The first chapter whose gate can lock later ones; chapters before it are always open. */
const FIRST_GATED = 4
/** The first chapter that can be locked. */
const FIRST_LOCKABLE = 5

function passedSections(results: readonly SectionResult[] | undefined): Set<string> {
  return new Set((results ?? []).filter((r) => r.passed).map((r) => r.section))
}

/** The chapter's test result: Chapter 4 is judged by the Stage 0 test, the others by their own chapter test list. */
export function resultOf(info: ChapterInfo, results: ResultsByMode): SectionResult | undefined {
  return info.gate === 'stage0'
    ? results.stage0.find((r) => r.section === 'pseudo-test')
    : results['chapter-test'].find((r) => r.section === info.testListId)
}

/** The state of every chapter in `chapters`, keyed by chapter number. */
export function chapterStates(
  chapters: readonly ChapterInfo[],
  results: ResultsByMode,
  marks: readonly ProgressMark[],
): Map<number, ChapterState> {
  const stage0 = passedSections(results.stage0)
  const drills = passedSections(results.section)
  const tests = passedSections(results['chapter-test'])
  const markKinds = new Map(marks.map((m) => [m.chapter, m.kind]))

  function clearing(info: ChapterInfo): ChapterState['how'] | undefined {
    switch (info.gate) {
      case 'stage0':
        if (stage0.has('pseudo-test')) return 'passed'
        break
      case 'test':
        if (info.testListId !== undefined && tests.has(info.testListId)) return 'passed'
        break
      case 'drills':
        if (info.listIds.length > 0 && info.listIds.every((id) => drills.has(id))) return 'drills'
        break
      case 'read':
        if (markKinds.get(info.chapter) === 'read') return 'read'
        break
    }
    return markKinds.get(info.chapter) === 'override' ? 'override' : undefined
  }

  const ordered = [...chapters].sort((a, b) => a.chapter - b.chapter)
  const states = new Map<number, ChapterState>()
  let blockedBy: number | undefined
  for (const info of ordered) {
    const how = clearing(info)
    const locked = info.chapter >= FIRST_LOCKABLE && blockedBy !== undefined
    const state: ChapterState = { chapter: info.chapter, cleared: how !== undefined, locked }
    if (how !== undefined) state.how = how
    if (locked) state.blockedBy = blockedBy
    states.set(info.chapter, state)
    if (how === undefined && info.chapter >= FIRST_GATED && blockedBy === undefined) blockedBy = info.chapter
  }
  return states
}

/** The first chapter from 4 on that is not cleared, or the last chapter when all are. */
export function currentChapter(chapters: readonly ChapterInfo[], states: ReadonlyMap<number, ChapterState>): number {
  const ordered = [...chapters].sort((a, b) => a.chapter - b.chapter)
  const next = ordered.find((c) => c.chapter >= FIRST_GATED && !states.get(c.chapter)?.cleared)
  return (next ?? ordered[ordered.length - 1]).chapter
}

/** The newest chapter whose material counts as taught: 4 at the least, 26 (nothing hidden) when progress is unknown. */
export function taughtChapter(chapters: readonly ChapterInfo[], states: ReadonlyMap<number, ChapterState>): number {
  if (chapters.length === 0 || states.size === 0) return 26
  return Math.max(FIRST_GATED, currentChapter(chapters, states))
}

/**
 * The chapters that keep `chapter` locked: every chapter from 4 up to the one before it that has a state and is
 * not cleared, ascending. Empty when none do, or when there are no states (progress not ready: nothing is locked).
 */
export function blockingChapters(states: ReadonlyMap<number, ChapterState>, chapter: number): number[] {
  return [...states.values()]
    .filter((s) => s.chapter >= FIRST_GATED && s.chapter < chapter && !s.cleared)
    .map((s) => s.chapter)
    .sort((a, b) => a - b)
}

/** `Chapter 5`, `Chapters 5 and 6`, `Chapters 5, 6 and 7`. */
export function chapterList(chapters: readonly number[]): string {
  if (chapters.length === 1) return `Chapter ${chapters[0]}`
  const head = chapters.slice(0, -1).join(', ')
  return `Chapters ${head} and ${chapters[chapters.length - 1]}`
}

function percent(accuracy: number): string {
  return `${Math.round(accuracy * 100)}%`
}

/** What the chapter asks for, in one line. */
export function requirementText(info: ChapterInfo): string {
  const mark = info.passMark
  switch (info.gate) {
    case 'stage0': {
      let text = 'Pass the Chapter 4 test'
      if (mark) {
        text += `: ${percent(mark.accuracy)} accuracy`
        if (mark.minWpm !== undefined) text += ` and at least ${mark.minWpm} wpm`
        if (mark.maxMinutes !== undefined) text += ` within ${mark.maxMinutes} ${mark.maxMinutes === 1 ? 'minute' : 'minutes'}`
      }
      return text
    }
    case 'test': {
      let text = 'Pass the chapter test'
      if (mark) {
        text += `: ${percent(mark.accuracy)} accuracy`
        if (mark.minWpm !== undefined) text += ` and at least ${mark.minWpm} wpm`
      }
      return text
    }
    case 'drills':
      return 'Do each section drill once at 90% accuracy or better'
    case 'read':
      return 'Read the chapter, then mark it as read'
  }
}
