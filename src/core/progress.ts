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
