import { DrillSession } from './drill.ts'
import type { DrillItem, DrillRun, DrillStats, StrokeResult } from './drill.ts'
import { FIXED_STREAK } from './fixup.ts'
import type { RawStroke } from './uni.ts'

/** A run ends after this many showings even when items are still unfixed. */
export const FIXUP_MAX_SHOWINGS = 500

/** One thing to fix: its `items` are shown cyclically, one per showing. */
export type FixupTarget = { id: string; label: string; items: DrillItem[] }

export type FixupProgress = {
  target: FixupTarget | undefined
  /** 1-based number of the current target, as in "Item N of M"; 0 with no targets. */
  position: number
  total: number
  /** Clean showings in a row on the current target, 0 to FIXED_STREAK - 1. */
  streak: number
  fixed: number
  showings: number
  capped: boolean
}

/**
 * The Focus drill: one target at a time until it has FIXED_STREAK clean showings in a row.
 * Each showing is judged by a fresh single-item DrillSession, so stroke matching and undo behave as everywhere else.
 */
export class FixupSession implements DrillRun {
  readonly total: number
  private readonly targets: readonly FixupTarget[]
  private readonly clock: () => number
  private position = 0
  private inner: DrillSession | null = null
  private streak = 0
  private showings = 0
  /** Showings of the current target, so each target's items start again at items[0]. */
  private targetShowings = 0
  private clean = 0
  private fixed: string[] = []
  private capped = false
  private startedAt: number | null = null
  private lastCompletionAt: number | null = null

  constructor(targets: readonly FixupTarget[], clock: () => number = Date.now) {
    for (const t of targets) {
      if (t.items.length === 0) throw new Error(`Fix-up target ${JSON.stringify(t.id)} has no items`)
      // Validates every item with the exact messages DrillSession gives.
      new DrillSession(t.items)
    }
    this.targets = targets
    this.clock = clock
    this.total = targets.length
  }

  get index(): number {
    return this.position
  }

  get finished(): boolean {
    return this.capped || this.position >= this.total
  }

  get current(): DrillItem | undefined {
    return this.finished ? undefined : this.session().current
  }

  progress(): FixupProgress {
    return {
      target: this.finished ? undefined : this.targets[this.position],
      position: Math.min(this.position + 1, this.total),
      total: this.total,
      streak: this.streak,
      fixed: this.fixed.length,
      showings: this.showings,
      capped: this.capped,
    }
  }

  fixedIds(): string[] {
    return [...this.fixed]
  }

  submit(stroke: RawStroke): StrokeResult {
    if (this.finished) return { kind: 'ignored' }
    const now = this.clock()
    if (this.startedAt === null) this.startedAt = now

    const result = this.session().submit(stroke)
    if (result.kind === 'miss') {
      this.streak = 0
    } else if (result.kind === 'correct') {
      this.showings++
      this.targetShowings++
      if (result.firstTry) {
        this.clean++
        this.streak++
      }
      this.lastCompletionAt = now
      this.inner = null
      if (this.streak >= FIXED_STREAK) {
        this.fixed.push(this.targets[this.position].id)
        this.position++
        this.streak = 0
        this.targetShowings = 0
      }
      if (this.showings >= FIXUP_MAX_SHOWINGS && this.position < this.total) this.capped = true
    }
    return result
  }

  stats(): DrillStats {
    const elapsedMs =
      this.startedAt === null || this.lastCompletionAt === null ? 0 : this.lastCompletionAt - this.startedAt
    return {
      completed: this.showings,
      firstTryCorrect: this.clean,
      accuracy: this.showings === 0 ? 0 : this.clean / this.showings,
      elapsedMs,
      wpm: 0,
    }
  }

  /** The single-item session for the showing in progress; only call while not finished. */
  private session(): DrillSession {
    if (this.inner === null) {
      const { items } = this.targets[this.position]
      this.inner = new DrillSession([items[this.targetShowings % items.length]], this.clock)
    }
    return this.inner
  }
}
